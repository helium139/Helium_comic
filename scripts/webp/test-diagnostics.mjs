import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect, formatFailure, migrate, parseArguments, references, REQUIRED_ENV } from './migrate.mjs';

test('startup reports every missing variable without secrets', async () => {
    await assert.rejects(connect({ env: {} }), error => {
        const diagnostic = JSON.parse(formatFailure(error, {}, {}));
        for (const name of REQUIRED_ENV) assert.ok(diagnostic.message.includes(name));
        assert.equal(diagnostic.stage, 'configuration');
        return true;
    });
});

test('argument diagnostics reject missing and invalid prefixes', () => {
    for (const prefix of [undefined, 'https://images.test/m/chap0/', 'm/chap0', '../m/']) {
        assert.throws(() => parseArguments(['--dry-run', '--scope', 'chapters', ...(prefix ? ['--prefix', prefix] : [])]), /prefix/);
    }
});

test('supplied chapter prefix discovers four legacy JPGs in repository catalogue', async () => {
    const data = JSON.parse(await readFile(new URL('../../assets/data/data.json', import.meta.url)));
    const prefix = 'nguoi-hau-trong-tu-kinh/chap0/';
    const base = data['nguoi-hau-trong-tu-kinh'].chapters[0].folder.split('/').slice(0, 3).join('/');
    assert.deepEqual(references(data, base, 'chapters', prefix).map(r => r.key), [1, 2, 3, 4].map(n => `${prefix}${n}.jpg`));
});

test('diagnostics redact environment secrets, headers, URL credentials and signed queries', () => {
    const env = { R2_SECRET_ACCESS_KEY: 'private/key', CUSTOM_TOKEN: 'custom-secret' };
    const failure = JSON.parse(formatFailure(new Error('private/key private%2Fkey custom-secret Authorization: Bearer abc123 https://user:pass@example.test/object?X-Amz-Signature=hidden'), {}, env));
    for (const secret of ['private/key', 'private%2Fkey', 'custom-secret', 'abc123', 'user:pass', 'hidden']) assert.ok(!JSON.stringify(failure).includes(secret));
});

for (const [stage, name, status, code] of [
    ['r2.head', 'NotFound', 404], ['r2.list', 'AccessDenied', 403],
    ['r2.get', 'Error', undefined, 'ENOTFOUND'], ['github.read', 'Error', 401],
    ['conversion.decode', 'Error'], ['verification.conversion', 'Error']
]) test(`preserves safe underlying ${stage}/${name} diagnostics`, () => {
    const cause = Object.assign(new Error('Underlying failure'), { name, code, $metadata: { httpStatusCode: status } });
    const error = Object.assign(new Error('Operation failed', { cause }), { stage, context: { key: 'm/chap0/1.jpg' } });
    const diagnostic = JSON.parse(formatFailure(error));
    assert.equal(diagnostic.stage, stage);
    assert.equal(diagnostic.class, name);
    assert.equal(diagnostic.cause, 'Underlying failure');
    assert.equal(diagnostic.key, 'm/chap0/1.jpg');
    if (status) assert.equal(diagnostic.httpStatus, status);
    if (stage.startsWith('r2.')) assert.ok(diagnostic.hint);
});

test('catalogue read and discovery failures preserve stages', async () => {
    const options = { prefix: 'm/', scope: 'chapters', base: 'https://img.test', store: { list() { assert.fail('must not list'); } } };
    await assert.rejects(migrate({ ...options, catalogue: { read: async () => { throw new Error('Catalogue unavailable'); } } }), error => error.stage === 'catalogue.read' && error.message === 'Catalogue unavailable');
    await assert.rejects(migrate({ ...options, catalogue: { read: async () => ({ data: {} }) } }), error => error.stage === 'catalogue.discovery');
});

test('dry-run traces HEAD, GET, conversion and catalogue plan without any writes', async () => {
    const calls = [], logs = [];
    const failWrite = () => assert.fail('dry-run attempted a write');
    const stats = await migrate({ prefix: 'm/chap0/', scope: 'chapters', base: 'https://img.test', limit: 1,
        catalogue: { read: async () => { calls.push('catalogue'); return { data: { m: { chapters: [{ id: 0, pages: 1, folder: 'https://img.test/m/chap0' }] } } }; }, save: failWrite },
        store: { list: async prefix => { calls.push(`list:${prefix}`); return ['m/chap0/1.jpg']; }, head: async key => { calls.push(`head:${key}`); }, get: async key => { calls.push(`get:${key}`); return { bytes: Buffer.alloc(100) }; }, put: failWrite },
        encode: async () => { calls.push('convert'); return Buffer.alloc(40); }, journal: failWrite, log: value => logs.push(value)
    });
    assert.deepEqual(calls, ['catalogue', 'list:m/chap0/', 'head:m/chap0/1.jpg', 'get:m/chap0/1.jpg', 'convert']);
    assert.equal(stats.converted, 1);
    assert.ok(logs.some(line => line.includes('Would update catalogue: m.chapters[id=0].images[0] -> m/chap0/1.webp')));
});

test('configuration uses supplied process environment only', async () => {
    await assert.rejects(connect({ env: {} }), /Missing required environment variables: R2_PUBLIC_URL/);
});
