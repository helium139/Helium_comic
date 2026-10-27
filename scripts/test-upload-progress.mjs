import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createUploadProgress, bindUploadProgress } from '../admin/upload-progress.mjs';

function model(total) {
    const values = [];
    const progress = createUploadProgress(value => values.push(value));
    progress.reset(total);
    return { progress, values, last: () => values.at(-1) };
}
test('starts at zero; real completed conversion and upload advance gradually', () => {
    const f = model(4);
    assert.equal(f.last().percent, 0);
    f.progress.prepared(); assert.equal(f.last().percent, 10);
    f.progress.converting(0); assert.equal(f.last().percent, 10);
    f.progress.converted(0); assert.equal(f.last().percent, 21.25);
    f.progress.uploaded(0); assert.equal(f.last().percent, 30);
    f.progress.converted(1); assert.equal(f.last().percent, 41.25);
    f.progress.uploaded(1); assert.equal(f.last().percent, 50);
});
for (const total of [1, 12, 500]) test(`${total} images progress monotonically through publication and complete at exactly 100`, () => {
    const f = model(total);
    f.progress.prepared();
    for (let i = 0; i < total; i++) {
        f.progress.converting(i); f.progress.converted(i); f.progress.uploaded(i);
        assert.ok(f.last().percent <= 90);
    }
    assert.equal(f.last().percent, 90);
    f.progress.publishing(); assert.equal(f.last().percent, 90);
    f.progress.published(); assert.equal(f.last().percent, 98);
    assert.ok(f.values.every(value => value.percent < 100));
    f.progress.complete(); assert.equal(f.last().percent, 100);
    assert.equal(f.last().state, 'success');
    for (let i = 1; i < f.values.length; i++) assert.ok(f.values[i].percent >= f.values[i - 1].percent);
});
test('out-of-order and duplicate completions never regress or count twice', () => {
    const f = model(3);
    f.progress.prepared();
    for (const index of [2, 0, 1]) f.progress.converted(index);
    assert.equal(f.last().percent, 55);
    for (const index of [1, 1, 0, 2]) f.progress.uploaded(index);
    assert.equal(f.last().percent, 90);
    f.progress.prepared(); assert.equal(f.last().percent, 90);
});
test('failure preserves current progress, ignores late work and cannot complete; second upload resets', () => {
    const f = model(2);
    f.progress.prepared(); f.progress.converted(0); f.progress.uploaded(0);
    const before = f.last().percent;
    f.progress.fail('network failure');
    assert.equal(f.last().percent, before);
    assert.equal(f.last().state, 'error');
    f.progress.published(); f.progress.complete();
    assert.equal(f.last().percent, before);
    f.progress.reset(1);
    assert.equal(f.last().percent, 0); assert.equal(f.last().state, 'idle');
    f.progress.prepared(); f.progress.converted(0); f.progress.uploaded(0); f.progress.published(); f.progress.complete();
    assert.equal(f.last().percent, 100);
    f.progress.reset(2); assert.equal(f.last().percent, 0);
});
test('metadata-only edit reserves completion until update succeeds', () => {
    const f = model(0);
    f.progress.prepared(); assert.equal(f.last().percent, 90);
    f.progress.publishing(); f.progress.reordered(); assert.equal(f.last().percent, 94);
    f.progress.published(); assert.equal(f.last().percent, 98);
    f.progress.complete(); assert.equal(f.last().percent, 100);
});
test('renderer retains fill element and updates actual width, percentage, status, ARIA and reset classes', () => {
    const elements = Object.fromEntries(['progressFill', 'progressPercent', 'progressStatus', 'progressTrack'].map(id => [id, { style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }]));
    const classes = new Map();
    const root = { querySelector: selector => elements[selector.slice(1)], classList: { toggle: (name, value) => classes.set(name, value) }, setAttribute() {} };
    const fill = elements.progressFill;
    const progress = bindUploadProgress(root);
    progress.reset(2); progress.prepared(); progress.converted(0);
    assert.equal(fill.style.width, '32.5%');
    assert.equal(elements.progressPercent.textContent, '32%');
    assert.match(elements.progressStatus.textContent, /Đang tải ảnh/);
    assert.equal(elements.progressTrack.attributes['aria-valuenow'], '32.5');
    progress.fail('fail'); assert.equal(classes.get('is-error'), true);
    assert.equal(fill.style.width, '32.5%');
    progress.reset(1); assert.equal(fill.style.width, '0%'); assert.equal(classes.get('is-error'), false);
    progress.complete(); assert.equal(fill.style.width, '100%'); assert.equal(classes.get('is-success'), true);
    assert.equal(root.querySelector('#progressFill'), fill);
});
test('missing progress markup is diagnosed without preventing saving', () => {
    const error = console.error, messages = [];
    console.error = message => messages.push(message);
    try { bindUploadProgress(null).reset(1); assert.match(messages[0], /markup is missing/); }
    finally { console.error = error; }
});
test('both chapter HTML entrypoints contain persistent progress IDs and chapter code never replaces their container', async () => {
    for (const file of ['admin/chapter.html', 'admin/chapter/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        for (const id of ['progress', 'progressFill', 'progressTrack', 'progressPercent', 'progressStatus']) assert.equal(html.split(`id="${id}"`).length, 2);
    }
    const source = await readFile(new URL('../admin/chapter.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /progress\.(innerHTML|textContent)\s*=/);
});

const uploadSource = await readFile(new URL('../admin/api/upload.js', import.meta.url), 'utf8');
const conversionSource = await readFile(new URL('../admin/api/image-conversion.js', import.meta.url), 'utf8');
for (const failure of [null, 'conversion', 'upload', 'response']) test(`upload callbacks follow completed work (${failure || 'success'})`, async () => {
    const events = [];
    const context = { Blob, FormData, console,
        authenticatedFetch: async () => { events.push('request'); if (failure === 'upload') throw new Error('network'); return { json: async () => ({ success: failure !== 'response', url: 'https://images.test/m/chap1/1-id.webp' }) }; }
    };
    vm.createContext(context);
    vm.runInContext(conversionSource.replace(/export /g, ''), context);
    context.prepareImage = async file => {
        events.push('convert');
        if (failure === 'conversion') throw new Error('convert failed');
        return { file, filename: '1.webp' };
    };
    vm.runInContext(uploadSource.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
    const run = () => context.uploadImage(new Blob(['image']), 'm/chap1', '1.jpg', { onProgress: phase => events.push(phase) });
    if (failure) { await assert.rejects(run()); assert.ok(!events.includes('uploaded')); }
    else {
        assert.equal(await run(), 'https://images.test/m/chap1/1-id.webp');
        assert.deepEqual(events, ['converting', 'convert', 'converted', 'request', 'uploaded']);
    }
});

test('oversized JPEG conversion skip advances through upload without reporting an error', async () => {
    const events = [];
    const context = { Blob, FormData, console,
        authenticatedFetch: async (_url, options) => {
            events.push('request');
            assert.equal(options.body.get('filename'), '2.jpg');
            return { json: async () => ({ success: true, url: 'https://images.test/m/chap1/2-id.jpg' }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(conversionSource.replace(/export /g, ''), context);
    context.prepareImage = async file => {
        events.push('convert');
        return { file, filename: '2.jpg', reason: 'oversized-jpeg' };
    };
    vm.runInContext(uploadSource.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
    const url = await context.uploadImage(new Blob(['large JPEG']), 'm/chap1', '2.jpeg', {
        onProgress: phase => events.push(phase)
    });
    assert.equal(url, 'https://images.test/m/chap1/2-id.jpg');
    assert.deepEqual(events, ['converting', 'convert', 'preserved', 'converted', 'request', 'uploaded']);
});

test('unsafe-dimension JPEG conversion skip advances through upload without reporting an error', async () => {
    const events = [];
    const context = { Blob, FormData, console,
        authenticatedFetch: async (_url, options) => {
            events.push('request');
            assert.equal(options.body.get('filename'), '3.jpg');
            return { json: async () => ({ success: true, url: 'https://images.test/m/chap1/3-id.jpg' }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(conversionSource.replace(/export /g, ''), context);
    context.prepareImage = async file => {
        events.push('convert');
        return { file, filename: '3.jpg', reason: 'unsafe-canvas-dimensions' };
    };
    vm.runInContext(uploadSource.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
    const url = await context.uploadImage(new Blob(['tall JPEG']), 'm/chap1', '3.jpeg', {
        onProgress: phase => events.push(phase)
    });
    assert.equal(url, 'https://images.test/m/chap1/3-id.jpg');
    assert.deepEqual(events, ['converting', 'convert', 'preserved', 'converted', 'request', 'uploaded']);
});

test('skipped JPEG logs preservation and still completes conversion and upload progress', async () => {
    const source = await readFile(new URL('../admin/chapter.js', import.meta.url), 'utf8');
    const f = model(1), messages = [];
    const context = {
        uploadProgress: f.progress,
        paintProgress: async () => {},
        log: message => messages.push(message)
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function uploadProgressOptions(')), context);
    const options = context.uploadProgressOptions(0, { name: '2.jpeg' });
    await options.onProgress('converting');
    await options.onProgress('preserved', { filename: '2.jpg' });
    await options.onProgress('converted');
    await options.onProgress('uploaded');
    assert.deepEqual(messages, ['Giữ nguyên JPG: 2.jpg']);
    assert.equal(f.last().percent, 90);
    assert.equal(f.last().state, 'running');
});
