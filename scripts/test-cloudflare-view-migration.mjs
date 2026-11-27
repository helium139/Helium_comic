import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {installSchema} from '../worker/view-runtime/schema.mjs';
import {createD1Views} from '../worker/view-runtime/service.mjs';
import {installReportJobs,createD1ReportJobs} from '../worker/view-runtime/report-jobs.mjs';
import {createMigrationRuntime} from '../worker/view-runtime/runtime.mjs';
import {installAuthority,createAuthority} from '../worker/view-runtime/authority.mjs';
import {createGoogleIdentityBridge} from '../worker/view-runtime/google-identity-bridge.mjs';
const require=createRequire(import.meta.url);let lib;
for(const entry of await readdir(path.join(process.env.LOCALAPPDATA,'npm-cache/_npx'))){try{lib=require(path.join(process.env.LOCALAPPDATA,'npm-cache/_npx',entry,'node_modules/miniflare'));break;}catch{}}
if(!lib)throw Error('Existing local Miniflare required; no cloud fallback');
const cat={revision:'fixture-v1',teams:[{id:'team-a',active:true,name:'A'},{id:'team-b',active:true,name:'B'}],data:{manga:{title:'Fixture',teamId:'team-a',chapters:[{id:'1',pages:1,folder:'https://example.invalid/'}]}}};
const admin={uid:'fixture-admin',role:'admin'};
test('Cloudflare migration code: D1 reporting retries and authority gates',async t=>{
 const mf=new lib.Miniflare(lib.convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local only")}}',compatibilityDate:'2026-10-26',d1Databases:{DB:'migration-fixture'}}));t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');await installSchema(db);await installReportJobs(db);
 let now=Date.parse('2026-11-15T12:00:00Z');
 await db.prepare('INSERT INTO config VALUES(1,1,?,?,?,?,?,?)').bind(Date.parse('2026-10-01T00:00:00Z'),'valid-views-v1',120,2400,360,7200).run();
 const secret='fixture-secret-'.repeat(4),views=createD1Views({db,secret,catalogue:async()=>cat,clock:()=>now});
 const reader=randomUUID();const session=await views.start({anonymousReaderId:reader,requestId:randomUUID(),mangaId:'manga',chapterId:'1'},{network:'fixture-net'});now+=10000;await views.record({anonymousReaderId:reader,sessionId:session.sessionId},{network:'fixture-net'});
 now=Date.parse('2026-12-01T00:10:01Z');
 const coverage={status:'verified-complete',gaps:[],start:Date.parse('2026-11-01T00:00:00Z'),end:Date.parse('2026-12-01T00:00:00Z'),verifiedAt:now,evidenceReference:'synthetic-only'};
 let creates=0,populates=0,failPopulate=true;
 const exporter={find:async()=>[],create:async()=>{creates++;return {id:'fixture_sheet_12345'};},verify:async id=>({id}),populate:async()=>{populates++;if(failPopulate)throw Error('fixture-failure');}};
 const jobs=createD1ReportJobs({db,views,exporter,folderId:'fixture_folder_123',clock:()=>now});
 await t.test('coverage blocks before external requests; explicit retry preserves one Sheet and snapshot',async()=>{
  await assert.rejects(jobs.generate({month:'2026-11'},admin),e=>e.code==='failed-precondition');assert.equal(creates,0);
  await db.prepare('INSERT INTO accounting_coverage VALUES(?,?)').bind('2026-11',JSON.stringify(coverage)).run();
  await assert.rejects(jobs.generate({month:'2026-11'},admin),/fixture-failure/);assert.equal(creates,1);
  const first=await db.prepare('SELECT hash FROM reports WHERE month=?').bind('2026-11').first();
  failPopulate=false;assert.equal((await jobs.retry({month:'2026-11'},admin)).status,'generated');assert.equal(creates,1);assert.equal(populates,2);
  assert.deepEqual(await db.prepare('SELECT hash FROM reports WHERE month=?').bind('2026-11').first(),first);
  assert.equal((await jobs.generate({month:'2026-11'},admin)).alreadyGenerated,true);
  await assert.rejects(jobs.history({}, {uid:'leader',role:'team_leader'}),e=>e.code==='permission-denied');
 });
 await t.test('uncertain Google creation is not posted twice, including concurrent retry',async()=>{
  const october={...coverage,start:Date.parse('2026-10-01T00:00:00Z'),end:Date.parse('2026-11-01T00:00:00Z')};
  await db.prepare('INSERT INTO accounting_coverage VALUES(?,?)').bind('2026-10',JSON.stringify(october)).run();
  let count=0;const uncertain=createD1ReportJobs({db,views,folderId:'fixture_folder_123',clock:()=>now,exporter:{...exporter,create:async()=>{count++;throw Error('synthetic-lost-response');}}});
  await assert.rejects(uncertain.generate({month:'2026-10'},admin),/lost-response/);
  const results=await Promise.allSettled([uncertain.retry({month:'2026-10'},admin),uncertain.retry({month:'2026-10'},admin)]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(count,1);
 });
 await t.test('routing requires both deployment flag and verified restore checkpoint',async()=>{
  const runtime=createMigrationRuntime({catalogue:async()=>cat,verifyToken:async()=>admin,authority:{resolve:async actor=>actor},exporterFactory:()=>exporter,clock:()=>now});
  const request=()=>new Request('https://fixture.invalid/getChapterViewAnalytics',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({data:{scopeId:'site'}})});
  const env={DB:db,VIEW_READER_HMAC_KEY:secret,GOOGLE_REPORT_FOLDER_ID:'fixture_folder_123'};
  assert.equal((await runtime.fetch(request(),env)).status,503);
  assert.equal((await runtime.fetch(request(),{...env,CUTOVER_ENABLED:'true'})).status,400);
  await db.prepare('UPDATE migration_gate SET verified=1,evidence_hash=? WHERE id=1').bind('f'.repeat(64)).run();
  const response=await runtime.fetch(request(),{...env,CUTOVER_ENABLED:'true'});assert.equal(response.status,200);assert.equal((await response.json()).result.total,1);
 });
 await t.test('fresh server authority overrides stale admin claims and denies foreign team access',async()=>{
  const runtime=createMigrationRuntime({catalogue:async()=>cat,verifyToken:async()=>admin,authority:{resolve:async()=>({uid:admin.uid,role:'team_leader',teamId:'team-b'})},exporterFactory:()=>exporter,clock:()=>now});
  const env={DB:db,VIEW_READER_HMAC_KEY:secret,CUTOVER_ENABLED:'true'};
  const request=new Request('https://fixture.invalid/getChapterViewAnalytics',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({data:{scopeId:'team:team-a'}})});
  assert.equal((await runtime.fetch(request,env)).status,403);
  const noAuthority=createMigrationRuntime({catalogue:async()=>cat,verifyToken:async()=>admin,exporterFactory:()=>exporter,clock:()=>now});
  const request2=new Request('https://fixture.invalid/setUserAccess',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({data:{uid:'other',role:'admin'}})});assert.equal((await noAuthority.fetch(request2,env)).status,400);
 });
 await t.test('D1 authority denies pending/revoked access and protects last admin; mirrors retry finitely',async()=>{
  await installAuthority(db);
  await db.prepare("INSERT INTO access_rows(uid,role) VALUES('owner','admin'),('second','admin'),('leader','team_leader')").run();
  let failure=true;const mirrors=[];
  const bridge={getAccount:async()=>({disabled:false,validSince:0}),patchMirror:async(uid,row)=>mirrors.push({uid,...row}),setClaims:async()=>{if(failure)throw Error('fixture-sync-failure');},patchProfile:async()=>{}};
  const authority=createAuthority({db,bridge,catalogue:async()=>cat,clock:()=>now});
  await assert.rejects(authority.changeAccess({uid:'leader',role:'team_leader',teamId:'team-a'},{uid:'owner',role:'admin'}),e=>e.code==='unavailable');
  const raw='fixture.'+Buffer.from(JSON.stringify({sub:'leader',auth_time:1})).toString('base64url')+'.fixture';
  await assert.rejects(authority.resolve({uid:'leader',role:'admin'},raw),e=>e.code==='permission-denied');
  failure=false;assert.equal((await authority.changeAccess({uid:'leader',role:'team_leader',teamId:'team-a'},{uid:'owner',role:'admin'})).ok,true);
  assert.equal((await authority.resolve({uid:'leader',role:'admin'},raw)).role,'team_leader');assert.equal(mirrors.at(-1).leaseUntil,now+300000);
  await authority.changeAccess({uid:'second',role:'user'},{uid:'owner',role:'admin'});
  await assert.rejects(authority.changeAccess({uid:'owner',role:'user'},{uid:'owner',role:'admin'}),/last-admin/);
 });
 await t.test('identity bridge preserves unrelated claims/profile fields and masks errors',async()=>{
  const calls=[];const bridge=createGoogleIdentityBridge({getAccessToken:async()=>'synthetic-backend-only',fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:true,status:200,json:async()=>url.includes('accounts:lookup')?{users:[{localId:'target',customAttributes:JSON.stringify({role:'team_leader',teamId:'old-team',unrelated:true})}]}:{}};}});
  await bridge.setClaims('target',{role:'user',accessVersion:2});
  const claims=JSON.parse(calls.find(c=>c.url.includes('accounts:update')).body.customAttributes);assert.equal(claims.role,'user');assert.equal(claims.teamId,undefined);assert.equal(claims.unrelated,true);assert.equal(claims.accessVersion,2);
  await bridge.patchProfile('target',{role:'user',teamId:null});const profile=calls.at(-1);assert.match(profile.url,/updateMask.fieldPaths=role/);assert.match(profile.url,/updateMask.fieldPaths=teamId/);assert.deepEqual(Object.keys(profile.body.fields),['role']);
  await bridge.patchMirror('target',{role:'user',teamId:null,version:2,state:'active',leaseUntil:123});assert.equal(calls.at(-1).body.fields.leaseUntilMs.integerValue,'123');
  const before=calls.length;await assert.rejects(bridge.getAccount('bad/path'),/Invalid UID/);assert.equal(calls.length,before);
  const denied=createGoogleIdentityBridge({getAccessToken:async()=>'synthetic',fetchImpl:async()=>({ok:false,status:403})});await assert.rejects(denied.getAccount('target'),/Identity synchronization failed/);
 });
});
