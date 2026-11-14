import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createViewService as batch} from '../functions/lib/views/view-service.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const project = 'demo-helium-views';
const host = process.env.FIRESTORE_EMULATOR_HOST;
// Fail closed rather than silently skipping the integration gate or using ADC.
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Start the local Firestore emulator before running this suite');
assert.ok(!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === project, 'Only the fixed demo project is allowed');
const fixture = (await readFile(new URL('./fixtures/view-service-sequential.mjs.txt', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
assert.equal(createHash('sha256').update(fixture).digest('hex'), '1836ed34b8677d1dc35454ddcc9e3438983de2378a5f22fb9cc7c3442160c26b');
const baselineSource = fixture.replace('"./policy.mjs"', JSON.stringify(new URL('../functions/lib/views/policy.mjs', import.meta.url).href))
    .replace('"./catalogue.mjs"', JSON.stringify(new URL('../functions/lib/views/catalogue.mjs', import.meta.url).href));
const {createViewService: baseline} = await import('data:text/javascript;base64,' + Buffer.from(baselineSource).toString('base64'));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const baseTime = Date.parse('2026-11-01T12:00:00Z');
const secret = 'emulator-only-synthetic-secret-'.repeat(3);

function normalize(value) {
    if (value?.toMillis) return value.toMillis();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
    return value;
}

function accountingState(state, competingReceipts) {
    if (!competingReceipts) return state;
    // Concurrent duplicate sessions may choose different winners. Each variant
    // verifies the actual event -> receipt ID link before comparing semantics.
    return state.map(([path, data]) => {
        if (path.startsWith('chapterViewEvents/')) return ['chapterViewEvents/winner', {...data, sessionId: 'winner'}];
        if (path.startsWith('chapterViewSessions/')) return ['chapterViewSessions/contender', {...data,
            outcome: data.outcome?.accepted ? {...data.outcome, eventId: 'winner'} : data.outcome}];
        return [path, data];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function harness(factory, label) {
    const reset = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, {method: 'DELETE'});
    assert.equal(reset.status, 200);
    const app = initializeApp({projectId: project}, label);
    const db = getFirestore(app);
    let now = baseTime, catalogueCalls = 0, attempts = 0;
    let inject;
    const calls = [];
    const catalogue = {data: {m: {teamId: 'heliumtg', chapters: Array.from({length: 4}, (_, id) =>
        ({id, pages: 1, folder: `https://images.invalid/m/chap${id}`}))}}, teams: [{id: 'heliumtg'}], revision: 'synthetic-fixed'};
    const countedDb = {
        doc: path => db.doc(path),
        runTransaction: callback => db.runTransaction(async tx => {
            attempts++;
            let writing = false;
            const instrumented = new Proxy(tx, {get(target, key) {
                const fn = target[key];
                if (key === 'get' || key === 'getAll') return async (...refs) => {
                    assert.equal(writing, false, 'Every transaction read precedes every write');
                    calls.push(refs.map(ref => ref.path));
                    const result = await fn.apply(target, refs);
                    if (key === 'getAll') assert.deepEqual(result.map(doc => doc.ref.path), refs.map(ref => ref.path),
                        'SDK BatchGet preserves reference order, including missing documents');
                    return result;
                };
                if (['create', 'set', 'update', 'delete'].includes(key)) return (...args) => {
                    writing = true; return fn.apply(target, args);
                };
                return typeof fn === 'function' ? fn.bind(target) : fn;
            }});
            const result = await callback(instrumented);
            if (inject) {const failure = inject; inject = null; throw Object.assign(new Error('Synthetic pre-commit failure'), {code: failure});}
            return result;
        }),
    };
    const options = {db: countedDb, timestamp: ms => Timestamp.fromMillis(ms), secret,
        catalogue: async () => {catalogueCalls++; return catalogue;}, clock: () => now};
    const service = factory(options);
    await db.doc('viewSystem/config').set({enabled: true, activationAt: Timestamp.fromMillis(baseTime - 60000)});
    async function dump() {
        const docs = [];
        for (const collection of ['viewSystem', 'chapterViewSessions', 'chapterViewEvents', 'viewDedup', 'viewRateLimits']) {
            for (const doc of (await db.collection(collection).get()).docs) docs.push([doc.ref.path, normalize(doc.data())]);
        }
        for (const doc of (await db.collectionGroup('periods').get()).docs) docs.push([doc.ref.path, normalize(doc.data())]);
        return docs.sort(([a], [b]) => a.localeCompare(b));
    }
    const actor = (n = 1) => ({uid: `fake-user-${n}`, network: `fake-network-${n}`});
    const start = (n = 1, chapterId = 0, identity = actor(n), device = uuid(n)) => service.start({mangaId: 'm', chapterId,
        requestId: uuid(100 + n), anonymousReaderId: device}, identity);
    const record = (session, n = 1, identity = actor(n), device = uuid(n)) => service.record({sessionId: session.sessionId, anonymousReaderId: device}, identity);
    async function verify(eventsExpected, sessionsExpected, aggregateValue) {
        const events = await db.collection('chapterViewEvents').get();
        const sessions = await db.collection('chapterViewSessions').get();
        const scopes = await db.collectionGroup('periods').get();
        assert.equal(events.size, eventsExpected); assert.equal(sessions.size, sessionsExpected);
        assert.equal(scopes.size, eventsExpected ? 8 : 0);
        for (const doc of scopes.docs) assert.equal(doc.data().validViews, aggregateValue, doc.ref.path);
        for (const doc of events.docs) {
            const receipt = await db.doc(`chapterViewSessions/${doc.id}`).get();
            assert.equal(receipt.data().consumed, true);
            assert.deepEqual(receipt.data().outcome, {accepted: true, eventId: doc.id});
            assert.equal(doc.data().valid, true);
        }
    }
    return {db, service, options, calls, start, record, actor, dump, verify,
        advance: () => {now += 10000;}, inject: code => {inject = code;},
        stats: () => ({attempts, catalogueCalls}),
        close: async () => {await db.terminate(); await deleteApp(app);}};
}

const workloads = {
    async 'same session concurrent start and record'(h) {
        const starts = await Promise.all(Array.from({length: 4}, () => h.start()));
        assert.equal(new Set(starts.map(s => s.sessionId)).size, 1);
        h.advance();
        const outcomes = await Promise.all(starts.map(s => h.record(s)));
        assert.ok(outcomes.every(o => o.accepted && o.eventId === starts[0].sessionId));
        await h.verify(1, 1, 1);
        for (const doc of (await h.db.collection('viewRateLimits').get()).docs) assert.equal(doc.data().acceptedAt.length, 1);
    },
    async 'different readers contend on the same eight aggregates'(h) {
        const sessions = await Promise.all([1, 2, 3].map(n => h.start(n)));
        h.advance();
        const outcomes = await Promise.all(sessions.map((s, i) => h.record(s, i + 1)));
        assert.ok(outcomes.every(o => o.accepted));
        await h.verify(3, 3, 3);
    },
    async 'different sessions from one reader deduplicate atomically'(h) {
        const sessions = await Promise.all([1, 2, 3].map(n => h.start(n, 0, h.actor(1), uuid(1))));
        h.advance();
        const outcomes = await Promise.all(sessions.map(s => h.record(s, 1)));
        assert.equal(outcomes.filter(o => o.accepted).length, 1);
        assert.equal(outcomes.filter(o => o.reason === 'duplicate').length, 2);
        await h.verify(1, 3, 1);
        assert.ok((await h.db.collection('chapterViewSessions').get()).docs.every(d => d.data().consumed));
    },
    async 'reader and network accepted-rate limits preserve receipts without partial writes'(h) {
        await h.db.doc('viewSystem/config').update({readerHourlyLimit: 1, networkHourlyLimit: 1});
        const first = await h.start(); h.advance(); assert.equal((await h.record(first)).accepted, true);
        const readerLimited = await h.start(2, 1, h.actor(1), uuid(1));
        const networkLimited = await h.start(3, 1, {...h.actor(3), network: h.actor(1).network});
        h.advance();
        assert.deepEqual(await h.record(readerLimited), {accepted: false, reason: 'rate-limited'});
        assert.deepEqual(await h.record(networkLimited, 3, {...h.actor(3), network: h.actor(1).network}), {accepted: false, reason: 'rate-limited'});
        await h.verify(1, 3, 1);
        for (const s of [readerLimited, networkLimited]) assert.deepEqual((await h.db.doc(`chapterViewSessions/${s.sessionId}`).get()).data().outcome,
            {accepted: false, reason: 'rate-limited'});
    },
    async 'start rate rejection creates no session and performs no write'(h) {
        await h.db.doc('viewSystem/config').update({readerSessionHourlyLimit: 1});
        await h.start(); const before = await h.dump();
        await assert.rejects(h.start(2, 1, h.actor(1), uuid(1)), error => error.code === 'resource-exhausted');
        assert.deepEqual(await h.dump(), before);
        await h.verify(0, 1, 0);
    },
    async 'SDK retries ABORTED after staged writes exactly once'(h) {
        const s = await h.start(); h.advance();
        const before = h.stats(); h.inject(10); // gRPC ABORTED, handled by the real SDK retry loop.
        assert.equal((await h.record(s)).accepted, true);
        assert.equal(h.stats().attempts - before.attempts, 2);
        assert.equal(h.stats().catalogueCalls - before.catalogueCalls, 1, 'Catalogue stays outside the retried callback');
        await h.verify(1, 1, 1);
    },
    async 'nonretryable failure after staged writes leaves no partial event or receipt'(h) {
        const s = await h.start(); h.advance(); const before = await h.dump();
        h.inject(7); // gRPC PERMISSION_DENIED must not be retried.
        await assert.rejects(h.record(s), error => error.code === 7);
        assert.deepEqual(await h.dump(), before);
        await h.verify(0, 1, 0);
        assert.equal((await h.record(s)).accepted, true);
        await h.verify(1, 1, 1);
    },
    async 'guest dedup remains compatible with login'(h) {
        const guest = {network: 'fake-network-guest'};
        const s = await h.start(1, 0, guest); h.advance();
        assert.equal((await h.record(s, 1, guest)).accepted, true);
        const logged = await h.start(2, 0, h.actor(1), uuid(1)); h.advance();
        assert.deepEqual(await h.record(logged, 1), {accepted: false, reason: 'duplicate'});
        await h.verify(1, 2, 1);
    },
};

test('baseline and batch use the same fixed demo database and produce identical persisted state', async t => {
    for (const [name, workload] of Object.entries(workloads)) {
        await t.test(name, {timeout: 120000}, async () => {
            const states = [];
            const observations = [];
            for (const [label, factory] of [['baseline', baseline], ['batch', batch]]) {
                const h = await harness(factory, `${label}-${name}`);
                try {
                    await workload(h);
                    states.push(accountingState(await h.dump(), name === 'different sessions from one reader deduplicate atomically'));
                    observations.push({variant: label, ...h.stats()});
                }
                finally {await h.close();}
            }
            assert.deepEqual(states[1], states[0], 'All fake sessions/events/rates/dedup/eight aggregates match baseline');
            t.diagnostic(JSON.stringify({workload: name, observations}));
        });
    }
});

test('BatchGet maps reversed references and nonexistent documents to the correct snapshots', async () => {
    const h = await harness(batch, 'snapshot-order');
    try {
        await h.db.doc('mapping/a').set({value: 'A'}); await h.db.doc('mapping/z').set({value: 'Z'});
        const refs = ['mapping/z', 'mapping/missing', 'mapping/a'].map(p => h.db.doc(p));
        const snapshots = await h.db.runTransaction(tx => tx.getAll(...refs));
        assert.deepEqual(snapshots.map(s => s.ref.path), refs.map(r => r.path));
        assert.deepEqual(snapshots.map(s => s.data()?.value), ['Z', undefined, 'A']);
    } finally {await h.close();}
});

test('baseline sessions and receipts work in batch, and batch receipts work after rollback', async () => {
    for (const [label, first, second] of [['old-new', baseline, batch], ['new-old', batch, baseline]]) {
        const h = await harness(first, label);
        try {
            const s = await h.start(); h.advance();
            const other = second(h.options);
            const request = {sessionId: s.sessionId, anonymousReaderId: uuid(1)};
            const outcome = await other.record(request, h.actor());
            assert.equal(outcome.accepted, true);
            const before = await h.dump();
            const replay = first({...h.options, catalogue: async () => {throw new Error('Catalogue unavailable');}});
            assert.deepEqual(await replay.record(request, h.actor()), outcome);
            assert.deepEqual(await h.dump(), before);
            await h.verify(1, 1, 1);
        } finally {await h.close();}
    }
});
