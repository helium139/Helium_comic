import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { migrate, convert, references, connect, formatFailure, parseArguments, REQUIRED_ENV } from './migrate.mjs';

function fixture(failure) {
    let data = { manga: { cover: 'https://images.test/manga/cover.png', chapters: [{ id: 1, pages: 2, folder: 'https://images.test/manga/chap1' }] } };
    const original = Buffer.alloc(100, 1), output = Buffer.alloc(40, 2);
    const objects = new Map(['1.jpg', '2.jpg'].map(n => [`manga/chap1/${n}`, { bytes: original, contentType: 'image/jpeg' }]));
    let writes = 0;
    const store = {
        list: async () => [...objects.keys()],
        get: async key => objects.get(key),
        put: async (key, bytes) => { if (failure === 'upload') throw Error(); writes++; objects.set(key, { bytes, contentType: 'image/webp' }); }
    };
    const catalogue = {
        read: async () => ({ data: structuredClone(data), sha: 'version' }),
        save: async value => { if (failure === 'update') throw Error(); writes++; data = value.data; }
    };
    return { options: { store, catalogue, base: 'https://images.test', scope: 'chapters', prefix: 'manga/',
        encode: async () => { if (failure === 'conversion') throw Error(); return output; }, log: () => {} },
        objects, data: () => data, writes: () => writes };
}
test('dry run converts samples without any writes or catalogue mutation', async () => {
    const f = fixture(); const stats = await migrate(f.options);
    assert.equal(stats.converted, 2); assert.equal(stats.savedBytes, 120);
    assert.equal(f.writes(), 0); assert.equal(f.data().manga.chapters[0].images, undefined);
});
test('apply verifies replacements and updates ordered exact references; rerun is idempotent', async () => {
    const f = fixture(); const stats = await migrate({ ...f.options, apply: true });
    assert.equal(stats.converted, 2);
    assert.deepEqual(f.data().manga.chapters[0].images, ['1.webp', '2.webp']);
    assert.equal(f.objects.get('manga/chap1/1.webp').contentType, 'image/webp');
    assert.ok(f.objects.has('manga/chap1/1.jpg'));
    const writes = f.writes(); assert.equal((await migrate({ ...f.options, apply: true })).converted, 0);
    assert.equal(f.writes(), writes);
});
for (const failure of ['conversion', 'upload', 'update']) test(`${failure} failure preserves originals and old references`, async () => {
    const f = fixture(failure); const stats = await migrate({ ...f.options, apply: true });
    assert.equal(stats.failed, 2); assert.ok(f.objects.has('manga/chap1/1.jpg'));
    assert.equal(f.data().manga.chapters[0].images, undefined);
});
test('limit, scopes and nonmatching hosts protect unrelated assets', async () => {
    const f = fixture(); assert.equal((await migrate({ ...f.options, apply: true, limit: 1 })).converted, 1);
    assert.deepEqual(f.data().manga.chapters[0].images, ['1.webp', '2.jpg']);
    assert.equal(references(f.data(), 'https://other.test', 'chapters', 'manga/').length, 0);
    assert.equal(references(f.data(), 'https://images.test', 'covers', 'manga/')[0].key, 'manga/cover.png');
});
test('collision cannot overwrite an unrelated WebP', async () => {
    const f = fixture(); f.objects.set('manga/chap1/1.webp', { bytes: Buffer.from('different'), contentType: 'image/webp' });
    const stats = await migrate({ ...f.options, apply: true, limit: 1 });
    assert.equal(stats.failed, 1); assert.equal(f.writes(), 0);
});

test('missing referenced sources fail visibly without metadata writes', async () => {
    const f = fixture(); f.objects.delete('manga/chap1/1.jpg');
    const stats = await migrate({ ...f.options, apply: true, limit: 1 });
    assert.equal(stats.failed, 1); assert.equal(f.writes(), 0);
});
for (const format of ['jpeg', 'png']) test(`real ${format} -> smaller dimension-preserving WebP`, async () => {
    const bytes = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#eeeeee' } })[format]().toBuffer();
    const result = await convert(bytes, 85); assert.ok(result);
    const meta = await sharp(result).metadata(); assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 800); assert.equal(meta.height, 1200); assert.ok(result.length < bytes.length);
});
test('WebP and GIF are never recompressed', async () => {
    const input = sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } });
    assert.equal(await convert(await input.clone().webp().toBuffer(), 85), null);
    assert.equal(await convert(await input.clone().gif().toBuffer(), 85), null);
});

test('EXIF-oriented original is preserved', async () => {
    const bytes = await sharp({ create: { width: 100, height: 200, channels: 3, background: 'red' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    assert.equal(await convert(bytes, 85), null);
});

// Startup, diagnostics and dry-run safety belong to the migration suite.
test('startup reports every missing variable without secrets', async () => {
    await assert.rejects(connect({ env: {} }), error => {
        const diagnostic = JSON.parse(formatFailure(error, {}, {}));
        for (const name of REQUIRED_ENV) assert.ok(diagnostic.message.includes(name));
        assert.equal(diagnostic.stage, 'configuration');
        return true;
    });
});

test('argument diagnostics reject missing and invalid prefixes', () => {
    for (const prefix of [undefined, 'https://images.test/m/chap0/', 'm/chap0', '../m/']) {
        assert.throws(() => parseArguments(['--dry-run', '--scope', 'chapters', ...(prefix ? ['--prefix', prefix] : [])]), /prefix/);
    }
});

test('legacy chapter prefix discovers four implied JPGs independently of later migrations', () => {
    const prefix = 'nguoi-hau-trong-tu-kinh/chap0/';
    const base = 'https://images.test';
    const data = { 'nguoi-hau-trong-tu-kinh': { chapters: [{ id: 0, pages: 4, folder: `${base}/${prefix.slice(0, -1)}` }] } };
    assert.deepEqual(references(data, base, 'chapters', prefix).map(r => r.key), [1, 2, 3, 4].map(n => `${prefix}${n}.jpg`));
});

test('diagnostics redact environment secrets, headers, URL credentials and signed queries', () => {
    const env = { R2_SECRET_ACCESS_KEY: 'private/key', CUSTOM_TOKEN: 'custom-secret' };
    const failure = JSON.parse(formatFailure(new Error('private/key private%2Fkey custom-secret Authorization: Bearer abc123 https://user:pass@example.test/object?X-Amz-Signature=hidden'), {}, env));
    for (const secret of ['private/key', 'private%2Fkey', 'custom-secret', 'abc123', 'user:pass', 'hidden']) assert.ok(!JSON.stringify(failure).includes(secret));
});

for (const [stage, name, status, code] of [
    ['r2.head', 'NotFound', 404], ['r2.list', 'AccessDenied', 403],
    ['r2.get', 'Error', undefined, 'ENOTFOUND'], ['github.read', 'Error', 401],
    ['conversion.decode', 'Error'], ['verification.conversion', 'Error']
]) test(`preserves safe underlying ${stage}/${name} diagnostics`, () => {
    const cause = Object.assign(new Error('Underlying failure'), { name, code, $metadata: { httpStatusCode: status } });
    const error = Object.assign(new Error('Operation failed', { cause }), { stage, context: { key: 'm/chap0/1.jpg' } });
    const diagnostic = JSON.parse(formatFailure(error));
    assert.equal(diagnostic.stage, stage);
    assert.equal(diagnostic.class, name);
    assert.equal(diagnostic.cause, 'Underlying failure');
    assert.equal(diagnostic.key, 'm/chap0/1.jpg');
    if (status) assert.equal(diagnostic.httpStatus, status);
    if (stage.startsWith('r2.')) assert.ok(diagnostic.hint);
});

test('catalogue read and discovery failures preserve stages', async () => {
    const options = { prefix: 'm/', scope: 'chapters', base: 'https://img.test', store: { list() { assert.fail('must not list'); } } };
    await assert.rejects(migrate({ ...options, catalogue: { read: async () => { throw new Error('Catalogue unavailable'); } } }), error => error.stage === 'catalogue.read' && error.message === 'Catalogue unavailable');
    await assert.rejects(migrate({ ...options, catalogue: { read: async () => ({ data: {} }) } }), error => error.stage === 'catalogue.discovery');
});

test('dry-run traces HEAD, GET, conversion and catalogue plan without any writes', async () => {
    const calls = [], logs = [];
    const failWrite = () => assert.fail('dry-run attempted a write');
    const stats = await migrate({ prefix: 'm/chap0/', scope: 'chapters', base: 'https://img.test', limit: 1,
        catalogue: { read: async () => { calls.push('catalogue'); return { data: { m: { chapters: [{ id: 0, pages: 1, folder: 'https://img.test/m/chap0' }] } } }; }, save: failWrite },
        store: { list: async prefix => { calls.push(`list:${prefix}`); return ['m/chap0/1.jpg']; }, head: async key => { calls.push(`head:${key}`); }, get: async key => { calls.push(`get:${key}`); return { bytes: Buffer.alloc(100) }; }, put: failWrite },
        encode: async () => { calls.push('convert'); return Buffer.alloc(40); }, journal: failWrite, log: value => logs.push(value)
    });
    assert.deepEqual(calls, ['catalogue', 'list:m/chap0/', 'head:m/chap0/1.jpg', 'get:m/chap0/1.jpg', 'convert']);
    assert.equal(stats.converted, 1);
    assert.ok(logs.some(line => line.includes('Would update catalogue: m.chapters[id=0].images[0] -> m/chap0/1.webp')));
});

test('configuration uses supplied process environment only', async () => {
    await assert.rejects(connect({ env: {} }), /Missing required environment variables: R2_PUBLIC_URL/);
});
