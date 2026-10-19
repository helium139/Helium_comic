import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createViewService } from '../functions/lib/views/view-service.mjs';
import { DEFAULT_POLICY } from '../functions/lib/views/policy.mjs';

class Stamp { constructor(value) { this.value = value; } toMillis() { return this.value; } }
const clone = value => value instanceof Stamp ? new Stamp(value.value) : Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)])) : value;
export function memoryDb() {
    const documents = new Map(); let tail = Promise.resolve();
    const db = {
        documents, writes: 0,
        doc(path) { return { path, get: async () => ({ data: () => clone(documents.get(path)) }) }; },
        runTransaction(operation) {
            const run = tail.then(async () => {
                const pending = []; let writing = false;
                const result = await operation({
                    get: async ref => { assert.equal(writing, false, 'Firestore reads must precede writes'); return { data: () => clone(documents.get(ref.path)) }; },
                    create(ref, data) { writing = true; assert.equal(documents.has(ref.path), false); pending.push([ref.path, data]); },
                    set(ref, data) { writing = true; pending.push([ref.path, data]); },
                    update(ref, data) { writing = true; pending.push([ref.path, { ...documents.get(ref.path), ...data }]); }
                });
                for (const [path, data] of pending) documents.set(path, clone(data));
                db.writes += pending.length;
                return clone(result);
            });
            tail = run.catch(() => {});
            return run;
        },
        collectionGroup() {
            const filters = []; let cursor = null, limit = 26;
            const query = {
                where(key, operator, value) { filters.push([key, value]); return query; }, orderBy() { return query; },
                startAfter(value) { cursor = value; return query; }, limit(value) { limit = value; return query; },
                async get() { return { docs: [...documents.entries()].filter(([path, value]) => path.startsWith('analyticsScopes/') &&
                    filters.every(([key, expected]) => value[key] === expected) && (!cursor || value.scopeId > cursor))
                    .map(([, value]) => value).sort((a, b) => a.scopeId.localeCompare(b.scopeId)).slice(0, limit).map(value => ({ data: () => clone(value) })) }; }
            };
            return query;
        }
    };
    return db;
}
function harness() {
    const db = memoryDb(); let time = Date.parse('2026-10-19T12:00:00Z');
    const chapters = Array.from({ length: 130 }, (_, id) => ({ id, pages: 2, folder: `https://images.test/m/chap${id}` }));
    const catalogue = { revision: 'revision-1', teams: [{ id: 'heliumtg' }, { id: 'other' }],
        data: { m: { teamId: 'heliumtg', chapters }, n: { teamId: 'other', chapters } } };
    db.documents.set('viewSystem/config', { enabled: true, activationAt: new Stamp(time - 60000), ...DEFAULT_POLICY });
    const service = createViewService({ db, timestamp: ms => new Stamp(ms), secret: 'test-key-'.repeat(8), catalogue: async () => catalogue, clock: () => time });
    const device = randomUUID(), context = { network: 'shared-network' };
    const start = (chapterId = 0, actor = context, anonymousReaderId = device, mangaId = 'm') => service.start({ mangaId, chapterId,
        requestId: randomUUID(), anonymousReaderId }, actor);
    const record = (session, actor = context, anonymousReaderId = device) => service.record({ sessionId: session.sessionId, anonymousReaderId }, actor);
    return { db, service, catalogue, device, context, start, record, now: () => time, advance: ms => { time += ms; }, setTime: ms => { time = ms; } };
}

test('activation, invalid resources, elapsed time, expiration and identity are enforced', async () => {
    const h = harness();
    await assert.rejects(h.start(0, h.context, h.device, 'invalid'), error => error.code === 'not-found');
    await assert.rejects(h.start(999), error => error.code === 'not-found');
    const session = await h.start();
    await assert.rejects(h.record(session), error => error.code === 'failed-precondition');
    h.advance(9999);
    await assert.rejects(h.record(session), error => error.code === 'failed-precondition');
    h.advance(1);
    await assert.rejects(h.record(session, h.context, randomUUID()), error => error.code === 'permission-denied');
    assert.equal((await h.record(session)).accepted, true);
    const expired = await h.start(1); h.advance(30 * 60000);
    await assert.rejects(h.record(expired), error => error.code === 'deadline-exceeded');
    h.db.documents.get('viewSystem/config').enabled = false;
    await assert.rejects(h.start(), error => error.code === 'failed-precondition');
    assert.equal((await h.record(session)).accepted, true); // Receipt survives activation pause/expiry.
});

test('guests and authenticated readers create immutable events and eight aggregates with documented write counts', async () => {
    for (const uid of [null, 'verified-user']) {
        const h = harness(), actor = { uid, network: 'network' };
        const session = await h.start(0, actor);
        h.advance(10000);
        const before = h.db.writes;
        const result = await h.record(session, actor);
        assert.equal(result.accepted, true);
        assert.equal(h.db.writes - before, uid ? 15 : 13);
        const event = h.db.documents.get(`chapterViewEvents/${session.sessionId}`);
        assert.equal(event.uid, uid); assert.equal(event.valid, true); assert.equal(event.chapterId, '0');
        assert.equal(event.teamId, 'heliumtg'); assert.equal(event.catalogueRevision, 'revision-1');
        assert.match(event.anonymousReaderHash, /^[0-9a-f]{64}$/);
        assert.equal(JSON.stringify([...h.db.documents.values()]).includes(h.device), false);
        assert.equal([...h.db.documents.keys()].filter(key => key.startsWith('analyticsScopes/')).length, 8);
        const snapshot = JSON.stringify(event);
        const writes = h.db.writes;
        assert.deepEqual(await h.record(session, actor), result);
        assert.equal(h.db.writes, writes);
        assert.equal(JSON.stringify(h.db.documents.get(`chapterViewEvents/${session.sessionId}`)), snapshot);
    }
});

test('refreshes/concurrent tabs dedup atomically; different chapters and exact rolling 24h remain eligible', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.start(), h.start()]); h.advance(10000);
    const outcomes = await Promise.all([h.record(a), h.record(b)]);
    assert.equal(outcomes.filter(result => result.accepted).length, 1);
    assert.equal(outcomes.filter(result => result.reason === 'duplicate').length, 1);
    const next = await h.start(1); h.advance(10000);
    assert.equal((await h.record(next)).accepted, true);
    const acceptedAt = h.db.documents.get(`chapterViewEvents/${outcomes[0].accepted ? a.sessionId : b.sessionId}`).createdAt.toMillis();
    h.setTime(acceptedAt + 24 * 3600000 - 10000);
    const later = await h.start(); h.advance(10000);
    assert.equal((await h.record(later)).accepted, true);
});

test('guest -> login continuity and verified UID dedup prevent immediate double counts across devices', async () => {
    const h = harness(), loggedIn = { uid: 'user', network: 'network' };
    const guest = await h.start(); h.advance(10000);
    assert.equal((await h.record(guest)).accepted, true);
    const logged = await h.start(0, loggedIn); h.advance(10000);
    assert.equal((await h.record(logged, loggedIn)).reason, 'duplicate');
    const ownChapter = await h.start(1, loggedIn); h.advance(10000);
    assert.equal((await h.record(ownChapter, loggedIn)).accepted, true);
    const secondDevice = randomUUID();
    const repeat = await h.start(1, loggedIn, secondDevice); h.advance(10000);
    assert.equal((await h.record(repeat, loggedIn, secondDevice)).reason, 'duplicate');
    const bound = await h.start(2, loggedIn); h.advance(10000);
    await assert.rejects(h.record(bound, { uid: 'another', network: 'network' }), error => error.code === 'permission-denied');
    const upgrade = await h.start(3); h.advance(10000);
    assert.equal((await h.record(upgrade, loggedIn)).accepted, true);
});

test('reader ceiling is 120 per rolling hour, and session-start limits are enforced', async () => {
    const h = harness();
    for (let chapter = 0; chapter < 120; chapter++) {
        const session = await h.start(chapter); h.advance(10000);
        assert.equal((await h.record(session)).accepted, true);
    }
    const blocked = await h.start(120); h.advance(10000);
    assert.equal((await h.record(blocked)).reason, 'rate-limited');
    assert.equal(h.db.documents.get('analyticsScopes/site/periods/all').validViews, 120);
    h.advance(3600000);
    const eligible = await h.start(121); h.advance(10000);
    assert.equal((await h.record(eligible)).accepted, true);
    const starts = harness(); starts.db.documents.get('viewSystem/config').readerSessionHourlyLimit = 1;
    await starts.start();
    await assert.rejects(starts.start(), error => error.code === 'resource-exhausted');
});

test('UTC month attribution uses server acceptance time; ownership changes reject old sessions', async () => {
    const h = harness();
    h.setTime(Date.parse('2026-10-31T23:59:55Z'));
    const session = await h.start(); h.advance(10000);
    assert.equal((await h.record(session)).accepted, true);
    assert.equal(h.db.documents.get('analyticsScopes/site/periods/2026-11').validViews, 1);
    assert.equal(h.db.documents.has('analyticsScopes/site/periods/2026-10'), false);
    const moved = await h.start(1);
    h.catalogue.data.m.teamId = 'other'; h.advance(10000);
    await assert.rejects(h.record(moved), error => error.code === 'failed-precondition');
});

test('staff analytics read aggregates only; leader site/foreign-team queries are denied', async () => {
    const h = harness(), session = await h.start(); h.advance(10000); await h.record(session);
    const admin = { role: 'admin' }, leader = { role: 'team_leader', teamId: 'heliumtg' };
    const site = await h.service.analytics({ scopeId: 'site', includeChildren: true }, admin);
    assert.equal(site.total, 1); assert.equal(site.monthly, 1); assert.equal(site.children[0].teamId, 'heliumtg');
    assert.equal((await h.service.analytics({ scopeId: 'team:heliumtg' }, leader)).total, 1);
    for (const scopeId of ['site', 'team:other', 'manga:other:m', 'chapter:other:m:0']) {
        await assert.rejects(h.service.analytics({ scopeId }, leader), error => error.code === 'permission-denied');
    }
    await assert.rejects(h.service.analytics({ scopeId: 'site' }, { role: 'user' }), error => error.code === 'permission-denied');
});


test('start retries are idempotent and network ceilings cover different device identities', async () => {
    const h = harness();
    const data = { mangaId: 'm', chapterId: 0, anonymousReaderId: h.device, requestId: randomUUID() };
    const first = await h.service.start(data, h.context), writes = h.db.writes;
    assert.deepEqual(await h.service.start(data, h.context), first);
    assert.equal(h.db.writes, writes);
    h.db.documents.get('viewSystem/config').networkHourlyLimit = 1;
    h.advance(10000); assert.equal((await h.record(first)).accepted, true);
    const another = randomUUID(), second = await h.start(1, h.context, another);
    h.advance(10000); assert.equal((await h.record(second, h.context, another)).reason, 'rate-limited');
    assert.equal(h.db.documents.get('analyticsScopes/site/periods/all').validViews, 1);
});
