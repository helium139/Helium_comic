import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildDashboardModel, getDashboardScope, chapterDate, utcMonthBounds } from '../admin/dashboard-data.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const strip = source => source.replace(/^import[\s\S]*?from\s*"[^"]+";\s*/gm, '');
const staffHelpers = await import('data:text/javascript;base64,' + Buffer.from(strip(await read('assets/js/staff-access.js'))).toString('base64'));
const admin = { uid: 'admin', role: 'admin', teamId: null };
const leader = { uid: 'leader', role: 'team_leader', teamId: 'heliumtg' };
const teams = [
    { id: 'heliumtg', name: 'HeliumTG', active: true },
    { id: 'testteam', name: 'Test Team', active: true },
    { id: 'empty', name: 'Empty Team', active: false }
];
const now = new Date('2026-10-19T10:00:00Z');
const catalogue = {
    own: { title: 'Alpha', teamId: 'heliumtg', status: 'Ongoing', cover: 'own.webp', chapters: [
        { id: 0, title: 'Newest date', createAt: '2026-10-01T00:00:00Z' },
        { id: 1, title: 'Older date', createAt: '2026-09-30T23:59:59Z' }
    ] },
    other: { title: 'Beta', teamId: 'testteam', status: 'Completed', cover: 'other.webp', chapters: [
        { id: 1, title: 'October', createAt: '2026-10-10T10:30:00.123Z' },
        { id: 2, title: 'November', createAt: '2026-11-01T00:00:00Z' }
    ] }
};

test('UTC month boundaries are start-inclusive/end-exclusive with explicit offset handling', () => {
    const dates = ['2026-09-30T23:59:59.999Z', '2026-10-01T00:00:00Z', '2026-10-31T23:59:59.999Z',
        '2026-11-01T00:00:00Z', '2026-09-30T23:30:00-02:00', '2026-10-01T00:30:00+02:00'];
    const data = { test: { title: 'Test', teamId: 'heliumtg', chapters: dates.map(createAt => ({ createAt })) } };
    const model = buildDashboardModel(admin, data, teams, 'all', now);
    assert.equal(model.monthlyChapters, 3);
    assert.equal(model.month.key, '2026-10');
    const yearEnd = utcMonthBounds(new Date('2026-12-31T23:59:59Z'));
    assert.equal(new Date(yearEnd.end).toISOString(), '2027-01-01T00:00:00.000Z');
    assert.equal(utcMonthBounds(new Date('2026-11-01T00:00:00+02:00')).key, '2026-10');
});

test('malformed/missing/ambiguous dates are excluded and reported; valid date-only values use UTC', () => {
    for (const date of [undefined, null, '', 'not-a-date', '2026-10-01T00:00:00', '2026-02-30T00:00:00Z',
        '2025-02-29', '2026-13-01', '2026-10-01T25:00:00Z']) assert.equal(chapterDate(date), null, String(date));
    assert.equal(chapterDate('2024-02-29'), Date.parse('2024-02-29T00:00:00Z'));
    const data = { test: { title: 'Test', teamId: 'heliumtg', chapters: [
        { createAt: '2026-10-01' }, { createAt: 'broken' }, {}
    ] } };
    const model = buildDashboardModel(admin, data, teams, 'all', now);
    assert.equal(model.monthlyChapters, 1);
    assert.equal(model.invalidDates, 2);
});

test('admin scope includes all or selected teams; leaders cannot override their fixed scope', () => {
    const before = structuredClone(catalogue);
    assert.equal(getDashboardScope(admin, undefined, teams), 'all');
    assert.equal(buildDashboardModel(admin, catalogue, teams, 'all', now).mangaCount, 2);
    const scoped = buildDashboardModel(admin, catalogue, teams, 'testteam', now);
    assert.equal(scoped.mangaCount, 1);
    assert.equal(scoped.monthlyChapters, 1);
    assert.equal(scoped.mangas[0].team.name, 'Test Team');
    assert.equal(buildDashboardModel(admin, catalogue, teams, 'empty', now).mangaCount, 0);
    for (const requested of ['all', 'testteam', 'unknown']) {
        const own = buildDashboardModel(leader, catalogue, teams, requested, now);
        assert.equal(own.scope, 'heliumtg');
        assert.equal(own.mangaCount, 1);
        assert.equal(own.mangas[0].slug, 'own');
    }
    assert.throws(() => getDashboardScope({ role: 'user' }, 'all', teams), /Staff access/);
    assert.throws(() => getDashboardScope({ role: 'team_leader' }, 'all', teams), /Unknown/);
    assert.throws(() => getDashboardScope(admin, 'unknown', teams), /Unknown/);
    assert.deepEqual(catalogue, before); // Scope and date calculations never mutate content.
});

test('list chapter totals use catalogue arrays and last update uses latest valid timestamp', () => {
    const model = buildDashboardModel(admin, catalogue, teams, 'all', now);
    assert.equal(model.mangas[0].chapterCount, 2);
    assert.equal(model.mangas[0].latestChapter.id, 0);
    const empty = buildDashboardModel(admin, { empty: { title: 'Empty', teamId: 'heliumtg', chapters: [] } }, teams, 'all', now);
    assert.equal(empty.mangas[0].latestDate, null);
    assert.equal(empty.mangas[0].latestChapter, null);
    assert.throws(() => buildDashboardModel(admin, { bad: { teamId: 'unknown' } }, teams, 'all', now), /Unknown manga team ownership/);
});

function dom() {
    const nodes = new Map();
    const element = tag => ({
        tag, textContent: '', hidden: false, disabled: false, value: '', children: [], attributes: {}, events: {},
        appendChild(child) { this.children.push(child); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(type, callback) { this.events[type] = callback; }
    });
    const get = id => { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); };
    get('team-filter-container').hidden = true;
    get('dashboard-team').disabled = true;
    get('dashboard-content').hidden = true;
    return { get, document: { getElementById: get, createElement: element } };
}

async function dashboard(staff, { failFetch = false, deny = false } = {}) {
    const d = dom(), requests = [], errors = [];
    let guarded = false;
    const context = { document: d.document,
        requireStaff: async () => { if (deny) throw new Error('Staff access required'); guarded = true; return staff; },
        getTeams: async () => { assert.equal(guarded, true); requests.push('teams'); return teams; },
        fetch: async url => { assert.equal(guarded, true); requests.push(url); return { ok: !failFetch, json: async () => catalogue }; },
        scopeMangas: staffHelpers.scopeMangas, assertCanManageManga: staffHelpers.assertCanManageManga,
        showStaffAccessError: error => errors.push(error),
        createDashboardAnalytics: () => ({ update() {} }),
        getDashboardScope,
        buildDashboardModel: (...args) => buildDashboardModel(...args, now)
    };
    vm.createContext(context);
    const promise = vm.runInContext('(async () => {' + strip(await read('admin/dashboard.js')) + '})()', context);
    if (deny) await assert.rejects(promise, /Staff access/); else await promise;
    return { ...d, requests, errors };
}
const editLink = row => row.children.at(-1).children[0];

test('admin selector updates both cards and table locally without additional requests', async () => {
    const d = await dashboard(admin);
    assert.equal(d.errors.length, 0);
    assert.equal(d.get('total-manga').textContent, '2');
    assert.equal(d.get('monthly-chapters').textContent, '2');
    assert.equal(d.get('team-filter-container').hidden, false);
    assert.equal(d.get('dashboard-team').children.length, 4);
    assert.equal(d.get('dashboard-team').children[0].textContent, 'All Teams');
    const filter = d.get('dashboard-team');
    filter.value = 'testteam'; filter.events.change();
    assert.equal(d.get('total-manga').textContent, '1');
    assert.equal(d.get('monthly-chapters').textContent, '1');
    assert.equal(d.get('dashboard-scope').textContent, 'Team: Test Team');
    assert.equal(editLink(d.get('manga-list').children[0]).href, '/admin/manga/?manga=other');
    filter.value = 'empty'; filter.events.change();
    assert.equal(d.get('total-manga').textContent, '0');
    assert.equal(d.get('monthly-chapters').textContent, '0');
    assert.equal(d.get('manga-list').children.length, 0);
    assert.equal(d.get('dashboard-empty').hidden, false);
    filter.value = 'all'; filter.events.change();
    assert.equal(d.get('total-manga').textContent, '2');
    assert.equal(d.get('dashboard-empty').hidden, true);
    assert.deepEqual(d.requests, ['teams', '/assets/data/data.json']);
    assert.equal(d.get('dashboard-content').hidden, false);
    assert.equal(d.get('dashboard').attributes['aria-busy'], 'false');
});

test('leader table and cards have fixed own-team scope; no All Teams options or foreign links', async () => {
    const d = await dashboard(leader);
    assert.equal(d.errors.length, 0);
    assert.equal(d.get('dashboard-title').textContent, 'Team Dashboard');
    assert.equal(d.get('dashboard-scope').textContent, 'Team: HeliumTG');
    assert.equal(d.get('total-manga').textContent, '1');
    assert.equal(d.get('monthly-chapters').textContent, '1');
    assert.equal(d.get('team-filter-container').hidden, true);
    assert.equal(d.get('dashboard-team').disabled, true);
    assert.equal(d.get('dashboard-team').children.length, 0);
    assert.equal(d.get('dashboard-team').events.change, undefined);
    const rows = d.get('manga-list').children;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].children[1].textContent, 'HeliumTG');
    assert.equal(editLink(rows[0]).href, '/admin/manga/?manga=own');
});

test('guard/fetch failures do not display misleading zero counts; placeholders do not load Firestore', async () => {
    const denied = await dashboard(admin, { deny: true });
    assert.deepEqual(denied.requests, []);
    const failed = await dashboard(admin, { failFetch: true });
    assert.equal(failed.errors.length, 1);
    assert.equal(failed.get('dashboard-content').hidden, true);
    const markup = await read('admin/index.html');
    assert.match(markup, /id="total-valid-views"/);
    assert.match(markup, /id="monthly-valid-views"/);
    assert.match(markup, /Available in Phase 4/);
    const source = await read('admin/dashboard.js');
    assert.doesNotMatch(source, /firebase-firestore|mangaStats|onSnapshot|getDocs|getCountFromServer|increment\(/);
});
