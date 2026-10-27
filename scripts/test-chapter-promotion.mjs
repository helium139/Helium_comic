import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { promoteChapterPages } from '../worker/source/chapter-promotion.js';
globalThis.crypto ||= webcrypto;
const uuid = '6a294080-018b-4e4a-b5d2-1d945dba7afa';
function fixture(names) {
    const objects = new Map(), writes = [];
    let revision = 0;
    const store = (body, httpMetadata) => ({
        body: new Uint8Array(body),
        size: body.byteLength,
        etag: `etag-${++revision}`,
        httpMetadata
    });
    for (const [index, name] of names.entries()) {
        const ext = name.split('.').pop();
        const jpeg = ['jpg', 'jpeg'].includes(ext);
        const bytes = ext === 'webp' ? Buffer.from(`RIFF1234WEBP${index}`) : jpeg ? Buffer.from([255,216,255,index]) : Buffer.from([137,80,78,71,13,10,26,10,index]);
        objects.set(`m/chap1/${name}`, store(bytes, { contentType: `image/${jpeg ? 'jpeg' : ext}` }));
    }
    const bucket = {
        get: async key => objects.get(key),
        head: async key => {
            const object = objects.get(key);
            return object ? {
                size: object.size,
                etag: object.etag,
                httpMetadata: object.httpMetadata
            } : null;
        },
        put: async (key, bytes, options) => {
            assert.equal(options.onlyIf.etagDoesNotMatch, '*');
            if (objects.has(key)) return null;
            writes.push(key);
            const object = store(bytes, options.httpMetadata);
            objects.set(key, object);
            return { etag: object.etag, size: object.size };
        }, delete: () => assert.fail('must not delete')
    };
    return { objects, writes, bucket };
}
for (const extensions of [['webp','webp','webp'], ['jpg','webp','png']]) test(`final numbered keys preserve ${extensions.join('/')} extensions`, async () => {
    const names = extensions.map((ext, i) => `${i+1}-${uuid}.${ext}`), f = fixture(names);
    const result = await promoteChapterPages(f.bucket, 'm/chap1', names);
    assert.deepEqual(result, extensions.map((ext, i) => `${i+1}.${ext}`));
    assert.ok(result.every(name => !name.includes(uuid)));
    assert.ok(result.every(name => /^\d+\.(?:jpg|webp|png)$/.test(name)));
    for (const [index, name] of names.entries()) {
        const source = f.objects.get(`m/chap1/${name}`);
        const destination = f.objects.get(`m/chap1/${result[index]}`);
        assert.ok(source);
        assert.ok(destination);
        assert.deepEqual(destination.body, source.body);
        assert.equal(destination.size, source.size);
        assert.equal(destination.httpMetadata.contentType, source.httpMetadata.contentType);
    }
});
test('JPEG extension .jpeg is promoted as the canonical numbered .jpg', async () => {
    const name = `1-${uuid}.jpeg`, f = fixture([name]);
    assert.deepEqual(await promoteChapterPages(f.bucket, 'm/chap1', [name]), ['1.jpg']);
    assert.ok(f.objects.has('m/chap1/1.jpg'));
    assert.ok(!f.objects.has('m/chap1/1.jpeg'));
    assert.equal(f.objects.get('m/chap1/1.jpg').httpMetadata.contentType, 'image/jpeg');
});
test('reorder uses final display order', async () => {
    const names = [`1-${uuid}.jpg`, `2-${uuid}.png`], f = fixture(names);
    const result = await promoteChapterPages(f.bucket, 'm/chap1', [...names].reverse());
    assert.deepEqual(result, ['1.png', '2.jpg']);
    assert.deepEqual([...f.objects.get('m/chap1/1.png').body], [...f.objects.get(`m/chap1/${names[1]}`).body]);
});
test('all sources and collisions are validated before writing any final object', async () => {
    const names = [`1-${uuid}.jpg`, `2-${uuid}.jpg`], f = fixture(names);
    f.objects.delete(`m/chap1/${names[1]}`);
    await assert.rejects(promoteChapterPages(f.bucket, 'm/chap1', names));
    assert.deepEqual(f.writes, []);
    const g = fixture(names); g.objects.set('m/chap1/2.jpg', { ...g.objects.get(`m/chap1/${names[0]}`) });
    await assert.rejects(promoteChapterPages(g.bucket, 'm/chap1', names), /different content/);
    assert.deepEqual(g.writes, []);
});
test('existing identical numbered page can be reused without overwrite', async () => {
    const f = fixture(['1.webp']);
    assert.deepEqual(await promoteChapterPages(f.bucket, 'm/chap1', ['1.webp']), ['1.webp']);
    assert.deepEqual(f.writes, []);
});
test('concurrent creation loses safely rather than overwriting', async () => {
    const names = [`1-${uuid}.jpg`], f = fixture(names); f.bucket.put = async () => null;
    await assert.rejects(promoteChapterPages(f.bucket, 'm/chap1', names), /changed during promotion/);
    assert.ok(f.objects.has(`m/chap1/${names[0]}`));
});
test('traversal and arbitrary source paths cannot reach R2', async () => {
    const f = fixture([]);
    for (const folder of ['../other', 'm/../other', 'm/chap1/extra', 'm']) await assert.rejects(promoteChapterPages(f.bucket, folder, ['1.jpg']));
    for (const name of ['../1.jpg', 'other/1.jpg', '%2e%2e.jpg']) await assert.rejects(promoteChapterPages(f.bucket, 'm/chap1', [name]));
    assert.deepEqual(f.writes, []);
});
