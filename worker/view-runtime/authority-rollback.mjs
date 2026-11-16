// Trusted local snapshot input only. Never lower versions or restore old claims.
export function planAuthorityRollback(current,baseline,{operatorUid}){
 const valid=rows=>Array.isArray(rows)&&new Set(rows.map(r=>r.uid)).size===rows.length&&rows.every(r=>typeof r.uid==='string'&&r.uid&&!/[\\/]/.test(r.uid)&&['admin','team_leader','user'].includes(r.role)&&(r.role!=='team_leader'||typeof r.teamId==='string'&&r.teamId));
 if(!valid(current)||!valid(baseline)||!baseline.some(r=>r.role==='admin')||!current.some(r=>r.uid===operatorUid&&r.role==='admin'))throw Error('Trusted complete authority snapshots and current admin required');
 const byId=new Map(baseline.map(r=>[r.uid,r]));if(current.length!==baseline.length||current.some(r=>!byId.has(r.uid)||r.state!=='active'||!Number.isSafeInteger(r.version)))throw Error('Reconcile changed/pending identities before rollback');
 const changes=current.filter(r=>{const b=byId.get(r.uid);return r.role!==b.role||(r.teamId||null)!==(b.teamId||null);}).map(r=>({uid:r.uid,role:byId.get(r.uid).role,teamId:byId.get(r.uid).role==='team_leader'?byId.get(r.uid).teamId:null,previousVersion:r.version,minimumNewVersion:r.version+1}));
 return changes.sort((a,b)=>Number(b.role==='admin')-Number(a.role==='admin')||Number(a.uid===operatorUid)-Number(b.uid===operatorUid)||a.uid.localeCompare(b.uid));
}
export async function executeAuthorityRollback(plan,{authority,operator,assertQuiesced}){
 if(typeof assertQuiesced!=='function')throw Error('Explicit quiescence check required');
 const results=[];for(const item of plan){await assertQuiesced();const result=await authority.changeAccess({uid:item.uid,role:item.role,teamId:item.teamId},operator);if(result.version<item.minimumNewVersion)throw Error('Rollback version must increase');results.push({uid:item.uid,version:result.version});}
 // Operator must verify ALL claims/profile/mirrors before disabling D1 routing.
 return {results,requiresProjectionReconciliation:true,mayDisableStrictGuards:false};
}
