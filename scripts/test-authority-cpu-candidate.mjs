import test from 'node:test';
import assert from 'node:assert/strict';
import {teamRegistry} from '../worker/view-runtime/team-registry.mjs';
test('bounded registry revalidates every access; changed ETag and errors revoke cached team',async()=>{
 let now=0,calls=0,active=true,fail=false;const requests=[];
 const catalogue=teamRegistry({clock:()=>now,fetchImpl:async(_url,{headers})=>{calls++;requests.push(headers);if(fail)throw Error('offline');const tag=active?'"v1"':'"v2"';return headers['If-None-Match']===tag?new Response(null,{status:304}):Response.json([{id:'a',active}],{headers:{ETag:tag}});}});
 assert.equal((await catalogue.getTeam('a')).active,true);
 assert.equal((await catalogue.getTeam('a')).active,true);assert.equal(calls,2);assert.equal(requests[1]['If-None-Match'],'"v1"');
 active=false;assert.equal((await catalogue.getTeam('a')).active,false);
 now=30001;await catalogue.getTeam('a');assert.equal(requests.at(-1)['If-None-Match'],undefined);
 fail=true;await assert.rejects(catalogue.getTeam('a'),/unavailable/);fail=false;await catalogue.getTeam('a');assert.equal(requests.at(-1)['If-None-Match'],undefined);
 catalogue.invalidate();await catalogue.getTeam('a');assert.equal(requests.at(-1)['If-None-Match'],undefined);
});
test('registry coalesces concurrent fetch but invalidation fences the in-flight result',async()=>{
 let release,calls=0;const catalogue=teamRegistry({fetchImpl:async()=>{calls++;await new Promise(r=>release=r);return Response.json([{id:'a',active:true}],{headers:{ETag:'"v1"'}});}});
 const a=catalogue.getTeam('a'),b=catalogue.getTeam('a');assert.equal(calls,1);catalogue.invalidate();release();
 await Promise.all([assert.rejects(a,/invalidated/),assert.rejects(b,/invalidated/)]);
});
test('304 never extends validator age; no stale or unsolicited 304 acceptance',async()=>{
 let now=0,calls=0;const catalogue=teamRegistry({clock:()=>now,fetchImpl:async()=>++calls===1?Response.json([{id:'a',active:true}],{headers:{ETag:'"v1"'}}):new Response(null,{status:304})});
 await catalogue.getTeam('a');now=29000;await catalogue.getTeam('a');now=30000;await assert.rejects(catalogue.getTeam('a'),/stale/);
});
