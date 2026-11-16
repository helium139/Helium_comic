import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {identity} from '../functions/lib/views/policy.mjs';
import {installSchema} from '../worker/view-runtime/schema.mjs';
import {createD1Views} from '../worker/view-runtime/service.mjs';
const {Miniflare,convertV4MiniflareOptions}=createRequire(new URL('../worker/package.json',import.meta.url))('miniflare');
test('three full out-of-order histories stay bounded and exact after RETURNING path',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local")}}',compatibilityDate:'2026-10-26',d1Databases:{DB:'bounded-rate'}}));t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await installSchema(db);
 const now=100000000,secret='synthetic'.repeat(8),reader=randomUUID(),context={uid:'fixture',network:'192.0.2.1'},r=identity(context,reader,secret),keys=[r.deviceHash,r.accountHash,r.networkHash];
 await db.prepare('INSERT INTO config VALUES(1,1,?,?,?,?,?,?)').bind(1,'valid-views-v1',120,2400,360,7200).run();
 const history=Array.from({length:9999},(_,i)=>now-3600000-9999+i).concat(now+1);
 for(const key of keys)await db.prepare('INSERT INTO rates VALUES(?,?,?)').bind('starts:'+key,JSON.stringify(history),now+7200000).run();
 const measurements=[];const views=createD1Views({db,secret,clock:()=>now,onMetrics:m=>measurements.push(m),catalogue:async()=>({revision:'fixture',teams:[{id:'a',active:true}],data:{m:{teamId:'a',chapters:[{id:'1',pages:1,folder:'https://example.invalid'}]}}})});
 await views.start({anonymousReaderId:reader,requestId:randomUUID(),mangaId:'m',chapterId:'1'},context);
 const expected=[...history,now].sort((a,b)=>a-b).slice(-10000);
 for(const key of keys){const stored=await db.prepare('SELECT times FROM rates WHERE id=?').bind('starts:'+key).first();assert.deepEqual(JSON.parse(stored.times),expected);}
 const rowsRead=measurements.reduce((n,m)=>n+m.rowsRead,0);assert.ok(rowsRead<=128);t.diagnostic(JSON.stringify({histories:3,lengthEach:10000,rowsRead,queries:measurements.reduce((n,m)=>n+m.queries,0),exact:true,cloudCPU:'unmeasured'}));
});
