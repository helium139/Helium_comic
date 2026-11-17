import {createAuthority} from './authority.mjs';
import {createGoogleIdentityBridge} from './google-identity-bridge.mjs';
import {googleAccessTokenSupplier} from './google-access-token.mjs';
const cache=new WeakMap();
export function boundAuthority(env,{catalogue,fetchImpl=fetch,clock=Date.now}={}){
 if(!cache.has(env)){
  const getAccessToken=googleAccessTokenSupplier({serviceAccountJSON:env.GOOGLE_IDENTITY_SERVICE_ACCOUNT_JSON,fetchImpl,clock});
  const bridge=createGoogleIdentityBridge({getAccessToken,fetchImpl});
  cache.set(env,createAuthority({db:env.DB,bridge,catalogue,clock}));
 }
 return cache.get(env);
}
export async function requireFreeCapacity(db,features,clock=Date.now){
 const row=await db.prepare('SELECT verified,evidence_hash,free_features,free_expires FROM migration_gate WHERE id=1').first();
 let enabled=[];try{enabled=JSON.parse(row?.free_features||'[]');}catch{}
 if(row?.verified!==1||!/^[a-f0-9]{64}$/.test(row.evidence_hash||'')||row.free_expires<=clock()||!features.every(f=>enabled.includes(f))){
  const e=new Error('Verified restore and Free capacity evidence required');e.code='failed-precondition';throw e;
 }
 return row;
}
