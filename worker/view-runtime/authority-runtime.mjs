import {installAuthority} from './authority.mjs';
import {boundAuthority,requireFreeCapacity} from './bindings.mjs';
import {verifyFirebaseToken} from '../source/firebase-auth.js';
import {teamRegistry} from './team-registry.mjs';

// Independent entry point: no view/report schema, HMAC or Sheets credential.
export async function installAuthorityPackage(db){
 await installAuthority(db);
 await db.prepare("CREATE TABLE migration_gate(id INTEGER PRIMARY KEY CHECK(id=1),verified INTEGER NOT NULL DEFAULT 0,evidence_hash TEXT,free_features TEXT NOT NULL DEFAULT '[]',free_expires INTEGER NOT NULL DEFAULT 0)").run();
 await db.prepare('INSERT INTO migration_gate(id) VALUES(1)').run();
}
export function createAuthorityRuntime({verifyToken=verifyFirebaseToken,authority,catalogue=teamRegistry(),clock=Date.now}={}){
 const allowed=new Set(['https://heliumtg.com','https://www.heliumtg.com']);
 return {async fetch(request,env){
  const origin=request.headers.get('origin'),cors=origin&&allowed.has(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
  const reply=(body,status)=>Response.json(body,{status,headers:cors});
  if(env.AUTHORITY_ENABLED!=='true')return reply({error:{status:'UNAVAILABLE'}},503);
  if(origin&&!allowed.has(origin))return reply({error:{status:'PERMISSION_DENIED'}},403);
  const name=new URL(request.url).pathname.slice(1);
  if(!['getCurrentAccess','setUserAccess'].includes(name))return reply({error:{status:'NOT_FOUND'}},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST'}});
  if(request.method!=='POST')return reply({error:{status:'INVALID_ARGUMENT'}},405);
  try{
   const match=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization')||'');if(!match||match[1].length>16384)throw Object.assign(Error(),{code:'unauthenticated'});
   let verified;try{verified=await verifyToken(match[1]);}catch{throw Object.assign(Error(),{code:'unauthenticated'});}
   await requireFreeCapacity(env.DB,['authority'],clock);
   const text=await request.text();if(text.length>2048)throw Object.assign(Error(),{code:'invalid-argument'});
   const body=JSON.parse(text);if(!body||Object.keys(body).some(k=>k!=='data')||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw Object.assign(Error(),{code:'invalid-argument'});
   const keys=Object.keys(body.data);if(keys.some(k=>!(name==='setUserAccess'?['uid','role','teamId']:[]).includes(k)))throw Object.assign(Error(),{code:'invalid-argument'});
   const provider=authority||boundAuthority(env,{catalogue,clock});
   const actor=await provider.resolve(verified,match[1]);if(!actor||actor.uid!==verified.uid)throw Object.assign(Error(),{code:'permission-denied'});
   return reply({result:name==='getCurrentAccess'?actor:await provider.changeAccess(body.data,actor)},200);
  }catch(error){const code=error.code||'unavailable',status={unauthenticated:401,'permission-denied':403,'invalid-argument':400,'failed-precondition':412,aborted:409,'resource-exhausted':429}[code]||503;return reply({error:{status:code.toUpperCase().replaceAll('-','_'),message:'Authority operation failed'}},status);}
 }};
}
export default createAuthorityRuntime();
