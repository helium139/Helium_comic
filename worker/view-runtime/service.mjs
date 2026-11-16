import {identity, uuid, hash, deny, policy, activation, authorizeAnalytics} from '../../functions/lib/views/policy.mjs';
import {resolveChapter} from '../../functions/lib/views/catalogue.mjs';
import {buildSnapshot, requireAdmin} from '../../functions/lib/reports/accounting.mjs';
import {rateExceeded} from './schema.mjs';
import {createHash} from 'node:crypto';

export function createD1Views({db,secret,catalogue,clock=Date.now,onMetrics=()=>{},failure=()=>false}) {
 const stmt=(sql,args=[])=>db.prepare(sql).bind(...args);
 async function batch(statements,label) {
  let results;
  try { results=await db.batch(statements); } catch(error) {
   const marker=[['start-rate-limited','resource-exhausted'],['expired','deadline-exceeded'],['too-early','failed-precondition'],['policy-changed','failed-precondition']].find(([text])=>error.message.includes(text));
   if(marker) error.code=marker[1];
   throw error;
  }
  onMetrics({label,queries:results.length,rowsRead:results.reduce((n,r)=>n+(r.meta.rows_read||0),0),rowsWritten:results.reduce((n,r)=>n+(r.meta.rows_written||0),0),results});
  return results;
 }
 const one=async(sql,args,label)=>(await batch([stmt(sql,args)],label))[0].results[0];
 const getConfig=async()=>{
  const c=await one('SELECT * FROM config WHERE id=1',[],'config');
  if(!c) deny('failed-precondition','Inactive');
  return {...c,enabled:!!c.enabled,activationAt:{toMillis:()=>c.activation},policyVersion:c.version};
 };
 const finish=s=>s.accepted?{accepted:true,eventId:s.id}:{accepted:false,reason:s.reason};
 async function start(data,context) {
  const r=identity(context,data.anonymousReaderId,secret);
  if(!uuid(data.requestId)) deny('invalid-argument','Request ID required');
  const ch=resolveChapter(await catalogue(),data.mangaId||data.mangaSlug,data.chapterId);
  const id=hash(secret,'session-v1',r.deviceHash,r.uid,data.requestId,ch.mangaId,ch.chapterId);
  const now=clock(),c=await getConfig(),p=policy(c),a=activation(c,now);
  const args=[id,r.uid,r.deviceHash,r.accountHash,r.networkHash,ch.teamId,ch.mangaId,ch.chapterId,ch.catalogueRevision,a,p.policyVersion,now,now+p.sessionMs,now+172800000,now];
  const rows=await batch([stmt('INSERT INTO sessions(id,uid,device,account,network,team,manga,chapter,revision,activation,version,started,expires,delete_after,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id,expires',args)],'start');
  const s=rows[0].results[0]||await one('SELECT id,expires FROM sessions WHERE id=?',[id],'start-replay');
  if(s.expires<=now) deny('deadline-exceeded','View session expired');
  return {sessionId:id,expiresAt:s.expires,minimumActiveMs:p.minimumMs};
 }
 async function record(data,context) {
  const r=identity(context,data.anonymousReaderId,secret),id=data.sessionId;
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)) deny('invalid-argument','Session ID invalid');
  const s=await one('SELECT * FROM sessions WHERE id=?',[id],'receipt');
  if(!s) deny('not-found','Session missing');
  if(s.device!==r.deviceHash||(s.uid&&s.uid!==r.uid)) deny('permission-denied','Identity mismatch');
  if(s.consumed) return finish(s);
  const ch=resolveChapter(await catalogue(),s.manga,s.chapter);
  if(ch.teamId!==s.team) deny('failed-precondition','Ownership changed');
  // UPDATE computes the outcome from current transactional state, never from stale JS reads.
  // Preserve A's hashed keys. Legacy dedup docs contain no reversible chapter/
  // identity fields, so concatenated SQL keys would lose the imported24h barrier.
  const dedupIds=[hash(secret,'chapter-dedup-v1',r.deviceHash,s.manga,s.chapter),r.accountHash?hash(secret,'chapter-dedup-v1',r.accountHash,s.manga,s.chapter):null];
  const duplicate='EXISTS(SELECT 1 FROM dedup WHERE id IN (?,?) AND eligible>?)';
  const limited=rateExceeded('accepted','s');
  const sql=`UPDATE sessions AS s SET consumed=1,at=?,account=?,network=?,record_revision=?,record_uid=?,device_dedup=?,account_dedup=?,reason=CASE WHEN ${duplicate} THEN 'duplicate' WHEN ${limited.replaceAll('s.at','?').replaceAll('s.account','?').replaceAll('s.network','?')} THEN 'rate-limited' ELSE NULL END,accepted=CASE WHEN ${duplicate} OR ${limited.replaceAll('s.at','?').replaceAll('s.account','?').replaceAll('s.network','?')} THEN 0 ELSE 1 END WHERE id=? AND consumed=0`;
  // Parameter order: account twice (value + null guard), network, decision time.
  const now=clock(),rateArgs=[r.accountHash,r.accountHash,r.networkHash,now];
  const args=[now,r.accountHash,r.networkHash,ch.catalogueRevision,r.uid,...dedupIds,...dedupIds,now,...rateArgs,...dedupIds,now,...rateArgs,id];
  const queries=[stmt(sql+' RETURNING id,accepted,reason',args)];
  if(failure('after-record')) queries.push(stmt('INSERT INTO deliberately_missing_table VALUES(1)'));
  const result=await batch(queries,'record');
  if(failure('after-commit')) throw new Error('Synthetic response lost after commit');
  return finish(result[0].results[0]||await one('SELECT id,accepted,reason FROM sessions WHERE id=?',[id],'record-raced-replay'));
 }
 async function analytics(data,actor) {
  const scope=authorizeAnalytics(actor,data.scopeId),parts=data.scopeId.split(':');
  const filters=[],args=[];
  if(scope.teamId){filters.push('team=?');args.push(scope.teamId);}
  if(parts[0]==='manga'||parts[0]==='chapter'){filters.push('manga=?');args.push(parts[2]);}
  if(parts[0]==='chapter'){filters.push('chapter=?');args.push(parts[3]);}
  if(data.period&&data.period!=='all') {if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.period)) deny('invalid-argument','Period invalid');filters.push('month=?');args.push(data.period);}
  return one(`SELECT count(*) AS validViews FROM events ${filters.length?'WHERE '+filters.join(' AND '):''}`,args,'analytics');
 }
 async function report(month,actor,{coverage}={}) {
  requireAdmin(actor);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) deny('invalid-argument','Month invalid');
  const end=Date.parse(month+'-01T00:00:00Z'); const next=new Date(end);next.setUTCMonth(next.getUTCMonth()+1);
  if(next.getTime()>clock()) deny('failed-precondition','Month not closed');
  if(!coverage||coverage.status!=='verified-complete'||coverage.gaps?.length!==0||coverage.end!==next.getTime()||!coverage.evidenceReference) deny('failed-precondition','Coverage unverified');
  const c=await getConfig();
  if(coverage.start!==Math.max(end,c.activation)||coverage.verifiedAt<coverage.end||coverage.verifiedAt>clock()) deny('failed-precondition','Coverage window invalid');
  const previous=await one('SELECT snapshot FROM reports WHERE month=?',[month],'report-replay');
  if(previous) {
   const saved=JSON.parse(previous.snapshot);
   if(saved.storage==='chunked-v1'){
    if(saved.bytes>131072)deny('resource-exhausted','Full report exceeds verified Free envelope; use retained Google exporter');
    const chunks=(await batch([stmt('SELECT part,body FROM report_chunks WHERE month=? ORDER BY part',[month])],'report-chunks'))[0].results;
    if(chunks.length!==saved.parts||chunks.some((c,i)=>c.part!==i))deny('failed-precondition','Snapshot chunks incomplete');
    const text=chunks.map(c=>c.body).join('');
    if(createHash('sha256').update(text).digest('hex')!==saved.contentHash)deny('failed-precondition','Snapshot hash mismatch');
    return JSON.parse(text);
   }
   return saved;
  }
  const cat=await catalogue();
  const rows=(await batch([stmt('SELECT team,manga,count(*) AS n FROM events WHERE month=? GROUP BY team,manga LIMIT 201',[month])],'report-group'))[0].results;
  if(rows.length>200)deny('resource-exhausted','Report requires retained Google exporter; no totals truncated');
  const teams=new Map();for(const row of rows) teams.set(row.team,(teams.get(row.team)||0)+row.n);
  const snapshot=buildSnapshot(month,cat,{validViews:rows.reduce((n,r)=>n+r.n,0)},[...teams].map(([teamId,validViews])=>({teamId,validViews,scopeId:`team:${teamId}`,kind:'team',period:month,parentScopeId:'site'})),rows.map(r=>({teamId:r.team,mangaId:r.manga,validViews:r.n,scopeId:`manga:${r.team}:${r.manga}`,parentScopeId:`team:${r.team}`,kind:'manga',period:month})),coverage);
  if(Buffer.byteLength(JSON.stringify(snapshot))>131072)deny('resource-exhausted','Report exceeds local Free size guard; Google/offline exporter required');
  const saved=await batch([stmt('INSERT INTO reports VALUES(?,?,?) ON CONFLICT(month) DO NOTHING',[month,snapshot.snapshotHash,JSON.stringify(snapshot)]),stmt('SELECT snapshot FROM reports WHERE month=?',[month])],'report-save');
  return JSON.parse(saved[1].results[0].snapshot);
 }
 async function cleanup(now,limit=15,cursors={}) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>15) throw new Error('Cleanup must stay below Free invocation query limit');
  // Bounded keyset sweep: each cycle covers dedup/rates; never scans entire history per call.
  const next={};
  for(const table of ['sessions','dedup','rates']) {
   const ids=(await batch([stmt(`SELECT id,delete_after FROM ${table} WHERE id>? ORDER BY id LIMIT ?`,[cursors[table]||'',limit])],'cleanup-read'))[0].results;
   next[table]=ids.length===limit?ids.at(-1).id:'';
   const expired=ids.filter(r=>r.delete_after<=now);
   if(expired.length) await batch(expired.map(r=>stmt(`DELETE FROM ${table} WHERE id=? AND delete_after<=?`,[r.id,now])),'cleanup-delete');
  }
  return next;
 }
 return {start,record,analytics,report,cleanup};
}
