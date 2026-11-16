// Backend-only transport. OAuth token supplier is an operator-configured adapter,
// never a value accepted from an HTTP request or stored in the public frontend.
export function createGoogleIdentityBridge({getAccessToken,fetchImpl=fetch,project='helium-team-d7f80'}){
 if(typeof getAccessToken!=='function')throw Error('Backend credential supplier required');
 const uidPath=uid=>{if(typeof uid!=='string'||!uid||uid.length>128||/[\\/]/.test(uid))throw Error('Invalid UID');return encodeURIComponent(uid);};
 async function request(url,method,body,{allowMissing=false}={}){
  const token=await getAccessToken();
  const response=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(allowMissing&&response.status===404)return null;
  if(!response.ok)throw Error('Identity synchronization failed');
  return response.status===204?{}:response.json();
 }
 async function getAccount(uid){uidPath(uid);const result=await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,'POST',{localId:[uid]});const user=result.users?.[0];if(!user||user.localId!==uid)throw Error('Account not found');return {disabled:!!user.disabled,validSince:Number(user.validSince||0),customClaims:JSON.parse(user.customAttributes||'{}')};}
 function fields(row){return Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined).map(([key,v])=>[key,v===null?{nullValue:null}:typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)}]));}
 const documentURL=(collection,uid)=>`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}/${uidPath(uid)}`;
 async function patch(collection,uid,row,mask=Object.keys(row),current){
  const query=new URLSearchParams();for(const key of mask)query.append('updateMask.fieldPaths',key);
  if(current!==undefined){if(current===null)query.set('currentDocument.exists','false');else {if(!current.updateTime)throw Error('Missing mirror precondition');query.set('currentDocument.updateTime',current.updateTime);}}
  return request(`${documentURL(collection,uid)}?${query}`,'PATCH',{fields:fields(row)});
 }
 async function patchMirror(uid,row,{mode}={}){
  if(!['renew','prepare','commit'].includes(mode))throw Error('Explicit mirror transition required');
  const current=await request(documentURL('authzMirrors',uid),'GET',undefined,{allowMissing:true});
  const f=current?.fields||{},version=Number(f.version?.integerValue||0),state=f.state?.stringValue;
  const same=version===row.version&&f.role?.stringValue===row.role&&(f.teamId?.stringValue||null)===(row.teamId||null);
  if(version>row.version||mode==='renew'&&(!same||state!=='active')||mode==='commit'&&(!same||!['pending','active'].includes(state))||mode==='prepare'&&version===row.version&&(!same||!['pending','active'].includes(state)))throw Error('Stale mirror transition');
  return patch('authzMirrors',uid,{role:row.role,teamId:row.teamId,version:row.version,state:row.state,leaseUntilMs:row.leaseUntil},undefined,current);
 }
 return {
  getAccount,
  async setClaims(uid,patch){const account=await getAccount(uid);const claims={...account.customClaims,role:patch.role,accessVersion:patch.accessVersion};if(patch.teamId)claims.teamId=patch.teamId;else delete claims.teamId;return request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,'POST',{localId:[uid],customAttributes:JSON.stringify(claims)});},
  patchProfile:(uid,row)=>patch('users',uid,{role:row.role,...(row.teamId?{teamId:row.teamId}:{})},['role','teamId']),
  patchMirror
 };
}
