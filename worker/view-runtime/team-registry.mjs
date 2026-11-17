import {validSlug} from '../../functions/lib/views/policy.mjs';
// Role assignment needs only the trusted team registry, never the manga catalogue.
export function teamRegistry({fetchImpl=fetch,clock=Date.now,maxValidatorAgeMs=30000}={}){
 if(!Number.isSafeInteger(maxValidatorAgeMs)||maxValidatorAgeMs<0||maxValidatorAgeMs>30000)throw Error('Bounded registry validator age required');
 let cached,pending,generation=0;
 async function load(){
  const started=generation;
  const reusable=cached&&clock()-cached.at<maxValidatorAgeMs,headers={'Cache-Control':'no-cache'};
  if(reusable&&cached.etag)headers['If-None-Match']=cached.etag;
  let response;try{response=await fetchImpl('https://heliumtg.com/assets/data/teams.json',{redirect:'error',signal:AbortSignal.timeout(10000),headers});}catch{cached=null;throw Error('Team registry unavailable');}
  if(started!==generation)throw Error('Team registry invalidated during fetch');
  if(response.status===304){if(!reusable||!cached.etag){cached=null;throw Error('Unsolicited/stale registry validator');}return cached;}
  cached=null;if(!response.ok)throw Error('Team registry unavailable');const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>65536)throw Error('Team registry exceeds reviewed envelope');
  if(started!==generation)throw Error('Team registry invalidated during fetch');
  const teams=JSON.parse(text);if(!Array.isArray(teams)||teams.length>200||teams.some(t=>!validSlug(t.id)||typeof t.active!=='boolean')||new Set(teams.map(t=>t.id)).size!==teams.length)throw Error('Invalid trusted team registry');
  for(const t of teams)Object.freeze(t);Object.freeze(teams);
  cached={teams,map:new Map(teams.map(t=>[t.id,t])),etag:response.headers.get('etag'),at:clock()};return cached;
 }
 async function read(){if(!pending)pending=load().finally(()=>{pending=null;});return pending;}
 const catalogue=async()=>({teams:(await read()).teams});
 catalogue.getTeam=async id=>(await read()).map.get(id)||null;
 catalogue.invalidate=()=>{generation++;cached=null;};
 return catalogue;
}
