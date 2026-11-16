import {randomUUID,createHash} from 'node:crypto';
import {requireAdmin,fail} from '../../functions/lib/reports/accounting.mjs';
import {monthEnd,utcMonths} from '../../functions/lib/reports/utc-months.mjs';

export async function installReportJobs(db) {
 for(const sql of [
  "CREATE TABLE migration_gate(id INTEGER PRIMARY KEY CHECK(id=1),verified INTEGER NOT NULL DEFAULT 0,evidence_hash TEXT)",
  'INSERT INTO migration_gate(id,verified) VALUES(1,0)',
  'CREATE TABLE accounting_coverage(month TEXT PRIMARY KEY,body TEXT NOT NULL) WITHOUT ROWID',
  `CREATE TABLE export_jobs(month TEXT PRIMARY KEY,status TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,creation_state TEXT NOT NULL DEFAULT 'not_started',spreadsheet_id TEXT,spreadsheet_url TEXT,export_key TEXT NOT NULL,folder TEXT NOT NULL,error_code TEXT,next_retry INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`,
  'CREATE TABLE export_attempts(id TEXT PRIMARY KEY,month TEXT NOT NULL,outcome TEXT NOT NULL,at INTEGER NOT NULL) WITHOUT ROWID',
  `CREATE TRIGGER export_audit_immutable_update BEFORE UPDATE ON export_attempts BEGIN SELECT RAISE(ABORT,'immutable-audit'); END`,
  `CREATE TRIGGER export_audit_immutable_delete BEFORE DELETE ON export_attempts BEGIN SELECT RAISE(ABORT,'immutable-audit'); END`
 ])await db.prepare(sql).run();
}

// Google adapter is injected server-side; no OAuth values accepted from readers.
export function createD1ReportJobs({db,views,exporter,folderId,clock=Date.now}) {
 const q=(sql,args=[])=>db.prepare(sql).bind(...args);
 async function checkpoint(month,owner,sql,args=[]) {
  const r=await q(`UPDATE export_jobs SET ${sql} WHERE month=? AND owner=? AND status='generating'`,[...args,month,owner]).run();
  if(r.meta.changes!==1)fail('aborted','Report lease changed');
 }
 async function run(month,actor,{retry=false,scheduled=false}={}) {
  if(!scheduled)requireAdmin(actor);
  let end;try{end=monthEnd(month);}catch{fail('invalid-argument','Invalid report month');}
  if(clock()<end+(scheduled?600000:0))fail('failed-precondition','Month not closed');
  const config=await q('SELECT activation FROM config WHERE id=1').first();
  if(!config||month<new Date(config.activation).toISOString().slice(0,7))fail('failed-precondition','Month before activation');
  const previous=await q('SELECT * FROM export_jobs WHERE month=?',[month]).first();
  if(previous?.status==='generated')return {month,status:'generated',alreadyGenerated:true,spreadsheetUrl:previous.spreadsheet_url};
  if(previous&&!retry&&!scheduled)return {month,status:previous.status,retryRequired:true};
  if(retry&&!previous)fail('not-found','No report to retry');
  const limit=scheduled?3:20;
  if((previous?.attempts||0)>=limit)fail('resource-exhausted','Report attempt limit reached; owner review required');
  const coverage=await q('SELECT body FROM accounting_coverage WHERE month=?',[month]).first();
  if(!coverage)fail('failed-precondition','Coverage unverified');
  const owner=randomUUID(),now=clock();
  const key=createHash('sha256').update(`helium-team-d7f80:monthly-views:v1:${month}`).digest('hex');
  const claimed=await db.batch([
   q(`INSERT INTO export_jobs(month,status,owner,lease_until,attempts,export_key,folder) VALUES(?,'generating',?,?,1,?,?) ON CONFLICT(month) DO UPDATE SET status='generating',owner=excluded.owner,lease_until=excluded.lease_until,attempts=export_jobs.attempts+1,error_code=NULL WHERE export_jobs.status<>'generated' AND export_jobs.lease_until<=? AND export_jobs.attempts<?`,[month,owner,now+900000,key,folderId,now,limit]),
   q('SELECT * FROM export_jobs WHERE month=?',[month])
  ]);
  const job=claimed[1].results[0];
  if(job.owner!==owner)fail('aborted','Report already running');
  await q('INSERT INTO export_attempts VALUES(?,?,?,?)',[owner+':start',month,'started',now]).run();
  try {
   const snapshot=await views.report(month,{uid:'internal-report-job',role:'admin'},{coverage:JSON.parse(coverage.body)});
   const report={...snapshot,driveFolderId:job.folder,exportKey:job.export_key};
   let file=job.spreadsheet_id?await exporter.verify(job.spreadsheet_id,report):null;
   if(!file){
    const matches=await exporter.find(report);
    if(matches.length>1)fail('failed-precondition','Multiple Sheets require reconciliation');
    file=matches[0];
    if(!file){
     if(job.creation_state==='issued')fail('failed-precondition','Uncertain creation: owner reconciliation required');
     await checkpoint(month,owner,"creation_state='issued'");
     try{file=await exporter.create(report);}catch(error){if(error.definitiveRejection)await checkpoint(month,owner,"creation_state='not_started'");throw error;}
    }
    file=await exporter.verify(file.id,report);
    await checkpoint(month,owner,"spreadsheet_id=?,spreadsheet_url=?,creation_state='identified'",[file.id,`https://docs.google.com/spreadsheets/d/${file.id}/edit`]);
   }
   await exporter.populate(file.id,report);
   await checkpoint(month,owner,"status='generated',lease_until=?,error_code=NULL",[clock()]);
   await q('INSERT INTO export_attempts VALUES(?,?,?,?)',[owner+':finish',month,'generated',clock()]).run();
   return {month,status:'generated',alreadyGenerated:false,spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${file.id}/edit`};
  }catch(error){
   await q("UPDATE export_jobs SET status='failed',lease_until=0,error_code=?,next_retry=? WHERE month=? AND owner=? AND status='generating'",[['failed-precondition','resource-exhausted','aborted'].includes(error.code)?error.code:'unavailable',clock()+900000,month,owner]).run();
   await q('INSERT INTO export_attempts VALUES(?,?,?,?)',[owner+':finish',month,'failed',clock()]).run();
   throw error;
  }
 }
 async function history(data,actor){requireAdmin(actor);const cursor=data?.cursor||'9999-99';if(!/^\d{4}-\d{2}$/.test(cursor))fail('invalid-argument','Invalid cursor');const r=await q('SELECT month,status,attempts,spreadsheet_url AS spreadsheetUrl,error_code AS errorCode FROM export_jobs WHERE month<? ORDER BY month DESC LIMIT 26',[cursor]).all();return {reports:r.results.slice(0,25),nextCursor:r.results.length>25?r.results[24].month:null};}
 async function scheduled(){const period=utcMonths(clock()).previousPeriod;const result=[];try{result.push(await run(period,{},{scheduled:true}));}catch(error){result.push({month:period,error:error.code||'unavailable'});}const jobs=await q("SELECT month FROM export_jobs WHERE status='failed' AND attempts<3 AND next_retry<=? AND month<>? ORDER BY month LIMIT 10",[clock(),period]).all();for(const row of jobs.results){try{result.push(await run(row.month,{},{scheduled:true}));}catch(error){result.push({month:row.month,error:error.code||'unavailable'});}}return result;}
 return {generate:(data,actor)=>{if(!data||Object.keys(data).length!==1||!data.month)fail('invalid-argument','Only month accepted');return run(data.month,actor);},retry:(data,actor)=>run(data?.month,actor,{retry:true}),history,scheduled};
}
