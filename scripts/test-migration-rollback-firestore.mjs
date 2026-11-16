import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {rollbackToGoogle} from '../worker/view-runtime/rollback.mjs';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
test('rollback restores one revenue event/8 aggregates once and preserves session outcome/rates/dedup',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,Timestamp}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-migration-rollback'},randomUUID()),db=getFirestore(app),epoch='synthetic-writer',evidenceHash='f'.repeat(64),at=Date.parse('2026-12-01T00:00:00Z');
 const row={id:'a'.repeat(64),team:'a',manga:'m',chapter:'1',uid:null,device:'b'.repeat(64),at,month:'2026-12',activation:1,version:'valid-views-v1',revision:'fixture',session_revision:'fixture',valid:1,epoch};
 const rollback=rollbackToGoogle({db,timestamp:Timestamp.fromMillis,epoch,evidenceHash});
 try{
  await db.doc('viewSystem/config').set({enabled:false});await assert.rejects(rollback.event(row),/quiesced/);
  await db.doc('migrationControl/view').set({state:'paused',epoch,evidenceHash});
  assert.equal((await rollback.event(row)).replayed,false);assert.equal((await rollback.event(row)).replayed,true);
  await assert.rejects(rollback.event({...row,team:'b'}),/collision/);
  assert.equal((await db.doc('analyticsScopes/site/periods/2026-12').get()).data().validViews,1);assert.equal((await db.doc('analyticsScopes/team:a/periods/all').get()).data().validViews,1);
  await rollback.operational('dedup',[{id:'b'.repeat(64),eligible:at+86400000,delete_after:at+172800000}]);
  await rollback.operational('rates',[{id:'accepted:'+'b'.repeat(64),times:JSON.stringify([at]),delete_after:at+7200000}]);
  await rollback.operational('sessions',[{...row,id:row.id,consumed:1,accepted:1,started:at-10000,expires:at+10000,delete_after:at+172800000,revision:'fixture',device:row.device}]);
  assert.deepEqual((await db.doc('chapterViewSessions/'+row.id).get()).data().outcome,{accepted:true,eventId:row.id});
  await db.doc('viewSystem/config').update({enabled:true});await assert.rejects(rollback.operational('dedup',[]),/quiesced/);
 }finally{await db.terminate();await deleteApp(app);}
});
