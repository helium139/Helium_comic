import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const columns={
 events:['id','team','manga','chapter','uid','device','at','month','activation','version','revision','session_revision','valid','epoch'],
 sessions:['id','uid','device','account','network','team','manga','chapter','revision','activation','version','started','expires','delete_after','at','consumed','accepted','reason','record_revision','record_uid','device_dedup','account_dedup'],
 rates:['id','times','delete_after'],dedup:['id','eligible','delete_after'],reports:['month','hash','snapshot'],report_chunks:['month','part','body'],
 accounting_coverage:['month','body'],
 export_jobs:['month','status','owner','lease_until','attempts','creation_state','spreadsheet_id','spreadsheet_url','export_key','folder','error_code','next_retry'],
 export_attempts:['id','month','outcome','at'],
 access_rows:['uid','role','team_id','version','state','next_role','next_team','attempts','sync_owner','sync_until'],
 access_audit:['id','actor','target','version','outcome','at'],
};
const keys={events:['id'],sessions:['id'],rates:['id'],dedup:['id'],reports:['month'],report_chunks:['month','part'],accounting_coverage:['month'],export_jobs:['month'],export_attempts:['id'],access_rows:['uid'],access_audit:['id']};
export async function installTransfer(db){await db.prepare('CREATE TABLE transfer_batches(id TEXT PRIMARY KEY,hash TEXT NOT NULL,rows INTEGER NOT NULL) WITHOUT ROWID').run();}
// <=20 rows =>44 batched statements +3 preflight reads <=47, under Free's50.
export function sealedBatch(id,table,rows){if(!columns[table]||!Array.isArray(rows)||rows.length>20)throw Error('Bounded known table required');const payload={id,table,rows};return {...payload,hash:sha(canonical(payload))};}
export async function restoreBatch(db,batch){
 if(batch.hash!==sha(canonical({id:batch.id,table:batch.table,rows:batch.rows})))throw Error('Transfer hash mismatch');
 const cols=columns[batch.table];if(!cols||batch.rows.length>20)throw Error('Unknown/oversized transfer batch');
 const gate=await db.prepare('SELECT verified FROM migration_gate WHERE id=1').first();if(gate?.verified!==0)throw Error('Restore forbidden after writer activation');
 const previous=await db.prepare('SELECT hash FROM transfer_batches WHERE id=?').bind(batch.id).first();
 if(previous){if(previous.hash!==batch.hash)throw Error('Transfer ID collision');return {rows:0,replayed:true};}
 const statements=[db.prepare("SELECT CASE WHEN (SELECT verified FROM migration_gate WHERE id=1)=0 THEN 1 ELSE json_extract('writer-active','$') END"),db.prepare('UPDATE transfer_mode SET enabled=1 WHERE id=1')];
 for(const row of batch.rows){
  if(Object.keys(row).some(k=>!cols.includes(k))||cols.some(k=>!Object.hasOwn(row,k)))throw Error('Exact transfer schema required');
  const predicate=keys[batch.table].map(k=>`${k} IS ?`).join(' AND '),keyValues=keys[batch.table].map(k=>row[k]);
  const same=cols.map(k=>`${k} IS ?`).join(' AND ');
  // A read-only failing expression rolls back the batch on collision; no extra
  // temporary row/index write is added to each restored revenue event.
  statements.push(db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${batch.table} WHERE ${predicate}) AND NOT EXISTS(SELECT 1 FROM ${batch.table} WHERE ${predicate} AND ${same}) THEN json_extract('transfer-collision','$') ELSE 1 END`).bind(...keyValues,...keyValues,...cols.map(k=>row[k])));
  statements.push(db.prepare(`INSERT INTO ${batch.table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`).bind(...cols.map(k=>row[k])));
 }
 statements.push(db.prepare('INSERT INTO transfer_batches VALUES(?,?,?)').bind(batch.id,batch.hash,batch.rows.length));
 statements.push(db.prepare('UPDATE transfer_mode SET enabled=0 WHERE id=1'));
 const result=await db.batch(statements);
 return {rows:batch.rows.length,replayed:false,rowsRead:result.reduce((n,r)=>n+r.meta.rows_read,0),rowsWritten:result.reduce((n,r)=>n+r.meta.rows_written,0)};
}
export function eventFromA(id,event){
 const at=toMillis(event.createdAt);if(!/^[a-f0-9]{64}$/.test(id)||event.valid!==true)throw Error('Invalid accepted-event backup');
 return {id,team:event.teamId,manga:event.mangaId,chapter:String(event.chapterId),uid:event.uid||null,device:event.anonymousReaderHash,at,month:new Date(at).toISOString().slice(0,7),activation:toMillis(event.activationAt),version:event.policyVersion,revision:event.catalogueRevision,session_revision:event.sessionCatalogueRevision,valid:1,epoch:'google-a'};
}
export function toMillis(value){const ms=typeof value==='number'?value:typeof value==='string'?Date.parse(value):typeof value?.toMillis==='function'?value.toMillis():Number(value?.seconds)*1000+Number(value?.nanoseconds||0)/1e6;if(!Number.isSafeInteger(ms))throw Error('Invalid/non-integral backup timestamp');return ms;}
export function rateFromA(id,value){const match=/^(starts|accepted)_([a-f0-9]{64})$/.exec(id);if(!match||!Array.isArray(value.acceptedAt)||value.acceptedAt.some(t=>!Number.isSafeInteger(t))||value.acceptedAt.length>10000)throw Error('Invalid rate backup');if(!value.acceptedAt.length)return null;return {id:match[1]+':'+match[2],times:JSON.stringify([...value.acceptedAt].sort((a,b)=>a-b)),delete_after:toMillis(value.deleteAfter)};}
export function dedupFromA(id,value){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid dedup key');return {id,eligible:toMillis(value.nextEligibleAt),delete_after:toMillis(value.deleteAfter)};}
export function sessionFromA(id,s,{accountHash=null,networkHash=null}={}){
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid session key');
 // Legacy session docs do not contain account/network hashes. They are not
 // used for record identity; each Record recomputes them from trusted context.
 return {id,uid:s.uid||null,device:s.anonymousReaderHash,account:accountHash,network:networkHash||'legacy-not-used-for-record',team:s.teamId,manga:s.mangaId,chapter:String(s.chapterId),revision:s.catalogueRevision,activation:toMillis(s.activationAt),version:s.policyVersion,started:toMillis(s.startedAt),expires:toMillis(s.expiresAt),delete_after:toMillis(s.deleteAfter),at:toMillis(s.consumedAt||s.startedAt),consumed:s.consumed?1:0,accepted:s.consumed?(s.outcome?.accepted?1:0):null,reason:s.outcome?.reason||null,record_revision:null,record_uid:null,device_dedup:null,account_dedup:null};
}
export function reportChunks(month,snapshot){const text=JSON.stringify(snapshot);const contentHash=sha(text);const rows=[];for(let offset=0;offset<text.length;offset+=16384)rows.push({month,part:rows.length,body:text.slice(offset,offset+16384)});return {head:{month,hash:snapshot.snapshotHash,snapshot:JSON.stringify({storage:'chunked-v1',parts:rows.length,bytes:Buffer.byteLength(text),contentHash})},chunks:rows};}
export async function reconcileLedger(db,expected){const rows=(await db.prepare('SELECT month,team,manga,chapter,count(*) AS n FROM events GROUP BY month,team,manga,chapter ORDER BY month,team,manga,chapter').all()).results;const actual=canonical(rows);if(actual!==canonical(expected))throw Error('Ledger totals do not reconcile');return {rows:rows.length,views:rows.reduce((n,r)=>n+r.n,0),totalsHash:sha(actual)};}
export async function exportRollbackEpoch(db,epoch,cursor='',limit=25){if(!epoch||epoch==='google-a'||!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Explicit CF writer epoch and bounded page required');const result=await db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?').bind(cursor,limit).all();return {events:result.results.filter(row=>row.epoch===epoch),scanned:result.results.length,nextCursor:result.results.length===limit?result.results.at(-1).id:null};}
