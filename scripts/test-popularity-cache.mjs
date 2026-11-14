import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = (await readFile(new URL('../assets/js/popularity.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const key = project => `helium:public-popularity:${encodeURIComponent(project)}:mangaStats:views-desc:v2`;
const plain = value => JSON.parse(JSON.stringify(value));
function page(state, storage, clock = () => 100000, project = 'preview-ranking') {
    const ctx = {db: {app: {options: {projectId: project}}}, Date: {now: clock}, sessionStorage: storage,
        collection: (db, name) => {assert.equal(name, 'mangaStats'); return name;},
        query: value => value, orderBy: (field, order) => {assert.equal(field, 'views'); assert.equal(order, 'desc');},
        getDocs: async () => {
            state.calls++;
            if (state.wait) await state.wait;
            if (state.fail) throw new Error('unavailable');
            return {metadata: {fromCache: !!state.offline}, docs: [{id: 'm',
                data: () => ({views: state.views ?? 42, uid: 'never-cache', role: 'admin', reports: ['private'], validViews: 99})}]};
        }};
    vm.createContext(ctx); vm.runInContext(source, ctx);
    return ctx.loadPopularity;
}
function storage() {
    const values = new Map();
    return {values, getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value)};
}
const record = (overrides = {}) => ({schema: 2, projectId: 'preview-ranking', at: 100000,
    stats: [{id: 'm', views: 42}], ...overrides});

test('concurrent requests coalesce and only public ids/counts are serialized', async () => {
    let resolve; const state = {calls: 0, wait: new Promise(done => {resolve = done;})}, cache = storage();
    const load = page(state, cache);
    assert.equal(load(), load()); assert.equal(state.calls, 1);
    resolve(); assert.deepEqual(plain(await load()), [{id: 'm', views: 42}]);
    assert.deepEqual(JSON.parse(cache.getItem(key('preview-ranking'))), record());
});

test('home-to-completed navigation reuses data, exact TTL expiry refreshes counts including in the same document', async () => {
    let time = 100000; const state = {calls: 0}, cache = storage();
    await page(state, cache, () => time)(); // home
    const completed = page(state, cache, () => time);
    state.views = 100;
    time = 159999; assert.equal((await completed())[0].views, 42);
    assert.equal(state.calls, 1);
    time = 160000;
    const one = completed(), two = completed(); assert.equal(one, two);
    assert.equal((await one)[0].views, 100); assert.equal(state.calls, 2);
    time = 220000; state.views = 200;
    assert.equal((await completed())[0].views, 200); assert.equal(state.calls, 3);
});

test('project and schema are in both key and payload, with no cross-project reuse', async () => {
    const cache = storage(), state = {calls: 0};
    await page(state, cache, undefined, 'project-a')();
    state.views = 84; await page(state, cache, undefined, 'project-b')();
    assert.equal(state.calls, 2);
    assert.equal((await page(state, cache, undefined, 'project-a')())[0].views, 42);
    assert.equal(state.calls, 2);
    cache.setItem(key('preview-ranking'), JSON.stringify(record({projectId: 'project-a'})));
    await page(state, cache)(); assert.equal(state.calls, 3);
});

test('broken JSON, wrong schema, bad timestamps and invalid stats trigger fresh reads', async () => {
    const invalid = ['broken', JSON.stringify(null), JSON.stringify(record({schema: 1})),
        JSON.stringify(record({at: 200000})), JSON.stringify(record({at: 40000})),
        JSON.stringify(record({at: '100000'})), JSON.stringify(record({at: null})),
        JSON.stringify(record({stats: null})), JSON.stringify(record({stats: [{id: '', views: 42}]})),
        JSON.stringify(record({stats: [{id: 'm', views: -1}]})), JSON.stringify(record({stats: [{id: 'm', views: '42'}]}))];
    for (const raw of invalid) {
        const cache = storage(), state = {calls: 0}; cache.setItem(key('preview-ranking'), raw);
        await page(state, cache)(); assert.equal(state.calls, 1);
    }
});

test('storage blocked or quota exceeded leaves ranking usable and memory TTL still expires', async () => {
    let time = 100000; const state = {calls: 0};
    const load = page(state, {getItem() {throw new Error('blocked');}, setItem() {throw new Error('quota');}}, () => time);
    assert.equal((await load())[0].views, 42);
    assert.equal((await load())[0].views, 42); assert.equal(state.calls, 1);
    time += 60000; state.views = 100;
    assert.equal((await load())[0].views, 100); assert.equal(state.calls, 2);
});

test('failed refresh never extends stale data and the next call can retry', async () => {
    let time = 100000; const state = {calls: 0}, cache = storage();
    const load = page(state, cache, () => time); await load();
    time += 60000; state.fail = true;
    await assert.rejects(load(), /unavailable/);
    assert.equal(JSON.parse(cache.getItem(key('preview-ranking'))).at, 100000);
    state.fail = false; state.views = 100;
    assert.equal((await load())[0].views, 100); assert.equal(state.calls, 3);
});

test('offline SDK snapshots are returned but never renewed as fresh shared cache', async () => {
    const state = {calls: 0, offline: true}, cache = storage(), load = page(state, cache);
    assert.equal((await load())[0].views, 42); assert.equal(cache.values.size, 0);
    state.offline = false; state.views = 100;
    assert.equal((await load())[0].views, 100); assert.equal(state.calls, 2);
});

test('storage extras are stripped and unknown project never uses a fallback shared key', async () => {
    const cache = storage(), state = {calls: 0};
    cache.setItem(key('preview-ranking'), JSON.stringify(record({stats: [{id: 'm', views: 42, uid: 'private', role: 'admin'}]})));
    assert.deepEqual(plain(await page(state, cache)()), [{id: 'm', views: 42}]); assert.equal(state.calls, 0);
    await page(state, cache, undefined, undefined)(); // default remains known project
    const unknown = page(state, cache, undefined, null);
    await unknown(); await unknown(); assert.equal(state.calls, 2);
    assert.equal([...cache.values.keys()].some(name => /null|undefined/.test(name)), false);
});

test('callers cannot pollute the shared memory cache through a returned array', async () => {
    const state = {calls: 0}, load = page(state, storage());
    const fresh = await load(); fresh[0].views = -1; fresh[0].uid = 'private';
    const cached = await load();
    assert.deepEqual(plain(cached), [{id: 'm', views: 42}]);
    cached.push({id: 'extra', views: 100, role: 'admin'});
    assert.deepEqual(plain(await load()), [{id: 'm', views: 42}]);
    assert.equal(state.calls, 1);
});
