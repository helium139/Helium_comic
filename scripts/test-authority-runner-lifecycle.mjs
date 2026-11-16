import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runLocalRequest,readLocalState,disk,PersistenceError} from './authority-pilot/local-request.mjs';
import {identifyActiveVersion} from './authority-pilot/active-version.mjs';
const base=path.resolve('.local/lifecycle-tests');fs.mkdirSync(base,{recursive:true});
const evidence={scope:'localhost only; no cloud, credentials, SQL or historical reservations',cases:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<200;i++){const value=fn();if(value)return value;await sleep(10);}throw Error('Local condition not reached');}
function start(args,{ipc=false}={}){const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe',...(ipc?['ipc']:[])]});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const closed=once(child,'close').then(([code,signal])=>({code,signal,stdout,stderr}));return {child,closed};}
function events(dir){try{return fs.readFileSync(path.join(dir,'journal.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}}
test('single-process lifecycle against actual localhost HTTP, including former lost-result reproduction',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'run-')),requests=[];let syntheticWrites=0;const timers=new Set();
 const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);};
 const server=http.createServer((req,res)=>{requests.push(req.url);const route=req.url.split('?')[0];
  if(route==='/write'){assert.equal(req.method,'POST');syntheticWrites++;later(()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"result":{"ok":true}}');}},300);return;}
  if(route==='/drop'){req.socket.destroy();return;}
  if(route==='/drop-body'){res.writeHead(200,{'Content-Type':'application/json','Content-Length':'10000'});res.flushHeaders();res.write('{"result":');later(()=>res.destroy(),30);return;}
  if(route==='/slow-body'){res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{"result":');later(()=>{if(!res.destroyed)res.end('{}}');},1200);return;}
  if(route==='/slow'){later(()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"result":{"ok":true}}');}},300);return;}
  if(route==='/redirect'){res.writeHead(302,{Location:'https://outside.invalid/private?token=synthetic-private'});res.end();return;}
  if(route.startsWith('/http-')){res.writeHead(Number(route.slice(6)),{'Content-Type':'application/json'});res.end('{"error":{"status":"UNAVAILABLE","message":"synthetic-private"}}');return;}
  if(route==='/large'||route==='/html'){res.writeHead(200,{'Content-Type':'text/html',Connection:'close'});res.end('<html>'+('synthetic-private '.repeat(route==='/large'?1000:2))+'</html>');return;}
  if(route==='/identity'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({protocol:'authority-pilot/v2',deployment:{versionId:'200c526c-1e9f-41c0-86f8-03a725ee2f2a',buildId:'a'.repeat(64),mode:'full'}}));return;}
  res.writeHead(200,{'Content-Type':'application/json',Connection:'close'});res.end('{"result":{"ok":true}}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));});
 const folder=name=>path.join(tmp,name);
 await t.test('BEFORE: frozen async-IIFE clone reader exits0 at inspect-clone without finally',async()=>{
  const file=path.join(tmp,'legacy.jsonl');fs.writeFileSync(file,'');const p=start(['scripts/authority-pilot/test-fixtures/legacy-clone-child.mjs',origin+'/large',file]);const killer=setTimeout(()=>p.child.kill('SIGKILL'),2500);const end=await p.closed;clearTimeout(killer);const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(end.code,0);assert.ok(rows.some(r=>r.state==='headers'&&r.status===200));assert.ok(!rows.some(r=>r.state==='finally'));assert.equal(rows.at(-1).phase,'inspect-clone');assert.equal(rows.at(-1).finished,false);
  evidence.before={nodeExitCode:end.code,serverResponse:200,phase:rows.at(-1).phase,finallyRan:false,responseSaved:false};
 });
 for(const [name,route,status,failure]of [['json','/',200,null],['large-html','/large',200,'parse-error'],['html','/html',200,'parse-error'],['redirect','/redirect',302,'redirect'],...['401','403','404','500','503'].map(n=>['http-'+n,'/http-'+n,Number(n),null])])await t.test('AFTER: '+name+' response committed before exit',async()=>{
  const dir=folder(name),before=requests.length,p=start(['scripts/authority-pilot/local-runner.mjs',origin+route,dir,'2000']);const end=await p.closed,state=readLocalState(dir);assert.equal(end.code,0,end.stderr);assert.equal(state.state,'response-saved');assert.equal(state.diagnostic.status,status);if(failure)assert.equal(state.failure,failure);assert.ok(fs.existsSync(path.join(dir,'result.json')));assert.equal(requests.length-before,1);assert.ok(!fs.readFileSync(path.join(dir,'journal.jsonl'),'utf8').includes('synthetic-private'));evidence.cases.push({case:name,state:state.state,status,exitCode:end.code});
 });
 for(const [name,route,timeout,state,status]of [['slow-success','/slow',2000,'response-saved',200],['connection-loss','/drop',2000,'transport-error',null],['body-loss','/drop-body',2000,'transport-error',200],['timeout-headers','/slow',80,'timeout',null],['timeout-body','/slow-body',150,'timeout',200]])await t.test(name+' terminal persisted with no retry',async()=>{
  const dir=folder(name),before=requests.length,p=start(['scripts/authority-pilot/local-runner.mjs',origin+route,dir,String(timeout)]);const end=await p.closed,s=readLocalState(dir);assert.equal(s.state,state,end.stderr);if(status)assert.equal(s.diagnostic.status,status);assert.ok(fs.existsSync(path.join(dir,'result.json')));assert.equal(requests.length-before,1);assert.equal(events(dir).filter(r=>r.state==='issued').length,1);evidence.cases.push({case:name,state:s.state,status:s.diagnostic?.status??null,exitCode:end.code});
 });
 await t.test('reading in-flight is not zero/unsent; exclusive folder prevents second request',async()=>{
  const dir=folder('inflight'),before=requests.length;const pending=runLocalRequest({url:origin+'/slow',dir,timeoutMs:2000});await waitFor(()=>events(dir).some(r=>r.state==='issued'));assert.equal(readLocalState(dir).state,'in-flight');assert.equal(readLocalState(dir).outcome,'unknown');assert.equal(readLocalState(dir).mayReplay,false);assert.equal(fs.existsSync(path.join(dir,'result.json')),false);await assert.rejects(runLocalRequest({url:origin+'/',dir}),/EEXIST/);await pending;assert.equal(requests.length-before,1);assert.equal(readLocalState(dir).state,'response-saved');evidence.cases.push({case:'inflight-read-and-no-replay',passed:true});
 });
 await t.test('hard process kill leaves durable issued/unknown, never becomes unsent',async()=>{
  const dir=folder('kill'),p=start(['scripts/authority-pilot/test-fixtures/local-run-child.mjs',origin+'/slow-body',dir,'3000']);await waitFor(()=>events(dir).some(r=>r.state==='headers-received'));p.child.kill('SIGKILL');await p.closed;const s=readLocalState(dir);assert.equal(s.state,'interrupted-unknown');assert.equal(s.outcome,'unknown');assert.equal(s.mayReplay,false);assert.equal(events(dir).find(r=>r.state==='issued').outcome,'unknown');const before=requests.length;await assert.rejects(runLocalRequest({url:origin+'/',dir}),/EEXIST/);assert.equal(requests.length,before);evidence.cases.push({case:'hard-kill',state:s.state});
 });
 await t.test('graceful signal handler persists interrupted unknown before exit',async()=>{
  const dir=folder('signal'),p=start(['scripts/authority-pilot/test-fixtures/local-run-child.mjs',origin+'/slow-body',dir,'3000','ipc-signal'],{ipc:true});await waitFor(()=>events(dir).some(r=>r.state==='headers-received'));p.child.send('interrupt');await p.closed;assert.equal(readLocalState(dir).state,'interrupted-unknown');assert.ok(fs.existsSync(path.join(dir,'result.json')));evidence.cases.push({case:'graceful-SIGTERM-handler-via-test-IPC',state:'interrupted-unknown'});
 });
 for(const fault of ['prepared','issued','headers-received','response-saved','projection'])await t.test('storage failure '+fault+' never replays or masks missing durability',async()=>{
  const dir=folder('fault-'+fault),before=requests.length,io={append(file,row){if(row.state===fault)throw Error('ENOSPC synthetic-private');disk.append(file,row);},replace(file,row){if(fault==='projection')throw Error('EIO synthetic-private');disk.replace(file,row);}};
  if(fault==='prepared')await assert.rejects(runLocalRequest({url:origin+'/',dir:path.join(tmp,'missing-parent','child')}),PersistenceError);
  await assert.rejects(runLocalRequest({url:origin+'/',dir,io}),PersistenceError);assert.equal(requests.length-before,['prepared','issued'].includes(fault)?0:1);
  const s=readLocalState(dir,{isAlive:()=>false});if(fault==='projection')assert.equal(s.state,'response-saved');if(['headers-received','response-saved'].includes(fault))assert.equal(s.state,'interrupted-unknown');assert.equal(s.mayReplay,false);evidence.cases.push({case:'storage-'+fault,state:s.state,requests:requests.length-before});
 });
 await t.test('timed-out POST keeps unknown and is never replayed',async()=>{
  const dir=folder('write-timeout'),before=syntheticWrites;const result=await runLocalRequest({url:origin+'/write',dir,method:'POST',body:'synthetic-only',timeoutMs:100});assert.equal(result.state,'timeout');assert.equal(syntheticWrites,before+1);await assert.rejects(runLocalRequest({url:origin+'/write',dir,method:'POST'}),/EEXIST/);assert.equal(syntheticWrites,before+1);evidence.cases.push({case:'POST-timeout-no-replay',writes:1,state:result.state});
 });
 for(const fault of ['fail-terminal','fail-projection'])await t.test('child storage failure exit74 '+fault,async()=>{
  const dir=folder(fault),p=start(['scripts/authority-pilot/test-fixtures/local-run-child.mjs',origin+'/',dir,'1000',fault]);const end=await p.closed;assert.equal(end.code,74);const s=readLocalState(dir);assert.equal(s.state,fault==='fail-terminal'?'interrupted-unknown':'response-saved');assert.equal(s.mayReplay,false);evidence.cases.push({case:fault,state:s.state,exitCode:end.code});
 });
 await t.test('truncated journal tail is explicit unknown',async()=>{const dir=folder('torn');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'journal.jsonl'),JSON.stringify({state:'issued',pid:999999,outcome:'unknown'})+'\n{"state":"res');assert.equal(readLocalState(dir).state,'journal-incomplete');assert.equal(readLocalState(dir).outcome,'unknown');});
 await t.test('metadata fixtures: deployment/version IDs and mismatched runtime fingerprints',async()=>{
  const v='200c526c-1e9f-41c0-86f8-03a725ee2f2a',expected={versionId:v,buildId:'a'.repeat(64),mode:'full'};assert.equal(identifyActiveVersion({deployments:[{id:'separate-deployment',versions:[{version_id:v,percentage:100}]}]},v.replaceAll('-','')).versionId,v);
  const good=await runLocalRequest({url:origin+'/identity',dir:folder('identity-good'),expectedIdentity:expected});assert.ok(Object.values(good.identity).every(Boolean));
  const bad=await runLocalRequest({url:origin+'/identity',dir:folder('identity-bad'),expectedIdentity:{...expected,buildId:'b'.repeat(64),versionId:'00000000-0000-4000-8000-000000000001'}});assert.equal(bad.identity.fingerprintMatches,false);assert.equal(bad.identity.versionMatches,false);evidence.cases.push({case:'metadata-fixtures',passed:true});
 });
 await t.test('public/cloud URLs rejected before any request or folder creation',async()=>{const dir=folder('no-cloud');await assert.rejects(runLocalRequest({url:'https://api.cloudflare.com/',dir}),/loopback/);assert.equal(fs.existsSync(dir),false);});
 evidence.allPassed=true;fs.writeFileSync(path.resolve('docs/migration-evidence/authority-runner-lifecycle-local.json'),JSON.stringify(evidence,null,2)+'\n');
});
