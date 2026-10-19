import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createReportService} from '../functions/lib/reports/service.mjs';
import {getMonthlyDashboard} from '../functions/lib/reports/dashboard.mjs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
test('real monthly snapshot transaction and concurrent close preserve Phase 3 data and create one export', {skip:!enabled},async()=>{
    const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore,Timestamp}=require('firebase-admin/firestore');
    const app=initializeApp({projectId:`demo-reports-${randomUUID().slice(0,8)}`},randomUUID()),db=getFirestore(app);
    const month='2026-10';let created=0;
    const files=[],exporter={async find(){return files;},async verify(id){return{id};},async create(){created++;const item={id:'owner_sheet_123'};files.push(item);return item;},async populate(){}};
    try{
        await db.doc('viewSystem/config').set({enabled:true,activationAt:Timestamp.fromMillis(1)});
        for(const row of [{scopeId:'site',kind:'site',parentScopeId:null,validViews:5},
            {scopeId:'team:a',kind:'team',parentScopeId:'site',teamId:'a',validViews:5},
            {scopeId:'manga:a:m',kind:'manga',parentScopeId:'team:a',teamId:'a',mangaId:'m',validViews:5}])await db.doc(`analyticsScopes/${row.scopeId}/periods/${month}`).set({...row,period:month});
        const service=createReportService({db,exporter,catalogue:async()=>({revision:'test',teams:[{id:'a',name:'A',active:true},{id:'z',name:'Zero',active:true}],data:{m:{title:'Manga'}}}),
            folderId:'private_owner_folder',timestamp:ms=>Timestamp.fromMillis(ms),clock:()=>Date.parse('2026-11-01T00:10:00Z')});
        const results=await Promise.allSettled([service.run(month),service.run(month)]);assert.equal(results.filter(result=>result.status==='fulfilled' && result.value.alreadyGenerated===false).length,1);
        assert.ok(results.some(result=>result.status==='fulfilled'));
        assert.equal(created,1);await service.run(month);assert.equal(created,1);
        const report=(await db.doc(`monthlyReports/${month}`).get()).data();assert.equal(report.status,'generated');assert.equal(report.totalValidViews,5);assert.equal(report.teams.find(team=>team.teamId==='z').validViews,0);
        assert.equal((await db.doc(`analyticsScopes/site/periods/${month}`).get()).data().validViews,5);
        const dashboard=await getMonthlyDashboard({scopeId:'team:a'},{uid:'l',role:'team_leader',teamId:'a'},{db,clock:()=>Date.parse('2026-11-01T00:00:00Z')});assert.equal(dashboard.monthly,0);assert.equal(dashboard.previousMonthly,5);
        await assert.rejects(getMonthlyDashboard({scopeId:'site'},{uid:'l',role:'team_leader',teamId:'a'},{db}),error=>error.code==='permission-denied');
    }finally{await db.terminate();await deleteApp(app);}
});
test('browser roles cannot read/write full-site reports, chunks or audit; admin must use callable', {skip:!enabled},async()=>{
    const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');const {doc,getDoc,setDoc,updateDoc,deleteDoc,setLogLevel}=require('firebase/firestore');setLogLevel('silent');
    const[host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');const environment=await initializeTestEnvironment({projectId:`demo-rules-${randomUUID().slice(0,8)}`,firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
    try{
        await environment.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'monthlyReports/2026-10'),{totalValidViews:100});});
        for(const context of [environment.unauthenticatedContext(),environment.authenticatedContext('u',{role:'user'}),environment.authenticatedContext('l',{role:'team_leader',teamId:'a'}),environment.authenticatedContext('a',{role:'admin'})]){
            const db=context.firestore();for(const path of ['monthlyReports/2026-10','monthlyReports/2026-10/snapshotChunks/00000','monthlyReports/2026-10/attempts/a']){
                await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),{totalValidViews:999}));await assertFails(updateDoc(doc(db,path),{status:'generated'}));await assertFails(deleteDoc(doc(db,path)));}
        }
    }finally{await environment.cleanup();}
});
