import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {verifyAppCheck} from '../worker/view-runtime/app-check.mjs';
import {googleAccessTokenSupplier} from '../worker/view-runtime/google-access-token.mjs';
import {createGoogleIdentityBridge} from '../worker/view-runtime/google-identity-bridge.mjs';
const jose=await import(pathToFileURL(createRequire(new URL('../worker/package.json',import.meta.url)).resolve('jose')).href);
test('real signed synthetic App Check token rejects wrong project/app, expiry and signature',async()=>{
 const {privateKey,publicKey}=await jose.generateKeyPair('RS256',{extractable:true});
 const jwk={...await jose.exportJWK(publicKey),kid:'fixture',alg:'RS256'},keySet=jose.createLocalJWKSet({keys:[jwk]});
 const now=Math.floor(Date.now()/1000),options={projectNumber:'1234',appId:'fixture-app',keySet};
 const token=async patch=>new jose.SignJWT({sub:'fixture-app',iss:'https://firebaseappcheck.googleapis.com/1234',aud:'projects/1234',iat:now,exp:now+60,...patch}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(privateKey);
 assert.equal(await verifyAppCheck(await token({}),options),true);
 for(const patch of [{sub:'foreign-app'},{aud:'projects/999'},{iss:'foreign'},{exp:now-1}])await assert.rejects(verifyAppCheck(await token(patch),options));
});
test('backend OAuth cache coalesces requests, fixes audience/scopes and never exposes credentials',async()=>{
 const {privateKey,publicKey}=await jose.generateKeyPair('RS256',{extractable:true});let calls=0;
 const serviceAccountJSON=JSON.stringify({type:'service_account',client_email:'fixture@synthetic.iam.gserviceaccount.com',private_key:await jose.exportPKCS8(privateKey)});
 const supply=googleAccessTokenSupplier({serviceAccountJSON,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');const {payload}=await jose.jwtVerify(options.body.get('assertion'),publicKey,{audience:'https://oauth2.googleapis.com/token'});assert.match(payload.scope,/identitytoolkit/);assert.match(payload.scope,/datastore/);return Response.json({access_token:'synthetic-access-token',expires_in:3600});}});
 assert.deepEqual(await Promise.all([supply(),supply(),supply()]),Array(3).fill('synthetic-access-token'));assert.equal(calls,1);await supply();assert.equal(calls,1);
 await assert.rejects(googleAccessTokenSupplier({serviceAccountJSON:'{}'})(),/credential unavailable/);
});
test('Firestore mirror compare-and-set forbids stale renewal and pending privilege resurrection',async()=>{
 let row={fields:{version:{integerValue:'3'},role:{stringValue:'admin'},teamId:{nullValue:null},state:{stringValue:'pending'}},updateTime:'fixture-version'},patches=0;
 const bridge=createGoogleIdentityBridge({getAccessToken:async()=>'fixture',fetchImpl:async(url,options)=>{
  if(options.method==='GET')return Response.json(row);
  patches++;assert.equal(new URL(url).searchParams.get('currentDocument.updateTime'),'fixture-version');return Response.json({});
 }});
 await assert.rejects(bridge.patchMirror('u',{version:2,role:'admin',state:'active'},{mode:'renew'}),/Stale/);
 await assert.rejects(bridge.patchMirror('u',{version:3,role:'admin',state:'active'},{mode:'renew'}),/Stale/);assert.equal(patches,0);
 await bridge.patchMirror('u',{version:3,role:'admin',state:'active',leaseUntil:999},{mode:'commit'});assert.equal(patches,1);
});
