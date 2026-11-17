import {scopeDescriptors} from '../../functions/lib/views/policy.mjs';
import {eventFromA} from './transfer.mjs';
const same=(a,b)=>JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='epoch').sort()))===JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k])=>k!=='epoch').sort()));
export function eventToA(row,timestamp){return {teamId:row.team,mangaId:row.manga,chapterId:row.chapter,uid:row.uid,anonymousReaderHash:row.device,createdAt:timestamp(row.at),sessionId:row.id,policyVersion:row.version,catalogueRevision:row.revision,sessionCatalogueRevision:row.session_revision,activationAt:timestamp(row.activation),valid:true};}
export function sessionToA(row,timestamp){return {teamId:row.team,mangaId:row.manga,chapterId:row.chapter,uid:row.uid,anonymousReaderHash:row.device,catalogueRevision:row.revision,activationAt:timestamp(row.activation),policyVersion:row.version,startedAt:timestamp(row.started),expiresAt:timestamp(row.expires),deleteAfter:timestamp(row.delete_after),consumed:!!row.consumed,...(row.consumed?{consumedAt:timestamp(row.at),outcome:row.accepted?{accepted:true,eventId:row.id}:{accepted:false,reason:row.reason}}:{})};}
// Injection-only restore transport. No credentials, automatic production discovery,
// resource creation, ledger deletion or reader route change exists in this module.
export function rollbackToGoogle({db,timestamp,epoch,evidenceHash}){
 if(!epoch||epoch==='google-a'||!/^[a-f0-9]{64}$/.test(evidenceHash||''))throw Error('Explicit writer epoch and reviewed pause evidence required');
 const ref=path=>db.doc(path);
 async function guard(tx){const control=(await tx.get(ref('migrationControl/view'))).data(),config=(await tx.get(ref('viewSystem/config'))).data();if(control?.state!=='paused'||control.epoch!==epoch||control.evidenceHash!==evidenceHash||config?.enabled!==false)throw Error('Both writers must remain quiesced; Google restore guard missing');}
 async function event(row){
  if(row.epoch!==epoch||row.valid!==1||!/^[a-f0-9]{64}$/.test(row.id)||row.month!==new Date(row.at).toISOString().slice(0,7))throw Error('Invalid rollback event');
  return db.runTransaction(async tx=>{
   await guard(tx);const eventRef=ref('chapterViewEvents/'+row.id),existing=(await tx.get(eventRef)).data();
   if(existing){if(!same(eventFromA(row.id,existing),row))throw Error('Rollback event collision');return {replayed:true};}
   const aggregates=scopeDescriptors(row.team,row.manga,row.chapter).flatMap(scope=>['all',row.month].map(period=>({scope,period,ref:ref(`analyticsScopes/${scope.scopeId}/periods/${period}`)})));
   const previous=await tx.getAll(...aggregates.map(x=>x.ref));
   tx.create(eventRef,eventToA(row,timestamp));
   aggregates.forEach((item,i)=>tx.set(item.ref,{...item.scope,period:item.period,validViews:(previous[i].data()?.validViews||0)+1,updatedAt:timestamp(row.at),activationAt:timestamp(row.activation)}));
   return {replayed:false};
  });
 }
 async function operational(table,rows){
  if(!['sessions','rates','dedup'].includes(table)||!Array.isArray(rows)||rows.length>25)throw Error('Bounded operational-state batch required');
  return db.runTransaction(async tx=>{
   await guard(tx);
   for(const row of rows){
    if(table==='sessions'){if(!/^[a-f0-9]{64}$/.test(row.id))throw Error('Invalid session');tx.set(ref('chapterViewSessions/'+row.id),sessionToA(row,timestamp));}
    if(table==='dedup'){if(!/^[a-f0-9]{64}$/.test(row.id))throw Error('Invalid dedup');tx.set(ref('viewDedup/'+row.id),{nextEligibleAt:timestamp(row.eligible),deleteAfter:timestamp(row.delete_after)});}
    if(table==='rates'){const match=/^(starts|accepted):([a-f0-9]{64})$/.exec(row.id),times=JSON.parse(row.times);if(!match||!Array.isArray(times)||times.length>10000||times.some(t=>!Number.isSafeInteger(t)))throw Error('Invalid rate');tx.set(ref('viewRateLimits/'+match[1]+'_'+match[2]),{acceptedAt:times,deleteAfter:timestamp(row.delete_after)});}
   }
   return {rows:rows.length};
  });
 }
 return {event,operational};
}
