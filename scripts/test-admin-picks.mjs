import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderedPicks, setPick } from '../assets/js/admin-picks-order.mjs';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const routes = new URL('../assets/js/route-urls.mjs', import.meta.url).href;
const cardURL = moduleURL((await read('assets/js/manga-card.js')).replace('"./route-urls.mjs"', JSON.stringify(routes)));
const cards = await import(cardURL);
const picks = await import(moduleURL((await read('assets/js/admin-picks.js'))
    .replace('"./route-urls.mjs"', JSON.stringify(routes))
    .replace('"./manga-card.js"', JSON.stringify(cardURL))
    .replace('"./admin-picks-order.mjs"', JSON.stringify(new URL('../assets/js/admin-picks-order.mjs', import.meta.url).href))));

test('FIFO preserves existing order, caps at ten, and only removes deselected item', () => {
    const catalogue = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`m-${i}`, {}]));
    for (let i = 0; i < 11; i++) setPick(catalogue, `m-${i}`, true);
    assert.deepEqual(orderedPicks(catalogue).map(([id]) => id), Array.from({ length: 10 }, (_, i) => `m-${i + 1}`));
    assert.equal(catalogue['m-0'].adminPick, false);
    const before = orderedPicks(catalogue).map(([id]) => id);
    setPick(catalogue, 'm-5', true);
    assert.deepEqual(orderedPicks(catalogue).map(([id]) => id), before);
    setPick(catalogue, 'm-5', false);
    assert.deepEqual(orderedPicks(catalogue).map(([id]) => id), before.filter(id => id !== 'm-5'));
});
test('legacy ordering typo is supported without a new persisted source', () => {
    assert.deepEqual(orderedPicks({ b: { adminPick: true, pickOder: 2 }, a: { adminPick: true, pickOrder: 1 } }).map(([id]) => id), ['a', 'b']);
});
test('raw badge is strict boolean and ordinary cards keep their publication status', () => {
    for (const value of [undefined, false, 'true']) assert.equal(cards.rawBadge({ isRawCaughtUp: value }), '');
    assert.match(cards.renderMangaCard('a', { title: 'A', status: 'Completed', isRawCaughtUp: true }), /Ngang Raw/);
    assert.match(cards.renderMangaCard('a', { title: 'A', status: 'Completed', isRawCaughtUp: true }), /comic-end-badge/);
});
test('carousel loops in both directions and handles one or zero slides', () => {
    assert.equal(picks.nextSlide(9, 1, 10), 0);
    assert.equal(picks.nextSlide(0, -1, 10), 9);
    assert.equal(picks.nextSlide(0, 1, 1), 0);
    assert.equal(picks.nextSlide(0, 1, 0), 0);
});
test('featured metadata is escaped, routes reused, inactive slides hidden', () => {
    const html = picks.featuredSlide('example', { title: '<unsafe>', author: 'Author', team: 'Team', cover: 'javascript:bad', description: '<b>Hello</b>', tags: ['<tag>'], status: 'Ongoing', isRawCaughtUp: true }, 1, 3);
    assert.match(html, /hidden/);
    assert.match(html, /&lt;unsafe&gt;/);
    assert.match(html, /href="\/manga\/example\/"/);
    assert.match(html, /Ngang Raw/);
    assert.match(html, /Hello/);
    assert.doesNotMatch(html, /<b>|javascript:/);
    assert.match(html, /helium_logo.webp/);
});
test('single-item carousel omits timers and hides controls', () => {
    const root = { innerHTML: '', querySelectorAll: () => [{ querySelector: () => ({ style: {} }) }], addEventListener() {} };
    const previous = globalThis.document;
    globalThis.document = { getElementById: () => root };
    try {
        picks.renderAdminPicks({ a: { adminPick: true, pickOrder: 1, title: 'Only' } });
        assert.match(root.innerHTML, /class="pick-controls" hidden/);
        picks.renderAdminPicks({});
        assert.match(root.innerHTML, /Chưa có lựa chọn/);
    } finally { globalThis.document = previous; }
});
test('carousel CSS supports mobile stacking, dark mode, reduced motion and hidden slides', async () => {
    const css = await read('assets/css/admin-picks.css');
    for (const pattern of [/data-theme="dark"/, /max-width: 700px/, /grid-template-columns: minmax\(0, 1fr\)/, /prefers-reduced-motion/, /\.pick-slide\[hidden\]/]) assert.match(css, pattern);
});
