import {validSlug} from '../../functions/lib/views/policy.mjs';
// Role assignment needs only the trusted team registry, never the manga catalogue.
export function teamRegistry({fetchImpl=fetch}={}){
 return async()=>{
  const response=await fetchImpl('https://heliumtg.com/assets/data/teams.json',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Team registry unavailable');const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>65536)throw Error('Team registry exceeds reviewed envelope');
  const teams=JSON.parse(text);if(!Array.isArray(teams)||teams.length>200||teams.some(t=>!validSlug(t.id)||typeof t.active!=='boolean')||new Set(teams.map(t=>t.id)).size!==teams.length)throw Error('Invalid trusted team registry');
  return {teams};
 };
}
