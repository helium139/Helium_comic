import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { cleanupStaging, parseStagingArguments, decodeImage } from './cleanup-chapter-staging.mjs';
import { createJournal } from './cleanup-originals.mjs';
const uuid = '6a294080-018b-4e4a-b5d2-1d945dba7afa';
const missing = () => Object.assign(new Error('missing'), { name: 'NoSuchKey' });
const pixels = { create: { width: 2, height: 3, channels: 3, background: '#123456' } };
const images = { webp: await sharp(pixels).webp().toBuffer(), jpg: await sharp(pixels).jpeg().toBuffer(), png: await sharp(pixels).png().toBuffer() };
function fixture(ext = 'webp') {
    const name = `1-${uuid}.${ext}`, key = `m/chap1/${name}`, final = `m/chap1/1.${ext}`;
    const objects = new Map([[key, images[ext]], [final, images[ext]]]);
    const data = { m: { chapters: [{ id: 1, pages: 1, folder: 'https://images.test/m/chap1', images: [`1.${ext}`] }] } };
    let live;
    const deleted = [], logs = [], records = [];
    const store = {
        list: async () => [...objects.keys()],
        get: async k => { if (!objects.has(k)) throw missing(); return { bytes: objects.get(k), contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` }; },
        head: async k => { if (!objects.has(k)) throw missing(); return { ContentLength: objects.get(k).length, ETag: objects.get(k).toString('hex'), LastModified: new Date('2020-01-01') }; },
        delete: async (k, options) => {
            assert.equal(options.ifMatch, objects.get(k).toString('hex'));
            assert.ok(logs.some(line => line.startsWith('Reclaimable bytes:')));
            assert.equal(records.at(-1).deletionResult, 'pending');
            deleted.push(k); objects.delete(k);
        }
    };
    return { key, final, name, data, objects, deleted, logs, records, live: value => { live = value; },
        options: { store, catalogue: { read: async () => ({ data: structuredClone(data), sha: 'revision1' }) },
            liveCatalogue: { read: async () => structuredClone(live || data) },
            base: 'https://images.test', prefix: 'm/chap1/', journal: async entry => records.push(entry), log: line => logs.push(line) } };
}
test('default dry-run reports exact safe candidate, bytes and zero deletes', async () => {
    const f = fixture(), stats = await cleanupStaging(f.options);
    assert.equal(stats.safeToDelete, 1);
    assert.equal(stats.reclaimableBytes, images.webp.length);
    assert.deepEqual(f.deleted, []);
    assert.equal(f.logs[0], 'DRY RUN - NO FILES WILL BE DELETED');
    assert.ok(f.logs.includes(`SAFE\nstaging: ${f.key}\nfinal:   ${f.final}\nbytes:   ${images.webp.length}`));
    assert.equal(f.logs.at(-1), 'DRY RUN - NO FILES DELETED');
});
test('default minimum age remains 24 hours and skips recent objects separately', async () => {
    const f = fixture();
    const now = Date.now();
    const head = f.options.store.head;
    f.options.store.head = async key => ({ ...await head(key), LastModified: new Date(now - 60 * 60 * 1000) });
    const parsed = parseStagingArguments(['--dry-run', '--prefix', 'm/chap1/']);
    assert.equal(parsed.minAgeHours, 24);
    const stats = await cleanupStaging({ ...f.options, now });
    assert.equal(stats.skippedRecent, 1);
    assert.equal(stats.skippedVerificationFailed, 0);
    assert.ok(f.logs.some(line => line.includes('Skipped recent: 1')));
    assert.deepEqual(f.deleted, []);
});
test('minimum age zero allows a recent object through only the age gate', async () => {
    const f = fixture();
    const now = Date.now();
    const head = f.options.store.head;
    f.options.store.head = async key => ({ ...await head(key), LastModified: new Date(now - 60 * 60 * 1000) });
    const stats = await cleanupStaging({ ...f.options, now, minAgeHours: 0 });
    assert.equal(stats.safeToDelete, 1);
    assert.equal(stats.skippedRecent, 0);
    assert.deepEqual(f.deleted, []);
});
for (const ext of ['webp', 'jpg', 'png']) test(`apply preserves ${ext} extension and only deletes verified staging; retry safe`, async () => {
    const f = fixture(ext);
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 1);
    assert.deepEqual(f.deleted, [f.key]);
    assert.ok(f.objects.has(f.final));
    assert.equal(f.records.at(-1).deletionResult, 'confirmed missing');
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 0);
});
for (const mode of ['referenced', 'different', 'missing', 'unknown', 'live referenced', 'decode', 'zero', 'MIME', 'recent', 'timestamp missing']) test(`retains ${mode} staging with reason`, async () => {
    const f = fixture();
    let reason = 'SKIP_VERIFICATION_FAILED';
    if (mode === 'referenced') { f.data.m.chapters[0].images = [f.name]; reason = 'SKIP_REFERENCED'; }
    if (mode === 'different') f.objects.set(f.final, images.png);
    if (mode === 'missing') { f.objects.delete(f.final); reason = 'SKIP_MISSING_FINAL'; }
    if (mode === 'unknown') { f.data.m.chapters = []; reason = 'SKIP_UNKNOWN'; }
    if (mode === 'live referenced') { f.live({ m: { ...f.data.m, asset: `https://images.test/${f.key}?v=1` } }); reason = 'SKIP_REFERENCED'; }
    if (mode === 'decode') f.options.verify = async () => { throw new Error('decode failed'); };
    if (mode === 'zero') { f.objects.set(f.final, Buffer.alloc(0)); f.objects.set(f.key, Buffer.alloc(0)); }
    if (['MIME', 'recent', 'timestamp missing'].includes(mode)) {
        const head = f.options.store.head;
        f.options.store.head = async k => ({ ...await head(k), ...({ MIME: { ContentType: 'text/plain' }, recent: { LastModified: new Date() }, 'timestamp missing': { LastModified: undefined } }[mode]) });
        if (mode !== 'MIME') reason = 'SKIP_RECENT';
    }
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 0);
    assert.ok(f.objects.has(f.key));
    assert.ok(f.logs.some(line => line === `${reason} ${f.key}`));
});
test('unknown files, covers and objects outside prefix remain untouched', async () => {
    const f = fixture();
    for (const key of ['m/chap1/1-hash.webp', 'm/cover.webp', `other/chap1/${f.name}`, 'm/chap1/og.webp']) f.objects.set(key, images.webp);
    await cleanupStaging({ ...f.options, apply: true });
    assert.deepEqual(f.deleted, [f.key]);
    assert.ok(f.objects.has(`other/chap1/${f.name}`));
    assert.ok(f.logs.some(line => line === 'SKIP_UNKNOWN m/chap1/1-hash.webp'));
});
for (const mode of ['catalogue', 'live', 'final missing', 'source changed', 'final changed']) test(`change during verification skips deletion: ${mode}`, async () => {
    const f = fixture(); let calls = 0;
    f.options.verify = async bytes => {
        await decodeImage(bytes);
        if (++calls !== 1) return;
        if (mode === 'catalogue') f.data.m.title = 'Changed';
        if (mode === 'live') f.live({ m: { ...f.data.m, title: 'Changed live' } });
        if (mode === 'final missing') f.objects.delete(f.final);
        if (mode === 'source changed') f.objects.set(f.key, images.png);
        if (mode === 'final changed') f.objects.set(f.final, images.png);
    };
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 0);
    assert.ok(f.objects.has(f.key));
});
test('journal existing file is never overwritten; entries have durable audit fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'staging-cleanup-'));
    const path = join(dir, 'audit.jsonl');
    try {
        const journal = await createJournal(path);
        try { await journal.append({ sentinel: 'preserve' }); } finally { await journal.close(); }
        await assert.rejects(createJournal(path), { code: 'EEXIST' });
        assert.equal(await readFile(path, 'utf8'), '{"sentinel":"preserve"}\n');
        const f = fixture();
        await cleanupStaging({ ...f.options, apply: true });
        for (const field of ['stagingKey', 'finalKey', 'action', 'timestamp', 'size', 'verificationResult', 'deletionResult']) assert.ok(Object.hasOwn(f.records[0], field));
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test('failed journal and absent journal prevent deletion', async () => {
    const f = fixture();
    await assert.rejects(cleanupStaging({ ...f.options, apply: true, journal: undefined }), /journal/);
    await assert.rejects(cleanupStaging({ ...f.options, apply: true, journal: async () => { throw new Error('disk full'); } }), /disk full/);
    assert.deepEqual(f.deleted, []);
});
test('CLI defaults to dry-run, accepts manga prefix, rejects global prefix and conflicting flags', () => {
    assert.equal(parseStagingArguments(['--prefix', 'm/']).apply, false);
    assert.equal(parseStagingArguments(['--apply', '--prefix', 'm/chap1/', '--journal', 'audit.jsonl']).apply, true);
    for (const args of [[], ['--prefix', '/'], ['--prefix', ''], ['--apply', '--dry-run', '--prefix', 'm/']]) assert.throws(() => parseStagingArguments(args));
});
test('minimum age accepts nonnegative numbers and rejects missing, negative or invalid values', () => {
    for (const value of ['0', '1', '24', '48']) {
        assert.equal(parseStagingArguments(['--prefix', 'm/', '--min-age-hours', value]).minAgeHours, Number(value));
    }
    for (const value of ['-1', 'abc', 'NaN', '']) {
        assert.throws(() => parseStagingArguments(['--prefix', 'm/', '--min-age-hours', value]), /min-age-hours/);
    }
    assert.throws(() => parseStagingArguments(['--prefix', 'm/', '--min-age-hours']), /min-age-hours/);
});
for (const [name, makeUnsafe, skipped] of [
    ['catalogue reference', f => { f.data.m.chapters[0].images = [f.name]; }, 'skippedReferenced'],
    ['live catalogue reference', f => f.live({ m: { ...f.data.m, asset: `https://images.test/${f.key}?v=1` } }), 'skippedReferenced'],
    ['missing final', f => f.objects.delete(f.final), 'skippedMissingFinal'],
    ['different bytes', f => f.objects.set(f.final, images.png), 'skippedVerificationFailed'],
    ['invalid MIME', f => {
        const get = f.options.store.get;
        f.options.store.get = async key => ({ ...await get(key), contentType: key === f.final ? 'text/plain' : 'image/webp' });
    }, 'skippedVerificationFailed'],
    ['decode failure', f => { f.options.verify = async () => { throw new Error('decode failed'); }; }, 'skippedVerificationFailed'],
    ['missing ETag', f => {
        const head = f.options.store.head;
        f.options.store.head = async key => ({ ...await head(key), ETag: key === f.key ? undefined : 'final-etag' });
    }, 'skippedVerificationFailed']
]) test(`minimum age zero does not bypass ${name}`, async () => {
    const f = fixture();
    makeUnsafe(f);
    const stats = await cleanupStaging({ ...f.options, minAgeHours: 0 });
    assert.equal(stats[skipped], 1);
    assert.equal(stats.safeToDelete, 0);
    assert.deepEqual(f.deleted, []);
});
test('real decoder rejects a plausible signature with truncated image payload', async () => {
    await assert.rejects(decodeImage(Buffer.from('RIFF1234WEBPpage')));
});
test('manga prefix cleans a mixed-extension chapter and protects a referenced legacy chapter', async () => {
    const f = fixture();
    f.options.prefix = 'm/';
    const names = [f.name, `2-${uuid}.jpg`, `3-${uuid}.png`];
    for (const [index, ext] of ['webp', 'jpg', 'png'].entries()) {
        f.objects.set(`m/chap1/${names[index]}`, images[ext]);
        f.objects.set(`m/chap1/${index + 1}.${ext}`, images[ext]);
    }
    f.data.m.chapters[0].pages = 3;
    f.data.m.chapters[0].images = ['1.webp', '2.jpg', '3.png'];
    const legacyName = f.name.replace('6a294080', '7a294080');
    const legacy = `m/chap0/${legacyName}`;
    f.objects.set(legacy, images.webp);
    f.objects.set('m/chap0/1.webp', images.webp);
    f.data.m.chapters.push({ id: 0, pages: 1, folder: 'https://images.test/m/chap0', images: [legacyName] });
    f.options.store.get = async key => {
        if (!f.objects.has(key)) throw missing();
        const ext = key.split('.').pop();
        return { bytes: f.objects.get(key), contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
    };
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 3);
    assert.deepEqual(f.deleted, names.map(name => `m/chap1/${name}`));
    assert.ok(f.objects.has(legacy));
});
test('catalogue change during pending journal flush causes skip', async () => {
    const f = fixture();
    f.options.journal = async record => {
        f.records.push(record);
        if (record.deletionResult === 'pending') f.data.m.title = 'concurrent edit';
    };
    assert.equal((await cleanupStaging({ ...f.options, apply: true })).deleted, 0);
    assert.ok(f.objects.has(f.key));
});
