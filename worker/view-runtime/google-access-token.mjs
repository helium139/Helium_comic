import {importPKCS8,SignJWT} from 'jose';

// Secret-store input only. No account/key is created, fetched or logged here.
export function googleAccessTokenSupplier({serviceAccountJSON,fetchImpl=fetch,clock=Date.now}){
 let cached,expires=0,pending,key;
 return async()=>{
  if(cached&&expires>clock()+60000)return cached;
  if(pending)return pending;
  pending=(async()=>{
   let account;try{account=JSON.parse(serviceAccountJSON);}catch{throw Error('Backend Google credential unavailable');}
   if(account.type!=='service_account'||!account.client_email?.endsWith('.gserviceaccount.com')||!account.private_key?.includes('PRIVATE KEY'))throw Error('Backend Google credential unavailable');
   key ||= await importPKCS8(account.private_key,'RS256');
   const issued=Math.floor(clock()/1000);
   const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore'})
    .setProtectedHeader({alg:'RS256',typ:'JWT',...(account.private_key_id?{kid:account.private_key_id}:{})})
    .setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt(issued).setExpirationTime(issued+3600).sign(key);
   const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
   if(!response.ok)throw Error('Backend Google authorization unavailable');
   const body=await response.json();if(!body.access_token||!Number.isFinite(Number(body.expires_in)))throw Error('Backend Google authorization unavailable');
   cached=body.access_token;expires=clock()+Math.max(0,Number(body.expires_in))*1000;return cached;
  })().finally(()=>{pending=null;});return pending;
 };
}
