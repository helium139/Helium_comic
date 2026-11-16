// One process, one localhost request. No cloud URL, provisioning, credentials or SQL.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectResponse,responseMetadata} from './response-diagnostics.mjs';
const terminalStates=new Set(['response-saved','transport-error','timeout','interrupted-unknown']);
export class PersistenceError extends Error{constructor(){super('Persistence failed; preserve journal; do not replay');this.name='PersistenceError';}}
export const disk={
 append(file,row){const fd=fs.openSync(file,'a',0o600);try{fs.writeFileSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
 replace(file,row){const tmp=file+'.'+process.pid+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(row,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
};
function alive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
export function readLocalState(dir,{isAlive=alive}={}){
 const file=path.join(dir,'journal.jsonl');if(!fs.existsSync(file))return {state:'no-journal',outcome:'unknown',mayReplay:false};
 const text=fs.readFileSync(file,'utf8'),lines=text.split('\n'),records=[];let corrupt=!text.endsWith('\n');
 for(const line of lines.filter(Boolean)){try{records.push(JSON.parse(line));}catch{corrupt=true;break;}}
 const issued=records.find(r=>r.state==='issued'),terminal=records.findLast(r=>terminalStates.has(r.state)),owner=records[0]?.pid;
 if(corrupt)return {state:'journal-incomplete',outcome:'unknown',mayReplay:false,issued:!!issued};
 if(terminal)return {...terminal,mayReplay:false};
 if(issued)return {state:isAlive(owner)?'in-flight':'interrupted-unknown',outcome:'unknown',issued:true,pid:owner,mayReplay:false};
 return {state:isAlive(owner)?'preparing':'not-issued',outcome:'not-issued',issued:false,mayReplay:false};
}
function validate(url,method,timeoutMs,id){const u=new URL(url);if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||!['GET','POST'].includes(method)||!Number.isSafeInteger(timeoutMs)||timeoutMs<50||timeoutMs>5000||!/^[a-z0-9-]{1,64}$/.test(id))throw Error('Bounded literal-loopback HTTP request required');}
export async function runLocalRequest({url,dir,method='GET',timeoutMs=1000,id='local-once',body,expectedIdentity,io=disk,fetchImpl=fetch}){
 validate(url,method,timeoutMs,id);dir=path.resolve(dir);try{fs.mkdirSync(dir);}catch(error){if(error.code==='EEXIST')throw error;throw new PersistenceError();} // exclusive owner; existing runs can NEVER resume/replay
 const journal=path.join(dir,'journal.jsonl'),resultFile=path.join(dir,'result.json'),runId=randomUUID();let sequence=0;
 const append=row=>{try{io.append(journal,{seq:++sequence,pid:process.pid,runId,id,at:new Date().toISOString(),...row});}catch{throw new PersistenceError();}};
 append({state:'prepared',outcome:'not-issued',workloadLimit:1,sqlUsage:{read:0,write:0}});
 const controller=new AbortController();let timer,active=true,lastHeaders=null;
 let interrupt;const signalResult=new Promise(resolve=>{interrupt=signal=>{controller.abort();resolve({state:'interrupted-unknown',outcome:'unknown',reason:signal,diagnostic:lastHeaders});};});
 const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
 let result;
 try{
  append({state:'issued',outcome:'unknown',method,sqlUsage:{read:0,write:0},reservationHeld:true});
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({state:'timeout',outcome:'unknown',diagnostic:lastHeaders});},timeoutMs);}); // ref'ed timer: pending work cannot silently exit0
  const operation=(async()=>{
   const response=await fetchImpl(url,{method,body:method==='POST'?body:undefined,redirect:'manual',signal:controller.signal});
   if(!active)throw Error('inactive');lastHeaders=responseMetadata(response,url);append({state:'headers-received',outcome:'unknown',diagnostic:lastHeaders});
   const inspected=await inspectResponse(response,{url,id,metrics:false}); // one consumer, NO clone/tee
   if(!active)throw Error('inactive');
   if(inspected.kind==='response-loss')return {state:'transport-error',outcome:'unknown',reason:'body-lost',diagnostic:inspected.diagnostic};
   let identity;
   if(expectedIdentity){const b=inspected.body;identity={protocolMatches:b?.protocol==='authority-pilot/v2',versionMatches:b?.deployment?.versionId===expectedIdentity.versionId,fingerprintMatches:b?.deployment?.buildId===expectedIdentity.buildId,modeMatches:b?.deployment?.mode===expectedIdentity.mode};}
   return {state:'response-saved',outcome:'response-observed',protocolOK:inspected.ok,httpOK:response.ok,failure:inspected.kind||null,diagnostic:inspected.diagnostic,...(identity?{identity}:{})};
  })().catch(error=>{if(error instanceof PersistenceError)throw error;return {state:'transport-error',outcome:'unknown',reason:'connection-lost',diagnostic:lastHeaders};});
  result=await Promise.race([operation,deadline,signalResult]);active=false;controller.abort();
  append(result); // authoritative record committed/fsync BEFORE result projection
  try{io.replace(resultFile,{id,pid:process.pid,runId,...result});}catch{throw new PersistenceError();}
  return result;
 }finally{active=false;controller.abort();clearTimeout(timer);process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
}
