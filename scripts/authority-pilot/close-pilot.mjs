// One spare call: tolerate a failed disable OR failed verification. No workload retries.
export async function closePilot({api,name,pause=async()=>{}}){
 const evidence={attempts:[],verified:false};
 const disable=async()=>{try{await api('POST','workers/scripts/'+name+'/subdomain',{enabled:false,previews_enabled:false});evidence.attempts.push({action:'disable',ok:true});return true;}catch{evidence.attempts.push({action:'disable',ok:false});return false;}};
 const verify=async()=>{try{const s=await api('GET','workers/scripts/'+name+'/subdomain');evidence.attempts.push({action:'verify',ok:true,enabled:s.enabled,previews_enabled:s.previews_enabled});evidence.verified=s.enabled===false&&s.previews_enabled===false;return evidence.verified;}catch{evidence.attempts.push({action:'verify',ok:false});return false;}};
 if(!await disable())await disable();
 await verify();
 if(!evidence.verified&&evidence.attempts.length<3){await pause();await verify();}
 return evidence;
}
