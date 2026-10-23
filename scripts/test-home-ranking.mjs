import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const routes = new URL('../assets/js/route-urls.mjs', import.meta.url).href;
const cardURL = dataModule((await read('assets/js/manga-card.js')).replace('"./route-urls.mjs"', JSON.stringify(routes)));
const ranking = await import(dataModule((await read('assets/js/home-ranking.js'))
    .replace('"./route-urls.mjs"', JSON.stringify(routes))
    .replace('"./manga-card.js"', JSON.stringify(cardURL))));
const catalogue = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`m-${i}`, {
    title: `Manga ${i}`, cover: '/assets/images/helium_logo.webp', status: 'Ongoing'
}]));

test('filters invalid counts and stale IDs before sorting and selecting ten', () => {
    const stats = Object.keys(catalogue).map((id, i) => ({ id, views: i * 1000 }));
    stats.push({ id: 'deleted', views: 9999999 }, { id: 'm-0', views: -1 }, { id: 'm-0', views: NaN }, { id: 'm-0', views: '999' });
    const result = ranking.selectRanking(stats, catalogue);
    assert.equal(result.length, 10);
    assert.equal(result[0].id, 'm-14');
    assert.equal(result.at(-1).id, 'm-5');
    assert.equal(stats[0].id, 'm-0');
    for (let i = 1; i < result.length; i++) assert.ok(result[i - 1].views >= result[i].views);
    assert.deepEqual(ranking.selectRanking([{ id: 'm-0', views: 0 }], catalogue), [{ id: 'm-0', views: 0 }]);
});
test('fewer valid records render without invented entries or views', () => {
    const container = {};
    ranking.renderRanking(container, [{ id: 'm-1', views: 12540 }], catalogue);
    assert.equal((container.innerHTML.match(/class="ranking-card /g) || []).length, 1);
    assert.match(container.innerHTML, /12\.540/);
    assert.doesNotMatch(container.innerHTML, /ranking-runners/);
    ranking.renderRanking(container, [], catalogue);
    assert.match(container.innerHTML, /Chưa có dữ liệu/);
});
test('ten results split into three featured cards and seven compact rows', () => {
    const container = {};
    ranking.renderRanking(container, Object.keys(catalogue).map((id, i) => ({ id, views: i })), catalogue);
    assert.equal((container.innerHTML.match(/ranking-featured/g) || []).length, 3);
    assert.equal((container.innerHTML.match(/ranking-compact/g) || []).length, 7);
    assert.match(container.innerHTML, /aria-label="Hạng 10"/);
});
test('cards retain clean URLs, escape titles, translate only existing statuses', () => {
    const data = { example: { title: '<unsafe> "title"', status: 'Completed', cover: 'javascript:bad' } };
    const html = ranking.rankingCard({ id: 'example', views: 2565591 }, data, 0);
    assert.match(html, /href="\/manga\/example\/"/);
    assert.match(html, /2\.565\.591/);
    assert.match(html, /Completed/);
    assert.match(html, /&lt;unsafe&gt;/);
    assert.doesNotMatch(html, /javascript:/);
    data.example.status = 'Hiatus';
    assert.match(ranking.rankingCard({ id: 'example', views: 1 }, data, 1), /Drop/);
    data.example.status = 'unknown';
    assert.doesNotMatch(ranking.rankingCard({ id: 'example', views: 1 }, data, 1), /ranking-status/);
});
test('cover failures use existing logo fallback without an error loop', () => {
    let handler;
    ranking.installRankingFallback({ addEventListener(type, callback, capture) {
        assert.equal(type, 'error'); assert.equal(capture, true); handler = callback;
    } });
    const img = { matches: () => true, dataset: {}, src: 'broken' };
    handler({ target: img });
    assert.equal(img.src, '/assets/images/helium_logo.webp');
    handler({ target: img });
    assert.equal(img.hidden, true);
});
test('homepage reuses loaded catalogue, catches ranking failures and scopes styles', async () => {
    const source = await read('assets/js/script.js');
    assert.equal((source.match(/fetch\("\/assets\/data\/data.json"\)/g) || []).length, 1);
    assert.match(await read('assets/js/popularity.js'), /doc\.data\(\)\.views/);
    assert.match(source, /Chưa thể tải bảng xếp hạng/);
    const css = await read('assets/css/home-ranking.css');
    assert.match(css, /\[data-theme="dark"\] \.home-ranking/);
    assert.match(css, /max-width: 800px/);
    assert.match(css, /prefers-reduced-motion/);
});
