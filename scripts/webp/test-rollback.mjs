import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rollback } from './rollback.mjs';
const original = Buffer.from('original');
function fixture(scope = 'chapters') {
    let data = { m: { cover: 'https://img.test/m/cover.webp', title: 'Keep later edits',
        chapters: [{ id: 0, pages: 2, folder: 'https://img.test/m/chap0', images: ['1.webp', '2.jpg'] }] } };
    let writes = 0, backedUp = false;
    const key = scope === 'chapters' ? 'm/chap0/1.jpg' : 'm/cover.png';
    const entry = { key, destination: key.replace(/\.[^.]+$/, '.webp'), slug: 'm', ...(scope === 'chapters' ? { id: 0, index: 0 } : {}), originalHash: createHash('sha256').update(original).digest('hex') };
    const options = { entries: [entry], scope, prefix: 'm/', base: 'https://img.test', log() {},
        store: { get: async () => ({ bytes: original }) }, backup: async () => { backedUp = true; },
        catalogue: { read: async () => ({ sha: 'live-sha', data: structuredClone(data) }), save: async snapshot => {
            assert.equal(backedUp, true); assert.equal(snapshot.sha, 'live-sha'); writes++; data = snapshot.data;
        } }
    };
    return { options, data: () => data, writes: () => writes };
}
test('rollback dry run performs no catalogue writes', async () => {
    const f = fixture(); assert.equal((await rollback(f.options)).restored, 1); assert.equal(f.writes(), 0);
    assert.equal(f.data().m.chapters[0].images[0], '1.webp');
});
for (const scope of ['chapters', 'covers']) test(`rollback ${scope} restores exact references and preserves unrelated edits`, async () => {
    const f = fixture(scope); await rollback({ ...f.options, apply: true });
    assert.equal(f.data().m.title, 'Keep later edits');
    assert.equal(scope === 'chapters' ? f.data().m.chapters[0].images[0] : f.data().m.cover, scope === 'chapters' ? '1.jpg' : 'https://img.test/m/cover.png');
    assert.equal((await rollback({ ...f.options, apply: true })).unchanged, 1); assert.equal(f.writes(), 1);
});
test('rollback refuses changed originals and saves no partial metadata', async () => {
    const f = fixture(); f.options.store.get = async () => ({ bytes: Buffer.from('changed') });
    await assert.rejects(rollback({ ...f.options, apply: true }), /Original no longer matches/); assert.equal(f.writes(), 0);
});
test('rollback refuses later reference changes', async () => {
    const f = fixture();
    const read = f.options.catalogue.read;
    f.options.catalogue.read = async () => { const snapshot = await read(); snapshot.data.m.chapters[0].images[0] = '1.png'; return snapshot; };
    await assert.rejects(rollback({ ...f.options, apply: true }), /Reference changed/); assert.equal(f.writes(), 0);
});
