import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {installSchema} from '../worker/view-runtime/schema.mjs';
import {createD1Views} from '../worker/view-runtime/service.mjs';
const {Miniflare,convertV4MiniflareOptions}=createRequire(new URL('../worker/package.json',import.meta.url))('miniflare');
test('current schema D1 operation metadata includes trigger/index writes exactly once',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local")}}',compatibilityDate:'2026-10-26',d1Databases:{DB:'quota-only'}}));t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await installSchema(db);
 let now=Date.parse('2026-11-16T12:00:00Z'),metrics=[];await db.prepare('INSERT INTO config VALUES(1,1,?,?,?,?,?,?)').bind(1,'valid-views-v1',120,2400,360,7200).run();
 const service=createD1Views({db,secret:'synthetic'.repeat(8),catalogue:async()=>({revision:'fixture',teams:[{id:'a',name:'A',active:true}],data:{m:{teamId:'a',title:'M',chapters:[{id:'1',pages:1,folder:'https://example.invalid/'}]}}}),clock:()=>now,onMetrics:m=>metrics.push(m)});
 const measured=[];const sum=()=>({read:metrics.reduce((n,x)=>n+x.rowsRead,0),write:metrics.reduce((n,x)=>n+x.rowsWritten,0)});
 for(const [kind,context,sw,rw] of [['guest',{network:'192.0.2.1'},3,6],['authenticated',{network:'192.0.2.2',uid:'synthetic'},4,8]]){
  const anonymousReaderId=randomUUID(),payload={anonymousReaderId,requestId:randomUUID(),mangaId:'m',chapterId:'1'};
  metrics=[];const s=await service.start(payload,context);let count=sum();assert.equal(count.write,sw);measured.push({outcome:kind+' Start',...count});
  metrics=[];await service.start(payload,context);count=sum();assert.equal(count.write,0);measured.push({outcome:kind+' Start replay',...count});
  now+=10000;metrics=[];assert.equal((await service.record({anonymousReaderId,sessionId:s.sessionId},context)).accepted,true);count=sum();assert.equal(count.write,rw);measured.push({outcome:kind+' accepted Record',...count});
  metrics=[];await service.record({anonymousReaderId,sessionId:s.sessionId},context);count=sum();assert.equal(count.write,0);measured.push({outcome:kind+' Record replay',...count});
  const second=await service.start({...payload,requestId:randomUUID()},context);now+=10000;metrics=[];assert.equal((await service.record({anonymousReaderId,sessionId:second.sessionId},context)).reason,'duplicate');count=sum();assert.equal(count.write,1);measured.push({outcome:kind+' duplicate Record',...count});
 }
 t.diagnostic(JSON.stringify({source:'Miniflare local D1 meta, not cloud CPU',measured}));
 // Lifecycle sensitivity retained from completed sizing: includes transient
 // delete costs; 5000 is unverified shared/report reserve, not measured usage.
 const sizes=[1,2].map(multiplier=>({multiplier,guest:(6*6916+9*3287)*multiplier+5001,authenticated:(8*6916+13*3287)*multiplier+5001}));
 assert.deepEqual(sizes,[{multiplier:1,guest:76080,authenticated:103060},{multiplier:2,guest:147159,authenticated:201119}]);
 t.diagnostic(JSON.stringify({assumption:'all Record accepted; outcome/auth mix unknown',sizes,freeDailyWrites:100000,headroomThreshold:75000,decision:'NO-GO full cutover; neither headroom nor 2x proven'}));
});
