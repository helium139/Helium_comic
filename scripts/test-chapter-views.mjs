import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createActiveViewSession } from '../assets/js/active-view-session.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function target() {
    const events = new Map();
    return { events, visibilityState: 'visible',
        addEventListener(type, handler) { events.set(type, handler); },
        removeEventListener(type) { events.delete(type); },
        emit(type, value = {}) { events.get(type)?.(value); } };
}
function harness({ start, record } = {}) {
    let time = 0, next = 0; const timers = new Map();
    const doc = target(), win = target(), starts = [], records = [];
    const tracker = createActiveViewSession({ doc, win, now: () => time, wallNow: () => time,
        schedule: (fn, ms) => { timers.set(++next, { at: time + ms, fn }); return next; }, cancel: id => timers.delete(id),
        makeRequestId: () => `request-${++next}`,
        start: async data => { starts.push(data); return start ? start(data, starts.length) : { sessionId: 'session', expiresAt: time + 1800000, minimumActiveMs: 10000 }; },
        record: async data => { records.push(data); return record ? record(data, records.length) : { accepted: true }; }
    });
    async function advance(ms) {
        const end = time + ms;
        while (true) {
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            timers.delete(due[0]); time = due[1].at; due[1].fn(); await flush();
        }
        time = end; await flush();
    }
    return { tracker, doc, win, starts, records, advance, timers,
        async ready() { tracker.setIdentity(null); tracker.ready(); await flush(); } };
}

test('first readiness gate and 10 active visible seconds are required; submit once', async () => {
    const h = harness(); h.tracker.setIdentity(null); await h.advance(20000);
    assert.equal(h.starts.length, 0);
    h.tracker.ready(); await flush();
    await h.advance(9999); assert.equal(h.records.length, 0);
    await h.advance(1); assert.equal(h.records.length, 1);
    await h.advance(60000); h.tracker.ready(); h.tracker.setIdentity(null);
    assert.equal(h.records.length, 1);
});

test('6 visible + 30 hidden + 4 visible seconds qualifies, without hidden time', async () => {
    const h = harness(); await h.ready(); await h.advance(6000);
    h.doc.visibilityState = 'hidden'; h.doc.emit('visibilitychange');
    await h.advance(30000); assert.equal(h.records.length, 0);
    h.doc.visibilityState = 'visible'; h.doc.emit('visibilitychange');
    await h.advance(3999); assert.equal(h.records.length, 0);
    await h.advance(1); assert.equal(h.records.length, 1);
});

test('bfcache resumes active accumulation without stacking listeners or timers', async () => {
    const h = harness(); await h.ready(); await h.advance(6000);
    h.win.emit('pagehide', { persisted: true }); await h.advance(30000);
    assert.equal(h.records.length, 0);
    h.win.emit('pageshow', { persisted: true }); await h.advance(4000);
    assert.equal(h.records.length, 1);
    h.win.emit('pageshow', { persisted: true }); await h.advance(10000);
    assert.equal(h.records.length, 1); assert.equal(h.doc.events.size, 1);
    h.tracker.dispose(); assert.equal(h.doc.events.size, 0); assert.equal(h.win.events.size, 0);
});

test('network retries use the same session and start retries use the same request ID', async () => {
    const h = harness({ start(data, count) {
        if (count === 1) throw { code: 'functions/unavailable' };
        return { sessionId: 'same', expiresAt: 1800000, minimumActiveMs: 10000 };
    }, record(data, count) { if (count === 1) throw { code: 'functions/unavailable' }; return { accepted: true }; } });
    await h.ready(); await h.advance(1000);
    assert.equal(h.starts[0].requestId, h.starts[1].requestId);
    await h.advance(10000); await h.advance(1000);
    assert.equal(h.records.length, 2); assert.equal(h.records[0].sessionId, h.records[1].sessionId);
});

test('leaving before threshold does not count; old async identity sessions cannot overwrite newer ones', async () => {
    const h = harness(); await h.ready(); await h.advance(9000); h.win.emit('pagehide', { persisted: false });
    await h.advance(10000); assert.equal(h.records.length, 0);
    let resolveOld;
    const race = harness({ start(data, count) { return count === 1 ? new Promise(resolve => { resolveOld = resolve; }) :
        { sessionId: 'new', expiresAt: 1800000, minimumActiveMs: 10000 }; } });
    await race.ready(); race.tracker.setIdentity('logged-in'); await flush();
    resolveOld({ sessionId: 'old', expiresAt: 1800000, minimumActiveMs: 10000 }); await flush();
    await race.advance(10000); assert.equal(race.records[0].sessionId, 'new');
});

test('detail page has no view submission; chapter hook is after first-image readiness, no direct increments', async () => {
    const detail = await readFile(new URL('../assets/js/comicpage.js', import.meta.url), 'utf8');
    const chapter = await readFile(new URL('../assets/js/comicchap.js', import.meta.url), 'utf8');
    assert.doesNotMatch(detail, /updateView\(|startChapterViews|recordChapterView|views:\s*increment/);
    assert.doesNotMatch(chapter, /updateChapterView|views:\s*increment|mangaStats/);
    assert.match(chapter, /firstImage\?\.addEventListener\("load", chapterOpened/);
    assert.match(chapter, /startChapterViews\(\{ mangaId, chapterId, manga, chapter, firstImage \}\)/);
});


test('reader adapter rejects missing/broken first pages, initializes once, and tolerates unavailable crypto', async () => {
    const source = (await readFile(new URL('../assets/js/chapter-views.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    let initialized = 0, ready = 0;
    const context = { auth: {}, onAuthStateChanged: () => () => {}, viewCallable: () => async () => ({}),
        localStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
        document: {}, window: {}, performance: { now: () => 0 },
        createActiveViewSession() { initialized++; return { ready() { ready++; }, dispose() {} }; }
    };
    vm.createContext(context); vm.runInContext(source, context);
    const chapter = { id: 0, pages: 2, folder: 'https://images.test/m/chap0' };
    const data = { mangaId: 'm', chapterId: 0, manga: { chapters: [chapter] }, chapter, firstImage: { naturalWidth: 0 } };
    context.startChapterViews(data); assert.equal(initialized, 0);
    context.startChapterViews({ ...data, manga: null }); assert.equal(initialized, 0);
    data.firstImage.naturalWidth = 100;
    context.startChapterViews(data); context.startChapterViews(data);
    assert.equal(initialized, 1); assert.equal(ready, 1);
    context.crypto = {};
    assert.doesNotThrow(() => context.startChapterViews({ ...data, mangaId: 'another' }));
});
