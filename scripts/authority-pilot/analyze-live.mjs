import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {attachProviderCPU} from './control.mjs';
const dir=path.resolve(process.argv[2]),data=JSON.parse(await readFile(path.join(dir,'provider-logs.private.json'))),work=JSON.parse(await readFile(path.join(dir,'workload-result.json'))),events=data.events.events,traces=[];
for(const event of events){const w=event.$workers;if(w?.scriptName!=='helium-authority-fixture-20261116')throw Error('Nonfixture log returned');if(typeof w.cpuTimeMs==='number'){const id=w.event?.search?.pilotCase;if(!id)continue;traces.push({id,cpuMs:w.cpuTimeMs,outcome:w.outcome});}}
const result=attachProviderCPU(work.records,traces);result.budget=work.budget;result.provider='Cloudflare Workers invocation logs cpuTimeMs';result.trueColdSamples=result.records.filter(r=>r.isolateFirst).length;result.maxCPU=Math.max(...result.records.map(r=>r.cpuMs??0));result.correct=result.records.every(r=>r.correct);
await writeFile(path.join(dir,'measured-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({decision:result.decision,cases:result.records.length,cpuTraces:traces.length,trueColdSamples:result.trueColdSamples,maxCPU:result.maxCPU,groups:result.groups,budget:result.budget}));
