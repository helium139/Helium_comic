import test from 'node:test';
import assert from 'node:assert/strict';
import {signedBridgeHeaders,verifyBridge,forwardView} from '../functions/lib/views/migration-bridge.mjs';
test('old-session bridge authenticates original IP/identity/body and fails closed without fallback',async()=>{
 const secret='synthetic-secret',name='recordChapterView',body=JSON.stringify({data:{sessionId:'fixture'}}),at=100000;
 const signed=signedBridgeHeaders(secret,name,body,{uid:'u',network:'192.0.2.1',at}),headers=new Headers(signed);
 assert.deepEqual(verifyBridge(secret,name,body,headers,at),{uid:'u',network:'192.0.2.1',at});assert.equal(verifyBridge(secret,name,body,new Headers(),at),null);
 for(const args of [[secret,name,body+' ',headers,at],[secret,name,body,headers,at+30001],['wrong',name,body,headers,at],[secret,'startChapterViewSession',body,headers,at]])assert.throws(()=>verifyBridge(...args),/Invalid/);
 let calls=0;const fetchImpl=async(url,options)=>{calls++;const context=verifyBridge(secret,name,options.body,new Headers(options.headers));assert.equal(context.network,'192.0.2.1');assert.equal(options.headers.Authorization,'Bearer fake');return Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429});};
 await assert.rejects(forwardView({url:'https://fixture.invalid',name,secret,data:{sessionId:'fixture'},uid:'u',network:'192.0.2.1',authorization:'Bearer fake',fetchImpl}),e=>e.code==='resource-exhausted');assert.equal(calls,1);
});
