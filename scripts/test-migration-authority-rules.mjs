import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {currentActor} from '../functions/lib/views/authority-mirror.mjs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
test('retained Admin SDK endpoints downgrade stale staff without blocking own-user operations',async()=>{
 const request={auth:{uid:'staff',token:{role:'team_leader',teamId:'a',accessVersion:2}}};
 let row={state:'active',role:'team_leader',teamId:'a',version:2,leaseUntilMs:1001},reads=0;
 const db={doc:()=>({get:async()=>{reads++;return {data:()=>row};}})};
 assert.equal((await currentActor(db,request,{strict:true,clock:()=>1000})).role,'team_leader');
 for(const patch of [{state:'pending'},{version:3},{teamId:'b'},{leaseUntilMs:1000}]){const saved=row;row={...row,...patch};assert.equal((await currentActor(db,request,{strict:true,clock:()=>1000})).role,'user');row=saved;}
 const before=reads;assert.equal((await currentActor(db,{auth:{uid:'u',token:{role:'user'}}},{strict:true})).uid,'u');assert.equal(reads,before);
});
test('strict Firestore mirror rules revoke stale cross-team staff but retain user data', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
 const {doc,setDoc,getDoc,updateDoc,setLogLevel}=require('firebase/firestore');setLogLevel('silent');
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 const env=await initializeTestEnvironment({projectId:'demo-migration-authority',firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 const write=async(path,row)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),row));
 try{
  await write('roleSystem/config',{enforceCurrentAuthority:true});
  await write('authzMirrors/l',{role:'team_leader',teamId:'a',version:2,state:'active',leaseUntilMs:Date.now()+300000});
  await write('users/l',{role:'team_leader',teamId:'a'});await write('users/reader',{role:'user',name:'Reader'});
  await write('mangaOwnership/a',{teamId:'a'});await write('mangaOwnership/b',{teamId:'b'});
  const leader=env.authenticatedContext('l',{role:'team_leader',teamId:'a',accessVersion:2}).firestore();
  await assertSucceeds(getDoc(doc(leader,'mangaOwnership/a')));await assertFails(getDoc(doc(leader,'mangaOwnership/b')));
  await assertFails(getDoc(doc(env.authenticatedContext('l',{role:'team_leader',teamId:'a',accessVersion:1}).firestore(),'mangaOwnership/a')));
  for(const patch of [{state:'pending'},{state:'active',leaseUntilMs:1},{state:'active',version:3,leaseUntilMs:Date.now()+300000}]){
   await write('authzMirrors/l',{role:'team_leader',teamId:'a',version:2,state:'active',leaseUntilMs:Date.now()+300000,...patch});
   await assertFails(getDoc(doc(leader,'mangaOwnership/a')));await assertSucceeds(getDoc(doc(leader,'users/l')));
  }
  const reader=env.authenticatedContext('reader',{role:'user'}).firestore();
  await assertSucceeds(updateDoc(doc(reader,'users/reader'),{name:'Updated'}));await assertFails(updateDoc(doc(reader,'users/reader'),{accessVersion:3}));
  await assertFails(setDoc(doc(reader,'roleSystem/config'),{enforceCurrentAuthority:false}));await assertFails(setDoc(doc(reader,'authzMirrors/reader'),{role:'admin'}));
 }finally{await env.cleanup();}
});
