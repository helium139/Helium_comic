// Measurement client only. Never provisions, deploys, reads credentials or retries.
export const limits=Object.freeze({http:250,read:5000,write:2000,bytes:1048576});
export function pilotBudget(initial={http:50,read:64,write:128}){
 const used={...initial};
 for(const key of ['http','read','write'])if(!Number.isSafeInteger(used[key])||used[key]<0||used[key]>limits[key])throw Error('Invalid initial pilot budget');
 function reserve(cost){for(const key of ['http','read','write'])if(!Number.isSafeInteger(cost[key])||cost[key]<0||used[key]+cost[key]>limits[key])throw Error('Pilot budget exhausted before request');for(const key of ['http','read','write'])used[key]+=cost[key];}
 function settle(reserved,actual){for(const key of ['read','write'])if(!Number.isSafeInteger(actual[key])||actual[key]<0||actual[key]>reserved[key])throw Error('Unverified/exceeded D1 reservation; STOP');if(!Number.isSafeInteger(actual.bytes)||actual.bytes>limits.bytes||actual.bytes<0)throw Error('Unverified/exceeded database size; STOP');for(const key of ['read','write'])used[key]-=reserved[key]-actual[key];}
 return {reserve,settle,snapshot:()=>({...used})};
}
export async function runMeasurementClient({baseURL,approvedHost,steps,getSyntheticJWT,pilotSecret,fetchImpl=fetch,journal,now=()=>performance.now(),budget=pilotBudget()}){
 const base=new URL(baseURL);
 if(base.protocol!=='https:'||base.host!==approvedHost||!/^helium-authority-fixture-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(base.hostname)||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw Error('Isolated approved fixture host required');
 if(typeof journal!=='function'||!pilotSecret||!Array.isArray(steps)||steps.length>48||new Set(steps.map(s=>s.id)).size!==steps.length)throw Error('Bounded unique plan and pre-send durable journal required');
 const records=[];
 for(const step of steps){
  const method=step.method||'POST';
  if(!/^[a-z0-9-]{1,64}$/.test(step.id)||!['getCurrentAccess','setUserAccess'].includes(step.name)||!['warm','forced-key-cold'].includes(step.cryptoCase)||!['POST','OPTIONS'].includes(method))throw Error('Invalid fixture step');
  const reserved={http:1,read:64,write:32};budget.reserve(reserved);
  await journal({id:step.id,state:'issued',reservation:reserved,budget:budget.snapshot()});
  const headers={'Content-Type':'application/json','X-Helium-Pilot-Key':pilotSecret,'X-Helium-Pilot-Crypto':step.cryptoCase};
  if(method==='POST')headers.Authorization='Bearer '+await getSyntheticJWT(step);
  const started=now();let response;
  try{response=await fetchImpl(new URL(step.name+'?pilotCase='+step.id,base),{method,headers,body:method==='POST'?JSON.stringify({data:step.data||{}}):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{await journal({id:step.id,state:'unknown-stop',budget:budget.snapshot()});throw Error('Unknown request outcome; reservation retained; no retry');}
  const latencyMs=now()-started;let meta,body;
  try{meta=JSON.parse(response.headers.get('X-Helium-Pilot-Metrics'));body=response.status===204?{}:await response.json();}catch{throw Error('Missing fixture metrics; reservation retained; STOP');}
  if(meta?.caseId!==step.id)throw Error('Fixture correlation mismatch; STOP');
  budget.settle(reserved,{read:meta.rowsRead,write:meta.rowsWritten,bytes:meta.databaseBytes});
  const correct=response.status===step.expectStatus&&(!step.expectResult||Object.entries(step.expectResult).every(([k,v])=>body.result?.[k]===v));
  const record={id:step.id,operation:method==='OPTIONS'?'OPTIONS':step.name,cryptoCase:step.cryptoCase,isolateFirst:meta.isolateFirst===true,isolateTag:meta.isolateTag,status:response.status,correct,latencyMs,rowsRead:meta.rowsRead,rowsWritten:meta.rowsWritten,databaseBytes:meta.databaseBytes,cpuMs:null};
  records.push(record);await journal({...record,state:'observed',budget:budget.snapshot()});
  if(!correct)throw Error('Correctness failure; STOP');
 }
 return {records,budget:budget.snapshot(),decision:'pending-provider-CPU-and-complete-case-coverage'};
}
export function attachProviderCPU(records,traces){
 const byId=new Map();for(const t of traces){if(byId.has(t.id)||!Number.isFinite(t.cpuMs)||t.cpuMs<0)throw Error('Ambiguous/invalid provider CPU trace');byId.set(t.id,t);}
 const result=records.map(r=>({...r,cpuMs:byId.get(r.id)?.cpuMs??null,providerOutcome:byId.get(r.id)?.outcome??null}));
 const complete=result.every(r=>r.cpuMs!==null&&r.providerOutcome!==null);
 const exceeded=result.some(r=>r.cpuMs>10||r.providerOutcome==='exceededCpu');
 const groups=[];for(const key of new Set(result.map(r=>[r.operation,r.isolateFirst?'isolate-first':'isolate-warm',r.cryptoCase].join('/')))){
  const rows=result.filter(r=>[r.operation,r.isolateFirst?'isolate-first':'isolate-warm',r.cryptoCase].join('/')===key),cpu=rows.map(r=>r.cpuMs).filter(n=>n!==null).sort((a,b)=>a-b),latency=rows.map(r=>r.latencyMs).sort((a,b)=>a-b);
  const q=(values,p)=>values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]:null;
  groups.push({key,count:rows.length,cpuSamples:cpu.length,cpuP50:q(cpu,.5),cpuP95:q(cpu,.95),latencyP50:q(latency,.5),latencyP95:q(latency,.95)});
 }
 return {records:result,groups,decision:!complete?'inconclusive-missing-provider-traces':exceeded?'no-go-CPU':result.some(r=>r.providerOutcome!=='ok')?'no-go-provider-errors':result.every(r=>r.correct)?'sample-pass-only-not-production-approval':'no-go-correctness'};
}
