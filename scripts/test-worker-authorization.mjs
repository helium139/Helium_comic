import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { createLocalJWKSet, createRemoteJWKSet, customFetch, generateKeyPair, exportJWK, SignJWT } =
    await import(pathToFileURL(createRequire(new URL('../worker/package.json', import.meta.url)).resolve('jose')).href);
import { createWorker } from '../worker/source/worker.js';
import { verifyFirebaseToken, FIREBASE_PROJECT } from '../worker/source/firebase-auth.js';

globalThis.crypto ||= webcrypto;
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const keys = createLocalJWKSet({ keys: [jwk] });
const now = () => Math.floor(Date.now() / 1000);
async function token(claims = {}, header = {}) {
    return new SignJWT({
        sub: 'reader', role: 'admin', aud: FIREBASE_PROJECT,
        iss: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
        iat: now(), auth_time: now() - 60, exp: now() + 3600, ...claims
    }).setProtectedHeader({ alg: 'RS256', kid: 'test-key', ...header }).sign(privateKey);
}
const admin = await token();
const leader = await token({ sub: 'leader', role: 'team_leader', teamId: 'heliumtg' });
const otherLeader = await token({ sub: 'other', role: 'team_leader', teamId: 'other-team' });
const ordinary = await token({ role: 'user' });
const routes = ['/new-manga', '/edit-manga', '/delete-manga', '/new-chapter', '/edit-chapter', '/delete-chapter', '/upload', '/rename-images'];
const teams = [
    { id: 'heliumtg', slug: 'heliumtg', name: 'HeliumTG', active: true },
    { id: 'other-team', slug: 'other-team', name: 'Other', active: true },
    { id: 'inactive', slug: 'inactive', name: 'Inactive', active: false }
];
const input = (slug = 'own') => ({
    slug, title: 'Title', original_title: 'Original', author: 'Author', status: 'Ongoing',
    description: '', tags: [], teamId: 'heliumtg', team: 'Untrusted display name',
    adminPick: false, pickOrder: 999, cover: ''
});
const manga = teamId => ({ ...input(), teamId, adminPick: true, pickOrder: 3, customGlobalFlag: true,
    chapters: [{ id: 0, title: 'Prologue', pages: 1, folder: 'https://images.test/own/chap0', createAt: '2026-01-01T00:00:00.000Z' }] });

function harness() {
    let catalogue = { own: manga('heliumtg'), other: manga('other-team'), legacy: { ...manga('heliumtg'), teamId: undefined } };
    const objects = new Map();
    const operations = [], commits = [], logs = [], requests = [];
    let rejectSave = false, failDelete = false, revision = 1;
    const BUCKET = {
        async put(key, value, options = {}) {
            operations.push(['put', key]);
            const bytes = new Uint8Array(await new Response(value).arrayBuffer());
            objects.set(key, { bytes, ...structuredClone(options) });
            return {};
        },
        async get(key) {
            const value = objects.get(key);
            return value ? { ...structuredClone(value), body: value.bytes.slice() } : null;
        },
        async head(key) { return objects.has(key) ? {} : null; },
        async delete(key) {
            if (/\/chap1\/[1-9]\d*-[a-f0-9-]+\./.test(key)) {
                assert.ok(commits.length > 0, 'staging deletion follows catalogue commit');
                assert.ok(catalogue.own.chapters.some(chapter => chapter.id === 1 && chapter.images.every(name => !name.includes('-'))));
            }
            operations.push(['delete', key]);
            if (failDelete) throw new Error('private bucket credentials');
            objects.delete(key);
        }
    };
    const env = { BUCKET, R2_PUBLIC_URL: 'https://images.test', GITHUB_OWNER: 'owner',
        GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'PRIVATE_SECRET' };
    const worker = createWorker({
        verifyToken: jwt => verifyFirebaseToken(jwt, keys),
        log: details => logs.push(details),
        fetchImpl: async (url, options) => {
            requests.push({ url, method: options.method });
            if (options.method === 'PUT') {
                if (rejectSave) return new Response('PRIVATE_GITHUB_ERROR', { status: 409 });
                const body = JSON.parse(options.body);
                if (body.sha !== `sha-${revision}`) return new Response('', { status: 409 });
                catalogue = JSON.parse(Buffer.from(body.content, 'base64').toString());
                revision++;
                commits.push(body);
                return Response.json({ content: { sha: `sha-${revision}` } });
            }
            const data = new URL(url).pathname.endsWith('/teams.json') ? teams : catalogue;
            if (options.headers.Accept === 'application/vnd.github.raw+json') {
                const etag = `"data-${revision}"`;
                if (options.headers['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
                return new Response(JSON.stringify(data), { headers: { ETag: etag, 'Content-Type': 'application/vnd.github.raw+json' } });
            }
            return Response.json({ sha: `sha-${revision}`, content: Buffer.from(JSON.stringify(data)).toString('base64') });
        }
    });
    async function call(path, body = {}, jwt = admin, { method = 'POST', origin, headers = {} } = {}) {
        const requestHeaders = new Headers(headers);
        if (jwt) requestHeaders.set('Authorization', `Bearer ${jwt}`);
        if (origin) requestHeaders.set('Origin', origin);
        const multipart = body instanceof FormData;
        if (!multipart && method === 'POST') requestHeaders.set('Content-Type', 'application/json');
        return worker.fetch(new Request(`https://cms.test${path}`, {
            method, headers: requestHeaders,
            body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : multipart ? body : JSON.stringify(body)
        }), env);
    }
    return { call, BUCKET, objects, operations, commits, logs, requests,
        catalogue: () => catalogue, rejectSave: () => { rejectSave = true; }, failDelete: () => { failDelete = true; } };
}
function upload(folder, filename = '1.jpg', extra = {}) {
    const form = new FormData();
    form.set('file', new Blob([Uint8Array.from([255,216,255,224]), 'test-image'], { type: 'image/jpeg' }), filename);
    if (folder !== undefined) form.set('folder', folder);
    if (filename !== undefined && folder !== undefined) form.set('filename', filename);
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    return form;
}
const stageForm = () => upload(undefined, 'cover.jpg', { kind: 'new-manga-cover' });

test('image signatures determine MIME; spoofed files and mismatched chapter extensions fail', async () => {
    const h = harness();
    const fake = upload('own/chap1');
    fake.set('file', new Blob(['not an image'], { type: 'image/jpeg' }), '1.jpg');
    assert.equal((await h.call('/upload', fake)).status, 400);
    assert.equal((await h.call('/upload', upload('own/chap1', '1.webp'))).status, 400);
    const webp = upload('own/chap1', '1.webp');
    webp.set('file', new Blob(['RIFF1234WEBPxxxx'], { type: 'image/png' }), '1.webp');
    const response = await h.call('/upload', webp);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.key, /^own\/chap1\/1-[a-f0-9-]+\.webp$/);
    assert.equal(h.objects.get(result.key).httpMetadata.contentType, 'image/webp');

    const retainedJpeg = await h.call('/upload', upload('own/chap1', '2.jpeg'));
    assert.equal(retainedJpeg.status, 200);
    const jpegResult = await retainedJpeg.json();
    assert.match(jpegResult.key, /^own\/chap1\/2-[a-f0-9-]+\.jpg$/);
    assert.equal(h.objects.get(jpegResult.key).httpMetadata.contentType, 'image/jpeg');
});

test('chapter manifests preserve mixed page order and reject arbitrary paths', async () => {
    const h = harness();
    const body = { manga: 'own', chapterNumber: 1, title: 'Mixed', imageCount: 3, images: ['1.webp', '2.jpg', '3.webp'] };
    for (const name of body.images) {
        const jpeg = name.endsWith('.jpg');
        const bytes = jpeg ? Uint8Array.from([255,216,255,224]) : 'RIFF1234WEBPxxxx';
        await h.BUCKET.put(`own/chap1/${name}`, bytes, { httpMetadata: { contentType: jpeg ? 'image/jpeg' : 'image/webp' } });
    }
    assert.equal((await h.call('/new-chapter', body, leader)).status, 200);
    assert.deepEqual(h.catalogue().own.chapters[1].images, body.images);
    assert.ok(h.catalogue().own.chapters[1].images.every((name, index) => name === `${index + 1}.${['webp', 'jpg', 'webp'][index]}`));
    assert.ok(h.catalogue().own.chapters[1].images.every(name => /^\d+\.(?:webp|jpg)$/.test(name)));
    assert.equal((await h.call('/new-chapter', { ...body, chapterNumber: 2, images: ['2.png', '1.webp'] }, leader)).status, 400);
    assert.equal((await h.call('/new-chapter', { ...body, chapterNumber: 2, images: ['../1.webp', '2.png'] }, leader)).status, 400);
});

test('publishing a missing page or cover cannot write broken catalogue references', async () => {
    const h = harness();
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Missing', imageCount: 1, images: ['1.webp'] })).status, 400);
    assert.equal((await h.call('/edit-manga', { ...input(), cover: 'https://images.test/own/cover.webp' })).status, 400);
    assert.equal(h.commits.length, 0);
});

test('failed catalogue save after upload/reorder preserves every live original', async () => {
    const h = harness();
    await h.BUCKET.put('own/chap0/1.jpg', 'original page');
    await h.BUCKET.put('own/cover.jpg', 'original cover');
    const page = await (await h.call('/upload', upload('own/chap0'))).json();
    const cover = await (await h.call('/upload', upload('own', 'cover.jpg'))).json();
    const reordered = await (await h.call('/rename-images', { folder: 'own/chap0', images: [page.key.split('/').pop()] })).json();
    h.rejectSave();
    assert.equal((await h.call('/edit-chapter', { manga: 'own', chapterId: 0, title: 'Edit', createAt: new Date().toISOString(), pages: 1, images: reordered.images })).status, 409);
    assert.equal((await h.call('/edit-manga', { ...input(), cover: cover.url })).status, 409);
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/1.jpg').bytes), 'original page');
    assert.equal(new TextDecoder().decode(h.objects.get('own/cover.jpg').bytes), 'original cover');
    assert.equal(h.operations.some(([op]) => op === 'delete'), false);
    assert.equal(h.catalogue().own.chapters[0].images, undefined);
});

test('partial reorder upload failure preserves originals and catalogue', async () => {
    const h = harness();
    await h.BUCKET.put('own/chap0/1.jpg', 'one'); await h.BUCKET.put('own/chap0/2.png', 'two');
    const put = h.BUCKET.put; let copies = 0;
    h.BUCKET.put = async (...args) => { if (++copies === 2) throw Error('simulated failure'); return put(...args); };
    assert.equal((await h.call('/rename-images', { folder: 'own/chap0', images: ['2.png', '1.jpg'] })).status, 500);
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/1.jpg').bytes), 'one');
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/2.png').bytes), 'two');
    assert.equal(h.operations.some(([op]) => op === 'delete'), false); assert.equal(h.commits.length, 0);
});

// Every route goes through the same verifier before any GitHub or R2 operation.
test('every mutation denies anonymous and ordinary users without touching storage or GitHub', async () => {
    for (const path of routes) {
        for (const [jwt, status] of [[null, 401], [ordinary, 403], ['not-a-jwt', 401]]) {
            const h = harness();
            assert.equal((await h.call(path, {}, jwt)).status, status, path);
            assert.equal(h.requests.length, 0);
            assert.equal(h.operations.length, 0);
        }
    }
});

test('real RS256 verification rejects invalid issuer, audience, timestamps, subject, keys and signatures', async () => {
    const cases = [
        { iss: 'https://securetoken.google.com/other' }, { aud: 'other' }, { aud: [FIREBASE_PROJECT] },
        { exp: now() - 1 }, { exp: undefined }, { iat: now() + 100 }, { iat: undefined },
        { auth_time: now() + 100 }, { auth_time: undefined }, { auth_time: 'yesterday' },
        { sub: '' }, { sub: ' ' }, { sub: undefined }, { sub: 'x'.repeat(129) }
    ];
    for (const claims of cases) {
        await assert.rejects(verifyFirebaseToken(await token(claims), keys));
        assert.equal((await harness().call('/new-manga', input('new'), await token(claims))).status, 401);
    }
    await assert.rejects(verifyFirebaseToken(await token({}, { kid: 'unknown' }), keys));
    await assert.rejects(verifyFirebaseToken(await token({}, { kid: '' }), keys));
    const parts = admin.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'forged', role: 'admin' })).toString('base64url');
    assert.equal((await harness().call('/delete-manga', { slug: 'own' }, parts.join('.'))).status, 401);
    const { privateKey: attacker } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'attacker' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(attacker);
    await assert.rejects(verifyFirebaseToken(forged, keys));
    const hs = await new SignJWT({ sub: 'attacker' }).setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
        .sign(new TextEncoder().encode('a'.repeat(32)));
    await assert.rejects(verifyFirebaseToken(hs, keys));
});

test('remote JWK handling caches Google-format signing keys across verifications', async () => {
    let requests = 0;
    const remote = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), {
        [customFetch]: async (url, options) => {
            assert.equal(new URL(url).hostname, 'www.googleapis.com');
            assert.equal(options.method, 'GET');
            requests++;
            return Response.json({ keys: [jwk] });
        }
    });
    await verifyFirebaseToken(admin, remote);
    await verifyFirebaseToken(leader, remote);
    assert.equal(requests, 1);
});

test('admin creates valid active teams; leader body claims cannot override verified team', async () => {
    const h = harness();
    assert.equal((await h.call('/new-manga', { ...input('new'), teamId: 'other-team' })).status, 200);
    assert.equal(h.catalogue().new.teamId, 'other-team');
    assert.equal(h.catalogue().new.team, 'Other');
    for (const teamId of ['unknown', 'inactive']) {
        assert.equal((await h.call('/new-manga', { ...input('bad'), teamId })).status, 403);
    }
    assert.equal((await h.call('/new-manga', {
        ...input('leader-new'), teamId: 'other-team', role: 'admin', uid: 'reader', adminPick: true, pickOrder: 1
    }, leader)).status, 200);
    assert.equal(h.catalogue()['leader-new'].teamId, 'heliumtg');
    assert.equal(h.catalogue()['leader-new'].adminPick, false);
    assert.equal(h.catalogue()['leader-new'].pickOrder, 999);
    for (const teamId of ['inactive', 'unknown', undefined]) {
        assert.equal((await h.call('/new-manga', input('invalid'), await token({ role: 'team_leader', teamId }))).status, 403);
    }
});

test('existing ownership protects edits/deletes; editorial and chapter data cannot be smuggled', async () => {
    const h = harness();
    const chapters = structuredClone(h.catalogue().own.chapters);
    assert.equal((await h.call('/edit-manga', {
        ...input(), title: 'Leader edit', teamId: 'other-team', uid: 'reader', role: 'admin',
        adminPick: false, pickOrder: 1, chapters: [{ id: 99, folder: '../other' }], customGlobalFlag: false
    }, leader)).status, 200);
    assert.equal(h.catalogue().own.teamId, 'heliumtg');
    assert.equal(h.catalogue().own.title, 'Leader edit');
    assert.equal(h.catalogue().own.adminPick, true);
    assert.equal(h.catalogue().own.pickOrder, 3);
    assert.equal(h.catalogue().own.customGlobalFlag, true);
    assert.deepEqual(h.catalogue().own.chapters, chapters);
    for (const path of ['/edit-manga', '/delete-manga']) {
        const before = h.commits.length;
        assert.equal((await h.call(path, { ...input('other'), teamId: 'heliumtg' }, leader)).status, 403);
        assert.equal(h.commits.length, before);
        assert.equal((await h.call(path, input('legacy'), leader)).status, 403);
    }
    assert.equal((await h.call('/edit-manga', { ...input('other'), chapters: [], adminPick: false, pickOrder: 7 })).status, 200);
    assert.equal(h.catalogue().other.teamId, 'heliumtg');
    assert.equal(h.catalogue().other.chapters.length, 1);
    assert.equal(h.catalogue().other.pickOrder, 999);
    assert.equal((await h.call('/edit-manga', { ...input(), teamId: 'inactive' })).status, 403);
    h.catalogue().retired = manga('inactive');
    assert.equal((await h.call('/edit-manga', { ...input('retired'), teamId: 'inactive' })).status, 200);
    assert.equal((await h.call('/delete-manga', { slug: 'other' })).status, 200);
    assert.equal(Object.hasOwn(h.catalogue(), 'other'), false);
    assert.equal((await h.call('/delete-manga', { slug: 'own' }, leader)).status, 200);
});

test('all chapter routes inherit ownership; chapter zero and pre-record uploads work', async () => {
    const h = harness();
    for (const path of ['/new-chapter', '/edit-chapter', '/delete-chapter']) {
        assert.equal((await h.call(path, {
            manga: 'other', chapterId: 0, chapterNumber: 1, title: 'Forged', imageCount: 1,
            pages: 1, createAt: new Date().toISOString(), teamId: 'heliumtg'
        }, leader)).status, 403);
    }
    const uploaded = await h.call('/upload', upload('own/chap1'), leader);
    assert.equal(uploaded.status, 200);
    const page = await uploaded.json();
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Ch 1', imageCount: 1, images: [page.key.split('/').pop()], teamId: 'other-team' }, leader)).status, 200);
    assert.equal(h.catalogue().own.chapters[1].folder, 'https://images.test/own/chap1');
    assert.equal('teamId' in h.catalogue().own.chapters[1], false);
    await h.BUCKET.put('own/chap0/1.jpg', Uint8Array.from([255,216,255]), { httpMetadata: { contentType: 'image/jpeg' } });
    assert.equal((await h.call('/edit-chapter', { manga: 'own', chapterId: 0, title: 'Zero edit', pages: 1, createAt: new Date().toISOString() }, leader)).status, 200);
    assert.equal(h.catalogue().own.chapters[0].title, 'Zero edit');
    assert.equal((await h.call('/delete-chapter', { manga: 'own', chapterId: 0 }, leader)).status, 200);
    assert.equal(h.catalogue().own.chapters.length, 1);
    await h.BUCKET.put('own/chap0/2.png', Uint8Array.from([137,80,78,71,13,10,26,10]), { httpMetadata: { contentType: 'image/png' } });
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 0, title: 'Zero', imageCount: 2, images: ['1.jpg', '2.png'] }, leader)).status, 200);
    assert.equal(h.catalogue().own.chapters[0].id, 0);
});

test('uploads reject traversal, arbitrary keys, unexpected prefixes and cross-team writes', async () => {
    const folders = ['../other', './own', '/own', 'own/', 'own//chap1', 'own/../other', 'own\\..\\other',
        'own/%2e%2e', 'own/chap%31', '%6fwn/chap1', 'own/chap01', 'own/chap1/extra', 'staging/manga-covers/forged'];
    for (const folder of folders) {
        const h = harness();
        assert.equal((await h.call('/upload', upload(folder), leader)).status, 400, folder);
        assert.equal(h.operations.length, 0);
    }
    for (const filename of ['../1.jpg', '%2e%2e.jpg', 'other/1.jpg', '\\1.jpg', '0.jpg', '1.html']) {
        const h = harness();
        assert.equal((await h.call('/upload', upload('own/chap1', filename), leader)).status, 400, filename);
        assert.equal(h.operations.length, 0);
    }
    const h = harness();
    assert.equal((await h.call('/upload', upload('own/chap1', '1.jpg', { key: 'other/chap1/1.jpg' }), leader)).status, 400);
    assert.equal((await h.call('/upload', upload('other/chap1'), leader)).status, 403);
    assert.equal((await h.call('/upload', upload('missing/chap1'), leader)).status, 404);
    assert.equal((await h.call('/upload', upload('own', 'cover.webp'), leader)).status, 200);
    assert.equal([...h.objects.keys()].some(key => /^own\/cover-[a-f0-9-]+\.jpg$/.test(key)), true);
    assert.equal((await h.call('/upload', upload('other/chap1'), admin)).status, 200);
});

test('staged covers are server-keyed, caller-bound and promoted only after team validation', async () => {
    const h = harness();
    const response = await h.call('/upload', stageForm(), leader);
    assert.equal(response.status, 200);
    const staged = await response.json();
    assert.deepEqual(Object.keys(staged).sort(), ['stagingRef', 'success']);
    const stageKey = [...h.objects.keys()][0];
    assert.match(stageKey, /^staging\/manga-covers\/[a-f0-9]{64}\/[a-f0-9-]+$/);
    assert.equal((await h.call('/new-manga', { ...input('stolen'), coverStagingRef: staged.stagingRef }, otherLeader)).status, 403);
    assert.equal(h.objects.has(stageKey), true);
    assert.equal((await h.call('/new-manga', { ...input('new'), coverStagingRef: stageKey }, leader)).status, 400);
    assert.equal((await h.call('/new-manga', { ...input('new'), cover: 'https://evil.test/image' }, leader)).status, 400);
    assert.equal((await h.call('/new-manga', { ...input('new'), coverStagingRef: staged.stagingRef }, leader)).status, 200);
    assert.equal(h.catalogue().new.cover, `https://images.test/new/cover-${staged.stagingRef}.jpg`);
    assert.equal(h.objects.has(stageKey), false);
    assert.equal(h.objects.has(`new/cover-${staged.stagingRef}.jpg`), true);
    assert.equal((await h.call('/new-manga', { ...input('reuse'), coverStagingRef: staged.stagingRef }, leader)).status, 403);
    assert.equal((await h.call('/upload', upload('own', 'cover.webp', { kind: 'new-manga-cover' }), leader)).status, 400);
});

test('expired staging, failed publishing, and failed cleanup do not silently lose a committed cover', async () => {
    const h = harness();
    const { stagingRef } = await (await h.call('/upload', stageForm(), leader)).json();
    const stageKey = [...h.objects.keys()][0];
    h.objects.get(stageKey).customMetadata.createdAt = String(Date.now() - 25 * 3600000);
    assert.equal((await h.call('/new-manga', { ...input('expired'), coverStagingRef: stagingRef }, leader)).status, 403);
    h.objects.get(stageKey).customMetadata.createdAt = String(Date.now());
    h.rejectSave();
    const response = await h.call('/new-manga', { ...input('failed'), coverStagingRef: stagingRef }, leader);
    assert.equal(response.status, 409);
    assert.equal(h.objects.has(stageKey), true);
    assert.equal(Object.hasOwn(h.catalogue(), 'failed'), false);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
    const ok = harness();
    const staged = await (await ok.call('/upload', stageForm())).json();
    ok.failDelete();
    assert.equal((await ok.call('/new-manga', { ...input('saved'), coverStagingRef: staged.stagingRef })).status, 200);
    assert.equal(Object.hasOwn(ok.catalogue(), 'saved'), true);
});

test('rename validates all sources/destinations before writes and preserves content ordering', async () => {
    const h = harness();
    await h.BUCKET.put('own/chap0/1.jpg', 'one', { httpMetadata: { contentType: 'image/jpeg' } });
    await h.BUCKET.put('own/chap0/2.jpg', 'two', { httpMetadata: { contentType: 'image/jpeg' } });
    for (const body of [
        { folder: 'other/chap0', images: ['1.jpg'] },
        { folder: 'own/../other', images: ['1.jpg'] },
        { folder: 'own/chap0', images: ['1.jpg', '../other/1.jpg'] },
        { folder: 'own/chap0', images: ['%2e%2e.jpg'] },
        { folder: 'own/chap0', images: ['1.jpg'], destination: 'other/chap0' },
        { folder: 'own/chap0', images: ['1.jpg', '1.jpg'] },
        { folder: 'own/chap0', images: ['1.jpg', '3.jpg'] }
    ]) {
        const count = h.operations.length;
        const response = await h.call('/rename-images', body, leader);
        assert.ok([400, 403, 404].includes(response.status));
        assert.equal(h.operations.length, count);
    }
    const response = await h.call('/rename-images', { folder: 'own/chap0', images: ['2.jpg', '1.jpg'] }, leader);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(new TextDecoder().decode(h.objects.get(`own/chap0/${result.images[0]}`).bytes), 'two');
    assert.equal(new TextDecoder().decode(h.objects.get(`own/chap0/${result.images[1]}`).bytes), 'one');
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/1.jpg').bytes), 'one');
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/2.jpg').bytes), 'two');
    assert.equal(h.operations.some(([operation]) => operation === 'delete'), false);
    assert.equal([...h.objects.keys()].some(key => key.includes('tmp-')), false);
});

test('public reads stay public; mutation methods and browser origins are restricted', async () => {
    const h = harness();
    for (const path of ['/status', '/mangas']) {
        const response = await h.call(path, {}, null, { method: 'GET', origin: 'https://reader.test' });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    }
    assert.equal((await h.call('/delete-manga', { slug: 'own' }, admin, { origin: 'https://evil.test' })).status, 403);
    assert.equal((await h.call('/delete-manga', {}, admin, { method: 'GET' })).status, 405);
    for (const origin of ['https://heliumtg.com', 'https://www.heliumtg.com', 'http://localhost:8000', 'http://127.0.0.1:8000']) {
        const preflight = await h.call('/upload', {}, null, { method: 'OPTIONS', origin, headers: {
            'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'
        } });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
        assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Authorization,Content-Type');
    }
    assert.equal((await h.call('/upload', {}, null, { method: 'OPTIONS', origin: 'https://evil.test' })).status, 403);
    assert.equal((await h.call('/upload', {}, null, { method: 'OPTIONS', origin: 'https://heliumtg.com', headers: {
        'Access-Control-Request-Headers': 'x-evil-header'
    } })).status, 403);
    assert.equal((await h.call('/delete-manga', { slug: 'own' }, admin)).status, 200); // CLI: JWT still mandatory.
});

test('malformed requests and upstream errors return safe JSON without secrets', async () => {
    const h = harness();
    h.rejectSave();
    const response = await h.call('/edit-manga', input());
    assert.equal(response.status, 409);
    assert.doesNotMatch(await response.text(), /PRIVATE|stack|GITHUB_TOKEN/);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE|PRIVATE_SECRET/);
    const broken = createWorker({ verifyToken: jwt => verifyFirebaseToken(jwt, keys),
        fetchImpl: async () => { throw new Error('PRIVATE_NETWORK_SECRET'); }, log() {} });
    const failure = await broken.fetch(new Request('https://cms.test/mangas'), {});
    assert.equal(failure.status, 500);
    assert.doesNotMatch(await failure.text(), /PRIVATE_NETWORK_SECRET/);
});

test('new chapter promotes UUID upload sources into numbered final WebP names', async () => {
    const h = harness(), images = [];
    for (let index = 1; index <= 3; index++) {
        const form = upload('own/chap1', `${index}.webp`);
        form.set('file', new Blob([`RIFF1234WEBPpage${index}`], { type: 'image/webp' }), `${index}.webp`);
        const result = await (await h.call('/upload', form, leader)).json();
        assert.match(result.key, new RegExp(`^own/chap1/${index}-[a-f0-9-]+\\.webp$`));
        images.push(result.key.split('/').pop());
    }
    const response = await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'WebP', imageCount: 3, images }, leader);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).chapter.images, ['1.webp', '2.webp', '3.webp']);
    assert.deepEqual(h.catalogue().own.chapters[1].images, ['1.webp', '2.webp', '3.webp']);
    for (const name of images) assert.equal(h.objects.has(`own/chap1/${name}`), false);
    assert.equal(h.operations.filter(([operation]) => operation === 'delete').length, 3);
});

test('failed new chapter catalogue commit retains existing chapter and staged sources', async () => {
    const h = harness();
    await h.BUCKET.put('own/chap0/1.jpg', 'published original');
    const page = await (await h.call('/upload', upload('own/chap1'), leader)).json();
    h.rejectSave();
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Fail', imageCount: 1, images: [page.key.split('/').pop()] }, leader)).status, 409);
    assert.equal(h.catalogue().own.chapters.length, 1);
    assert.equal(new TextDecoder().decode(h.objects.get('own/chap0/1.jpg').bytes), 'published original');
    assert.ok(h.objects.has(page.key));
    assert.equal(h.operations.some(([operation]) => operation === 'delete'), false);
});

test('new mixed-format promotion leaves an existing UUID chapter and its objects untouched', async () => {
    const h = harness(), uuid = '6a294080-018b-4e4a-b5d2-1d945dba7afa';
    const existingName = `1-${uuid}.webp`;
    h.catalogue().own.chapters[0].images = [existingName];
    await h.BUCKET.put(`own/chap0/${existingName}`, 'published existing bytes');
    const before = structuredClone(h.catalogue().own.chapters[0]);
    const images = [`1-${uuid}.webp`, `2-${uuid}.jpg`, `3-${uuid}.png`];
    const bytes = ['RIFF1234WEBPnew', Uint8Array.from([255,216,255]), Uint8Array.from([137,80,78,71,13,10,26,10])];
    const types = ['image/webp', 'image/jpeg', 'image/png'];
    for (let i = 0; i < images.length; i++) await h.BUCKET.put(`own/chap1/${images[i]}`, bytes[i], { httpMetadata: { contentType: types[i] } });
    h.operations.length = 0;
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Mixed', imageCount: 3, images }, leader)).status, 200);
    assert.deepEqual(h.catalogue().own.chapters[1].images, ['1.webp', '2.jpg', '3.png']);
    assert.deepEqual(h.catalogue().own.chapters[0], before);
    assert.equal(new TextDecoder().decode(h.objects.get(`own/chap0/${existingName}`).bytes), 'published existing bytes');
    assert.ok(h.operations.every(([, key]) => key.startsWith('own/chap1/')));
    for (const name of images) assert.equal(h.objects.has(`own/chap1/${name}`), name === existingName);
    const operationsBefore = h.operations.length;
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 0, title: 'Forbidden replacement', imageCount: 1, images: [existingName] }, leader)).status, 409);
    assert.equal(h.operations.length, operationsBefore);
    assert.deepEqual(h.catalogue().own.chapters[0], before);
});


test('raw flag is boolean, persists both directions, and inherits manga ownership', async () => {
    const h = harness();
    for (const value of [true, false]) {
        assert.equal((await h.call('/edit-manga', { ...input(), isRawCaughtUp: value }, leader)).status, 200);
        assert.equal(h.catalogue().own.isRawCaughtUp, value);
        assert.equal(h.catalogue().own.status, 'Ongoing');
    }
    assert.equal((await h.call('/edit-manga', { ...input('other'), isRawCaughtUp: true }, leader)).status, 403);
    assert.equal((await h.call('/edit-manga', { ...input(), isRawCaughtUp: 'true' })).status, 400);
    assert.equal((await h.call('/edit-manga', { ...input('other'), isRawCaughtUp: true })).status, 200);
    assert.equal(h.catalogue().other.isRawCaughtUp, true);
    await h.BUCKET.put('own/chap0/1.jpg', 'image');
    assert.equal((await h.call('/edit-chapter', { manga: 'own', chapterId: 0, title: 'Edit', createAt: '2026-01-01', pages: 1, isRawCaughtUp: true }, leader)).status, 200);
    assert.equal(h.catalogue().own.isRawCaughtUp, true);
    await h.BUCKET.put('own/chap1/1.webp', 'RIFF1234WEBPxxxx', { httpMetadata: { contentType: 'image/webp' } });
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'New', imageCount: 1, images: ['1.webp'], isRawCaughtUp: false }, leader)).status, 200);
    assert.equal(h.catalogue().own.isRawCaughtUp, false);
});

test('admin queue enforces FIFO, preserves order and rejects conflicting commits', async () => {
    const h = harness();
    for (const value of Object.values(h.catalogue())) value.adminPick = false;
    for (let i = 0; i < 11; i++) {
        assert.equal((await h.call('/new-manga', { ...input(`pick-${i}`), adminPick: true })).status, 200);
    }
    const selected = () => Object.entries(h.catalogue()).filter(([, m]) => m.adminPick).sort((a,b) => a[1].pickOrder - b[1].pickOrder).map(([id]) => id);
    assert.deepEqual(selected(), Array.from({ length: 10 }, (_, i) => `pick-${i + 1}`));
    assert.equal(h.catalogue()['pick-0'].adminPick, false);
    assert.equal((await h.call('/edit-manga', { ...input('pick-5'), adminPick: false })).status, 200);
    assert.deepEqual(selected(), ['pick-1','pick-2','pick-3','pick-4','pick-6','pick-7','pick-8','pick-9','pick-10']);
    const before = selected();
    assert.equal((await h.call('/edit-manga', { ...input('pick-1'), adminPick: false }, leader)).status, 200);
    assert.deepEqual(selected(), before);
    h.rejectSave();
    assert.equal((await h.call('/edit-manga', { ...input('pick-0'), adminPick: true })).status, 409);
    assert.deepEqual(selected(), before);
});


test('current editor payload needs no pickOrder; optional fields preserve saved state', async () => {
    const h = harness();
    const body = { ...input(), adminPick: true, isRawCaughtUp: true };
    delete body.pickOrder;
    assert.equal((await h.call('/edit-manga', body)).status, 200);
    assert.equal(h.catalogue().own.adminPick, true);
    assert.equal(h.catalogue().own.isRawCaughtUp, true);
    const order = h.catalogue().own.pickOrder;
    delete body.adminPick;
    delete body.isRawCaughtUp;
    assert.equal((await h.call('/edit-manga', { ...body, unknownEditorialFlag: true })).status, 200);
    assert.equal(h.catalogue().own.adminPick, true);
    assert.equal(h.catalogue().own.pickOrder, order);
    assert.equal(h.catalogue().own.isRawCaughtUp, true);
    assert.equal(Object.hasOwn(h.catalogue().own, 'unknownEditorialFlag'), false);
    assert.equal((await h.call('/edit-manga', { ...body, adminPick: false, isRawCaughtUp: false })).status, 200);
    assert.equal(h.catalogue().own.adminPick, false);
    assert.equal(h.catalogue().own.isRawCaughtUp, false);
    assert.equal((await h.call('/new-manga', { ...body, slug: 'legacy-create' })).status, 200);
    assert.equal(h.catalogue()['legacy-create'].adminPick, false);
    assert.equal(h.catalogue()['legacy-create'].pickOrder, 999);
});

test('editorial fields reject non-booleans and invalid legacy order without commits', async () => {
    const h = harness();
    for (const field of ['adminPick', 'isRawCaughtUp']) {
        for (const value of ['true', 'false', null, 1, 0, {}, []]) {
            const before = h.commits.length;
            assert.equal((await h.call('/edit-manga', { ...input(), [field]: value })).status, 400);
            assert.equal(h.commits.length, before);
        }
    }
    assert.equal((await h.call('/edit-manga', { ...input(), pickOrder: '1' })).status, 400);
    const body = { ...input(), isRawCaughtUp: true, adminPick: false };
    delete body.pickOrder;
    assert.equal((await h.call('/edit-manga', body, leader)).status, 200);
    assert.equal(h.catalogue().own.isRawCaughtUp, true);
    assert.equal(h.catalogue().own.adminPick, true); // Team callers cannot change editorial selection.
    assert.equal((await h.call('/edit-manga', { ...body, slug: 'other' }, leader)).status, 403);
});

test('successful publish retries with missing staging and retained staging after delete failure', async () => {
    const h = harness();
    const page = await (await h.call('/upload', upload('own/chap1'), leader)).json();
    const body = { manga: 'own', chapterNumber: 1, title: 'Retry', imageCount: 1, images: [page.key.split('/').pop()] };
    assert.equal((await h.call('/new-chapter', body, leader)).status, 200);
    assert.equal(h.objects.has(page.key), false);
    assert.equal((await h.call('/new-chapter', body, leader)).status, 200);
    assert.equal(h.commits.length, 1);
    const g = harness();
    const source = await (await g.call('/upload', upload('own/chap1'), leader)).json();
    g.failDelete();
    assert.equal((await g.call('/new-chapter', { ...body, images: [source.key.split('/').pop()] }, leader)).status, 200);
    assert.ok(g.objects.has(source.key));
});

test('referenced session source anywhere in catalogue survives publication', async () => {
    const h = harness();
    const page = await (await h.call('/upload', upload('own/chap1'), leader)).json();
    h.catalogue().other.retainedAsset = `https://images.test/${page.key}`;
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Referenced', imageCount: 1, images: [page.key.split('/').pop()] }, leader)).status, 200);
    assert.ok(h.objects.has(page.key));
});

test('failed final verification retains staging and does not commit', async () => {
    const h = harness();
    const page = await (await h.call('/upload', upload('own/chap1'), leader)).json();
    const put = h.BUCKET.put;
    h.BUCKET.put = async (...args) => { const result = await put(...args); h.objects.get(args[0]).bytes = new Uint8Array([0]); return result; };
    assert.equal((await h.call('/new-chapter', { manga: 'own', chapterNumber: 1, title: 'Bad', imageCount: 1, images: [page.key.split('/').pop()] }, leader)).status, 400);
    assert.ok(h.objects.has(page.key));
    assert.equal(h.commits.length, 0);
    assert.equal(h.operations.some(([op]) => op === 'delete'), false);
});
