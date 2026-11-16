import test from 'node:test';
import assert from 'node:assert/strict';
import {runMeasurementClient,pilotBudget} from './authority-pilot/control.mjs';
import {checkReadiness,requireReadiness} from './authority-pilot/readiness-client.mjs';
import {readinessResponse} from './authority-pilot/readiness-handler.mjs';
import {inspectResponse,responseLimit} from './authority-pilot/response-diagnostics.mjs';
const host='helium-authority-fixture-local.example.workers.dev',url='https://'+host+'/',deployment={versionId:'00000000-0000-4000-8000-000000000001',buildId:'a'.repeat(64),mode:'full'};
const meta={caseId:'resolve',rowsRead:3,rowsWritten:0,databaseBytes:65536,isolateFirst:false,isolateTag:'local'};
function config(fetchImpl,extra={}){return {baseURL:url,approvedHost:host,pilotSecret:'private-pilot-key',getSyntheticJWT:async()=>'private-jwt',steps:[{id:'resolve',name:'getCurrentAccess',cryptoCase:'warm',expectStatus:200}],fetchImpl,...extra};}
for(const [label,status,contentType,body,kind]of [
 ['401 JSON',401,'application/json','{"error":{"status":"UNAUTHENTICATED","message":"private-token"}}','authentication-or-authorization'],
 ['403 HTML',403,'text/html','<html><title>private-person@example.invalid</title></html>','authentication-or-authorization'],
 ['404 HTML',404,'text/html','<html>not found private-token</html>','http-error'],
 ['500 JSON',500,'application/json','{"error":{"message":"private-token"}}','http-error'],
 ['503 HTML',503,'text/html','<html>Error code: 1102 private-token</html>','http-error'],
 ['200 HTML',200,'text/html','<html>private-token</html>','parse-error'],
 ['broken JSON',200,'application/json','{private-token','parse-error'],
 ['missing metrics',200,'application/json','{"result":{}}','metrics-schema-error']])test('diagnostic '+label+' retains reservation, redacts body, no retry',async()=>{
 const rows=[];let calls=0;await assert.rejects(runMeasurementClient(config(async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(body,{status,headers:{'Content-Type':contentType}});},{journal:async r=>rows.push(r)})),/STOP/);
 assert.equal(calls,1);const failure=rows.at(-1);assert.equal(failure.failure,kind);assert.equal(failure.status,status);assert.equal(failure.budget.read,128);assert.equal(failure.budget.write,160);assert.ok(!JSON.stringify(rows).includes('private-token'));assert.ok(!JSON.stringify(rows).includes('private-person'));assert.ok(!JSON.stringify(rows).includes('private-pilot-key'));assert.ok(!JSON.stringify(rows).includes('private-jwt'));
});
test('metrics schema rejects type, bounds, identity and correlation errors',async()=>{
 for(const patch of [{rowsRead:'3'},{rowsRead:-1},{rowsWritten:1.5},{databaseBytes:1048577},{isolateTag:'email@example.invalid'},{isolateFirst:'false'},{caseId:'other'}]){
  const rows=[];await assert.rejects(runMeasurementClient(config(async()=>Response.json({result:{}},{headers:{'X-Helium-Pilot-Metrics':JSON.stringify({...meta,...patch})}}),{journal:async r=>rows.push(r)})),/STOP/);assert.equal(rows.at(-1).failure,'metrics-schema-error');assert.equal(rows.at(-1).budget.read,128);
 }
});
test('all redirects are recorded, query/credentials redacted and never followed',async()=>{
 for(const location of ['https://outside.invalid/path/private-person?token=private-token','/getCurrentAccess?token=private-token']){
  const rows=[];let calls=0;await assert.rejects(runMeasurementClient(config(async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:location}});},{journal:async r=>rows.push(r)})),/STOP/);assert.equal(calls,1);assert.equal(rows.at(-1).failure,'redirect');assert.ok(!JSON.stringify(rows).includes('private-token'));assert.ok(!JSON.stringify(rows).includes('private-person'));
 }
});
test('lost response and broken body stream are distinct, neither is retried',async()=>{
 const rows=[];await assert.rejects(runMeasurementClient(config(async()=>{throw Error('private-token');},{journal:async r=>rows.push(r)})),/no retry/);assert.equal(rows.at(-1).state,'unknown-stop');
 const bad=new Response(new ReadableStream({start(c){c.error(Error('private-token'));}}));const inspected=await inspectResponse(bad,{url,id:'resolve'});assert.equal(inspected.kind,'response-loss');assert.ok(!JSON.stringify(rows).includes('private-token'));
});
test('body reading bounded before parse; arbitrary JSON fields/text are redacted',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode('private-token'.repeat(2000)));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/plain'}});
 const r=await inspectResponse(response,{url,id:'resolve'});assert.equal(r.diagnostic.bodyBytes,responseLimit);assert.equal(r.diagnostic.bodyTruncated,true);assert.equal(cancelled,true);assert.ok(!JSON.stringify(r).includes('private-token'));
 const j=await inspectResponse(Response.json({email:'private@example.invalid',token:'private-token',error:{status:'UNAVAILABLE',message:'private-token'}}),{url,id:'resolve'});assert.ok(!JSON.stringify(j).includes('private-token'));assert.ok(!JSON.stringify(j).includes('private@example'));
});
function readyBody(){return {protocol:'authority-pilot/v2',caseId:'ready',deployment,isolateTag:'local',isolateFirst:true,scope:'transport-only',guardUnexpired:true,rowsRead:0,rowsWritten:0,d1Checked:false};}
test('readiness requires exact version/build/protocol, cannot forge receipt, expires, gates SET',async()=>{
 const rows=[],budget=pilotBudget({http:92,read:828,write:369});let now=1000;
 const opts={baseURL:url,approvedHost:host,deployment,id:'ready',pilotSecret:'private-pilot-key',getSyntheticJWT:async()=>'private-jwt',journal:async r=>rows.push(r),budget,clock:()=>now,fetchImpl:async(_url,init)=>{assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');return Response.json(readyBody());}};
 const receipt=await checkReadiness(opts);assert.deepEqual(budget.snapshot(),{http:93,read:828,write:369});requireReadiness(receipt,{host,deployment,clock:()=>now});assert.throws(()=>requireReadiness({...receipt},{host,deployment}),/readiness/);
 let calls=0;await assert.rejects(runMeasurementClient(config(async()=>{calls++;},{journal:async()=>{},steps:[{id:'set',name:'setUserAccess',cryptoCase:'warm',expectStatus:200}]})),/readiness/);assert.equal(calls,0);
 const result=await runMeasurementClient(config(async(_url,init)=>{calls++;assert.equal(init.headers['X-Helium-Pilot-Version'],deployment.versionId);return Response.json({result:{}},{headers:{'X-Helium-Pilot-Metrics':JSON.stringify({...meta,caseId:'set'})}});},{journal:async()=>{},steps:[{id:'set',name:'setUserAccess',cryptoCase:'warm',expectStatus:200}],deployment,readinessReceipt:receipt,clock:()=>now}));assert.equal(result.records[0].correct,true);
 now+=30001;assert.throws(()=>requireReadiness(receipt,{host,deployment,clock:()=>now}),/readiness/);
 for(const patch of [{protocol:'wrong'},{deployment:{...deployment,versionId:'00000000-0000-4000-8000-000000000002'}},{deployment:{...deployment,buildId:'b'.repeat(64)}},{rowsWritten:1},{guardUnexpired:false},{caseId:'replayed'}])await assert.rejects(checkReadiness({...opts,id:'ready',fetchImpl:async()=>Response.json({...readyBody(),...patch})}),/STOP/);
});
test('readiness handler does no D1 access, checks JWT, method and immutable deployment identity',async()=>{
 let verified=0;const env={PILOT_REGISTRY_MODE:'full',PILOT_READY_UNTIL:'2000',CF_VERSION_METADATA:{id:deployment.versionId},get DB(){throw Error('D1 must not be touched');}};
 const request=new Request(url+'__pilot/ready',{headers:{Authorization:'Bearer synthetic'}}),context={buildId:deployment.buildId,caseId:'ready',isolateTag:'local',isolateFirst:true,clock:()=>1000,verifyToken:async()=>{verified++;}};
 const r=await readinessResponse(request,env,context),b=await r.json();assert.equal(verified,1);assert.equal(b.guardUnexpired,true);assert.equal(b.d1Checked,false);assert.equal(b.rowsWritten,0);assert.deepEqual(b.deployment,deployment);
 assert.equal((await readinessResponse(new Request(url),env,context)).status,401);
 assert.equal((await readinessResponse(new Request(url,{method:'POST'}),env,context)).status,405);
 assert.equal((await readinessResponse(request,env,{...context,verifyToken:async()=>{throw Error('private-token');}})).status,401);
 assert.equal((await readinessResponse(request,Object.assign(Object.create(env),{CF_VERSION_METADATA:undefined}),context)).status,503);
});
test('valid metrics cannot make a malformed application body valid',async()=>{
 const rows=[];await assert.rejects(runMeasurementClient(config(async()=>Response.json({error:{status:'UNAVAILABLE'}},{headers:{'X-Helium-Pilot-Metrics':JSON.stringify(meta)}}),{journal:async r=>rows.push(r)})),/STOP/);assert.equal(rows.at(-1).failure,'body-schema-error');assert.equal(rows.at(-1).budget.read,128);
});
test('credential preparation failure is redacted and journaled before any network call',async()=>{
 const rows=[];let calls=0;await assert.rejects(runMeasurementClient(config(async()=>{calls++;},{journal:async r=>rows.push(r),getSyntheticJWT:async()=>{throw Error('private-token');}})),/STOP/);assert.equal(calls,0);assert.equal(rows.at(-1).failure,'credential-preparation');assert.ok(!JSON.stringify(rows).includes('private-token'));
});
