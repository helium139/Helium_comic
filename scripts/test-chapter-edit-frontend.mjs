import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createUploadProgress } from '../admin/upload-progress.mjs';

const source = await readFile(new URL('../admin/chapter.js', import.meta.url), 'utf8');
const saveStart = source.indexOf('async function save(){');
const editStart = source.indexOf('async function saveChapter(');
const editEnd = source.indexOf('function resetForm(){');
const progressAdapterStart = source.indexOf('function uploadProgressOptions(');
const saveFunction = source.slice(saveStart, source.indexOf('/* ===========================\n        NEW CHAPTER', saveStart));
const editFunction = source.slice(editStart, editEnd);
const progressAdapter = source.slice(progressAdapterStart);

function harness({ pages, updateChapter }) {
    const progressValues = [];
    const alerts = [];
    const uploaded = [];
    const calls = [];
    const context = {
        uploadBtn: { disabled: false, innerHTML: '' },
        uploadLog: { textContent: '' },
        progress: {},
        uploadProgress: createUploadProgress(value => progressValues.push(value)),
        paintProgress: async () => {},
        settleUploadProgress: async () => {},
        document: {
            getElementById: () => ({ classList: { add() {}, remove() {} } }),
            querySelectorAll: () => []
        },
        sortable: null,
        alert: message => alerts.push(message),
        console: { error() {} },
        mode: 'edit',
        mangas: { m: { chapters: [{ id: 2 }]} },
        mangaSelect: { value: 'm' },
        currentSlug: 'm',
        currentChapter: 2,
        currentStaff: {},
        assertCanManageManga() {},
        chapterTitle: { value: 'Edited' },
        chapterDate: { value: '2026-10-27' },
        rawCaughtUp: { checked: false },
        chapterLink: {},
        chapterLinkBox: { classList: { remove() {} } },
        chapterUrl: () => '/m/chapter/2',
        document: {
            getElementById: () => ({ classList: { add() {}, remove() {} } }),
            querySelectorAll: () => []
        },
        pageOrder: pages,
        newImages: pages.filter(page => page.type !== 'remote'),
        existingImages: pages.filter(page => page.type === 'remote'),
        stagedEditImages: new Set(),
        traceChapterEdit() {},
        renderPreview() {},
        log() {},
        updateChapter: async payload => {
            calls.push(payload);
            return updateChapter(payload, calls.length);
        },
        uploadImage: async file => {
            const name = `${file.name.replace(/\.[^.]+$/, '')}-staged-${uploaded.length + 1}.${file.name.split('.').pop()}`;
            const result = { key: `m/chap2/${name}`, name, url: `https://images.test/m/chap2/${name}` };
            uploaded.push({ file, result });
            return result;
        }
    };
    vm.createContext(context);
    vm.runInContext(progressAdapter, context);
    vm.runInContext(saveFunction, context);
    vm.runInContext(editFunction, context);
    return { context, uploaded, calls, alerts, progressValues };
}

function local(name, stagingName = null, type = stagingName ? 'staged' : 'local') {
    return { type, file: { name, size: 10, slice() {} }, stagingName };
}

function committed(payload) {
    return {
        chapter: {
            id: 2,
            pages: payload.pages,
            folder: 'https://images.test/m/chap2/_revision-123',
            images: payload.images.map((image, index) => `${index + 1}.${image.name.split('.').pop()}`)
        }
    };
}

test('eight successful uploads build ordered staging descriptors and send edit exactly once', async () => {
    const pages = Array.from({ length: 8 }, (_, index) => local(`page-${index + 1}.jpg`));
    const h = harness({ pages, updateChapter: payload => committed(payload) });

    await h.context.save();

    assert.equal(h.uploaded.length, 8);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(Array.from(h.calls[0].images, image => image.name),
        h.uploaded.map(({ result }) => result.name));
    assert.ok(h.calls[0].images.every(image => image.type === 'staged'));
    assert.equal(h.calls[0].pages, 8);
    assert.equal(h.progressValues.at(-1).percent, 100);
    assert.equal(h.progressValues.at(-1).state, 'success');
    assert.deepEqual(h.alerts, ['Đã lưu thành công.']);
});

test('mixed tray order excludes removed pages and includes existing and staged entries exactly once', async () => {
    const existing = name => ({ type: 'remote', sourceType: 'existing', name, url: `https://images.test/m/chap2/${name}` });
    const removed = existing('removed.webp');
    const firstNew = local('new-one.webp');
    const secondNew = local('new-two.jpg');
    const pages = [existing('3.webp'), firstNew, existing('1.jpg'), secondNew];
    const h = harness({ pages, updateChapter: payload => committed(payload) });

    await h.context.save();

    assert.equal(h.calls.length, 1);
    assert.deepEqual(Array.from(h.calls[0].images, item => `${item.type}:${item.name}`), [
        'existing:3.webp',
        `staged:${h.uploaded[0].result.name}`,
        'existing:1.jpg',
        `staged:${h.uploaded[1].result.name}`
    ]);
    assert.ok(!h.calls[0].images.some(item => item.name === removed.name));
    assert.equal(h.calls[0].pages, 4);
});

test('retry reuses tray staging names after edit request failure', async () => {
    const pages = [local('retry.jpg'), local('retry-2.webp')];
    const h = harness({
        pages,
        updateChapter: (payload, attempt) => {
            if (attempt === 1) throw new Error('temporary edit failure');
            return committed(payload);
        }
    });

    await h.context.save();
    assert.equal(h.uploaded.length, 2);
    assert.equal(h.calls.length, 1);
    assert.equal(h.context.uploadBtn.disabled, false);
    assert.ok(h.alerts.includes('temporary edit failure'));

    await h.context.save();
    assert.equal(h.uploaded.length, 2, 'successful staging uploads must not be repeated');
    assert.equal(h.calls.length, 2);
    assert.deepEqual(Array.from(h.calls[1].images, item => item.name),
        h.uploaded.map(({ result }) => result.name));
    assert.equal(h.progressValues.at(-1).percent, 100);
});

test('staged tray item without staging identity fails clearly and restores the save control', async () => {
    const h = harness({
        pages: [local('missing-name.jpg', null, 'staged')],
        updateChapter: payload => committed(payload)
    });

    await h.context.save();

    assert.equal(h.uploaded.length, 0);
    assert.equal(h.calls.length, 0);
    assert.ok(h.alerts.some(message => /Không thể xác định ảnh đã tải lên: missing-name\.jpg/.test(message)));
    assert.equal(h.progressValues.at(-1).state, 'error');
    assert.equal(h.context.uploadBtn.disabled, false);
});
