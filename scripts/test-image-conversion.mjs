import { createUploadProgress } from "../admin/upload-progress.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../admin/api/image-conversion.js', import.meta.url), 'utf8');

function browser({ type = 'image/webp', size = 20, fail = false } = {}) {
    let closed = 0, decoded = 0, canvas, quality;
    const context = { Uint8Array, DataView,
        createImageBitmap: async () => { decoded++; return { width: 800, height: 1200, close: () => closed++ }; },
        document: { createElement: () => (canvas = { width: 0, height: 0,
            getContext: () => ({ drawImage() {} }),
            toBlob(callback, mime, q) { quality = q; callback(fail ? null : new Blob(['x'.repeat(size)], { type })); }
        }) }
    };
    vm.createContext(context); vm.runInContext(source.replace(/export /g, ''), context);
    return { prepare: context.prepareImage, closed: () => closed, decoded: () => decoded, canvas: () => canvas, quality: () => quality };
}
for (const ext of ['jpg', 'jpeg', 'png']) test(`browser ${ext} becomes WebP with correct name, type and quality`, async () => {
    const b = browser(); const input = new Blob(['x'.repeat(100)], { type: ext === 'png' ? 'image/png' : 'image/jpeg' });
    const result = await b.prepare(input, `001.${ext}`);
    assert.equal(result.filename, '001.webp'); assert.equal(result.file.type, 'image/webp');
    assert.equal(b.quality(), 0.85); assert.equal(b.closed(), 1); assert.equal(b.canvas().width, 0);
});
test('small JPEG still converts to WebP', async () => {
    const b = browser({ size: 1 });
    const input = new Blob([Uint8Array.of(255, 216, 255, 217), 'small JPEG'], { type: 'image/jpeg' });
    const result = await b.prepare(input, '1.jpg', 0.85, { maxJpegConversionSize: 5 * 1024 * 1024 });
    assert.equal(result.reason, 'converted');
    assert.equal(result.filename, '1.webp');
    assert.equal(result.file.type, 'image/webp');
    assert.equal(b.decoded(), 1);
});
test('oversized JPEG is preserved without decoding and .jpeg normalizes to .jpg', async () => {
    const b = browser();
    const input = new Blob([Uint8Array.of(255, 216, 255, 217), new Uint8Array(5 * 1024 * 1024)], { type: 'image/jpeg' });
    const result = await b.prepare(input, '2.jpeg', 0.85, { maxJpegConversionSize: 5 * 1024 * 1024 });
    assert.equal(result.file, input);
    assert.equal(result.filename, '2.jpg');
    assert.equal(result.reason, 'oversized-jpeg');
    assert.equal(b.decoded(), 0);
    assert.equal(b.closed(), 0);
});
for (const ext of ['webp', 'gif', 'avif']) test(`${ext} passes through without decoding`, async () => {
    const b = browser(), input = new Blob(['x']); const result = await b.prepare(input, `1.${ext}`);
    assert.equal(result.file, input); assert.equal(b.closed(), 0);
});
test('unsupported encoder or larger output keeps the original', async () => {
    const file = new Blob(['x'.repeat(100)]);
    for (const options of [{ type: 'image/png' }, { size: 100 }, { size: 101 }]) {
        const result = await browser(options).prepare(file, '1.jpg'); assert.equal(result.file, file); assert.equal(result.filename, '1.jpg');
    }
});
test('conversion failure rejects and releases bitmap/canvas', async () => {
    const b = browser({ fail: true });
    await assert.rejects(b.prepare(new Blob(['x']), '1.jpg'), /conversion failed/);
    assert.equal(b.closed(), 1); assert.equal(b.canvas().width, 0);
});

test('conversion failure names the exact source file', async () => {
    const file = new Blob(['x']); Object.defineProperty(file, 'name', { value: 'page-10.jpg' });
    await assert.rejects(browser({ fail: true }).prepare(file, '2.jpg'), /page-10\.jpg/);
});
test('cover uses requested 0.88 quality', async () => {
    const b = browser(); await b.prepare(new Blob(['x'.repeat(100)]), 'cover.jpg', 0.88); assert.equal(b.quality(), 0.88);
});

test('APNG animation chunk bypasses canvas conversion', async () => {
    const bytes = new Uint8Array(28);
    bytes.set([0, 0, 0, 8], 8); bytes.set([... 'acTL'].map(c => c.charCodeAt(0)), 12);
    const file = new Blob([bytes]); const b = browser();
    assert.equal((await b.prepare(file, '1.png')).file, file); assert.equal(b.closed(), 0);
});

test('GIF/WebP bytes disguised with a JPG filename are not flattened', async () => {
    for (const signature of ['GIF89a', 'RIFF1234WEBP']) {
        const b = browser(), file = new Blob([signature]);
        assert.equal((await b.prepare(file, '1.jpg')).file, file); assert.equal(b.closed(), 0);
    }
});

test('EXIF-oriented JPEG stays original to preserve visual orientation', async () => {
    const bytes = new Uint8Array(40);
    bytes.set([255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0]);
    const view = new DataView(bytes.buffer);
    view.setUint16(22, 0x112, true); view.setUint16(24, 3, true); view.setUint32(26, 1, true); view.setUint16(30, 6, true);
    bytes.set([255, 217], 38);
    const file = new Blob([bytes]), b = browser();
    assert.equal((await b.prepare(file, 'cover.jpg')).file, file); assert.equal(b.closed(), 0);
});

const chapterSource = await readFile(new URL('../admin/chapter.js', import.meta.url), 'utf8');
// Function-level chapter fixtures use the real progress model and callback adapter.
function withProgress(context) {
    context.uploadProgress = createUploadProgress();
    context.uploadProgress.reset(context.newImages?.length || 0);
    context.paintProgress = async () => {};
    return context;
}
function chapterContext(context) {
    vm.createContext(withProgress(context));
    vm.runInContext(chapterSource.slice(chapterSource.indexOf('function uploadProgressOptions(')), context);
}

for (const rawValue of [undefined, false, true]) for (const fail of [false, true]) test(`chapter uploads (raw=${rawValue}) sequentially and ${fail ? 'does not publish after upload failure' : 'publishes returned filenames in order'}`, async () => {
    let active = 0, maximum = 0, published;
    const context = {
        mangaSelect: { value: 'manga' }, mangas: { manga: {} }, currentStaff: {}, assertCanManageManga() {},
        chapterNumber: { value: '1' }, chapterTitle: { value: 'Title' }, progress: {},
        pageOrder: [], newImages: [{ name: 'a.jpg' }, { name: 'b.png' }], log() {},
        uploadImage: async (file, folder, name) => {
            active++; maximum = Math.max(active, maximum); await Promise.resolve(); active--;
            if (fail) throw new Error('Upload failed');
            return `https://images.test/${folder}/${name.replace(/\.[^.]+$/, '.webp')}`;
        },
        publishChapter: async value => { published = value; }, chapterUrl: () => '/chapter/',
        chapterLink: {}, chapterLinkBox: { classList: { remove() {} } }, document: { getElementById: () => ({}) }
    };
    chapterContext(context);
    vm.runInContext(chapterSource.slice(chapterSource.indexOf('async function uploadChapter('), chapterSource.indexOf('async function saveChapter(')), context);
    if (fail) { await assert.rejects(context.uploadChapter(rawValue), /Upload failed/); assert.equal(published, undefined); }
    else { await context.uploadChapter(rawValue); assert.deepEqual(Array.from(published.images), ['1.webp', '2.webp']); assert.equal(published.isRawCaughtUp, rawValue === true); }
    assert.equal(maximum, 1);
});

test('100-page upload keeps selection order and at most one upload active', async () => {
    let active = 0, maximum = 0, published; const seen = [];
    const files = ['1.jpg', '2.jpg', '10.jpg', ...Array.from({ length: 97 }, (_, i) => `${i+11}.jpg`)].map(name => ({ name }));
    const c = { mangaSelect: { value: 'm' }, mangas: { m: {} }, currentStaff: {}, assertCanManageManga() {},
        chapterNumber: { value: '1' }, chapterTitle: { value: 'Title' }, progress: {}, newImages: files,
        pageOrder: [], log() {}, uploadImage: async (file, folder, name) => {
            active++; maximum = Math.max(maximum, active); seen.push(file.name); await Promise.resolve(); active--;
            return `https://images.test/${folder}/${name}`;
        }, publishChapter: async data => { published = data; }, chapterUrl: () => '/', chapterLink: {},
        chapterLinkBox: { classList: { remove() {} } }, document: { getElementById: () => ({}) }
    };
    chapterContext(c); vm.runInContext(chapterSource.slice(chapterSource.indexOf('async function uploadChapter('), chapterSource.indexOf('async function saveChapter(')), c);
    await c.uploadChapter(); assert.equal(maximum, 1); assert.deepEqual(seen, files.map(file => file.name));
    assert.equal(published.images.length, 100);
});

test('dragging a new page between remote pages preserves the displayed order', () => {
    const a = { type: 'remote', name: '1.jpg' }, b = { type: 'remote', name: '2.png' }, added = { name: '10.jpg' };
    let options;
    const c = { sortable: null, preview: {}, existingImages: [a, b], newImages: [added], pageOrder: [a, b, added],
        renderPreview() {}, Sortable: { create: (element, value) => { options = value; return {}; } } };
    vm.createContext(c); vm.runInContext(chapterSource.slice(chapterSource.indexOf('function initSortable(){'), chapterSource.indexOf('preview.addEventListener("click"')), c);
    c.initSortable(); options.onEnd({ oldIndex: 2, newIndex: 1 });
    assert.deepEqual(Array.from(c.pageOrder, img => img.name), ['1.jpg', '10.jpg', '2.png']);
});

for (const rawValue of [undefined, false, true]) for (const failure of [undefined, 'upload', 'rename', 'update']) test(`chapter edit (raw=${rawValue}) ${failure ? failure + ' failure retains queue' : 'saves exact displayed order and returned filenames'}`, async () => {
    const a = { type: 'remote', name: '1.jpg' }, b = { type: 'remote', name: '2.png' }, added = { name: '10.jpg' };
    let renamedSources, saved;
    const c = { currentStaff: {}, assertCanManageManga() {}, currentSlug: 'm', currentChapter: 0,
        mangas: { m: { chapters: [{ id: 0, folder: 'https://img.test/m/chap0' }] } },
        existingImages: [a, b], newImages: [added], pageOrder: [a, added, b], progress: {}, log() {},
        uploadImage: async () => { if (failure === 'upload') throw Error('upload'); return 'https://img.test/m/chap0/3.webp'; },
        renameImages: async body => { if (failure === 'rename') throw Error('rename'); renamedSources = body.images; return { images: ['1.webp', '2.webp', '3.png'] }; },
        updateChapter: async body => { if (failure === 'update') throw Error('update'); saved = body; },
        chapterTitle: { value: 'Edit' }, chapterDate: { value: '2026-01-01' }, renderPreview() {},
        chapterUrl: () => '/', chapterLink: {}, chapterLinkBox: { classList: { remove() {} } }, document: { getElementById: () => ({}) }
    };
    chapterContext(c); vm.runInContext(chapterSource.slice(chapterSource.indexOf('async function saveChapter('), chapterSource.indexOf('function resetForm(){')), c);
    if (failure) {
        await assert.rejects(c.saveChapter(rawValue), new RegExp(failure));
        assert.equal(c.newImages[0], added); assert.equal(c.existingImages[0], a); assert.equal(saved, undefined);
    } else {
        await c.saveChapter(rawValue); assert.deepEqual(Array.from(renamedSources), ['1.jpg', '3.webp', '2.png']);
        assert.deepEqual(Array.from(saved.images), ['1.webp', '2.webp', '3.png']); assert.equal(saved.isRawCaughtUp, rawValue === true); assert.equal(c.newImages.length, 0);
    }
});

test('preview rerender releases object URLs and requests lazy image decoding', () => {
    const revoked = [], created = []; const file = { name: 'a.jpg' };
    const c = { previewObjectUrls: ['old-url'], pageOrder: [], existingImages: [], newImages: [file],
        preview: { innerHTML: '', appendChild() {} }, updateStats() {}, initSortable() {},
        URL: { revokeObjectURL: url => revoked.push(url), createObjectURL: () => 'new-url' },
        document: { createElement: tag => { const element = { dataset: {}, append() {} }; if (tag === 'img') created.push(element); return element; } }
    };
    vm.createContext(c); vm.runInContext(chapterSource.slice(chapterSource.indexOf('function renderPreview(){'), chapterSource.indexOf('function initSortable(){')), c);
    c.renderPreview(); assert.deepEqual(revoked, ['old-url']); assert.equal(created[0].loading, 'lazy'); assert.equal(created[0].decoding, 'async');
    created[0].onload(); assert.ok(revoked.includes('new-url'));
});

const readerSource = await readFile(new URL('../assets/js/comicchap.js', import.meta.url), 'utf8');
for (const images of [undefined, ['1.png', '2.jpg', '3.png'], ['1.webp', '2.jpg', '3.png'], ['1-6a294080-018b-4e4a-b5d2-1d945dba7afa.webp', '2.jpg', '3.png']]) test(`reader preserves ${images ? images.join('/') : 'legacy JPG'} page paths and order`, () => {
    const reader = { innerHTML: '' }, chapter = { folder: 'https://img.test/m/chap0', pages: 3, ...(images ? { images } : {}) };
    const c = { chapter, document: { getElementById: () => reader } };
    vm.createContext(c); vm.runInContext(readerSource.slice(readerSource.indexOf('    const reader ='), readerSource.indexOf('    const firstImage =')), c);
    const paths = [...reader.innerHTML.matchAll(/src="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(paths, (images || ['1.jpg', '2.jpg', '3.jpg']).map(name => `${chapter.folder}/${name}`));
});

test('new chapter numbers uploads from final displayed order, preserving actual mixed extensions', async () => {
    const first = { name: 'first.jpg' }, second = { name: 'second.png' }, third = { name: 'third.jpg' };
    const seen = []; let saved;
    const c = { mangaSelect: { value: 'm' }, mangas: { m: { chapters: [] } }, currentStaff: {}, assertCanManageManga() {},
        chapterNumber: { value: '4' }, chapterTitle: { value: 'New' }, progress: {},
        newImages: [first, second, third], pageOrder: [third, first, second],
        log() {}, uploadImage: async (file, folder, name) => {
            seen.push([file.name, name]);
            const ext = file === first ? 'jpg' : file === second ? 'png' : 'webp';
            return `https://images.test/${folder}/${name.split('.')[0]}-6a294080-018b-4e4a-b5d2-1d945dba7afa.${ext}`;
        }, publishChapter: async value => { saved = value; }, chapterUrl: () => '/', chapterLink: {},
        chapterLinkBox: { classList: { remove() {} } }, document: { getElementById: () => ({}) }
    };
    chapterContext(c); vm.runInContext(chapterSource.slice(chapterSource.indexOf('async function uploadChapter('), chapterSource.indexOf('async function saveChapter(')), c);
    await c.uploadChapter();
    assert.deepEqual(seen, [['third.jpg', '1.jpg'], ['first.jpg', '2.jpg'], ['second.png', '3.png']]);
    assert.deepEqual(Array.from(saved.images, name => name.split('.').pop()), ['webp', 'jpg', 'png']);
});
