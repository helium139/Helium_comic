// Local only: exact candidate bundle + synthetic RSA, no remote credentials/network.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const dir=path.resolve(process.argv[2]),require=createRequire(new URL('../../worker/package.json',import.meta.url));
const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare'),{SignJWT,importPKCS8}=await import(pathToFileURL(require.resolve('jose')));
const setup=JSON.parse(await readFile(path.join(dir,'setup.private.json'))),data=JSON.parse(await readFile(path.join(dir,'synthetic-secrets.private.json'))),versionId='00000000-0000-4000-8000-000000000001';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(path.join(dir,'index.mjs'),'utf8'),compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],bindings:{...data.secrets,PILOT_REGISTRY_MODE:'full',PILOT_READY_UNTIL:String(setup.expires),PILOT_DIAGNOSTIC_ONLY:'true',CF_VERSION_METADATA:{id:versionId}},d1Databases:{DB:'readiness-local-only'},log:new Log(LogLevel.NONE)}));
const results=[];
try{
 const db=await mf.getD1Database('DB');for(const q of setup.queries)await db.prepare(q.sql).bind(...q.params).run();
 // Compare data, excluding variable SQL timing metadata.
 const state=async()=>JSON.stringify(await Promise.all(['SELECT * FROM fixture_budget','SELECT uid,version,state FROM access_rows ORDER BY uid','SELECT * FROM access_audit ORDER BY id','SELECT * FROM fixture_google ORDER BY uid'].map(async sql=>(await db.prepare(sql).all()).results)));
 const before=await state(),key=await importPKCS8(data.privatePEM,'RS256'),now=Math.floor(Date.now()/1000);
 const token=patch=>new SignJWT({sub:'reader',iat:now,exp:now+3600,auth_time:now-60,...patch}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://authority-fixture.invalid').setAudience('authority-pilot').sign(key);
 async function call(id,{jwt,secret=data.secrets.PILOT_KEY,method='GET',route='__pilot/ready',status=200}={}){
  const r=await mf.dispatchFetch('https://fixture.invalid/'+route+'?pilotCase='+id,{method,headers:{'X-Helium-Pilot-Key':secret,...(jwt?{Authorization:'Bearer '+jwt}:{})}});assert.equal(r.status,status,id);const body=r.headers.get('content-type')?.includes('json')?await r.json():null;results.push({id,status:r.status});return body;
 }
 const first=await call('first',{jwt:await token({})});assert.equal(first.protocol,'authority-pilot/v2');assert.equal(first.deployment.buildId,setup.buildId);assert.equal(first.deployment.versionId,versionId);assert.equal(first.isolateFirst,true);assert.equal(first.rowsRead,0);assert.equal(first.rowsWritten,0);
 const second=await call('second',{jwt:await token({})});assert.equal(second.isolateFirst,false);assert.equal(first.isolateTag,second.isolateTag);
 await call('wrong-key',{jwt:await token({}),secret:'wrong-synthetic',status:403});
 await call('missing-jwt',{status:401});
 for(const [id,patch]of [['future-iat',{iat:now+60}],['future-auth',{auth_time:now+60}],['empty-sub',{sub:' '}]] )await call(id,{jwt:await token(patch),status:401});
 await call('wrong-method',{jwt:await token({}),method:'POST',status:405});
 await call('write-blocked',{jwt:await token({}),method:'POST',route:'setUserAccess',status:403});
 await call('resolve-blocked',{jwt:await token({}),method:'POST',route:'getCurrentAccess',status:403});
 assert.equal(await state(),before,'All DB content, counters, audit and mock projections unchanged');
 const result={scope:'local exact bundle; no cloud',cases:results.length,allPassed:true,buildId:setup.buildId,bundleHash:setup.hash,dbUnchanged:true,readinessSQLQueries:0,readinessWarmsIsolate:true,results};
 await writeFile(path.join(dir,'readiness-local.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
