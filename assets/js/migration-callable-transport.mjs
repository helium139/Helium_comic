// No provider fallback: retrying against a second ledger can double count views.
export function migrationCallable({baseURL,name,getIdToken,getAppCheckToken,fetchImpl=fetch,timeout=70000}) {
 const base=new URL(baseURL);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Reviewed HTTPS Worker URL required');
 if(!/^[A-Za-z]+$/.test(name))throw Error('Invalid callable name');
 return async data=>{
  const headers={'Content-Type':'application/json'},id=await getIdToken(),app=await getAppCheckToken();
  if(id)headers.Authorization='Bearer '+id;if(app)headers['X-Firebase-AppCheck']=app;
  const response=await fetchImpl(new URL(name,base.href.replace(/\/?$/,'/')),{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(timeout)});
  const body=await response.json();
  if(!response.ok||body.error){const error=Error(body.error?.message||'Callable failed');error.code='functions/'+(body.error?.status||'unavailable').toLowerCase().replaceAll('_','-');throw error;}
  if(!Object.hasOwn(body,'result'))throw Error('Malformed callable response');
  return body.result;
 };
}
