import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const esm = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const helpers = await esm(await read('assets/js/team-catalogue.js'));
const cards = await esm((await read('assets/js/manga-card.js')).replace('"./route-urls.mjs"', JSON.stringify(new URL('../assets/js/route-urls.mjs', import.meta.url).href)));

test('stable ownership excludes unassigned, legacy-only and other teams', () => {
    const catalogue = { a: { teamId: 'one', team: 'Old Name' }, b: {}, c: { team: 'one' }, d: { teamId: 'two' } };
    assert.deepEqual(helpers.teamManga(catalogue, 'one').map(([id]) => id), ['a']);
    catalogue.e = { teamId: 'one' };
    assert.equal(helpers.teamManga(catalogue, 'one').length, 2);
});
test('latest update uses valid chapter dates and never mutates input', () => {
    const entries = [['empty', {}], ['old', { chapters: [{ createAt: '2024-01-01' }] }], ['new', { chapters: [{ createAt: '2026-01-01' }, { createAt: 'bad' }] }]];
    assert.deepEqual(helpers.sortTeamManga(entries).map(([id]) => id), ['new', 'old', 'empty']);
    assert.equal(entries[0][0], 'empty');
    assert.equal(helpers.getUpdateTime({ chapters: [{ createAt: 'bad' }] }), 0);
});
test('query validation accepts stable IDs and rejects malformed or missing IDs', () => {
    for (const id of [null, '', '../x', '<script>', 'UPPER', 'a b', 'a--b']) assert.equal(helpers.validTeamId(id), false);
    assert.equal(helpers.validTeamId('heliumtg'), true);
});
test('shared cards retain routes, badges and safe empty-chapter rendering', () => {
    const html = cards.renderMangaCard('example', { title: '<unsafe>', status: 'Completed', cover: 'javascript:alert(1)' });
    assert.match(html, /href="\/manga\/example\/"/);
    assert.match(html, /comic-end-badge/);
    assert.match(html, /&lt;unsafe&gt;/);
    assert.match(html, /Chưa có chapter/);
    assert.doesNotMatch(html, /javascript:/);
});
test('real catalogue counts derive from existing stable assignments', async () => {
    const catalogue = JSON.parse(await read('assets/data/data.json'));
    const teams = JSON.parse(await read('assets/data/teams.json'));
    assert.ok(helpers.teamManga(catalogue, 'heliumtg').length > 0);
    for (const team of teams) {
        assert.equal('mangaCount' in team, false);
        assert.equal('latestManga' in team, false);
    }
});
