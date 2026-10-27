import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const paths = ['/new-manga', '/edit-manga', '/delete-manga', '/new-chapter', '/edit-chapter', '/delete-chapter', '/upload', '/rename-images'];
async function client({ user, response, fetchImpl, setTimeoutImpl, clearTimeoutImpl } = {}) {
    const calls = [];
    const context = {
        auth: { currentUser: user === undefined ? { getIdToken: async () => 'sdk-token' } : user },
        Headers, FormData, AbortController, DOMException,
        fetch: fetchImpl || (async (url, options) => {
            calls.push({ url, options });
            return response || new Response(JSON.stringify({
                success: true, key: 'm/chap1/1-upload-id.jpg', url: 'https://images.test/m/chap1/1-upload-id.jpg'
            }), {
                status: 200, headers: { 'Content-Type': 'application/json' }
            });
        }),
        setTimeout: setTimeoutImpl || setTimeout,
        clearTimeout: clearTimeoutImpl || clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(strip(await read('admin/api/image-conversion.js')), context);
    context.prepareImage = async (file, filename) => ({ file, filename });
    vm.runInContext(strip(await read('admin/api/authenticated-fetch.js')), context);
    vm.runInContext(strip(await read('admin/api/github.js')), context);
    vm.runInContext(strip(await read('admin/api/upload.js')), context);
    return { context, calls };
}

test('all eight mutation wrappers attach SDK tokens and preserve payloads', async () => {
    const { context: c, calls } = await client();
    const manga = { slug: 'm', teamId: 'heliumtg', title: 'Manga' };
    const chapter = { manga: 'm', chapterId: 1 };
    await c.newManga(manga);
    await c.editManga(manga);
    await c.deleteManga('m');
    await c.publishChapter(chapter);
    await c.updateChapter(chapter);
    await c.removeChapter('m', 1);
    const uploaded = await c.uploadImage(new Blob(['image']), 'm/chap1', '1.jpg');
    await c.renameImages({ folder: 'm/chap1', images: ['1.jpg'] });
    assert.deepEqual({ ...uploaded }, {
        key: 'm/chap1/1-upload-id.jpg',
        name: '1-upload-id.jpg',
        url: 'https://images.test/m/chap1/1-upload-id.jpg'
    });
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), paths);
    for (const { url, options } of calls) {
        assert.equal(new URL(url).origin, 'https://helium-cms.mylengoctra06.workers.dev');
        assert.equal(options.headers.get('Authorization'), 'Bearer sdk-token');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.credentials, 'omit');
    }
    assert.deepEqual(JSON.parse(calls[0].options.body), manga);
    assert.deepEqual(JSON.parse(calls[5].options.body), chapter);
    const upload = calls[6].options;
    assert.equal(upload.headers.has('Content-Type'), false);
    assert.equal(upload.body.get('folder'), 'm/chap1');
    assert.equal(upload.body.get('filename'), '1.jpg');
    assert.equal(calls[0].options.headers.get('Content-Type'), 'application/json');
});

test('chapter update aborts a pending request and reports a retryable timeout', async () => {
    let sent;
    const { context: c } = await client({
        setTimeoutImpl: callback => { queueMicrotask(callback); return 1; },
        clearTimeoutImpl: () => {},
        fetchImpl: async (url, options) => {
            sent = { url, options };
            if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            return new Promise((_, reject) => options.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))));
        }
    });
    await assert.rejects(c.updateChapter({ chapterId: 1 }), /quá thời gian chờ/i);
    assert.equal(new URL(sent.url).pathname, '/edit-chapter');
    assert.equal(sent.options.signal.aborted, true);
});

test('missing login or token acquisition failure never sends a mutation', async () => {
    for (const user of [null, { getIdToken: async () => { throw new Error('expired'); } }]) {
        const { context, calls } = await client({ user });
        await assert.rejects(context.newManga({}), error => error.status === 401);
        assert.equal(calls.length, 0);
    }
});

test('account change during token acquisition aborts; each request asks SDK for token', async () => {
    let tokenCalls = 0;
    const user = { getIdToken: async () => `token-${++tokenCalls}` };
    const { context: c, calls } = await client({ user });
    await c.newManga({});
    await c.newManga({});
    assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer token-2');
    user.getIdToken = async () => { c.auth.currentUser = null; return 'old-account'; };
    await assert.rejects(c.newManga({}), error => error.status === 401);
    assert.equal(calls.length, 2);
});

test('helper restricts credential destinations and overrides supplied Authorization', async () => {
    const { context: c, calls } = await client();
    for (const path of ['https://evil.test/upload', '//evil.test/upload', '/upload/../new-manga', '/mangas', '/upload?target=other']) {
        await assert.rejects(c.authenticatedFetch(path), /Unsupported/);
    }
    await assert.rejects(c.authenticatedFetch('/upload', { method: 'GET' }), /require POST/);
    assert.equal(calls.length, 0);
    await c.authenticatedFetch('/edit-manga', { headers: { Authorization: 'untrusted' }, redirect: 'follow' });
    assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer sdk-token');
    assert.equal(calls[0].options.redirect, 'error');
});

test('HTTP 401/403/500 responses reject even if body falsely reports success', async () => {
    for (const status of [401, 403, 500]) {
        for (const body of ['not JSON', JSON.stringify({ success: true })]) {
            const { context: c, calls } = await client({ response: new Response(body, { status }) });
            await assert.rejects(c.newManga({}), error => error.status === status);
            assert.equal(calls.length, 1); // No automatic retry of mutations.
        }
    }
});

test('new covers upload only a file and staging kind; no client-selected R2 destination', async () => {
    const { context: c, calls } = await client({ response: Response.json({ success: true, stagingRef: 'opaque-reference' }) });
    assert.equal(await c.stageMangaCover(new Blob(['image'])), 'opaque-reference');
    assert.deepEqual([...calls[0].options.body.keys()].sort(), ['file', 'kind']);
    assert.equal(calls[0].options.body.get('kind'), 'new-manga-cover');
    assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer sdk-token');
    assert.equal(calls[0].options.headers.has('Content-Type'), false);
});
