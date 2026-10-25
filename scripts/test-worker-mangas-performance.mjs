import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../worker/source/worker.js';

const catalogue = await readFile(new URL('../assets/data/data.json', import.meta.url), 'utf8');

test('public mangas streams the large raw catalogue with one upstream request', async () => {
    assert.ok(Buffer.byteLength(catalogue) > 300_000, 'performance fixture should remain representative of production');
    const requests = [];
    const worker = createWorker({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return new Response(catalogue, { headers: { 'Content-Type': 'application/vnd.github.raw+json' } });
        },
        log: () => assert.fail('A successful public catalogue read must not log an error')
    });
    const response = await worker.fetch(new Request('https://cms.test/mangas'), {
        GITHUB_OWNER: 'helium139',
        GITHUB_REPO: 'Helium_comic',
        GITHUB_BRANCH: 'main'
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(await response.text(), catalogue);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.headers.Accept, 'application/vnd.github.raw+json');
    assert.match(requests[0].url, /\/contents\/assets\/data\/data\.json\?ref=main$/);
});
