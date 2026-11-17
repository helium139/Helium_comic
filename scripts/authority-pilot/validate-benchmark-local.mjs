// Local exact bundle: all13 planned requests, unchanged historical guard, scope and quota tests.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {createSessionSQL,table,sessionId} from './benchmark-session.mjs';
const dir=path.resolve(process.argv[2]),require=createRequire(new URL('../../worker/package.json',import.meta.url)),{Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare'),{SignJWT,importPKCS8}=await import(pathToFileURL(require.resolve('jose'))),setup=JSON.parse(fs.readFileSync(path.join(dir,'setup.private.json'))),fake=JSON.parse(fs.readFileSync(path.join(dir,'synthetic-secrets.private.json')));
const version='00000000-0000-4000-8000-000000000001',expires=Date.now()+900000;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:fs.readFileSync(path.join(dir,'index.mjs'),'utf8'),compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],bindings:{...fake.secrets,PILOT_REGISTRY_MODE:'validator',PILOT_DIAGNOSTIC_ONLY:'false',PILOT_READY_UNTIL:String(expires),BENCHMARK_SESSION:sessionId,CF_VERSION_METADATA:{id:version}},d1Databases:{DB:'benchmark-local'},log:new Log(LogLevel.NONE)}));
try{
 const db=await mf.getD1Database('DB');for(const q of setup.queries)await db.prepare(q.sql).bind(...q.params).run();
 await db.prepare('UPDATE fixture_budget SET requests=91,reserved_read=585,reserved_write=308,sets=8,expires=1').run();await db.prepare('UPDATE migration_gate SET free_expires=1').run();
 await db.prepare("UPDATE access_rows SET version=4 WHERE uid='leader'").run();
 const row=JSON.parse((await db.prepare("SELECT body FROM fixture_google WHERE uid='leader'").first()).body);row.claims.accessVersion=4;row.mirror.version={integerValue:'4'};await db.prepare("UPDATE fixture_google SET body=? WHERE uid='leader'").bind(JSON.stringify(row)).run();
 const history=JSON.stringify([(await db.prepare('SELECT * FROM fixture_budget').all()).results,(await db.prepare('SELECT * FROM migration_gate').all()).results]);
 const seed=createSessionSQL({hash:setup.hash,expires});const seeded=await db.prepare(seed.sql).bind(...seed.params).run();assert.ok(seeded.meta.rows_read<=128&&seeded.meta.rows_written<=64);
 const key=await importPKCS8(fake.privatePEM,'RS256'),now=Math.floor(Date.now()/1000),token=await new SignJWT({sub:'owner',iat:now,exp:now+3600,auth_time:now-60}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://authority-fixture.invalid').setAudience('authority-pilot').sign(key);
 const common={Authorization:'Bearer '+token,'X-Helium-Pilot-Key':fake.secrets.PILOT_KEY};
 const r=await mf.dispatchFetch('https://fixture.invalid/__pilot/ready?pilotCase=ready',{headers:common}),ready=await r.json();assert.equal(r.status,200);assert.equal(ready.benchmarkSession,sessionId);assert.equal(ready.deployment.buildId,setup.buildId);assert.equal(ready.isolateFirst,true);
 const rows=[];async function call(id,name,data,crypto='warm',expectedVersion){const response=await mf.dispatchFetch('https://fixture.invalid/'+name+'?pilotCase='+id,{method:'POST',headers:{...common,'Content-Type':'application/json','X-Helium-Pilot-Version':version,'X-Helium-Pilot-Build':setup.buildId,'X-Helium-Benchmark-Session':sessionId,'X-Helium-Benchmark-Ready-At':String(ready.benchmarkReadyAt),'X-Helium-Pilot-Crypto':crypto},body:JSON.stringify({data})});const body=await response.json(),meta=JSON.parse(response.headers.get('X-Helium-Pilot-Metrics'));assert.equal(response.status,200,id+JSON.stringify(body));if(expectedVersion)assert.equal(body.result.version,expectedVersion);assert.ok(meta.rowsRead<=64&&meta.rowsWritten<=32&&meta.databaseBytes<=1048576);assert.equal(meta.isolateFirst,false);rows.push({id,status:response.status,...meta});}
 for(let i=0;i<2;i++)await call('warmup-'+i,'getCurrentAccess',{});
 for(let i=0;i<3;i++)await call('warm-'+i,'getCurrentAccess',{});
 for(let i=0;i<3;i++)await call('keycold-'+i,'getCurrentAccess',{},'forced-key-cold');
 await call('registry-first','setUserAccess',{uid:'leader',role:'team_leader',teamId:'b'},'warm',5);
 await call('warm-set-1','setUserAccess',{uid:'leader',role:'team_leader',teamId:'a'},'warm',6);
 await call('keycold-set','setUserAccess',{uid:'leader',role:'team_leader',teamId:'b'},'forced-key-cold',7);
 await call('warm-set-2','setUserAccess',{uid:'leader',role:'team_leader',teamId:'a'},'warm',8);
 const budget=await db.prepare(`SELECT * FROM ${table}`).first();assert.equal(budget.business,12);assert.equal(budget.sets,4);assert.equal(budget.requests,130);assert.equal(budget.read_reserved,1916);assert.equal(budget.write_reserved,849);
 assert.equal(JSON.stringify([(await db.prepare('SELECT * FROM fixture_budget').all()).results,(await db.prepare('SELECT * FROM migration_gate').all()).results]),history);
 const headers={...common,'X-Helium-Pilot-Version':version,'X-Helium-Pilot-Build':setup.buildId,'X-Helium-Benchmark-Session':sessionId,'X-Helium-Benchmark-Ready-At':String(ready.benchmarkReadyAt)};
 const extra=await mf.dispatchFetch('https://fixture.invalid/setUserAccess?pilotCase=extra',{method:'POST',headers,body:JSON.stringify({data:{uid:'leader',role:'user'}})});assert.equal(extra.status,429);assert.equal((await db.prepare(`SELECT sets FROM ${table}`).first()).sets,4);
 // New local DB row mutations below exercise fail-closed guards, not a cloud reset.
 await db.prepare(`UPDATE ${table} SET business=0,sets=0,requests=118,read_reserved=1148,write_reserved=465,ready_until=1`).run();
 const window=await mf.dispatchFetch('https://fixture.invalid/getCurrentAccess?pilotCase=window',{method:'POST',headers,body:'{"data":{}}'});assert.equal(window.status,429);
 await db.prepare(`UPDATE ${table} SET ready_until=0,expires=1`).run();
 const expired=await mf.dispatchFetch('https://fixture.invalid/getCurrentAccess?pilotCase=expired',{method:'POST',headers,body:'{"data":{}}'});assert.equal(expired.status,429);
 const summary={scope:'local Miniflare synthetic only; no cloud CPU',allPassed:true,cases:16,plannedHTTP:13,businessRequests:12,maxRead:Math.max(...rows.map(r=>r.rowsRead)),maxWrite:Math.max(...rows.map(r=>r.rowsWritten)),maxBytes:Math.max(...rows.map(r=>r.databaseBytes)),oldGuardsUnchanged:true,quotaAndExpiryRejected:true,bundleHash:setup.hash,buildId:setup.buildId,rows};fs.writeFileSync(path.join(dir,'benchmark-local.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await mf.dispose();}
