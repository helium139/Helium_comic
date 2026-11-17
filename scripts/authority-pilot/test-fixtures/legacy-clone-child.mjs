// Frozen reproduction of the former async-IIFE + clone inspection ordering.
import fs from 'node:fs';
import {inspectResponse} from './legacy-response-diagnostics.mjs';
const [url,file]=process.argv.slice(2);let phase='starting',finished=false;
const event=data=>fs.appendFileSync(file,JSON.stringify({pid:process.pid,...data})+'\n');
process.once('beforeExit',code=>event({state:'before-exit',code,phase,finished}));
process.once('exit',code=>event({state:'exit',code,phase,finished}));
(async()=>{event({state:'issued',outcome:'unknown'});try{const r=await fetch(url,{signal:AbortSignal.timeout(200),redirect:'manual'});phase='inspect-clone';event({state:'headers',status:r.status,phase});await inspectResponse(r.clone(),{url,id:'local',metrics:false});phase='response-saved';event({state:'response-saved'});}finally{finished=true;event({state:'finally'});}})().catch(()=>{event({state:'error'});process.exitCode=1;});
