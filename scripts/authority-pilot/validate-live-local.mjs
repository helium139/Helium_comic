import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const output=path.resolve(process.argv[2]),require=createRequire(new URL('../../worker/package.json',import.meta.url)),{Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare');
const {SignJWT,importPKCS8}=await import(pathToFileURL(require.resolve('jose'))),privateData=JSON.parse(await readFile(path.join(output,'synthetic-secrets.private.json'))),setup=JSON.parse(await readFile(path.join(output,'setup.private.json')));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(path.join(output,'index.mjs'),'utf8'),compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],bindings:privateData.secrets,d1Databases:{DB:'isolated-fixture-local'},log:new Log(LogLevel.NONE)}));
const results=[];
try{
 const db=await mf.getD1Database('DB');for(const q of setup.queries)await db.prepare(q.sql).bind(...q.params).run();
 const key=await importPKCS8(privateData.privatePEM,'RS256'),now=Math.floor(Date.now()/1000);
 const token=async uid=>new SignJWT({sub:uid,role:'admin',teamId:'stale',accessVersion:0,auth_time:now-60}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://authority-fixture.invalid').setAudience('authority-pilot').setIssuedAt(now).setExpirationTime(now+3600).sign(key);
 async function call(id,uid,name,data,status,expected={},scenario='',cold=false){
  const r=await mf.dispatchFetch('https://fixture.invalid/'+name+'?pilotCase='+id,{method:'POST',headers:{Authorization:'Bearer '+await token(uid),'X-Helium-Pilot-Key':privateData.secrets.PILOT_KEY,'X-Helium-Pilot-Scenario':scenario,'X-Helium-Pilot-Crypto':cold?'forced-key-cold':'warm'},body:JSON.stringify({data})});
  const body=await r.json(),meta=JSON.parse(r.headers.get('X-Helium-Pilot-Metrics'));assert.equal(r.status,status,id+': '+JSON.stringify(body));for(const [k,v]of Object.entries(expected))assert.equal(body.result?.[k],v,id+': '+k);assert.ok(meta.rowsRead<=64&&meta.rowsWritten<=32&&meta.databaseBytes<=1048576);results.push({id,status,rowsRead:meta.rowsRead,rowsWritten:meta.rowsWritten,bytes:meta.databaseBytes});
 }
 await call('cold-resolve','leader','getCurrentAccess',{},200,{teamId:'a'},'',true);
 await call('transfer','owner','setUserAccess',{uid:'leader',role:'team_leader',teamId:'b'},200,{version:2});
 await call('old-token','leader','getCurrentAccess',{},200,{teamId:'b',accessVersion:2});
 await call('foreign-admin','reader','setUserAccess',{uid:'owner',role:'user'},403);
 await call('failed-revoke','owner','setUserAccess',{uid:'leader',role:'user'},503,{},'fail-claims');
 await call('pending-denied','leader','getCurrentAccess',{},403);
 await call('retry-revoke','owner','setUserAccess',{uid:'leader',role:'user'},200,{version:3});
 await call('revoked-role','leader','getCurrentAccess',{},200,{role:'user'});
 await call('rollback','owner','setUserAccess',{uid:'leader',role:'team_leader',teamId:'a'},200,{version:4},'',true);
 await call('rollback-version','leader','getCurrentAccess',{},200,{teamId:'a',accessVersion:4});
 await call('disabled','leader','getCurrentAccess',{},403,{},'disabled');
 await call('session-revoked','leader','getCurrentAccess',{},401,{},'revoked');
 await call('remove-backup','owner','setUserAccess',{uid:'backup',role:'user'},200);
 await call('last-admin','owner','setUserAccess',{uid:'owner',role:'user'},503);
 const row=await db.prepare("SELECT role,state FROM access_rows WHERE uid='owner'").first();assert.equal(row.role,'admin');assert.equal(row.state,'active');
 const summary={scope:'bundled fixture local only, no cloud CPU claim',cases:results.length,allPassed:true,maxRead:Math.max(...results.map(r=>r.rowsRead)),maxWrite:Math.max(...results.map(r=>r.rowsWritten)),maxBytes:Math.max(...results.map(r=>r.bytes)),results};await writeFile(path.join(output,'local-validation.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await mf.dispose();}
