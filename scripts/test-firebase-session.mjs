import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('shared auth dispatch and profile reads preserve freshness and retry after failure', async () => {
    let observer;
    let observers = 0;
    let reads = 0;
    let settle;
    globalThis.__firebaseTest = {
        app: {}, db: {}, auth: {},
        getAuth() { return this.auth; },
        observeAuth(auth, callback) { observers++; observer = callback; },
        doc(db, collection, uid) { return uid; },
        getDoc(uid) { reads++; return new Promise((resolve, reject) => { settle = { resolve, reject }; }); }
    };
    const source = (await readFile(new URL('../assets/js/firebase-session.js', import.meta.url), 'utf8'))
        .replace(/^import .*;\n/gm, '')
        .replace('export const auth = getAuth(app);', 'export const auth = globalThis.__firebaseTest.auth;');
    const prelude = 'const { app, db, observeAuth, doc, getDoc } = globalThis.__firebaseTest;\n';
    try {
        const session = await import('data:text/javascript;base64,' + Buffer.from(prelude + source).toString('base64'));
        const seen = [];
        const stop = session.onAuthStateChanged(session.auth, user => seen.push(user));
        observer({ uid: 'first' });
        await flush();
        assert.equal(observers, 1);
        assert.equal(seen.length, 1);
        stop();
        observer(null);
        await flush();
        assert.equal(seen.length, 1);
        session.onAuthStateChanged(session.auth, user => seen.push(user));
        await flush();
        assert.equal(seen.at(-1), null);
        const a = session.getUserSnapshot('first');
        const b = session.getUserSnapshot('first');
        assert.equal(a, b);
        assert.equal(reads, 1);
        settle.resolve({ name: 'old' });
        await a;
        const fresh = session.getUserSnapshot('first');
        assert.equal(reads, 2);
        settle.reject(new Error('offline'));
        await assert.rejects(fresh, /offline/);
        const retry = session.getUserSnapshot('first');
        assert.equal(reads, 3);
        settle.resolve({ name: 'new' });
        assert.deepEqual(await retry, { name: 'new' });
    } finally {
        delete globalThis.__firebaseTest;
    }
});

test('comments use bounded callables and refresh on auth/bfcache without realtime listeners', async () => {
    const source = await readFile(new URL('../assets/js/comment.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /onSnapshot|firebase-firestore/);
    assert.match(source, /onAuthStateChanged\(auth, \(\) => loadRoots\(true\)\)/);
    assert.match(source, /event.persisted\) loadRoots\(true\)/);
});
