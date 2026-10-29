import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterEvents, deliverEvents, sendDiscord, openLedger, baselineRef } from './discord-delivery.mjs';
import { execFileSync } from 'node:child_process';

const catalogue = (ids, slug = 'manga') => ({ [slug]: { title: slug, chapters: ids.map(id => ({ id, title: `Chapter ${id}` })) } });
function harness() {
    const state = { delivered: {} }, sent = [], ready = [], saved = [];
    const options = { ready: async e => ready.push(e.key), send: async e => sent.push(e.key),
        save: async s => saved.push(structuredClone(s)) };
    return { state, sent, ready, saved, options, run: events => deliverEvents(events, state, options) };
}

test('rapid sequential publishes deliver every chapter without a time guard', async () => {
    const h = harness();
    await h.run(chapterEvents(catalogue([10]), {}));
    await h.run(chapterEvents(catalogue([10, 11]), {}));
    assert.equal(h.sent.length, 2);
});

test('multi-chapter update sends all in deterministic numeric order, including recovered pending runs', async () => {
    const h = harness();
    const events = chapterEvents(catalogue([12, 10, 11]), catalogue([9]));
    assert.deepEqual(events.map(e => e.chapter.id), [10, 11, 12]);
    await h.run(events);
    assert.equal(h.sent.length, 3);
    assert.equal(h.saved.length, 3);
    assert.deepEqual(chapterEvents(catalogue([11, 12, 10]), catalogue([9])).map(e => e.key), events.map(e => e.key));
});

test('same event retry skips Discord but retains Firebase handoff', async () => {
    const h = harness(), events = chapterEvents(catalogue([10]), {}), handoff = [];
    h.options.onDelivered = async e => handoff.push(e.key);
    await h.run(events);
    await h.run(events);
    assert.equal(h.sent.length, 1);
    assert.equal(h.ready.length, 1);
    assert.equal(handoff.length, 2);
    const restarted = harness();
    restarted.state.delivered = h.saved.at(-1).delivered;
    await restarted.run(events);
    assert.equal(restarted.sent.length, 0);
});

test('successful Discord response is followed by receipt save; failed response is not recorded', async () => {
    const events = chapterEvents(catalogue([10]), {});
    const successful = harness(), order = [];
    successful.options.send = async () => order.push('discord');
    successful.options.save = async state => {
        order.push('receipt');
        successful.saved.push(structuredClone(state));
    };
    await successful.run(events);
    assert.deepEqual(order, ['discord', 'receipt']);
    assert.equal(successful.saved[0].delivered[events[0].key], true);

    const failed = harness();
    failed.options.send = async () => { throw Error('Discord rejected delivery'); };
    await assert.rejects(failed.run(events), /Discord rejected delivery/);
    assert.equal(failed.saved.length, 0);
    assert.deepEqual(failed.state.delivered, {});
});

test('failed delivery remains retryable; partial success is preserved', async () => {
    const h = harness(), events = chapterEvents(catalogue([10, 11]), {});
    h.options.send = async e => { if (e.chapter.id === 11) throw Error('failed'); h.sent.push(e.key); };
    await assert.rejects(h.run(events), /failed/);
    assert.equal(Object.keys(h.state.delivered).length, 1);
    h.options.send = async e => h.sent.push(e.key);
    await h.run(events);
    assert.deepEqual(h.sent, events.map(e => e.key));
});

test('different manga and different chapter IDs have distinct identities', async () => {
    const h = harness();
    await h.run(chapterEvents({ ...catalogue([10, 11], 'a'), ...catalogue([10], 'b') }, {}));
    assert.equal(new Set(h.sent).size, 3);
});

test('historical baseline chapters are not replayed; duplicate catalogue IDs collapse', () => {
    assert.deepEqual(chapterEvents(catalogue([9, 10, '10']), catalogue([9])).map(e => String(e.chapter.id)), ['10']);
});

test('429 waits for Retry-After and retries same payload before next event', async () => {
    const waits = [], bodies = [];
    const replies = [new Response('{"retry_after":0.5}', { status: 429, headers: { 'Retry-After': '1.25' } }), new Response('{}')];
    await sendDiscord('https://discord.com/api/webhooks/test/token', { content: 'chapter10' }, {
        request: async (url, init) => { assert.equal(url.searchParams.get('wait'), 'true'); bodies.push(init.body); return replies.shift(); },
        pause: async ms => waits.push(ms)
    });
    assert.deepEqual(waits, [1250]);
    assert.equal(bodies[0], bodies[1]);
});

test('exhausted 429 and rejected Discord responses remain failures without leaking response bodies', async () => {
    for (const status of [429, 400, 500]) {
        await assert.rejects(sendDiscord('https://discord.com/api/webhooks/test/secret', {}, {
            attempts: 2, pause: async () => {}, request: async () => new Response('{"message":"secret"}', { status })
        }), e => !e.message.includes('secret') && e.message.includes(String(status)));
    }
});

test('readiness failure prevents sending and recording', async () => {
    const h = harness();
    h.options.ready = async () => { throw Error('not ready'); };
    await assert.rejects(h.run(chapterEvents(catalogue([10]), {})), /not ready/);
    assert.equal(h.sent.length, 0);
    assert.equal(h.saved.length, 0);
});

test('production notifier entry point parses', () => {
    execFileSync(process.execPath, ['--check', 'scripts/discord-notify.mjs']);
});

test('ledger write failure stops queue instead of falsely confirming later chapters', async () => {
    const h = harness();
    h.options.save = async () => { throw Error('ledger unavailable'); };
    await assert.rejects(h.run(chapterEvents(catalogue([10, 11]), {})), /ledger unavailable/);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.state.delivered, {});
});

test('transport errors are sanitized and are not automatically reposted', async () => {
    let calls = 0;
    await assert.rejects(sendDiscord('https://discord.com/api/webhooks/test/secret', {}, {
        request: async () => { calls++; throw Error('https://discord.com/api/webhooks/test/secret'); }
    }), e => !e.message.includes('secret'));
    assert.equal(calls, 1);
});

test('existing ledger branch and file load and save with Contents API CAS', async () => {
    let stored, version = 0;
    const methods = [], requests = [];
    const request = async (url, init) => {
        methods.push(init.method);
        requests.push({ url, method: init.method });
        assert.equal(init.headers.Authorization, 'Bearer secret');
        if (url.endsWith('/git/ref/heads/discord-delivery-state')) {
            return Response.json({ ref: 'refs/heads/discord-delivery-state' });
        }
        if (init.method === 'GET') return stored ? Response.json(stored) : new Response('', { status: 404 });
        const body = JSON.parse(init.body);
        assert.equal(body.branch, 'discord-delivery-state');
        assert.equal(body.sha, stored?.sha);
        stored = { content: body.content, sha: String(++version) };
        return Response.json({ content: { sha: stored.sha } });
    };
    const ledger = await openLedger({ repository: 'owner/repo', token: 'secret', request });
    assert.equal(ledger.state.baseline, baselineRef);
    await ledger.save({ ...ledger.state, delivered: { chapter10: true } });
    const reloaded = await openLedger({ repository: 'owner/repo', token: 'secret', request });
    assert.equal(reloaded.state.delivered.chapter10, true);
    assert.equal(methods.filter(m => m === 'PUT').length, 2);
    assert.ok(requests.every(({ url, method }) => !(method === 'POST' && url.endsWith('/git/refs'))));
    assert.equal(requests.filter(({ url, method }) =>
        method === 'PUT' && url === 'https://api.github.com/repos/owner/repo/contents/discord-delivery.json').length, 2);
});

test('existing ledger branch with missing file creates ledger on that branch', async () => {
    const requests = [];
    const request = async (url, init) => {
        requests.push({ url, method: init.method, body: init.body });
        if (url.endsWith('/git/ref/heads/discord-delivery-state')) {
            return Response.json({ ref: 'refs/heads/discord-delivery-state' });
        }
        if (init.method === 'GET') return new Response('', { status: 404 });
        return Response.json({ content: { sha: 'initial-ledger-sha' } });
    };
    const ledger = await openLedger({ repository: 'owner/repo', token: 'secret', request });
    assert.deepEqual(ledger.state, { baseline: baselineRef, delivered: {} });
    const createFile = requests.find(({ method }) => method === 'PUT');
    assert.ok(createFile);
    assert.equal(createFile.url, 'https://api.github.com/repos/owner/repo/contents/discord-delivery.json');
    assert.equal(JSON.parse(createFile.body).branch, 'discord-delivery-state');
    assert.ok(requests.every(({ url, method }) => !(method === 'POST' && url.endsWith('/git/refs'))));
});

test('missing ledger branch reports manual setup and never creates a ref', async () => {
    const requests = [];
    await assert.rejects(openLedger({
        repository: 'owner/repo',
        token: 'secret',
        request: async (url, init) => {
            requests.push({ url, method: init.method });
            return new Response('', { status: 404 });
        }
    }), /Discord delivery ledger branch "discord-delivery-state" does not exist\. Create it manually once from main, then rerun the workflow\./);
    assert.deepEqual(requests, [{
        url: 'https://api.github.com/repos/owner/repo/git/ref/heads/discord-delivery-state',
        method: 'GET'
    }]);
});

test('ledger API 403 includes GitHub message and endpoint without exposing token', async () => {
    const token = 'secret-do-not-log-123';
    const requests = [];
    await assert.rejects(openLedger({
        repository: 'owner/repo',
        token,
        request: async (url, init) => {
            requests.push({ url, method: init.method });
            return Response.json({ message: `Resource not accessible by integration: ${token}` }, { status: 403 });
        }
    }), error => {
        assert.match(error.message, /GET \/git\/ref\/heads\/discord-delivery-state failed \(HTTP 403\)/);
        assert.match(error.message, /Resource not accessible by integration/);
        assert.doesNotMatch(error.message, /secret-do-not-log-123/);
        return true;
    });
    assert.deepEqual(requests, [{
        url: 'https://api.github.com/repos/owner/repo/git/ref/heads/discord-delivery-state',
        method: 'GET'
    }]);
});
