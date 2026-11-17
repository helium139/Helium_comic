import {MIGRATION_ROUTING} from "./migration-routing.js";
import {viewCallable} from "./view-callables.js";
export async function currentStaffClaims(user){
 let token=await user.getIdTokenResult();
 if(MIGRATION_ROUTING.authority!=='cloudflare')return token.claims;
 const current=await viewCallable('getCurrentAccess')({});
 if(current.uid!==user.uid)throw Error('Authority identity mismatch');
 if(token.claims.accessVersion!==current.accessVersion){token=await user.getIdTokenResult(true);}
 if(token.claims.accessVersion!==current.accessVersion||token.claims.role!==current.role||(token.claims.teamId||null)!==(current.teamId||null))throw Error('Access synchronization pending; refresh before staff operations');
 return token.claims;
}
