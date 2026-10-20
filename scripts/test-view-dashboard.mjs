import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../admin/view-analytics.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
function node() { return { children: [], events: {}, value: 'all', hidden: false,
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    addEventListener(type, callback) { this.events[type] = callback; }, setAttribute() {}, remove() {} }; }
function harness(staff, call) {
    const elements = new Map(); const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
    const context = { window: {}, getViewAnalytics: call,
        getMonthlyViewDashboard: async data => { const result = await call(data); return {...result, currentPeriod: result.month || '2026-10', previousPeriod:'2026-09', previousMonthly:result.previousMonthly ?? 0, serverNow:1, nextBoundary:2}; },
        createMonthRollover: () => ({sync() {},dispose() {}}), document: { getElementById: get, createElement: node } };
    vm.createContext(context); vm.runInContext(source, context);
    return { get, analytics: context.createDashboardAnalytics({ staff, teams: [{ id: 'heliumtg', name: 'HeliumTG' }], catalogue: {} }) };
}

test('aggregate cards and lazy team -> manga -> chapter expansion use scoped callable data', async () => {
    const requests = [];
    const h = harness({ role: 'admin' }, async data => {
        requests.push(data);
        const kind = data.scopeId === 'site' ? 'team' : data.scopeId.startsWith('team:') ? 'manga' : 'chapter';
        return { active: true, activationAt: 1, total: 42, monthly: 9, month: '2026-10', nextCursor: null,
            children: data.includeChildren ? [{ kind, scopeId: kind === 'team' ? 'team:heliumtg' : kind === 'manga' ? 'manga:heliumtg:m' : 'chapter:heliumtg:m:0',
                teamId: 'heliumtg', mangaId: 'm', chapterId: '0', validViews: 42 }] : [] };
    });
    await h.analytics.update('all');
    assert.equal(h.get('total-valid-views').textContent, '42');
    assert.equal(h.get('monthly-valid-views').textContent, '9');
    assert.equal(requests.length, 1);
    await h.get('view-analytics-expand').events.click();
    assert.equal(requests[1].scopeId, 'site');
    const team = h.get('view-analytics-tree').children[0];
    await team.children[0].events.click();
    assert.equal(requests[2].scopeId, 'team:heliumtg');
    const manga = team.children[1].children[0];
    await manga.children[0].events.click();
    assert.equal(requests[3].scopeId, 'manga:heliumtg:m');
});

test('leader requests stay fixed to own team; inactive/error states do not invent zeros', async () => {
    const requests = [];
    const h = harness({ role: 'team_leader', teamId: 'heliumtg' }, async data => {
        requests.push(data); return { active: false, total: 0, monthly: 0 };
    });
    await h.analytics.update('other');
    assert.equal(requests[0].scopeId, 'team:heliumtg');
    assert.equal(h.get('total-valid-views').textContent, 'Not active yet');
    const unavailable = harness({ role: 'admin' }, async () => { throw { code: 'functions/unavailable' }; });
    await unavailable.analytics.update('all');
    assert.equal(unavailable.get('total-valid-views').textContent, 'Unavailable');
});

test('late responses from a previous scope cannot overwrite current aggregate cards', async () => {
    let resolveOld;
    const h = harness({ role: 'admin' }, data => data.scopeId === 'site' ? new Promise(resolve => { resolveOld = resolve; }) :
        Promise.resolve({ active: true, total: 2, monthly: 1, month: '2026-10', activationAt: 1 }));
    const old = h.analytics.update('all');
    await h.analytics.update('heliumtg');
    resolveOld({ active: true, total: 999, monthly: 999, month: '2026-10', activationAt: 1 }); await old;
    assert.equal(h.get('total-valid-views').textContent, '2');
});
