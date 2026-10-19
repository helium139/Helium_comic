import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../assets/js/reading-progress.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from "[^"]+";\n/gm, '')
    .replace(/export /g, '');
function helpers(overrides = {}) {
    const context = {
        db: {}, doc: (...parts) => parts.slice(1).join('/'),
        collection: (...parts) => parts.slice(1).join('/'),
        serverTimestamp: () => 'server-time', ...overrides
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}
const manga = { chapters: [0, 1, 2, 10, 10.5, 'extra', 'special'].map(id => ({ id })) };

test('never-read, latest, new publication, decimals, zero and special IDs follow catalogue order', () => {
    const h = helpers();
    assert.equal(h.hasUnreadChapter(manga, null), true);
    assert.equal(h.isChapterRead(manga, 0, { chapterId: 0 }), true);
    assert.equal(h.isChapterRead(manga, 10.5, { chapterId: 10 }), false);
    assert.equal(h.isChapterRead(manga, 2, { chapterId: '10.5' }), true);
    assert.equal(h.isChapterRead(manga, 'extra', { chapterId: 'special' }), true);
    assert.equal(h.hasUnreadChapter(manga, { chapterId: 'special' }), false);
    const published = { chapters: [...manga.chapters, { id: 'afterword' }] };
    assert.equal(h.hasUnreadChapter(published, { chapterId: 'special' }), true);
    assert.equal(h.hasUnreadChapter({ chapters: [] }, null), false);
    assert.equal(h.isChapterRead(manga, 'missing', { chapterId: 'special' }), false);
});

test('existing history advances once; older, repeated and out-of-order visits cannot regress it', async () => {
    let stored = null;
    let writes = 0;
    const h = helpers({
        runTransaction: async (db, callback) => callback({
            get: async reference => {
                assert.equal(reference, 'users/u/history/m');
                return { exists: () => stored !== null, data: () => stored };
            },
            set(reference, value, options) {
                assert.equal(options.merge, true);
                stored = value;
                writes++;
            }
        })
    });
    for (const id of [2, 2, 0, 10.5, 10, 'special', 'extra']) {
        await h.markChapterRead('u', 'm', manga, id);
    }
    assert.equal(writes, 3);
    assert.equal(stored.chapterId, 'special');
    assert.equal(stored.mangaId, 'm');
    assert.equal(stored.updatedAt, 'server-time');
    assert.equal(await h.markChapterRead('u', 'm', manga, 'unknown'), false);
});

test('transaction retry rechecks newer progress from another tab', async () => {
    let writes = 0;
    const h = helpers({ runTransaction: async (db, callback) => {
        // Simulate SDK discarding the first attempt and retrying after a conflict.
        await callback({ get: async () => ({ exists: () => false }), set() {} });
        return callback({
            get: async () => ({ exists: () => true, data: () => ({ chapterId: 'special' }) }),
            set() { writes++; }
        });
    } });
    assert.equal(await h.markChapterRead('u', 'm', manga, 10), false);
    assert.equal(writes, 0);
});

test('collection reads are shared while pending, fresh on refresh, and isolated by account', async () => {
    let reads = 0;
    const h = helpers({ getDocs: async () => {
        reads++;
        return { docs: [{ id: 'm', data: () => ({ chapterId: 10 }) }] };
    } });
    const first = h.getReadingProgressMap('u');
    assert.equal(first, h.getReadingProgressMap('u'));
    assert.equal((await first).get('m').chapterId, 10);
    await h.getReadingProgressMap('u');
    await h.getReadingProgressMap('other');
    assert.equal(reads, 3);
});

test('failed reads evict pending cache; failed transactions propagate without false success', async () => {
    let reads = 0;
    const h = helpers({
        getDoc: async () => {
            reads++;
            if (reads === 1) throw new Error('permission-denied');
            return { exists: () => true, data: () => ({ chapterId: 2 }) };
        },
        runTransaction: async () => { throw new Error('offline'); }
    });
    await assert.rejects(h.getReadingProgress('u', 'm'), /permission-denied/);
    assert.equal((await h.getReadingProgress('u', 'm')).chapterId, 2);
    await assert.rejects(h.markChapterRead('u', 'm', manga, 10), /offline/);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
test('reader waits for image success and auth; duplicate callbacks and guest visits do not write', async () => {
    const readerSource = (await readFile(new URL('../assets/js/comicchap.js', import.meta.url), 'utf8'))
        .replace(/^import[\s\S]*?from\s*"[^"]+";\s*/gm, '');
    let authChanged;
    let imageLoaded;
    let writes = 0;
    const image = { complete: false, addEventListener(type, callback) { imageLoaded = callback; } };
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            innerHTML: '', style: {}, classList: { add() {}, remove() {} },
            addEventListener() {}, querySelector: () => image
        });
        return elements.get(id);
    };
    const chapterManga = { title: 'Test', cover: 'cover', chapters: [
        { id: 10.5, title: 'Decimal', createAt: '2026-10-18T00:00:00Z', pages: 2, folder: 'images' }
    ] };
    const context = {
        auth: {}, db: {},
        onAuthStateChanged(auth, callback) { authChanged = callback; },
        getRouteParams: () => new URLSearchParams('id=m&chap=10.5'),
        mangaUrl: () => '/manga/m/', chapterUrl: () => '/manga/m/chapter/10.5/',
        localStorage: { getItem: () => '1', setItem() {} },
        fetch: async () => ({ json: async () => ({ m: chapterManga }) }),
        document: { getElementById: element, querySelector: () => ({}), documentElement: { removeAttribute() {} } },
        location: { href: '/manga/m/chapter/10.5/', origin: 'https://example.com' },
        window: { addEventListener() {} },
        startChapterViews() {},
        markChapterRead: async (uid, id, data, chapter) => {
            assert.equal(chapter, '10.5');
            writes++;
        },
        showProgressError() { assert.fail('unexpected reader error'); }
    };
    vm.runInNewContext(readerSource, context);
    await authChanged({ uid: 'u' });
    await flush();
    assert.equal(writes, 0);
    imageLoaded();
    await flush();
    assert.equal(writes, 1);
    await authChanged({ uid: 'u' });
    assert.equal(writes, 1);
    await authChanged(null);
    imageLoaded();
    assert.equal(writes, 1);
});

test('follow renders existing UP component, clears it after reading, and handles progress failure', async () => {
    const followSource = (await readFile(new URL('../assets/js/follow.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\n/gm, '');
    let authChanged;
    let restore;
    let progress = null;
    let fail = false;
    let queries = 0;
    let errors = 0;
    const container = { innerHTML: '', insertAdjacentHTML(position, html) { this.innerHTML += html; } };
    const element = { addEventListener() {}, classList: { add() {}, remove() {} } };
    const context = {
        auth: {}, onAuthStateChanged(auth, callback) { authChanged = callback; },
        getUserSnapshot: async () => ({ data: () => ({ follows: ['m'] }) }),
        getReadingProgressMap: async () => {
            queries++;
            if (fail) throw new Error('offline');
            return new Map([['m', progress]]);
        },
        hasUnreadChapter: helpers().hasUnreadChapter,
        showProgressError() { errors++; },
        fetch: async () => ({ ok: true, json: async () => ({ m: { ...manga, title: 'Test', cover: 'cover' } }) }),
        mangaUrl: () => '/manga/m/',
        document: { getElementById: id => id === 'follow-list' ? container : element, documentElement: { removeAttribute() {} } },
        window: { addEventListener(type, callback) { restore = callback; } },
        location: {}, localStorage: { getItem() {}, setItem() {} }
    };
    vm.runInNewContext(followSource, context);
    await authChanged({ uid: 'u' });
    assert.match(container.innerHTML, /class="new-chapter-badge">UP/);
    assert.equal(queries, 1);
    progress = { chapterId: 'special' };
    restore({ persisted: true });
    await flush();
    assert.doesNotMatch(container.innerHTML, /new-chapter-badge/);
    fail = true;
    restore({ persisted: true });
    await flush();
    assert.match(container.innerHTML, /Test/);
    assert.doesNotMatch(container.innerHTML, /new-chapter-badge/);
    assert.equal(errors, 1);
    await authChanged(null);
    assert.equal(context.location.href, '/login/');
    assert.equal(container.innerHTML, '');
});
