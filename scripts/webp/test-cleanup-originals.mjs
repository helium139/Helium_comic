import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { cleanupOriginals, createJournal, fetchLiveCatalogue, inventory, notFound, parseCleanupArguments, verifyImages, LIVE_CATALOGUE_URL } from './cleanup-originals.mjs';
import { redact } from './migrate.mjs';

const base = 'https://images.test';
const missing = () => Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
function fixture() {
    const data = { m: { chapters: [{ id: 0, pages: 1, folder: `${base}/m/chap0`, images: ['1.webp'] }] } };
    const source = 'm/chap0/1.jpg', webp = 'm/chap0/1.webp';
    const objects = new Map([[source, { bytes: Buffer.alloc(100), contentType: 'image/jpeg', etag: 'source' }], [webp, { bytes: Buffer.alloc(40), contentType: 'image/webp', etag: 'webp' }]]);
    let live = structuredClone(data);
    const events = [], records = [], logs = [], deletes = [];
    const options = { scope: 'chapters', prefix: 'm/', base,
        catalogue: { read: async () => { events.push('catalogue'); return { data: structuredClone(data) }; }, save: () => assert.fail('catalogue write') },
        liveCatalogue: { read: async () => { events.push('live'); return structuredClone(live); } },
        store: {
            list: async () => [...objects.keys()],
            head: async key => { events.push(`head:${key}`); const o = objects.get(key); if (!o) throw missing(); return { ContentLength: o.bytes.length, ContentType: o.contentType, ETag: o.etag }; },
            get: async key => { events.push(`get:${key}`); if (!objects.has(key)) throw missing(); return objects.get(key); },
            delete: async (key, condition) => { events.push('delete'); assert.equal(condition.ifMatch, objects.get(key).etag); deletes.push(key); objects.delete(key); },
            put: () => assert.fail('object write')
        },
        verify: async () => { events.push('decode'); },
        journal: async entry => { events.push(`journal:${entry.reason}`); records.push(entry); },
        log: message => logs.push(message)
    };
    return { options, data, objects, source, webp, events, records, logs, deletes, live: value => { live = value; } };
}

test('dry-run verifies exact live replacement, journals proposal and performs zero deletes', async () => {
    const f = fixture(), stats = await cleanupOriginals(f.options);
    assert.equal(stats.safeToDelete, 1); assert.equal(stats.reclaimableBytes, 100); assert.equal(stats.deleted, 0);
    assert.deepEqual(f.deletes, []); assert.equal(f.records[0].reason, 'would delete');
    for (const field of ['catalogueVerified', 'liveCatalogueVerified', 'webpVerified']) assert.equal(f.records[0][field], true);
    assert.ok(f.logs.some(line => line.includes('reclaim: 100 bytes')));
});

test('apply deletes exactly eligible object after durable pending journal and verifies not found', async () => {
    const f = fixture(), stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.deleted, 1); assert.deepEqual(f.deletes, [f.source]); assert.ok(f.objects.has(f.webp));
    assert.deepEqual(f.records.map(r => r.reason), ['pending deletion', 'deleted and verified not found']);
    assert.ok(f.events.indexOf('journal:pending deletion') < f.events.indexOf('delete'));
    assert.equal(f.events.at(-2), `head:${f.source}`); assert.equal(f.records.at(-1).deleted, true);
});

for (const where of ['current', 'live', 'anywhere']) test(`${where} reference to original prevents deletion`, async () => {
    const f = fixture();
    if (where === 'current') delete f.data.m.chapters[0].images;
    if (where === 'live') { const live = structuredClone(f.data); delete live.m.chapters[0].images; f.live(live); }
    if (where === 'anywhere') f.data.other = { cover: `${base}/${f.source}?v=1` };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.deleted, 0); assert.equal(where === 'live' ? stats.skippedLiveNotVerified : stats.skippedReferenced, 1);
});

for (const mode of ['missing', 'wrong MIME', 'zero bytes', 'HEAD MIME', 'decode failure']) test(`${mode} replacement is never deleted`, async () => {
    const f = fixture();
    if (mode === 'missing') f.objects.delete(f.webp);
    if (mode === 'wrong MIME') f.objects.get(f.webp).contentType = 'image/jpeg';
    if (mode === 'zero bytes') f.objects.get(f.webp).bytes = Buffer.alloc(0);
    if (mode === 'HEAD MIME') { const head = f.options.store.head; f.options.store.head = async key => ({ ...await head(key), ...(key === f.webp ? { ContentType: 'image/jpeg' } : {}) }); }
    if (mode === 'decode failure') f.options.verify = async () => { throw new Error('corrupt source'); };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.deleted, 0); assert.equal(mode === 'missing' ? stats.skippedMissingWebp : stats.failed, 1);
});

test('unknown objects, other chapters, covers, OG, GIF, WebP and out-of-prefix keys are untouched', async () => {
    const f = fixture();
    const unknown = ['m/chap0/3.jpg', 'm/chap1/1.jpg'];
    const ignored = ['outside/chap0/1.jpg', 'm/cover.png', 'm/chap0/1.gif', 'm/og/1.png', 'm/chap0/../1.jpg'];
    for (const key of [...unknown, ...ignored]) f.objects.set(key, { bytes: Buffer.alloc(1) });
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.deepEqual(f.deletes, [f.source]); assert.equal(stats.skippedUnknown, 2);
    for (const key of [...unknown, ...ignored]) assert.ok(f.objects.has(key));
});

test('UUID stems must match exactly and page index must agree', async () => {
    const f = fixture(), stem = '1-a53f0000-0000-4000-8000-000000000000';
    f.objects.set(`m/chap0/${stem}.png`, f.objects.get(f.source)); f.objects.delete(f.source);
    assert.equal((await cleanupOriginals({ ...f.options, apply: true })).deleted, 0);
    f.data.m.chapters[0].images = [`${stem}.webp`]; f.live(f.data);
    f.objects.set(`m/chap0/${stem}.webp`, f.objects.get(f.webp));
    assert.equal((await cleanupOriginals({ ...f.options, apply: true })).deleted, 1);
});

test('live fetch failure is reported and retained', async () => {
    const f = fixture(); f.options.liveCatalogue.read = async () => { throw new Error('offline'); };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.skippedLiveNotVerified, 1); assert.match(f.records[0].reason, /live catalogue not verified/);
});

test('failed delete is journaled and later candidates continue safely', async () => {
    const f = fixture(); f.options.store.delete = async () => { throw new Error('delete refused'); };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.failed, 1); assert.equal(stats.deleted, 0); assert.ok(f.objects.has(f.source));
    assert.match(f.records.at(-1).reason, /delete refused/); assert.equal(f.records.at(-1).deleted, false);
});

test('original still present after delete is failure', async () => {
    const f = fixture(); f.options.store.delete = async () => {};
    assert.equal((await cleanupOriginals({ ...f.options, apply: true })).failed, 1);
});

test('journal failure stops before any delete', async () => {
    const f = fixture(); f.options.journal = async () => { throw new Error('disk full'); };
    await assert.rejects(cleanupOriginals({ ...f.options, apply: true }), /disk full/);
    assert.deepEqual(f.deletes, []);
});

test('catalogue and live changes between verification and deletion fail closed', async () => {
    for (const target of ['catalogue', 'live']) {
        const f = fixture(); f.options.verify = async () => {
            const data = structuredClone(f.data); delete data.m.chapters[0].images;
            if (target === 'catalogue') delete f.data.m.chapters[0].images; else f.live(data);
        };
        assert.equal((await cleanupOriginals({ ...f.options, apply: true })).deleted, 0);
    }
});

test('changed ETags prevent delete; authentication errors are not not-found', async () => {
    const f = fixture(); f.options.verify = async () => { f.objects.get(f.source).etag = 'changed'; };
    assert.equal((await cleanupOriginals({ ...f.options, apply: true })).failed, 1);
    assert.equal(notFound({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), false);
    assert.equal(notFound({ cause: missing() }), true);
    assert.equal(notFound({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }), false);
});

test('path, scope, mode and limit validation reject dangerous arguments', () => {
    for (const prefix of ['../m/', 'm/chap0/../', 'm/%2e%2e/', 'm\\chap0\\', 'm/chap0', '/m/', 'https://x/m/']) {
        assert.throws(() => parseCleanupArguments(['--dry-run', '--scope', 'chapters', '--prefix', prefix]));
    }
    for (const extra of [['--scope', 'covers'], ['--apply'], ['--limit', '0']]) {
        assert.throws(() => parseCleanupArguments(['--dry-run', '--scope', 'chapters', '--prefix', 'm/', ...extra]));
    }
});

test('journal is exclusive and persisted; secrets are redacted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webp-cleanup-'));
    try {
        const path = join(dir, 'audit.jsonl'), journal = await createJournal(path);
        await journal.append({ reason: redact('Bearer hidden https://user:password@example.test/a?token=secret') });
        await journal.close();
        await assert.rejects(createJournal(path), { code: 'EEXIST' });
        const saved = await readFile(path, 'utf8');
        for (const secret of ['hidden', 'password', 'secret']) assert.ok(!saved.includes(secret));
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('live fetch uses production origin, no credentials, cache busting and no redirects', async () => {
    let seen;
    await fetchLiveCatalogue(async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({}) }; });
    assert.equal(new URL(seen.url).origin, new URL(LIVE_CATALOGUE_URL).origin);
    assert.ok(new URL(seen.url).searchParams.has('cleanup_check'));
    assert.equal(seen.options.redirect, 'error'); assert.equal(seen.options.cache, 'no-store');
    assert.equal(seen.options.headers.Authorization, undefined);
    await assert.rejects(fetchLiveCatalogue(async () => ({ ok: false, status: 503 })), /503/);
});

test('malformed metadata fails closed', () => {
    assert.throws(() => inventory({ m: { chapters: [{ id: 0, pages: 1, folder: `${base}/wrong` }] } }, base));
});

test('real image verification rejects APNG, GIF, corrupt and mismatched dimensions', async () => {
    const image = sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } });
    const jpg = await image.clone().jpeg().toBuffer(), webp = await image.clone().webp().toBuffer();
    await verifyImages(jpg, webp);
    await assert.rejects(verifyImages(await image.clone().gif().toBuffer(), webp));
    await assert.rejects(verifyImages(Buffer.from('corrupt'), webp));
    await assert.rejects(verifyImages(jpg, await image.clone().resize(8, 8).webp().toBuffer()));
    const apng = Buffer.alloc(20); apng.write('PNG', 1); apng.write('acTL', 12);
    await assert.rejects(verifyImages(apng, webp), /Animated PNG/);
});

test('delete failure does not prevent independently verified later candidate', async () => {
    const f = fixture();
    f.data.m.chapters[0].pages = 2; f.data.m.chapters[0].images.push('2.webp'); f.live(f.data);
    f.objects.set('m/chap0/2.jpg', { ...f.objects.get(f.source), etag: 'source2' });
    f.objects.set('m/chap0/2.webp', { ...f.objects.get(f.webp), etag: 'webp2' });
    const remove = f.options.store.delete;
    f.options.store.delete = async (key, condition) => { if (key === f.source) throw new Error('first deletion failed'); return remove(key, condition); };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.failed, 1); assert.equal(stats.deleted, 1);
    assert.deepEqual(f.deletes, ['m/chap0/2.jpg']); assert.ok(f.objects.has(f.source));
});

test('page ordinal mismatches remain unknown even with matching WebP stem', async () => {
    const f = fixture(); f.data.m.chapters[0].images = ['2.webp']; f.live(f.data);
    f.objects.clear();
    f.objects.set('m/chap0/2.jpg', { bytes: Buffer.alloc(100), contentType: 'image/jpeg', etag: 's' });
    f.objects.set('m/chap0/2.webp', { bytes: Buffer.alloc(40), contentType: 'image/webp', etag: 'w' });
    assert.equal((await cleanupOriginals({ ...f.options, apply: true })).skippedUnknown, 1);
    assert.deepEqual(f.deletes, []);
});

test('limit caps source checks', async () => {
    const f = fixture(); f.objects.set('m/chap0/3.jpg', { bytes: Buffer.alloc(1) });
    const stats = await cleanupOriginals({ ...f.options, apply: true, limit: 1 });
    assert.equal(f.records.length, 2); assert.equal(stats.deleted, 1); assert.ok(f.objects.has('m/chap0/3.jpg'));
});

test('post-delete auth errors never count as verified deletion', async () => {
    const f = fixture(), head = f.options.store.head;
    let removed = false;
    f.options.store.delete = async () => { removed = true; };
    f.options.store.head = async key => {
        if (removed && key === f.source) throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        return head(key);
    };
    const stats = await cleanupOriginals({ ...f.options, apply: true });
    assert.equal(stats.deleted, 0); assert.equal(stats.failed, 1);
    assert.equal(f.records.at(-1).deleted, false);
});
