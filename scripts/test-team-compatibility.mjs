import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^import[\s\S]*?from\s*"[^"]+";\s*/gm, '');
const esm = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const teams = await esm(await read('assets/js/teams.js'));
const registry = teams.normalizeTeams([{ id: 'heliumtg', name: 'Renamed Team', slug: 'heliumtg', active: true }]);

test('legacy and object metadata normalize; IDs survive display-name changes', async () => {
    assert.equal(teams.normalizeTeams(['HeliumTG'])[0].id, 'heliumtg');
    assert.equal((await teams.getTeamById('heliumtg', registry)).name, 'Renamed Team');
    assert.equal(teams.resolveMangaTeam({ teamId: 'heliumtg', team: 'Old Name' }, registry).id, 'heliumtg');
    assert.equal(teams.resolveMangaTeam({ team: 'Renamed Team' }, registry).id, 'heliumtg');
    assert.throws(() => teams.resolveMangaTeam({ teamId: 'unknown', team: 'Renamed Team' }, registry), /Unknown/);
    assert.throws(() => teams.resolveMangaTeam({ team: 'unknown' }, registry), /Unknown/);
    for (const value of ['New Unmapped Name', { ...registry[0], active: 'true' }, { ...registry[0], id: 123 }, { ...registry[0], slug: 'Bad Slug' }]) {
        assert.throws(() => teams.normalizeTeam(value), /Invalid/);
    }
    assert.throws(() => teams.normalizeTeams([registry[0], registry[0]]), /Duplicate team id/);
    assert.throws(() => teams.normalizeTeams([registry[0], { ...registry[0], id: 'other' }]), /Duplicate team slug/);
    assert.throws(() => teams.validateCatalogue({ old: { team: 'HeliumTG' } }, registry), /Missing teamId/);
    assert.throws(() => teams.validateCatalogue({ bad: { teamId: 'unknown' } }, registry), /Unknown/);
});

test('metadata fetch is shared and retries failed loads', async () => {
    const module = await esm((await read('assets/js/teams.js')) + '\n// isolated fetch test');
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return { ok: calls > 1, json: async () => ['HeliumTG'] };
    };
    try {
        await assert.rejects(module.getTeams(), /Unable/);
        const a = module.getTeams();
        assert.equal(a, module.getTeams());
        assert.equal((await a)[0].id, 'heliumtg');
        assert.equal(await module.getTeamDisplayName('heliumtg'), 'HeliumTG');
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; }
});

test('current catalogue has valid stable ownership and retains legacy labels', async () => {
    const catalogue = JSON.parse(await read('assets/data/data.json'));
    const currentTeams = teams.normalizeTeams(JSON.parse(await read('assets/data/teams.json')));
    assert.equal(teams.validateCatalogue(catalogue, currentTeams), Object.keys(catalogue).length);
    for (const manga of Object.values(catalogue)) {
        assert.equal(typeof manga.team, 'string');
        assert.equal(teams.resolveMangaTeam(manga, currentTeams).id, manga.teamId);
    }
});

test('default profiles cannot inherit supplied roles/team IDs and use server timestamps', async () => {
    const source = stripImports(await read('assets/js/user-profile.js'));
    const profile = await esm('const serverTimestamp = () => "SERVER_TIMESTAMP";\n' + source);
    const user = { uid: 'u', displayName: 'Reader', email: 'r@example.test', photoURL: null, role: 'admin', teamId: 'other' };
    assert.deepEqual(profile.createDefaultProfile(user), {
        name: 'Reader', email: 'r@example.test', avatar: '/assets/images/helium_logo.webp',
        createdAt: 'SERVER_TIMESTAMP', role: 'user', likes: [], follows: [], history: []
    });
    assert.deepEqual(profile.resolveStaffContext('a', { role: 'admin' }), { uid: 'a', role: 'admin', teamId: null });
    assert.equal(profile.resolveStaffContext('t', { role: 'team_leader', teamId: 'heliumtg' }).teamId, 'heliumtg');
    assert.throws(() => profile.resolveStaffContext('t', { role: 'team_leader' }), /no assigned team/);
    assert.throws(() => profile.resolveStaffContext('u', {}), /Staff access/);
});

async function guard(profile, user = { uid: 'u' }) {
    const profileSource = stripImports(await read('assets/js/user-profile.js'));
    const helpers = await esm('const serverTimestamp = () => null;\n' + profileSource);
    let changed;
    const context = {
        auth: { currentUser: user }, db: {}, location: {},
        onAuthStateChanged(auth, callback) { changed = callback; queueMicrotask(() => callback(user)); },
        doc() {}, getDoc: async () => ({ data: () => profile }),
        resolveStaffContext: helpers.resolveStaffContext,
        getTeamById: id => teams.getTeamById(id, registry)
    };
    const source = stripImports(await read('assets/js/adminGuard.js')).replace(/export /g, '');
    vm.runInNewContext(source, context);
    return { context, change: (profileValue, account = user) => {
        context.getDoc = async () => ({ data: () => profileValue });
        context.auth.currentUser = account;
        return changed(account);
    } };
}

test('staff context recognizes leaders but existing management routes reject them; revocation still redirects', async () => {
    const leader = await guard({ role: 'team_leader', teamId: 'heliumtg' });
    assert.equal((await leader.context.requireStaff()).role, 'team_leader');
    await assert.rejects(leader.context.requireAdmin(), /disabled until Phase 1B/);
    assert.equal(leader.context.location.href, '/');
    const admin = await guard({ role: 'admin' });
    assert.equal((await admin.context.requireAdmin()).uid, 'u');
    await admin.change({ role: 'team_leader', teamId: 'heliumtg' });
    assert.equal(admin.context.location.href, '/');
    const guest = await guard(null, null);
    await assert.rejects(guest.context.requireAdmin(), /Login required/);
    assert.equal(guest.context.location.href, '/login/');
});

test('manga editor handles legacy Worker data and saves both stable ID and legacy display name', async () => {
    const elements = new Map();
    const el = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '', style: {}, dataset: {}, classList: { add() {}, remove() {} },
            replaceChildren() {}, appendChild() {}, addEventListener() {}
        });
        return elements.get(id);
    };
    let saved;
    const catalogue = { sample: { title: 'Sample', team: 'Renamed Team', cover: 'cover', chapters: [], tags: [] } };
    const context = {
        requireAdmin: async () => ({ uid: 'a', role: 'admin' }),
        getTeams: async () => registry, resolveMangaTeam: teams.resolveMangaTeam, getTeamById: teams.getTeamById,
        getMangas: async () => catalogue, editManga: async manga => { saved = manga; },
        document: { getElementById: el, createElement: () => el(Symbol()), addEventListener() {} },
        adminPick: el('adminPick'), pickOrder: el('pickOrder'), alert() {}, console
    };
    const source = stripImports(await read('admin/manga.js'));
    await vm.runInNewContext('(async () => {' + source + '\nreturn { openEditor, saveCurrent }; })()', context).then(async editor => {
        await new Promise(resolve => setImmediate(resolve));
        editor.openEditor('sample');
        assert.equal(el('team').value, 'heliumtg');
        await editor.saveCurrent();
        assert.equal(saved.teamId, 'heliumtg');
        assert.equal(saved.team, 'Renamed Team');
        assert.deepEqual(saved.chapters, []);
    });
});

test('editor stages new covers, keeps existing-cover uploads, and deletes chapters through the dedicated route', async () => {
    const elements = new Map();
    const el = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '', style: {}, dataset: {}, classList: { add() {}, remove() {} },
            replaceChildren() {}, appendChild() {}, addEventListener() {}
        });
        return elements.get(id);
    };
    const calls = [];
    const catalogue = { sample: { title: 'Sample', teamId: 'heliumtg', cover: 'old-cover', chapters: [{ id: 0, title: 'Prologue', createAt: '2026-01-01' }], tags: [] } };
    const context = {
        requireAdmin: async () => ({ uid: 'a', role: 'admin' }),
        getTeams: async () => registry, resolveMangaTeam: teams.resolveMangaTeam, getTeamById: teams.getTeamById,
        getMangas: async () => catalogue,
        newManga: async manga => calls.push(['create', manga]),
        editManga: async manga => calls.push(['edit', manga]),
        stageMangaCover: async file => { calls.push(['stage', file]); return 'staged-cover-reference'; },
        uploadImage: async (...args) => { calls.push(['upload', ...args]); return 'updated-cover'; },
        removeChapter: async (...args) => calls.push(['delete-chapter', ...args]),
        FileReader: class { readAsDataURL() {} },
        document: { getElementById: el, createElement: () => el(Symbol()), addEventListener() {} },
        adminPick: el('adminPick'), pickOrder: el('pickOrder'), alert() {}, confirm: () => true, console
    };
    const source = stripImports(await read('admin/manga.js'));
    const editor = await vm.runInNewContext('(async () => {' + source + '\nreturn { openNew, openEditor, saveCurrent, deleteChapter }; })()', context);
    await new Promise(resolve => setImmediate(resolve));
    editor.openNew();
    el('slug').value = 'new-manga';
    el('title').value = 'New Manga';
    const file = {};
    el('coverFile').onchange({ target: { files: [file] } });
    await editor.saveCurrent();
    assert.equal(calls[0][0], 'stage');
    assert.equal(calls[1][0], 'create');
    assert.equal(calls[1][1].coverStagingRef, 'staged-cover-reference');
    assert.equal(calls[1][1].cover, '');
    editor.openEditor('sample');
    el('coverFile').onchange({ target: { files: [file] } });
    await editor.saveCurrent();
    assert.deepEqual(calls[2], ['upload', file, 'sample', 'cover.webp']);
    assert.equal(calls[3][0], 'edit');
    assert.equal(calls[3][1].cover, 'updated-cover');
    assert.equal('coverStagingRef' in calls[3][1], false);
    await editor.deleteChapter(0);
    assert.deepEqual(calls[4], ['delete-chapter', 'sample', 0]);
    assert.equal(catalogue.sample.chapters.length, 0);
});

test('chapter editor recognizes chapter zero in a direct edit URL', async () => {
    const source = stripImports(await read('admin/chapter.js')).replace('\ninit();', '\n');
    const context = {
        requireAdmin: async () => ({ role: 'admin' }),
        URLSearchParams, location: { search: '?manga=own&chapter=0' },
        document: { getElementById: () => ({ addEventListener() {} }) }
    };
    const result = await vm.runInNewContext('(async () => {' + source +
        '\nparseQuery(); return { mode, currentSlug, currentChapter }; })()', context);
    assert.equal(result.mode, 'edit');
    assert.equal(result.currentSlug, 'own');
    assert.equal(result.currentChapter, 0);
});
