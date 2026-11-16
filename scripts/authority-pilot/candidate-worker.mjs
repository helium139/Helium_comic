// Local candidate only. Not deployed. Workload guards remain in fixture controller.
import {createLocalJWKSet,jwtVerify} from 'jose';
import {createAuthority} from '../../worker/view-runtime/authority.mjs';
import {createAuthorityRuntime} from '../../worker/view-runtime/authority-runtime.mjs';
import {createGoogleIdentityBridge} from '../../worker/view-runtime/google-identity-bridge.mjs';
import {googleAccessTokenSupplier} from '../../worker/view-runtime/google-access-token.mjs';
import {teamRegistry} from '../../worker/view-runtime/team-registry.mjs';
// Fixture deployment only; never import this entry from the CMS/production Worker.
globalThis.fetch=async()=>{throw Error('External network disabled in isolated mock fixture');};
let isolateTag,seen=0,keys,oauth,catalogue,registryText;
function candidateCatalogue(mode){
 if(mode==='full'){
  const text=JSON.stringify(Array.from({length:200},(_,i)=>({id:i===0?'a':i===1?'b':'team-'+i,active:true}))).padEnd(65536,' ');
  return teamRegistry({fetchImpl:async()=>new Response(text)});
 }
 if(mode!=='validator')throw Error('Explicit reviewed registry variant required');
 return catalogue ||= teamRegistry({fetchImpl:async(_url,options)=>{
  if(options.headers['If-None-Match']==='"fixture-v1"')return new Response(null,{status:304});
  registryText ||= JSON.stringify(Array.from({length:200},(_,i)=>({id:i===0?'a':i===1?'b':'team-'+i,active:true}))).padEnd(65536,' ');
  return new Response(registryText,{headers:{ETag:'"fixture-v1"'}});
 }});
}
function trackedDB(raw,metrics){
 const observe=r=>{metrics.rowsRead+=r.meta.rows_read||0;metrics.rowsWritten+=r.meta.rows_written||0;metrics.databaseBytes=Math.max(metrics.databaseBytes,Number(r.meta.size_after)||0);return r;};
 const wrap=q=>({bind:(...a)=>wrap(q.bind(...a)),run:async()=>observe(await q.run()),all:async()=>observe(await q.all()),first:async()=>observe(await q.all()).results[0]||null});
 return {prepare:sql=>wrap(raw.prepare(sql))};
}
export default {async fetch(request,env){
 if(!env.PILOT_KEY||request.headers.get('X-Helium-Pilot-Key')!==env.PILOT_KEY)return new Response('Denied',{status:403});
 isolateTag ||= crypto.randomUUID();
 const url=new URL(request.url),caseId=url.searchParams.get('pilotCase');
 if(!/^[a-z0-9-]{1,64}$/.test(caseId||''))return new Response('Invalid fixture case',{status:400});
 const metrics={caseId,rowsRead:0,rowsWritten:0,databaseBytes:0,isolateTag,isolateFirst:seen++===0,cryptoCase:request.headers.get('X-Helium-Pilot-Crypto')||'warm',mockCalls:0};
 const db=trackedDB(env.DB,metrics),isSet=url.pathname==='/setUserAccess';
 const reservation=await db.prepare('UPDATE fixture_budget SET requests=requests+1,reserved_read=reserved_read+64,reserved_write=reserved_write+32,sets=sets+? WHERE id=1 AND requests<250 AND reserved_read+64<=5000 AND reserved_write+32<=2000 AND sets+?<=12 AND expires>? RETURNING id').bind(isSet?1:0,isSet?1:0,Date.now()).all();
 if(!reservation.results.length)return new Response('Fixture budget/expiry exhausted',{status:429});
 let response;
 try{
  if(metrics.cryptoCase==='forced-key-cold'){keys=null;oauth=null;}
  keys ||= createLocalJWKSet({keys:[JSON.parse(env.FIXTURE_PUBLIC_JWK)]});
  const read=async uid=>{const row=await db.prepare('SELECT body FROM fixture_google WHERE uid=?').bind(uid).first();return row?JSON.parse(row.body):null;};
  const write=async(uid,row)=>db.prepare('UPDATE fixture_google SET body=? WHERE uid=?').bind(JSON.stringify(row),uid).run();
  const scenario=request.headers.get('X-Helium-Pilot-Scenario')||'';
  async function mockFetch(input,options={}){
   metrics.mockCalls++;const address=String(input),u=new URL(address);
   if(address==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-only',expires_in:3600});
   if(!['identitytoolkit.googleapis.com','firestore.googleapis.com'].includes(u.hostname)||!u.pathname.includes('/projects/demo-authority-fixture/'))throw Error('Nonfixture Google project blocked');
   const body=options.body?JSON.parse(options.body):null;
   if(u.pathname.endsWith('/accounts:lookup')){const uid=body.localId[0],row=await read(uid);return Response.json({users:row?[{localId:uid,customAttributes:JSON.stringify(row.claims),disabled:scenario==='disabled'||row.disabled,validSince:scenario==='revoked'?String(Math.floor(Date.now()/1000)):0}]:[]});}
   if(u.pathname.endsWith('/accounts:update')){if(scenario==='fail-claims')return Response.json({},{status:503});const row=await read(body.localId);row.claims=JSON.parse(body.customAttributes);await write(body.localId,row);return Response.json({});}
   const match=/\/(authzMirrors|users)\/([^/]+)$/.exec(u.pathname);if(!match)throw Error('Unsupported fixture Google path');
   const uid=decodeURIComponent(match[2]),row=await read(uid);if(!row)return Response.json({},{status:404});
   if(options.method==='GET')return Response.json({fields:row.mirror,updateTime:'v'+row.mirrorVersion});
   if(options.method!=='PATCH')throw Error('Unsupported fixture method');
   if(match[1]==='authzMirrors'){
    if(u.searchParams.get('currentDocument.exists')==='false'||u.searchParams.get('currentDocument.updateTime')!=='v'+row.mirrorVersion)return Response.json({},{status:409});
    row.mirror=body.fields;row.mirrorVersion++;
   }else {for(const field of u.searchParams.getAll('updateMask.fieldPaths')){if(body.fields[field])row.profile[field]=body.fields[field];else delete row.profile[field];}}
   await write(uid,row);return Response.json({});
  }
  oauth ||= googleAccessTokenSupplier({serviceAccountJSON:env.FIXTURE_SERVICE_ACCOUNT,fetchImpl:mockFetch});
  const bridge=createGoogleIdentityBridge({project:'demo-authority-fixture',getAccessToken:oauth,fetchImpl:mockFetch});
  // OAuth cached fetch captures its first invocation only; token request has no DB
  // operations. Per-request bridge always uses the current tracked DB closure.
  const catalogue=candidateCatalogue(env.PILOT_REGISTRY_MODE||'validator');
  const authority=createAuthority({db,bridge,catalogue});
  const runtime=createAuthorityRuntime({authority,catalogue,verifyToken:async token=>{
   const {payload,protectedHeader}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:'https://authority-fixture.invalid',audience:'authority-pilot',requiredClaims:['sub','iat','exp','auth_time']});const now=Math.floor(Date.now()/1000);
   if(typeof protectedHeader.kid!=='string'||!protectedHeader.kid||payload.aud!=='authority-pilot'||typeof payload.sub!=='string'||!payload.sub.trim()||payload.sub.length>128||!Number.isFinite(payload.iat)||payload.iat<0||payload.iat>now||!Number.isFinite(payload.auth_time)||payload.auth_time<0||payload.auth_time>now||payload.auth_time>payload.iat||payload.exp<=payload.iat)throw Error('Invalid fixture ID token claims');
   return {uid:payload.sub,role:payload.role,teamId:payload.teamId,accessVersion:payload.accessVersion};
  }});
  response=await runtime.fetch(request,{DB:db,AUTHORITY_ENABLED:'true'});
 }catch{response=Response.json({error:{status:'UNAVAILABLE',message:'Fixture failure'}},{status:503});}
 // Settle includes this final update itself (one PK read + one write).
 const readCharge=metrics.rowsRead+1,writeCharge=metrics.rowsWritten+1;
 if(readCharge>64||writeCharge>32||metrics.databaseBytes<=0||metrics.databaseBytes>1048576){await db.prepare('UPDATE fixture_budget SET expires=0 WHERE id=1').run();return new Response('Fixture bound exceeded/unverified; stopped',{status:503});}
 await db.prepare('UPDATE fixture_budget SET reserved_read=reserved_read-?,reserved_write=reserved_write-? WHERE id=1').bind(64-readCharge,32-writeCharge).run();
 const headers=new Headers(response.headers);headers.set('X-Helium-Pilot-Metrics',JSON.stringify(metrics));
 console.log(JSON.stringify({pilotCase:caseId,operation:request.method==='OPTIONS'?'OPTIONS':url.pathname.slice(1),...metrics}));
 return new Response(response.body,{status:response.status,headers});
}};
