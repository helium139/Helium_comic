import {requireAdmin,fail} from '../../functions/lib/reports/accounting.mjs';
import {validSlug} from '../../functions/lib/views/policy.mjs';
import {randomUUID} from 'node:crypto';

export async function installAuthority(db){
 for(const sql of [
  "CREATE TABLE access_rows(uid TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('user','admin','team_leader')),team_id TEXT,version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'active',next_role TEXT,next_team TEXT,attempts INTEGER NOT NULL DEFAULT 0,sync_owner TEXT,sync_until INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID",
  'CREATE INDEX access_active_admin ON access_rows(role,state)',
  'CREATE TABLE access_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,version INTEGER NOT NULL,outcome TEXT NOT NULL,at INTEGER NOT NULL) WITHOUT ROWID',
  "CREATE TRIGGER keep_one_admin BEFORE UPDATE ON access_rows WHEN OLD.role='admin' AND OLD.state='active' AND (NEW.role<>'admin' OR NEW.state<>'active') AND NOT EXISTS(SELECT 1 FROM access_rows WHERE uid<>OLD.uid AND role='admin' AND state='active') BEGIN SELECT RAISE(ABORT,'last-admin'); END",
  "CREATE TRIGGER access_audit_no_update BEFORE UPDATE ON access_audit BEGIN SELECT RAISE(ABORT,'immutable-access-audit'); END",
  "CREATE TRIGGER access_audit_no_delete BEFORE DELETE ON access_audit BEGIN SELECT RAISE(ABORT,'immutable-access-audit'); END"
 ])await db.prepare(sql).run();
}

// D1 is current role authority; Auth claims/profile/Firestore rule mirror are
// projections. Pending synchronization denies privilege. Never import frontend roles.
export function createAuthority({db,bridge,catalogue,clock=Date.now}){
 const q=(sql,args=[])=>db.prepare(sql).bind(...args);
 async function resolve(verified,rawToken){
  const row=await q('SELECT * FROM access_rows WHERE uid=?',[verified.uid]).first();
  if(!row||row.state!=='active')fail('permission-denied','Current access unavailable');
  const account=await bridge.getAccount(verified.uid);
  if(account.disabled)fail('permission-denied','Account disabled');
  // rawToken has already passed signature/audience/issuer checks in runtime/CMS.
  const claims=JSON.parse(Buffer.from(rawToken.split('.')[1],'base64url').toString());
  if(claims.sub!==verified.uid||!Number.isFinite(claims.auth_time)||claims.auth_time<Number(account.validSince||0))fail('unauthenticated','Sign in again');
  const unchanged=async()=>{const current=await q('SELECT version,state FROM access_rows WHERE uid=?',[row.uid]).first();if(current?.version!==row.version||current.state!=='active')fail('permission-denied','Access changed during verification');};
  await unchanged();
  await bridge.patchMirror(row.uid,{role:row.role,teamId:row.team_id,version:row.version,state:'active',leaseUntil:clock()+300000},{mode:'renew'});
  await unchanged();
  return {uid:row.uid,role:row.role,teamId:row.team_id,accessVersion:row.version};
 }
 async function changeAccess(data,actor){
  requireAdmin(actor);
  const currentActor=await q("SELECT uid FROM access_rows WHERE uid=? AND role='admin' AND state='active'",[actor.uid]).first();
  if(!currentActor)fail('permission-denied','Current admin required');
  if(typeof data.uid!=='string'||!data.uid||data.uid.length>128||/[\\/]/.test(data.uid)||!['user','admin','team_leader'].includes(data.role))fail('invalid-argument','Invalid access change');
  const team=data.role==='team_leader'?data.teamId:null;
  if(data.role==='team_leader'){
   if(!validSlug(team))fail('invalid-argument','Active team required');
   const entry=catalogue.getTeam?await catalogue.getTeam(team):(await catalogue()).teams.find(t=>t.id===team);
   if(!entry?.active)fail('invalid-argument','Active team required');
  }
  const target=await q('SELECT * FROM access_rows WHERE uid=?',[data.uid]).first();
  if(!target)fail('failed-precondition','Import/verify target authority first');
  if(target.state==='active'&&target.role===data.role&&target.team_id===team)return {ok:true,alreadyApplied:true,version:target.version};
  if(target.state==='pending'&&(target.next_role!==data.role||target.next_team!==team))fail('aborted','Different access change pending');
  if(target.attempts>=3&&target.state==='pending')fail('resource-exhausted','Access sync requires owner review');
  const version=target.state==='pending'?target.version:target.version+1;
  if(target.state==='active'){
   const claimed=await q("UPDATE access_rows SET state='pending',version=?,next_role=?,next_team=?,attempts=0 WHERE uid=? AND state='active' AND version=? AND EXISTS(SELECT 1 FROM access_rows WHERE uid=? AND role='admin' AND state='active')",[version,data.role,team,data.uid,target.version,actor.uid]).run();
   if(claimed.meta.changes!==1)fail('aborted','Access changed concurrently');
  }
  const owner=randomUUID();
  const lock=await q("UPDATE access_rows SET attempts=attempts+1,sync_owner=?,sync_until=? WHERE uid=? AND state='pending' AND version=? AND attempts<3 AND sync_until<=? AND EXISTS(SELECT 1 FROM access_rows WHERE uid=? AND role='admin' AND (state='active' OR uid=?))",[owner,clock()+120000,data.uid,version,clock(),actor.uid,data.uid]).run();
  if(lock.meta.changes!==1)fail('aborted','Access synchronization already running or exhausted');
  const fence=async()=>{const result=await q("UPDATE access_rows SET sync_until=? WHERE uid=? AND state='pending' AND version=? AND sync_owner=? AND sync_until>? AND EXISTS(SELECT 1 FROM access_rows WHERE uid=? AND role='admin' AND (state='active' OR uid=?))",[clock()+120000,data.uid,version,owner,clock(),actor.uid,data.uid]).run();if(result.meta.changes!==1)fail('aborted','Access synchronization lease or admin authority lost');};
  const id=data.uid+':'+version;
  await q('INSERT INTO access_audit VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[id+':start',actor.uid,data.uid,version,'pending',clock()]).run();
  try{
   await fence();
   await bridge.patchMirror(data.uid,{role:data.role,teamId:team,version,state:'pending',leaseUntil:clock()},{mode:'prepare'});
   await fence();
   await bridge.setClaims(data.uid,{role:data.role,teamId:team,accessVersion:version});
   await fence();
   await bridge.patchProfile(data.uid,{role:data.role,teamId:team,accessVersion:version});
   await fence();
   await bridge.patchMirror(data.uid,{role:data.role,teamId:team,version,state:'active',leaseUntil:clock()+300000},{mode:'commit'});
   const result=await q("UPDATE access_rows SET role=?,team_id=?,state='active',next_role=NULL,next_team=NULL,sync_owner=NULL,sync_until=0 WHERE uid=? AND version=? AND state='pending' AND sync_owner=? AND sync_until>?",[data.role,team,data.uid,version,owner,clock()]).run();
   if(result.meta.changes!==1)fail('aborted','Access sync changed');
   await q('INSERT INTO access_audit VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[id+':finish',actor.uid,data.uid,version,'active',clock()]).run();
   return {ok:true,version};
  }catch{await q('UPDATE access_rows SET sync_until=0,sync_owner=NULL WHERE uid=? AND version=? AND sync_owner=?',[data.uid,version,owner]).run();fail('unavailable','Access sync incomplete; privilege remains pending until retry');}
 }
 return {resolve,changeAccess};
}
