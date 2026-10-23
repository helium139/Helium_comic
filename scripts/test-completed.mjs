import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { completedEntries } from '../assets/js/completed-catalogue.mjs';
const catalogue = {
    a: { title: 'A', status: 'Completed', isRawCaughtUp: true, chapters: [{ createAt: '2025-01-01' }] },
    b: { title: 'B', status: 'Completed', chapters: [{ createAt: '2026-01-01' }] },
    c: { title: 'C', status: 'Completed' }, d: { title: 'D', status: 'Completed' },
    ongoing: { title: 'A ongoing', status: 'Ongoing', isRawCaughtUp: true },
    paused: { title: 'Paused', status: 'Hiatus' }, missing: { title: 'Missing' }
};
const stats = [{ id: 'a', views: 5000 }, { id: 'b', views: 70000 }, { id: 'c', views: 15000 }, { id: 'ongoing', views: 999999 }];
const ids = (...args) => completedEntries(...args).map(([id]) => id);
test('default filters actual publication status and sorts hottest first, missing counts last', () => {
    assert.deepEqual(ids(catalogue, stats), ['b', 'c', 'a', 'd']);
    assert.deepEqual(ids(catalogue, stats, 'ongoing'), []);
    assert.deepEqual(ids(catalogue, stats, 'a'), ['a']);
});
test('sorts remain deterministic without mutating catalogue or including ongoing manga', () => {
    const before = JSON.stringify(catalogue);
    assert.deepEqual(ids(catalogue, stats, '', 'az'), ['a','b','c','d']);
    assert.deepEqual(ids(catalogue, stats, '', 'za'), ['d','c','b','a']);
    assert.deepEqual(ids(catalogue, stats, '', 'updated'), ['b','a','c','d']);
    assert.deepEqual(ids(catalogue), ['a','b','c','d']);
    assert.deepEqual(ids(catalogue, [{ id: 'a', views: -1 }, { id: 'b', views: '100' }, { id: 'c', views: NaN }]), ['a','b','c','d']);
    assert.equal(JSON.stringify(catalogue), before);
    assert.deepEqual(ids({}), []);
});
test('real catalogue completed status is recognized and raw metadata is independent', async () => {
    const real = JSON.parse(await readFile(new URL('../assets/data/data.json', import.meta.url), 'utf8'));
    const result = completedEntries(real);
    assert.ok(result.length > 0);
    assert.ok(result.every(([, manga]) => manga.status === 'Completed'));
});
test('completed page reuses shared renderer and popularity source with explicit empty/error states', async () => {
    const source = await readFile(new URL('../assets/js/completed.js', import.meta.url), 'utf8');
    assert.match(source, /renderMangaCard/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /Hiện chưa có truyện hoàn thành/);
    assert.match(source, /Chưa thể tải lượt xem/);
    assert.match(source, /userWebTheme/);
    const homepage = await readFile(new URL('../assets/js/script.js', import.meta.url), 'utf8');
    assert.match(homepage, /await loadPopularity\(\)/);
});

test('shared popularity loader performs one query and retries failures', async () => {
    const vm = await import('node:vm');
    const source = (await readFile(new URL('../assets/js/popularity.js', import.meta.url), 'utf8'))
        .replace(/^import .*;$/gm, '').replace('export function', 'function');
    let calls = 0, fail = true;
    const context = { db: {}, collection: () => ({}), query: value => value, orderBy: () => ({}),
        getDocs: async () => { calls++; if (fail) throw Error('offline'); return { docs: [{ id: 'a', data: () => ({ views: 5000 }) }] }; } };
    vm.createContext(context); vm.runInContext(source, context);
    await assert.rejects(context.loadPopularity(), /offline/);
    fail = false;
    const one = context.loadPopularity(), two = context.loadPopularity();
    assert.equal(one, two);
    assert.equal((await one)[0].views, 5000);
    assert.equal(calls, 2);
});
