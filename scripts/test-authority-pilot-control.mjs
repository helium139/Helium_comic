import test from 'node:test';
import assert from 'node:assert/strict';
import {runMeasurementClient,pilotBudget,attachProviderCPU} from './authority-pilot/control.mjs';
import {authorityImportGraph} from './authority-pilot/import-graph.mjs';
import {teamRegistry} from '../worker/view-runtime/team-registry.mjs';
import {createAuthorityRuntime} from '../worker/view-runtime/authority-runtime.mjs';
test('pilot controller enforces reservation/journal/host limits and never substitutes wall time for CPU',async()=>{
 const journal=[],host='helium-authority-fixture-local.example.workers.dev';let calls=0;
 const config={baseURL:'https://'+host+'/',approvedHost:host,pilotSecret:'ephemeral-local-only',journal:async r=>journal.push(r),steps:[{id:'warm-resolve',name:'getCurrentAccess',cryptoCase:'warm',expectStatus:200,expectResult:{role:'user'}}],getSyntheticJWT:async()=>'not-a-real-token',fetchImpl:async()=>{calls++;assert.equal(journal.at(-1).state,'issued');return Response.json({result:{role:'user'}},{headers:{'X-Helium-Pilot-Metrics':JSON.stringify({caseId:'warm-resolve',rowsRead:4,rowsWritten:0,databaseBytes:65536,isolateFirst:true,isolateTag:'fixture'})}});}};
 const result=await runMeasurementClient(config);assert.equal(calls,1);assert.equal(result.records[0].cpuMs,null);assert.equal(result.budget.http,51);assert.equal(result.budget.read,68);
 assert.equal(attachProviderCPU(result.records,[]).decision,'inconclusive-missing-provider-traces');
 assert.equal(attachProviderCPU(result.records,[{id:'warm-resolve',cpuMs:11,outcome:'ok'}]).decision,'no-go-CPU');
 assert.equal(attachProviderCPU(result.records,[{id:'warm-resolve',cpuMs:2,outcome:'ok'}]).decision,'sample-pass-only-not-production-approval');
 assert.equal(attachProviderCPU(result.records,[{id:'warm-resolve',cpuMs:2,outcome:'exception'}]).decision,'no-go-provider-errors');
 assert.equal(attachProviderCPU(result.records,[{id:'warm-resolve',cpuMs:2,outcome:'ok'}]).groups[0].cpuP95,2);
 await assert.rejects(runMeasurementClient({...config,baseURL:'https://heliumtg.com/'}),/fixture host/);
 const budget=pilotBudget({http:250,read:0,write:0});await assert.rejects(runMeasurementClient({...config,budget}),/budget/);assert.equal(calls,1);
 await assert.rejects(runMeasurementClient({...config,fetchImpl:async()=>{throw Error('synthetic network failure');}}),/no retry/);assert.equal(journal.at(-1).state,'unknown-stop');
 const options=await runMeasurementClient({...config,steps:[{id:'options',name:'getCurrentAccess',method:'OPTIONS',cryptoCase:'warm',expectStatus:204}],fetchImpl:async(url,init)=>{assert.equal(init.method,'OPTIONS');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,undefined);return new Response(null,{status:204,headers:{'X-Helium-Pilot-Metrics':JSON.stringify({caseId:'options',rowsRead:0,rowsWritten:0,databaseBytes:65536,isolateTag:'fixture'})}});}});
 assert.equal(options.records[0].operation,'OPTIONS');
});
test('authority source graph excludes view SQL/rate histories',async()=>{
 const graph=await authorityImportGraph();assert.equal(graph.rateHistoryReachable,false);assert.ok(graph.files.some(f=>f.endsWith('team-registry.mjs')));assert.ok(!graph.files.some(f=>f.endsWith('schema.mjs')));
});
test('largest authority JSON paths:200teams/64KiB and callable boundary, not a view-history benchmark',async()=>{
 const teams=Array.from({length:200},(_,i)=>({id:'team-'+i,active:true})),largeRegistry=JSON.stringify(teams).padEnd(65536,' ');
 assert.equal((await teamRegistry({fetchImpl:async()=>new Response(largeRegistry)})()).teams.length,200);
 await assert.rejects(teamRegistry({fetchImpl:async()=>new Response(largeRegistry+' ')})(),/envelope/);
 const unicodeRegistry=JSON.stringify([{id:'a',active:true,name:'界'.repeat(30000)}]);assert.ok(unicodeRegistry.length<65536);
 await assert.rejects(teamRegistry({fetchImpl:async()=>new Response(unicodeRegistry)})(),/envelope/);
 let resolutions=0;const runtime=createAuthorityRuntime({verifyToken:async()=>({uid:'fixture'}),authority:{resolve:async()=>{resolutions++;return {uid:'fixture',role:'user'};}},clock:()=>1000000});
 const env={AUTHORITY_ENABLED:'true',DB:{prepare:()=>({first:async()=>({verified:1,evidence_hash:'f'.repeat(64),free_features:'["authority"]',free_expires:2000000})})}};
 const request=body=>new Request('https://fixture.invalid/getCurrentAccess',{method:'POST',headers:{Authorization:'Bearer synthetic-only'},body});
 assert.equal((await runtime.fetch(request('{"data":{}}'.padEnd(2048,' ')),env)).status,200);
 assert.equal((await runtime.fetch(request('{"data":{}}'.padEnd(2049,' ')),env)).status,400);
 assert.equal((await runtime.fetch(request(JSON.stringify({data:{rateHistory:Array(10000).fill(1000000)}})),env)).status,400);
 assert.equal(resolutions,1);
});
