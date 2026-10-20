import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {utcMonths,monthEnd} from '../functions/lib/reports/utc-months.mjs';
import {buildSnapshot} from '../functions/lib/reports/accounting.mjs';
import {createReportService} from '../functions/lib/reports/service.mjs';
import {getMonthlyDashboard} from '../functions/lib/reports/dashboard.mjs';
import {workbookRows,createGoogleExporter} from '../functions/lib/reports/google.mjs';
import {reportDb,Stamp} from './report-test-db.mjs';
const month='2026-10',folder='owner_private_folder';
const source={revision:'catalogue-hash',teams:[{id:'a',name:'Alpha',active:true},{id:'z',name:'Zero',active:true},{id:'old',name:'Old',active:false}],data:{m:{title:'Manga A'},n:{title:'Manga Old'}}};
const teamRow=(teamId,views)=>({scopeId:`team:${teamId}`,parentScopeId:'site',teamId,kind:'team',period:month,validViews:views});
const mangaRow=(teamId,mangaId,views)=>({scopeId:`manga:${teamId}:${mangaId}`,parentScopeId:`team:${teamId}`,teamId,mangaId,kind:'manga',period:month,validViews:views});
function harness(options={}) {
    const db=options.db||reportDb();let now=Date.parse('2026-11-01T00:10:00Z');
    if(!options.db){db.data.set(`analyticsScopes/site/periods/${month}`,{validViews:7});for(const row of [teamRow('a',5),teamRow('old',2),mangaRow('a','m',5),mangaRow('old','n',2)])db.data.set(`analyticsScopes/${row.scopeId}/periods/${month}`,row);}
    const files=[],calls={find:0,create:0,populate:0,verify:0};
    const exporter=options.exporter||{async find(){calls.find++;return files;},async verify(id){calls.verify++;return{id};},async create(){calls.create++;const file={id:'sheet_created_123'};files.push(file);return file;},async populate(){calls.populate++;}};
    const service=createReportService({db,catalogue:async()=>source,exporter,folderId:folder,timestamp:ms=>new Stamp(ms),clock:()=>now});
    return{db,service,files,calls,exporter,now:()=>now,setTime:value=>now=value};
}
test('UTC helpers normal rollover, Dec-Jan, leap year, timezone offsets and invalid periods',()=>{
    assert.equal(utcMonths('2026-11-01T00:00:00Z').previousPeriod,'2026-10');
    const january=utcMonths('2027-01-01T00:00:00Z');assert.equal(january.currentPeriod,'2027-01');assert.equal(january.previousPeriod,'2026-12');
    assert.equal(utcMonths('2024-02-29T23:59:59Z').nextBoundary,Date.parse('2024-03-01T00:00:00Z'));
    assert.equal(utcMonths('2026-11-01T02:00:00+03:00').currentPeriod,'2026-10');
    assert.equal(monthEnd('2024-02'),Date.parse('2024-03-01T00:00:00Z'));assert.throws(()=>monthEnd('2026-13'));
});
test('monthly snapshot includes zero active teams and historical inactive earnings, reconciles breakdown',()=>{
    const h=harness();const snapshot=buildSnapshot(month,source,{validViews:7},[teamRow('old',2),teamRow('a',5)],[mangaRow('old','n',2),mangaRow('a','m',5)]);
    assert.deepEqual(snapshot.teams.map(row=>[row.teamId,row.validViews]),[['a',5],['old',2],['z',0]]);
    const rows=workbookRows(snapshot);assert.deepEqual(rows.summary[0],['Team','Month','Valid Views','Percent of Site Views']);
    assert.deepEqual(rows.summary.at(-1),['TOTAL',month,7,1]);assert.equal(rows.summary[1][3],5/7);
    assert.deepEqual(rows.mangas.slice(1),[['Alpha','Manga A',5],['Old','Manga Old',2],['TOTAL','',7]]);
    assert.throws(()=>buildSnapshot(month,source,{validViews:8},[teamRow('a',5)],[mangaRow('a','m',5)]),/reconcile/);
    assert.equal(h.db.writes.length,0);
});
test('dashboard reads all/current/previous only: missing new month is zero, leaders cannot request foreign/site',async()=>{
    const h=harness();h.db.data.set('viewSystem/config',{enabled:true,activationAt:new Stamp(1)});
    h.db.data.set('analyticsScopes/site/periods/all',{validViews:7});
    h.db.data.set('analyticsScopes/team:a/periods/all',{validViews:5});
    const dependencies={db:h.db,clock:h.now};
    const all=await getMonthlyDashboard({scopeId:'site'},{uid:'admin',role:'admin'},dependencies);
    assert.equal(all.monthly,0);assert.equal(all.previousMonthly,7);assert.equal(all.total,7);
    assert.equal(all.currentPeriod,'2026-11');assert.equal(all.previousPeriod,month);
    const team=await getMonthlyDashboard({scopeId:'team:a'},{uid:'admin',role:'admin'},dependencies);assert.equal(team.previousMonthly,5);
    assert.equal((await getMonthlyDashboard({}, {uid:'l',role:'team_leader',teamId:'a'},dependencies)).previousMonthly,5);
    for(const scopeId of ['site','team:old'])await assert.rejects(getMonthlyDashboard({scopeId},{uid:'l',role:'team_leader',teamId:'a'},dependencies),e=>e.code==='permission-denied');
    await assert.rejects(getMonthlyDashboard({scopeId:'site'},{uid:'u',role:'user'},dependencies),e=>e.code==='permission-denied');
    h.db.data.set('mangaStats/m',{views:99999999});assert.equal((await getMonthlyDashboard({scopeId:'site'},{uid:'admin',role:'admin'},dependencies)).total,7);
    assert.equal(h.db.writes.length,0);
});
test('close is idempotent and concurrent scheduler runs cannot create duplicate Sheets or mutate aggregates',async()=>{
    const h=harness(),before=JSON.stringify([...h.db.data]);
    const outcomes=await Promise.allSettled([h.service.run(month),h.service.run(month)]);
    assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(h.calls.create,1);
    const report=structuredClone(h.db.data.get(`monthlyReports/${month}`));assert.equal(report.status,'generated');assert.equal(report.totalValidViews,7);
    const writes=h.db.writes.length;await h.service.run(month);assert.equal(h.calls.create,1);assert.equal(h.db.writes.length,writes);
    assert.ok(h.db.writes.every(path=>path.startsWith(`monthlyReports/${month}`)));
    assert.ok(before.includes('analyticsScopes'));assert.equal(h.db.data.get(`analyticsScopes/site/periods/${month}`).validViews,7);
});
test('failed population retries the same Sheet and immutable snapshot, records attempts, generated months never overwrite',async()=>{
    const h=harness();let fail=true;h.exporter.populate=async()=>{h.calls.populate++;if(fail)throw new Error('sensitive error must not leak');};
    await assert.rejects(h.service.run(month));const initial=h.db.data.get(`monthlyReports/${month}`);assert.equal(initial.status,'failed');assert.doesNotMatch(initial.error,/sensitive/);
    const hash=initial.snapshotHash;h.db.data.get(`analyticsScopes/site/periods/${month}`).validViews=999;
    fail=false;await h.service.retry({month},{uid:'admin',role:'admin'});
    const after=h.db.data.get(`monthlyReports/${month}`);assert.equal(after.snapshotHash,hash);assert.equal(after.totalValidViews,7);assert.equal(after.attempts,2);assert.equal(h.calls.create,1);
    assert.equal([...h.db.data.keys()].filter(path=>path.includes('/attempts/')).length,4);
    await h.service.retry({month},{uid:'admin',role:'admin'});assert.equal(h.calls.populate,2);
});
test('uncertain creation is recovered by marker; absent match is fail-closed, definitive rejection safely retries',async()=>{
    const h=harness();h.exporter.create=async()=>{h.calls.create++;h.files.push({id:'sheet_created_123'});throw new Error('connection lost');};
    await assert.rejects(h.service.run(month));assert.equal(h.db.data.get(`monthlyReports/${month}`).creationState,'issued');
    await h.service.run(month);assert.equal(h.calls.create,1);assert.equal(h.db.data.get(`monthlyReports/${month}`).status,'generated');
    const unknown=harness();unknown.exporter.create=async()=>{unknown.calls.create++;throw new Error('uncertain');};
    await assert.rejects(unknown.service.run(month));await assert.rejects(unknown.service.run(month),/reconciliation/);assert.equal(unknown.calls.create,1);
    const rejected=harness();let first=true;const create=rejected.exporter.create;
    rejected.exporter.create=async data=>{if(first){first=false;const e=new Error('rejected');e.definitiveRejection=true;throw e;}return create(data);};
    await assert.rejects(rejected.service.run(month));await rejected.service.run(month);assert.equal(rejected.calls.create,1);
});
test('expired leases recover, active leases block, retries/history are admin-only, future periods cannot close',async()=>{
    const h=harness();h.db.data.set(`monthlyReports/${month}`,{month,status:'generating',runId:'stale',leaseUntil:new Stamp(h.now()-1),driveFolderId:folder,creationState:'not_started',exportKey:'same-key',attempts:1});
    await h.service.run(month);assert.equal(h.db.data.get(`monthlyReports/${month}`).status,'generated');
    for(const actor of [{},{uid:'l',role:'team_leader',teamId:'a'},{uid:'u',role:'user'}]){
        await assert.rejects(h.service.history({},actor));await assert.rejects(h.service.retry({month},actor));}
    const page=await h.service.history({},{uid:'a',role:'admin'});assert.equal(page.reports.length,1);assert.equal(page.reports[0].totalValidViews,7);
    await assert.rejects(h.service.retry({month:'2026-09'},{uid:'a',role:'admin'}),/existing/);
    await assert.rejects(h.service.run('2026-11'),/ready/);
    const scheduled=harness();await scheduled.service.scheduled({scheduleTime:'2026-11-01T00:10:00Z'});assert.equal(scheduled.db.data.get(`monthlyReports/${month}`).status,'generated');
    scheduled.setTime(Date.parse('2026-12-01T00:10:00Z'));await scheduled.service.scheduled({scheduleTime:'2026-11-01T00:10:00Z'});assert.equal(scheduled.calls.create,1);assert.equal(scheduled.db.data.has('monthlyReports/2026-11'),false);
});
test('Google adapter builds typed RAW rows, private Drive markers, numeric/header formatting, and caches token per invocation',async()=>{
    const calls=[];let created=false;
    const report=buildSnapshot(month,{...source,data:{m:{title:'=formula'}}},{validViews:5},[teamRow('a',5)],[mangaRow('a','m',5)]);
    Object.assign(report,{driveFolderId:folder,exportKey:'marker'});
    const mock=async(url,options)=>{calls.push({url,options});let data={};
        if(url.includes('oauth2'))data={access_token:'SECRET',expires_in:3600};
        else if(url.includes(`/files/${folder}`))data={id:folder,mimeType:'application/vnd.google-apps.folder',ownedByMe:true,permissions:[{role:'owner'}]};
        else if(url.includes('/files?')&&options.method==='GET')data={files:created?[{id:'sheet_created_123'}]:[]};
        else if(url.includes('/files?')&&options.method==='POST'){data={id:'sheet_created_123'};created=true;}
        else if(url.includes('/files/sheet_created_123'))data={id:'sheet_created_123',mimeType:'application/vnd.google-apps.spreadsheet',ownedByMe:true,parents:[folder],appProperties:{heliumReportKey:'marker',snapshotHash:report.snapshotHash},permissions:[{role:'owner'}]};
        else if(options.method==='GET')data={sheets:[{properties:{sheetId:0,title:'Sheet1'}}]};
        return{ok:true,status:200,json:async()=>data};};
    const google=createGoogleExporter({clientId:'id',clientSecret:'secret',refreshToken:'refresh',fetchImpl:mock});
    await google.find(report);const file=await google.create(report);await google.verify(file.id,report);await google.populate(file.id,report);
    assert.equal(calls.filter(call=>call.url.includes('oauth2')).length,1);
    const create=calls.find(call=>call.url.includes('/files?')&&call.options.method==='POST');assert.equal(JSON.parse(create.options.body).appProperties.heliumReportKey,'marker');
    const values=calls.filter(call=>call.url.includes('/values:batchUpdate'));assert.equal(values.length,2);assert.ok(values.every(call=>JSON.parse(call.options.body).valueInputOption==='RAW'));
    assert.match(values[1].options.body,/=formula/);
    const format=calls.at(-1).options.body;assert.match(format,/PERCENT/);assert.match(format,/autoResizeDimensions/);
});


test('Functions manifest preserves existing exports and fixes monthly schedule to 00:10 UTC',()=>{
    const require=createRequire(new URL('../functions/package.json',import.meta.url));
    const functions=require('./index.js');
    for(const name of ['health','registerPushToken','unregisterPushToken','notifyNewChapter','setUserAccess','startChapterViewSession','recordChapterView','getChapterViewAnalytics','listComments','createComment','editComment','deleteComment','moderateComment','recordChapterPopularity','closeMonthlyViewReport','getMonthlyViewReports','retryMonthlyViewReport','generateMonthlyViewReport','getMonthlyViewDashboard'])assert.equal(typeof functions[name],'function',name);
    const schedule=functions.closeMonthlyViewReport.__endpoint.scheduleTrigger;
    assert.equal(schedule.schedule,'10 0 1 * *');assert.equal(schedule.timeZone,'UTC');assert.equal(schedule.retryConfig.retryCount,5);
});

test('expired export budget issues no Google request',async()=>{
    let requests=0;
    const exporter=createGoogleExporter({clientId:'id',clientSecret:'secret',refreshToken:'refresh',deadline:Date.now()-1,fetchImpl:async()=>{requests++;throw new Error('Must not fetch');}});
    await assert.rejects(exporter.find({driveFolderId:folder}),e=>e.code==='deadline-exceeded');assert.equal(requests,0);
});

test('Google export rejects shared/non-owner folders before creating a confidential report',async()=>{
    let writes=0;
    const google=createGoogleExporter({clientId:'id',clientSecret:'secret',refreshToken:'refresh',fetchImpl:async(url,options)=>{
        if(options.method==='POST'&&!url.includes('oauth2'))writes++;
        return{ok:true,status:200,json:async()=>url.includes('oauth2')?{access_token:'token',expires_in:3600}:{mimeType:'application/vnd.google-apps.folder',ownedByMe:true,permissions:[{role:'owner'},{role:'reader'}]}};
    }});
    await assert.rejects(google.find({driveFolderId:folder}),e=>e.code==='failed-precondition');assert.equal(writes,0);
});

const admin = {uid:'admin', role:'admin'};
function manualHarness() { const h=harness(); h.db.data.set('viewSystem/config',{enabled:true,activationAt:new Stamp(Date.parse('2026-09-15T00:00:00Z'))}); return h; }
test('manual generation uses historical trusted aggregates, excludes popularity and appends audit',async()=>{
 const h=manualHarness();h.db.data.set('mangaStats/m',{views:999999});
 const result=await h.service.generate({month},admin);assert.equal(result.status,'generated');assert.match(result.spreadsheetUrl,/sheet_created/);
 const report=h.db.data.get('monthlyReports/'+month);assert.equal(report.totalValidViews,7);assert.equal(report.lastTrigger,'admin_manual_generate');
 assert.ok([...h.db.data.entries()].filter(([p])=>p.includes('/attempts/')).every(([,r])=>r.trigger==='admin_manual_generate'));
 const writes=h.db.writes.length;assert.equal((await h.service.generate({month},admin)).spreadsheetUrl,result.spreadsheetUrl);assert.equal(h.calls.create,1);assert.equal(h.db.writes.length,writes);
});
test('manual validation rejects non-admins, current/future, malformed, preactivation and browser export fields',async()=>{
 const h=manualHarness();
 for(const actor of [{},{uid:'l',role:'team_leader'},{uid:'u',role:'user'}])await assert.rejects(h.service.generate({month},actor));
 for(const value of ['2026-11','2026-12','2026-13','2026-1','garbage','2026-08'])await assert.rejects(h.service.generate({month:value},admin));
 await assert.rejects(h.service.generate({month,spreadsheetId:'injected'},admin));assert.equal(h.db.writes.length,0);
 const noConfig=harness();await assert.rejects(noConfig.service.generate({month},admin),/availability/);
});
test('manual incomplete reports require retry and preserve snapshot and uncertain creation intent',async()=>{
 const h=manualHarness();h.exporter.populate=async()=>{throw new Error('failed');};await assert.rejects(h.service.generate({month},admin));
 const before=JSON.stringify([...h.db.data]);const result=await h.service.generate({month},admin);assert.equal(result.retryRequired,true);assert.equal(JSON.stringify([...h.db.data]),before);
 h.exporter.populate=async()=>{};await h.service.retry({month},admin);assert.equal(h.calls.create,1);
});
test('manual and scheduler share the lease and create at most one Sheet',async()=>{
 const h=manualHarness();await Promise.allSettled([h.service.generate({month},admin),h.service.scheduled({scheduleTime:'2026-11-01T00:10:00Z'})]);assert.equal(h.calls.create,1);assert.equal(h.db.data.get('monthlyReports/'+month).status,'generated');
});
test('manual December closes at January UTC boundary and activation month is eligible',async()=>{
 const h=manualHarness();h.setTime(Date.parse('2027-01-01T00:00:00Z'));
 await h.service.generate({month:'2026-12'},admin);await assert.rejects(h.service.generate({month:'2027-01'},admin));
 const bounds=await h.service.history({},admin);assert.equal(bounds.firstEligibleMonth,'2026-09');assert.equal(bounds.lastEligibleMonth,'2026-12');
});
