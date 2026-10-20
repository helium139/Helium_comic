import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { migrate, convert, references } from './migrate.mjs';

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
