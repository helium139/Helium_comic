import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createCommentService } from '../functions/lib/comments/service.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;

test('comment service authorization, transactions, legacy reads and pagination', {skip: !enabled}, async t => {
    const {initializeApp, deleteApp} = require('firebase-admin/app');
    const {getFirestore, Timestamp, FieldValue} = require('firebase-admin/firestore');
    const app = initializeApp({projectId: `demo-comments-${randomUUID().slice(0,8)}`}, randomUUID());
    const db = getFirestore(app);
    const catalogue = {data: {m: {teamId: 'heliumtg'}, other: {teamId: 'other'}}, teams: [{id: 'heliumtg'}, {id: 'other'}]};
    let now = Date.parse('2026-10-19T12:00:00Z');
    const service = createCommentService({db, catalogue: async () => catalogue, serverTimestamp: () => Timestamp.fromMillis(now), timestampFromParts: parts => new Timestamp(parts.seconds, parts.nanoseconds), fieldDelete: () => FieldValue.delete()});
    const user = {uid: 'u', role: 'user'}, other = {uid: 'v', role: 'user'}, admin = {uid: 'a', role: 'admin'}, leader = {uid: 'l', role: 'team_leader', teamId: 'heliumtg'};
    const post = (actor = user, data = {}) => service.create({mangaId: 'm', text: 'A comment', requestId: randomUUID(), ...data}, actor);
    const get = async key => (await db.doc(`comments/m/messages/${key}`).get()).data();
    try {
        let root, reply;
        await t.test('guest rejected; authenticated root ignores forged identity/system fields', async () => {
            await assert.rejects(post({}), e => e.code === 'unauthenticated');
            root = (await post(user, {uid: 'forged', role: 'admin', teamId: 'other', rootId: 'fake', replyCount: 999, moderationStatus: 'hidden'})).id;
            const doc = await get(root); assert.equal(doc.uid, 'u'); assert.equal(doc.parentId, null); assert.equal(doc.rootId, null);
            assert.equal(doc.replyCount, 0); assert.equal(doc.moderationStatus, 'visible'); assert.equal(doc.teamId, undefined);
        });
        await t.test('idempotent root creation; request ID collision never impersonates another user', async () => {
            const data = {requestId: randomUUID()}; const first = await post(user, data);
            assert.equal((await post(user, data)).id, first.id);
            await assert.rejects(post(other, data), e => e.code === 'permission-denied');
        });
        await t.test('invalid IDs, missing/self/cyclic parents rejected', async () => {
            await assert.rejects(post(user, {mangaId: '../m'}), e => e.code === 'invalid-argument');
            await assert.rejects(post(user, {parentId: '../other'}), e => e.code === 'invalid-argument');
            await assert.rejects(post(user, {parentId: 'missing'}), e => e.code === 'not-found');
            const key = randomUUID(); await assert.rejects(post(user, {requestId: key, parentId: key}), e => e.code === 'invalid-argument');
            await db.doc('comments/m/messages/cycle').set({uid:'u', parentId:'cycle', rootId:'cycle'});
            await assert.rejects(post(user, {parentId: 'cycle'}), e => e.code === 'failed-precondition');
            await db.doc('comments/m/messages/badchain').set({uid:'u', parentId:'badchain', rootId:root});
            await assert.rejects(post(user, {parentId:'badchain'}), e=>e.code==='failed-precondition');
            await db.doc('comments/m/messages/broken').set({uid:'u', parentId:'missing', rootId:root});
            await assert.rejects(post(user, {parentId:'broken'}), e=>e.code==='failed-precondition');
        });
        await t.test('concurrent replies increment once each; nested parent/root validated', async () => {
            const replies = await Promise.all([0,1,2].map(() => post(user, {parentId: root})));
            reply = replies[0].id;
            assert.equal((await get(root)).replyCount, 3);
            const child = (await post(user, {parentId: reply})).id;
            assert.equal((await get(child)).rootId, root); assert.equal((await get(child)).parentId, reply);
            assert.equal((await get(root)).replyCount, 4);
        });
        await t.test('only own text edits; immutable fields ignored, updatedAt server controlled', async () => {
            await assert.rejects(service.edit({mangaId:'m', commentId:root, text:'Hacked'}, other), e => e.code === 'permission-denied');
            const before = await get(root); now += 1000;
            await service.edit({mangaId:'m', commentId:root, text:'  Edited  ', uid:'v', parentId:reply, rootId:reply, createdAt:0,
                replyCount:999, moderationStatus:'hidden', deletedAt:1, teamId:'other', updatedAt:0}, user);
            const after = await get(root); assert.equal(after.text, 'Edited'); assert.equal(after.updatedAt.toMillis(), now);
            for (const field of ['uid','parentId','rootId','createdAt','replyCount','moderationStatus','deletedAt']) assert.deepEqual(after[field], before[field]);
        });
        await t.test('own soft delete removes text; descendants/count retained; guest/other cannot delete', async () => {
            await assert.rejects(service.remove({mangaId:'m', commentId:reply}, {}), e => e.code === 'unauthenticated');
            await assert.rejects(service.remove({mangaId:'m', commentId:reply}, other), e => e.code === 'permission-denied');
            await service.remove({mangaId:'m', commentId:reply}, user);
            const doc = await get(reply); assert.equal(doc.deleted, true); assert.equal(doc.text, ''); assert.equal(doc.content, undefined);
            assert.equal((await get(root)).replyCount, 4);
            await assert.rejects(post(user, {parentId:reply}), e => e.code === 'failed-precondition');
        });
        await t.test('admin moderation, own-team leader, forged team denial, immutable audit', async () => {
            const foreign = (await post(user, {mangaId:'other'})).id;
            await assert.rejects(service.moderate({mangaId:'other', commentId:foreign, teamId:'heliumtg', action:'hide'}, leader), e => e.code === 'permission-denied');
            await assert.rejects(service.moderate({mangaId:'m', commentId:root, action:'hide'}, user), e => e.code === 'permission-denied');
            await service.moderate({mangaId:'other', commentId:foreign, action:'hide'}, admin);
            await service.moderate({mangaId:'m', commentId:root, action:'hide'}, leader);
            let page = await service.list({mangaId:'m'}, {});
            assert.equal(page.comments.find(c => c.id === root).text, null); assert.equal(page.canModerate, false);
            assert.equal((await service.list({mangaId:'m'}, leader)).canModerate, true);
            assert.equal((await service.list({mangaId:'other'}, leader)).canModerate, false);
            await service.moderate({mangaId:'m', commentId:root, action:'restore'}, leader);
            assert.equal((await get(root)).moderationStatus, 'visible');
            const events = await db.collection('commentModerationEvents').get(); assert.equal(events.size, 3);
            assert.ok(events.docs.some(doc => doc.data().moderatorUid === 'l' && doc.data().teamId === 'heliumtg'));
            await service.moderate({mangaId:'other', commentId:foreign, action:'delete'}, admin);
            await assert.rejects(service.moderate({mangaId:'other', commentId:foreign, action:'restore'}, admin), e => e.code === 'failed-precondition');
        });
        await t.test('legacy roots/text remain readable, editable and replyable without normalization', async () => {
            now += 1000;
            await db.doc('comments/m/messages/legacy').set({uid:'u', content:'Old text', name:'Old reader', createdAt:new Timestamp(Math.floor(now / 1000), 123456000)});
            const page = await service.list({mangaId:'m'}, {}); const legacy = page.comments.find(c => c.id === 'legacy');
            assert.equal(legacy.text, 'Old text'); assert.equal(legacy.parentId, null); assert.equal(legacy.deleted, false);
            await post(user, {parentId:'legacy'}); assert.equal((await get('legacy')).replyCount, 1);
            await service.edit({mangaId:'m', commentId:'legacy', text:'New text'}, user);
            assert.equal((await get('legacy')).content, undefined);
        });
        await t.test('indexed roots 20/page deterministic ties; replies oldest first and paginated', async () => {
            await db.doc('commentSystem/other').set({rootsReady:true});
            const ids = [];
            for (let i=0;i<22;i++) ids.push((await post(user, {mangaId:'other'})).id);
            const all=[]; let cursor=null;
            do { const page=await service.list({mangaId:'other', cursor}, {}); assert.ok(page.comments.length<=20);
                all.push(...page.comments); cursor=page.nextCursor; } while(cursor);
            const nanoTime = new Timestamp(Math.floor(now / 1000) + 1, 123456000);
            for (let i=0;i<21;i++) await db.doc(`comments/other/messages/nano-${String(i).padStart(2,'0')}`).set({uid:'u',content:'Old timestamp',createdAt:nanoTime,parentId:null,rootId:null});
            const nanoPage = await service.list({mangaId:'other'}, {});
            assert.equal(nanoPage.nextCursor.createdAt.nanoseconds, 123456000);
            const nanoNext = await service.list({mangaId:'other',cursor:nanoPage.nextCursor}, {});
            assert.equal(nanoNext.comments.filter(c=>c.id.startsWith('nano-')).length, 1);
            const expected=[...ids].sort().reverse();
            assert.deepEqual(all.filter(c=>ids.includes(c.id)).map(c=>c.id), expected);
            for(let i=0;i<22;i++) { now+=1000; await post(user, {parentId:root}); }
            const replies=[]; cursor=null;
            do { const page=await service.list({mangaId:'m', rootId:root, cursor}, {}); replies.push(...page.comments); cursor=page.nextCursor; } while(cursor);
            assert.equal(replies.length, 26); assert.equal(new Set(replies.map(c=>c.id)).size, 26);
            assert.deepEqual(replies.map(c=>c.createdAt), replies.map(c=>c.createdAt).sort((a,b)=>a-b));
            await assert.rejects(service.list({mangaId:'m', cursor:{id:'../x', createdAt:1}}, {}), e=>e.code==='invalid-argument');
        });
        await t.test('production server timestamp transform ignores browser timestamps', async () => {
            const production = createCommentService({db, catalogue: async () => catalogue,
                serverTimestamp: () => FieldValue.serverTimestamp(),
                timestampFromParts: parts => new Timestamp(parts.seconds, parts.nanoseconds), fieldDelete: () => FieldValue.delete()});
            const before = Date.now();
            const created = await production.create({mangaId:'m', text:'Server time', requestId:randomUUID(), createdAt:0, updatedAt:0}, user);
            const doc = await get(created.id);
            assert.ok(doc.createdAt.toMillis() >= before - 2000);
            assert.deepEqual(doc.createdAt, doc.updatedAt);
            await production.edit({mangaId:'m', commentId:created.id, text:'Updated', updatedAt:0}, user);
            assert.ok((await get(created.id)).updatedAt.toMillis() >= doc.updatedAt.toMillis());
        });
    } finally { await db.terminate(); await deleteApp(app); }
});

test('comment rules deny direct mutation/hidden reads and audit tampering for every role', {skip: !enabled}, async () => {
    const {initializeTestEnvironment, assertFails} = require('@firebase/rules-unit-testing');
    const {doc,setDoc,getDoc,updateDoc,deleteDoc,setLogLevel} = require('firebase/firestore'); setLogLevel('silent');
    const [host,port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const env=await initializeTestEnvironment({projectId:`demo-crules-${randomUUID().slice(0,8)}`,firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
    try {
        await env.withSecurityRulesDisabled(async context=> { await setDoc(doc(context.firestore(),'comments/m/messages/c'),{uid:'u',text:'Hidden',moderationStatus:'hidden'}); });
        for (const context of [env.unauthenticatedContext(),env.authenticatedContext('u',{role:'user'}),env.authenticatedContext('a',{role:'admin'}),env.authenticatedContext('l',{role:'team_leader',teamId:'heliumtg'})]) {
            const db=context.firestore();
            await assertFails(getDoc(doc(db,'comments/m/messages/c')));
            await assertFails(setDoc(doc(db,'comments/m/messages/new'),{uid:'u',text:'forged'}));
            await assertFails(updateDoc(doc(db,'comments/m/messages/c'),{uid:'x',parentId:'fake',replyCount:999}));
            await assertFails(deleteDoc(doc(db,'comments/m/messages/c')));
            await assertFails(setDoc(doc(db,'commentModerationEvents/e'),{action:'restore'}));
            await assertFails(setDoc(doc(db,'commentSystem/m'),{rootsReady:true}));
        }
    } finally { await env.cleanup(); }
});
