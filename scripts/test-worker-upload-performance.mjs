import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../worker/source/worker.js';

const catalogueText = await readFile(new URL('../assets/data/data.json', import.meta.url), 'utf8');
const catalogue = JSON.parse(catalogueText);
const teamsText = await readFile(new URL('../assets/data/teams.json', import.meta.url), 'utf8');
const teams = JSON.parse(teamsText);
const slug = Object.keys(catalogue).find(id => catalogue[id].teamId === 'heliumtg');
const changedCatalogue = structuredClone(catalogue);
changedCatalogue[slug].teamId = 'other-team';
const changedCatalogueText = JSON.stringify(changedCatalogue);
const teamsResponse = JSON.stringify({ sha: 'teams-sha', content: Buffer.from(teamsText).toString('base64') });

function uploadRequest() {
    const bytes = Uint8Array.from([...Buffer.from('RIFF1234WEBP'), 1, 2, 3, 4]);
    let signatureReads = 0, streamReads = 0;
    const file = {
        size: bytes.byteLength,
        type: 'image/webp',
        slice(start, end) {
            signatureReads++;
            const buffer = bytes.slice(start, end).buffer;
            return { arrayBuffer: async () => buffer };
        },
        stream() {
            streamReads++;
            return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
        }
    };
    const values = new Map([
        ['file', file],
        ['folder', `${slug}/chap0`],
        ['filename', '1.webp']
    ]);
    const request = new Request('https://cms.test/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer verified-test-token' }
    });
    request.formData = async () => ({
        get: key => values.get(key) ?? null,
        has: key => values.has(key)
    });
    return { request, reads: () => ({ signatureReads, streamReads }) };
}

test('50 sequential uploads reuse only ETag-verified ownership and stream each image once', async () => {
    let verifyCalls = 0, fullCatalogueReads = 0, conditionalCatalogueReads = 0;
    let teamReads = 0, bucketPuts = 0, forbiddenBucketCalls = 0;
    let dataEtag = '"catalogue-v1"', currentCatalogueText = catalogueText;
    const keys = new Set(), putSizes = [], serializedLengths = [], logs = [];
    const bucket = {
        async put(key, value) {
            bucketPuts++;
            keys.add(key);
            putSizes.push((await new Response(value).arrayBuffer()).byteLength);
            return {};
        },
        async get() { forbiddenBucketCalls++; throw new Error('Unexpected R2 get'); },
        async head() { forbiddenBucketCalls++; throw new Error('Unexpected R2 head'); },
        async delete() { forbiddenBucketCalls++; throw new Error('Unexpected R2 delete'); },
        async list() { forbiddenBucketCalls++; throw new Error('Unexpected R2 listing'); }
    };
    const worker = createWorker({
        verifyToken: async () => {
            verifyCalls++;
            return { uid: 'leader-user', role: 'team_leader', teamId: 'heliumtg' };
        },
        fetchImpl: async (url, options) => {
            const path = new URL(url).pathname;
            if (options.method === 'PUT') assert.fail('Uploads must not write to GitHub');
            if (path.endsWith('/teams.json')) {
                teamReads++;
                return new Response(teamsResponse, { headers: { 'Content-Type': 'application/json' } });
            }
            assert.equal(path.endsWith('/data.json'), true);
            assert.equal(options.headers['Cache-Control'], 'no-cache');
            if (options.headers['If-None-Match'] === dataEtag) {
                conditionalCatalogueReads++;
                return new Response(null, { status: 304, headers: { ETag: dataEtag } });
            }
            fullCatalogueReads++;
            return new Response(currentCatalogueText, {
                headers: { ETag: dataEtag, 'Content-Type': 'application/vnd.github.raw+json' }
            });
        },
        log: details => logs.push(details)
    });
    const originalStringify = JSON.stringify;
    JSON.stringify = function (value, ...args) {
        const result = originalStringify.call(this, value, ...args);
        serializedLengths.push(result.length);
        return result;
    };
    try {
        for (let index = 0; index < 50; index++) {
            const testRequest = uploadRequest();
            const response = await worker.fetch(testRequest.request, {
                BUCKET: bucket,
                R2_PUBLIC_URL: 'https://images.test',
                GITHUB_OWNER: 'owner',
                GITHUB_REPO: 'repo',
                GITHUB_BRANCH: 'main'
            });
            assert.equal(response.status, 200, `upload ${index} failed: ${await response.clone().text()}; verify=${verifyCalls}, teams=${teamReads}, full=${fullCatalogueReads}, cached=${conditionalCatalogueReads}, puts=${bucketPuts}`);
            assert.equal((await response.json()).success, true);
            assert.deepEqual(testRequest.reads(), { signatureReads: 1, streamReads: 1 });
        }

        currentCatalogueText = changedCatalogueText;
        dataEtag = '"catalogue-v2"';
        const moved = await worker.fetch(uploadRequest().request, {
            BUCKET: bucket,
            R2_PUBLIC_URL: 'https://images.test',
            GITHUB_OWNER: 'owner',
            GITHUB_REPO: 'repo',
            GITHUB_BRANCH: 'main'
        });
        assert.equal(moved.status, 403, 'an externally changed ownership must be re-read and denied');
    } finally {
        JSON.stringify = originalStringify;
    }

    assert.equal(verifyCalls, 51, 'every upload still verifies its own token');
    assert.equal(teamReads, 51, 'active team metadata is checked for every upload');
    assert.equal(fullCatalogueReads, 2, 'the raw catalogue is parsed once per ETag version');
    assert.equal(conditionalCatalogueReads, 49, 'each later upload revalidates the cached ETag');
    assert.equal(bucketPuts, 50);
    assert.equal(keys.size, 50, 'each upload uses a unique server-generated R2 key');
    assert.deepEqual(putSizes, Array(50).fill(16));
    assert.equal(forbiddenBucketCalls, 0, 'uploads do not scan or read R2 objects');
    assert.deepEqual(logs, []);
    assert.ok(serializedLengths.every(length => length < 2000), 'uploads serialize only small response bodies');
});
