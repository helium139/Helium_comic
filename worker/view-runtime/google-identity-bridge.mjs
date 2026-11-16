// Backend-only transport. OAuth token supplier is an operator-configured adapter,
// never a value accepted from an HTTP request or stored in the public frontend.
export function createGoogleIdentityBridge({getAccessToken,fetchImpl=fetch,project='helium-team-d7f80'}){
 if(typeof getAccessToken!=='function')throw Error('Backend credential supplier required');
 const uidPath=uid=>{if(typeof uid!=='string'||!uid||uid.length>128||/[\\/]/.test(uid))throw Error('Invalid UID');return encodeURIComponent(uid);};
 async function request(url,method,body){
  const token=await getAccessToken();
  const response=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Identity synchronization failed');
  return response.status===204?{}:response.json();
 }
 async function getAccount(uid){uidPath(uid);const result=await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,'POST',{localId:[uid]});const user=result.users?.[0];if(!user||user.localId!==uid)throw Error('Account not found');return {disabled:!!user.disabled,validSince:Number(user.validSince||0),customClaims:JSON.parse(user.customAttributes||'{}')};}
 function fields(row){return Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined).map(([key,v])=>[key,v===null?{nullValue:null}:typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)}]));}
 async function patch(collection,uid,row,mask=Object.keys(row)){
  const query=new URLSearchParams();for(const key of mask)query.append('updateMask.fieldPaths',key);
  return request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}/${uidPath(uid)}?${query}`,'PATCH',{fields:fields(row)});
 }
 return {
  getAccount,
  async setClaims(uid,patch){const account=await getAccount(uid);const claims={...account.customClaims,role:patch.role,accessVersion:patch.accessVersion};if(patch.teamId)claims.teamId=patch.teamId;else delete claims.teamId;return request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,'POST',{localId:[uid],customAttributes:JSON.stringify(claims)});},
  patchProfile:(uid,row)=>patch('users',uid,{role:row.role,...(row.teamId?{teamId:row.teamId}:{})},['role','teamId']),
  patchMirror:(uid,row)=>patch('authzMirrors',uid,{role:row.role,teamId:row.teamId,version:row.version,state:row.state,leaseUntilMs:row.leaseUntil})
 };
}
