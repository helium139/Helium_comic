import { paginateMangas, renderPagination } from '../admin/pagination.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const strip = source => source.replace(/^import[\s\S]*?from\s*"[^"]+";\s*/gm, '').replace(/export /g, '');
const registry = [
    { id: 'heliumtg', name: 'HeliumTG', active: true },
    { id: 'other-team', name: 'Other Team', active: true }
];
const admin = { uid: 'admin', role: 'admin', teamId: null };
const leader = { uid: 'leader', role: 'team_leader', teamId: 'heliumtg' };
const fixtures = {
    own: { teamId: 'heliumtg', title: 'Own manga', author: 'Own author', cover: 'own.webp', status: 'Ongoing', tags: [], adminPick: true, pickOrder: 4,
        chapters: [{ id: 0, title: 'Prologue', pages: 1, createAt: '2026-01-01', folder: 'own/chap0' }] },
    other: { teamId: 'other-team', title: 'Other manga', author: 'Other author', cover: 'other.webp', status: 'Completed', tags: [],
        chapters: [{ id: 0, title: 'Other prologue', pages: 1, createAt: '2026-01-01', folder: 'other/chap0' }] },
    legacy: { team: 'HeliumTG', title: 'Legacy without ownership', status: 'Ongoing', chapters: [], tags: [] }
};
function identity(role, teamId) {
    return { uid: role, getIdTokenResult: async () => ({ claims: { role, ...(teamId ? { teamId } : {}) } }) };
}
const helpersContext = { serverTimestamp() {}, getTeamById: async id => {
    const team = registry.find(team => team.id === id);
    if (!team) throw new Error('Unknown team ownership');
    return team;
} };
vm.createContext(helpersContext);
vm.runInContext(strip(await read('assets/js/user-profile.js')), helpersContext);
vm.runInContext(strip(await read('assets/js/staff-access.js')), helpersContext);
const helpers = helpersContext;

function dom() {
    const nodes = new Map();
    function node(tag = 'div') {
        const classes = new Set();
        return {
            tag, events: {}, value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, children: [],
            classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
            append(...children) { for (const child of children) this.appendChild(child); },
            appendChild(child) { child.parent = this; this.children.push(child); if (child.id) nodes.set(child.id, child); },
            replaceChildren(...children) { this.children = []; this.append(...children); },
            addEventListener(type, callback) { this.events[type] = callback; }, setAttribute(key, value) { this[key] = value; },
            remove() { nodes.delete(this.id); if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
        };
    }
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, node());
        return nodes.get(id);
    };
    const document = {
        getElementById: id => ['staff-nav-link', 'staff-access-status'].includes(id) ? nodes.get(id) || null : get(id),
        createElement: node, querySelector: selector => get(selector), addEventListener() {}, querySelectorAll: () => []
    };
    return { document, get, nodes };
}

test('claims determine staff context; Firestore mismatch, missing claim and missing team fail closed', async () => {
    for (const [role, teamId] of [['admin', undefined], ['team_leader', 'heliumtg']]) {
        let calls = 0;
        const user = identity(role, teamId);
        const tokenResult = user.getIdTokenResult;
        user.getIdTokenResult = async () => { calls++; return tokenResult(); };
        const context = await helpers.getStaffContext(user, { role, ...(teamId ? { teamId } : {}) });
        assert.equal(context.role, role);
        assert.equal(context.teamId, teamId || null);
        assert.equal(calls, 1);
    }
    await assert.rejects(helpers.getStaffContext(identity('user'), { role: 'user' }), error => error.code === 'staff/forbidden');
    await assert.rejects(helpers.getStaffContext(identity(undefined), { role: 'team_leader', teamId: 'heliumtg' }), error => error.code === 'staff/stale-token');
    await assert.rejects(helpers.getStaffContext(identity('team_leader', 'other-team'), { role: 'team_leader', teamId: 'heliumtg' }), error => error.code === 'staff/stale-token');
    await assert.rejects(helpers.getStaffContext(identity('team_leader'), { role: 'team_leader' }), /teamId/);
    await assert.rejects(helpers.getStaffContext(identity('admin'), { role: 'user' }), error => error.code === 'staff/stale-token');
});

test('navigation shows one staff link only for claim-consistent admins/leaders, including logout/account changes', async () => {
    for (const [role, teamId] of [['admin', null], ['team_leader', 'heliumtg'], ['user', null], ['stale', null]]) {
        const d = dom();
        const user = identity(role === 'stale' ? undefined : role, teamId);
        const profile = role === 'stale' ? { role: 'team_leader', teamId: 'heliumtg' } : { role, teamId };
        const context = { ...d, auth: { currentUser: user }, getStaffContext: helpers.getStaffContext };
        vm.createContext(context);
        vm.runInContext(strip(await read('assets/js/staff-navigation.js')), context);
        await context.updateStaffNavigation(user, profile);
        const link = d.nodes.get('staff-nav-link');
        assert.equal(!!link, ['admin', 'team_leader'].includes(role), role);
        if (link) {
            assert.equal(link.href, '/admin/');
            await context.updateStaffNavigation(user, profile);
            assert.equal(d.get('.navigation').children.length, 1);
        }
        if (role === 'stale') assert.match(d.nodes.get('staff-access-status').textContent, /token/);
        context.clearStaffNavigation();
        assert.equal(d.nodes.has('staff-nav-link'), false);
    }
    const d = dom();
    let complete;
    const oldUser = { uid: 'old', getIdTokenResult: () => new Promise(resolve => { complete = resolve; }) };
    const context = { ...d, auth: { currentUser: oldUser }, getStaffContext: helpers.getStaffContext };
    vm.createContext(context);
    vm.runInContext(strip(await read('assets/js/staff-navigation.js')), context);
    const pending = context.updateStaffNavigation(oldUser, { role: 'admin' });
    context.auth.currentUser = identity('user');
    context.clearStaffNavigation();
    complete({ claims: { role: 'admin' } });
    await pending;
    assert.equal(d.nodes.has('staff-nav-link'), false);
});

test('guard accepts both staff roles and denies users/guests/stale tokens before page initialization', async () => {
    for (const kind of ['admin', 'team_leader', 'user', 'guest', 'stale', 'missing-team']) {
        const user = kind === 'guest' ? null : identity(kind === 'stale' ? undefined : kind === 'missing-team' ? 'team_leader' : kind,
            kind === 'team_leader' ? 'heliumtg' : undefined);
        const profile = kind === 'stale' ? { role: 'team_leader', teamId: 'heliumtg' }
            : { role: kind === 'missing-team' ? 'team_leader' : kind, ...(kind === 'team_leader' ? { teamId: 'heliumtg' } : {}) };
        const errors = [];
        const context = {
            auth: { currentUser: user }, location: {},
            onAuthStateChanged(auth, callback) { queueMicrotask(() => callback(user)); },
            getUserSnapshot: async () => ({ data: () => profile }),
            getStaffContext: helpers.getStaffContext, showStaffAccessError: error => errors.push(error)
        };
        vm.createContext(context);
        vm.runInContext(strip(await read('assets/js/adminGuard.js')), context);
        if (['admin', 'team_leader'].includes(kind)) {
            const staff = await context.requireStaff();
            assert.equal(staff.role, kind);
            assert.equal(staff.teamId, kind === 'team_leader' ? 'heliumtg' : null);
            assert.equal(errors.length, 0);
        } else {
            await assert.rejects(context.requireStaff());
            assert.equal(errors.length, 1);
            if (kind === 'guest') assert.equal(context.location.href, '/login/');
            if (kind === 'user') assert.equal(context.location.href, '/');
            if (kind === 'stale') assert.equal(errors[0].code, 'staff/stale-token');
            if (kind === 'missing-team') assert.match(errors[0].message, /teamId/);
        }
    }
});

// Dashboard scope/card/table integration is covered by test-dashboard.mjs.

async function editor(file, staff, search, fixtureData = fixtures) {
    const d = dom(), errors = [], calls = [];
    const catalogue = structuredClone(fixtureData);
    let guarded = false;
    const context = { ...d, URLSearchParams, location: { search },
        paginateMangas, renderPagination: (container, model, callback) => renderPagination(container, model, callback, d.document),
        requireStaff: async () => { guarded = true; return staff; },
        getMangas: async () => { assert.equal(guarded, true); return catalogue; },
        scopeMangas: helpers.scopeMangas, assertCanManageManga: helpers.assertCanManageManga,
        showStaffAccessError: error => errors.push(error),
        getTeams: async () => registry,
        resolveMangaTeam: manga => registry.find(team => team.id === (manga.teamId || 'heliumtg')),
        getTeamById: helpersContext.getTeamById,
        newManga: async body => calls.push(['new', body]), editManga: async body => calls.push(['edit', body]),
        publishChapter: async body => calls.push(['chapter', body]),
        Sortable: { create: () => ({ destroy() {} }) },
        chapterUrl: (slug, id) => `/manga/${slug}/chapter/${id}/`,
        alert() {}, confirm: () => true, console
    };
    vm.createContext(context);
    const extra = file === 'admin/manga.js'
        ? '\nreturn { openEditor, openNew, saveCurrent, scope: () => mangas };'
        : '\nreturn { scope: () => mangas, uploadChapter };';
    const api = await vm.runInContext('(async () => {' + strip(await read(file)) + extra + '})()', context);
    return { ...d, context, api, errors, calls };
}

test('manga editor scopes lists, locks leader team/editorial controls, and forces safe submission values', async () => {
    const own = await editor('admin/manga.js', leader, '?manga=own');
    assert.equal(own.errors.length, 0);
    assert.deepEqual(Object.keys(own.api.scope()), ['own']);
    assert.equal(own.get('title').value, 'Own manga');
    assert.equal(own.get('team').disabled, true);
    assert.equal(own.get('team').children.length, 1);
    assert.equal(own.get('adminPick').disabled, true);
    assert.equal(own.get('pickOrder').disabled, true);
    own.get('team').value = 'other-team';
    own.get('adminPick').checked = false;
    own.get('pickOrder').value = '1';
    await own.api.saveCurrent();
    assert.equal(own.calls[0][1].teamId, 'heliumtg');
    assert.equal(own.calls[0][1].adminPick, true);
    assert.equal(own.calls[0][1].pickOrder, 4);
    assert.deepEqual(Object.keys(own.api.scope()), ['own']);
    own.api.openNew();
    assert.equal(own.get('team').value, 'heliumtg');
    own.get('title').value = 'New';
    own.get('slug').value = 'new';
    await own.api.saveCurrent();
    assert.equal(own.calls[1][1].teamId, 'heliumtg');
    assert.equal(own.calls[1][1].adminPick, false);
    const all = await editor('admin/manga.js', admin, '?manga=other');
    assert.equal(all.errors.length, 0);
    assert.equal(Object.keys(all.api.scope()).length, 3);
    assert.equal(all.get('team').disabled, false);
    assert.equal(all.get('adminPick').disabled, false);
});

test('manga/chapter direct URLs reject other teams before editor content initializes; own chapter zero opens', async () => {
    for (const file of ['admin/manga.js', 'admin/chapter.js']) {
        const blocked = await editor(file, leader, '?manga=other&chapter=0');
        assert.equal(blocked.errors[0].code, 'staff/permission-denied', file);
        assert.equal(blocked.get('title').value, '');
        assert.equal(blocked.get('chapterTitle').value, '');
        assert.equal(blocked.calls.length, 0);
        assert.equal(blocked.get('uploadBtn').onclick, undefined);
        const allowed = await editor(file, leader, '?manga=own&chapter=0');
        assert.equal(allowed.errors.length, 0, file);
        assert.deepEqual(Object.keys(allowed.api.scope()), ['own']);
        if (file === 'admin/chapter.js') {
            assert.equal(allowed.get('chapterTitle').value, 'Prologue');
            assert.equal(allowed.get('chapterNumber').value, 0);
        }
    }
    const all = await editor('admin/chapter.js', admin, '?manga=other&chapter=0');
    assert.equal(all.errors.length, 0);
    assert.equal(all.get('chapterTitle').value, 'Other prologue');
});

test('all admin page modules await staff denial before catalogue requests or editor initialization', async () => {
    for (const file of ['admin/dashboard.js', 'admin/manga.js', 'admin/chapter.js']) {
        let initialized = false;
        const context = {
            requireStaff: async () => { throw new Error('Staff access required'); },
            fetch: () => { initialized = true; }, getMangas: () => { initialized = true; },
            document: { getElementById() { initialized = true; } }
        };
        vm.createContext(context);
        await assert.rejects(vm.runInContext('(async () => {' + strip(await read(file)) + '})()', context), /Staff access/);
        assert.equal(initialized, false, file);
    }
});

test('public auth module wires claim-consistent navigation for admins, leaders and ordinary readers', async () => {
    const d = dom();
    let callback;
    let profile;
    const context = {
        ...d, auth: { currentUser: null }, db: {}, getStaffContext: helpers.getStaffContext,
        onAuthStateChanged(auth, cb) { callback = cb; },
        getUserSnapshot: async () => ({ exists: () => true, data: () => profile }),
        doc() {}, console
    };
    vm.createContext(context);
    vm.runInContext(strip(await read('assets/js/staff-navigation.js')), context);
    vm.runInContext(strip(await read('assets/js/auth.js')), context);
    for (const [role, teamId] of [['admin', undefined], ['team_leader', 'heliumtg'], ['user', undefined]]) {
        profile = { role, teamId, name: 'Reader', avatar: 'avatar.webp' };
        const user = identity(role, teamId);
        context.auth.currentUser = user;
        await callback(user);
        assert.equal(d.nodes.has('staff-nav-link'), role !== 'user');
    }
    context.auth.currentUser = null;
    await callback(null);
    assert.equal(d.nodes.has('staff-nav-link'), false);
});


test('manga manager pagination keeps search and leader scope, then resets on search input', async () => {
    const data = Object.fromEntries(Array.from({length:33},(_,i)=>[`m${i}`, {title:`Manga ${String(i).padStart(2,'0')}`,teamId:i<23?'heliumtg':'other-team',chapters:[],tags:[]}]));
    const d = await editor('admin/manga.js',leader,'',data);
    assert.equal(d.errors.length,0);assert.equal(d.get('mangaGrid').children.length,14);
    d.get('manga-pagination').children.at(-1).events.click();
    assert.match(d.get('manga-pagination-summary').textContent,/Showing 15–23 of 23/);
    d.get('manga-pagination').children.at(-1).events.click();
     assert.equal(d.get('mangaGrid').children.length, 9);
    assert.match(d.get('manga-pagination-summary').textContent,/Showing 15–23 of 23/);
    assert.equal(d.get('manga-pagination').children.at(-1).disabled,true);
    d.get('searchInput').value='Manga 00';d.get('searchInput').oninput();
    assert.equal(d.get('mangaGrid').children.length,1);assert.match(d.get('manga-pagination-summary').textContent,/Showing 1–1 of 1/);
    assert.equal(d.get('manga-pagination').children[0].disabled,true);
    d.get('searchInput').value='';d.get('searchInput').oninput();
    assert.equal(d.get('mangaGrid').children.length,14);assert.match(d.get('manga-pagination-summary').textContent,/Showing 1–14 of 23/);
    const all=await editor('admin/manga.js',admin,'',data);
    assert.match(all.get('manga-pagination-summary').textContent,/Showing 1–14 of 33/);
});
