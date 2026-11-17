import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createAccessService} from '../functions/lib/access/service.mjs';
import {currentActor} from '../functions/lib/access/policy.mjs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,collection,getDocs,setLogLevel}=require('firebase/firestore');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/,'Local emulator required');
setLogLevel('silent');
test('real Firestore fence, sync recovery, stale tokens, slot contention and protected Rules',async()=>{
    const projectId='demo-staff-'+randomUUID().slice(0,8),[host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const env=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
    const app=initializeApp({projectId},projectId),db=getFirestore(app);let now=Date.now(),loseAck=true;
    const claims=new Map([['la',{role:'team_leader',teamId:'a',accessVersion:1}],['lb',{role:'user',accessVersion:1}]]);
    const auth={getUser:async uid=>({customClaims:claims.get(uid)}),setCustomUserClaims:async(uid,value)=>{
        claims.set(uid,value);if(loseAck)throw Error('simulated lost ACK');
    }};
    const admin={uid:'admin',token:{role:'admin',accessVersion:1}};
    const change=createAccessService({db,auth,clock:()=>now,timestamp:Timestamp.fromMillis,
        catalogue:async()=>({teams:[{id:'a',active:true},{id:'b',active:true}]})});
    try {
        for(const [path,data]of Object.entries({
            'staffAccess/admin':{state:'active',role:'admin',teamId:null,version:1},
            'staffAccess/la':{state:'active',role:'team_leader',teamId:'a',version:1},
            'staffAccess/lb':{state:'active',role:'user',teamId:null,version:1},
            'teamLeaderSlots/a':{uid:'la',version:1},
            'mangaOwnership/ma':{teamId:'a'},'mangaOwnership/mb':{teamId:'b'},
            'users/la':{role:'team_leader',teamId:'a',accessVersion:1},'users/reader':{role:'user'}
        }))await db.doc(path).set(data);
        const old=env.authenticatedContext('la',{role:'team_leader',teamId:'a',accessVersion:1}).firestore();
        const legacy=env.authenticatedContext('admin',{role:'admin'}).firestore();
        await assertSucceeds(getDoc(doc(old,'mangaOwnership/ma')));
        await assertFails(getDoc(doc(old,'mangaOwnership/mb')));
        await assertFails(getDoc(doc(legacy,'users/la')));
        const input={uid:'la',role:'team_leader',teamId:'b',expectedVersion:1,requestId:randomUUID()};
        const pending=await change(input,admin);assert.equal(pending.ok,false);assert.equal(pending.status,'pending');
        assert.equal((await getDoc(doc(old,'staffAccess/la'))).data().state,'pending');
        await assertFails(getDoc(doc(old,'mangaOwnership/ma')));
        await assert.rejects(currentActor(db,{uid:'la',token:{role:'team_leader',teamId:'a',accessVersion:1}}),e=>e.code==='permission-denied');
        loseAck=false;now+=120001;assert.equal((await change(input,admin)).ok,true);
        await assertFails(getDoc(doc(old,'mangaOwnership/ma')));
        const fresh=env.authenticatedContext('la',claims.get('la')).firestore();
        await assertSucceeds(getDoc(doc(fresh,'mangaOwnership/mb')));
        await assertFails(getDoc(doc(fresh,'mangaOwnership/ma')));
        for(const client of [old,fresh,env.authenticatedContext('admin',admin.token).firestore(),env.authenticatedContext('reader',{role:'user'}).firestore()]) {
            for(const path of ['staffAccess/la','staffAccessChanges/op','staffAccessAudit/op','teamLeaderSlots/b'])
                await assertFails(setDoc(doc(client,path),{state:'active',role:'admin',version:999}));
            await assertFails(getDoc(doc(client,'monthlyReports/2026-10')));
        }
        await assertFails(getDocs(collection(fresh,'staffAccess')));
        await assertFails(getDoc(doc(fresh,'staffAccess/admin')));
        await assertFails(updateDoc(doc(fresh,'users/la'),{accessVersion:999}));
        await assertSucceeds(updateDoc(doc(fresh,'users/la'),{name:'Synthetic display name'}));
        await change({uid:'la',role:'user',expectedVersion:2,requestId:randomUUID()},admin);
        await assertFails(getDoc(doc(fresh,'mangaOwnership/mb')));
        await assert.rejects(currentActor(db,{uid:'la',token:claims.get('la')}),e=>e.code==='permission-denied');
        // Two attempts for the same free slot: only one transaction can reserve it.
        const results=await Promise.allSettled(['la','lb'].map(uid=>change({uid,role:'team_leader',teamId:'a',
            expectedVersion:uid==='la'?3:1,requestId:randomUUID()},admin)));
        assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.ok).length,1);
        assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='failed-precondition').length,1);
    } finally {await db.terminate();await deleteApp(app);await env.cleanup();}
});
