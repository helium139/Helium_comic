import { fail, imageName, uploadFolder } from './cms-authorization.js';
import { imageFormat } from './image-format.js';

const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const DEFAULT_R2_TIMEOUT_MS = 30_000;

function bounded(operation, timeoutMs, label) {
    let timer;
    return Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`${label} timed out`);
                error.name = 'TimeoutError';
                reject(error);
            }, timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

async function mapLimit(values, limit, callback) {
    const results = new Array(values.length);
    let next = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (true) {
            if (failure) return;
            const index = next++;
            if (index >= values.length) return;
            try {
                results[index] = await callback(values[index], index);
            } catch (error) {
                failure ||= error;
            }
        }
    }));
    if (failure) throw failure;
    return results;
}

// Final keys are immutable here: a failed publish can leave unreferenced objects,
// but must never replace bytes used by the current or an older deployed catalogue.
function validateChapterObjectFolder(root, folder) {
    const revisionPrefix = `${root}/_revision-`;
    const revision = folder.startsWith(revisionPrefix) ? folder.slice(revisionPrefix.length) : '';
    if (uploadFolder(root).chapterId === null ||
        folder !== root && !/^\d+(?:-\d+)?$/.test(revision)) {
        fail(400, 'Invalid chapter folder');
    }
}

export async function promoteChapterPages(bucket, folder, names, {
    committed = false, sourceFolders, destinationFolder = folder,
    timeoutMs = DEFAULT_R2_TIMEOUT_MS, concurrency = 4
} = {}) {
    validateChapterObjectFolder(folder, folder);
    validateChapterObjectFolder(folder, destinationFolder);
    if (sourceFolders && (!Array.isArray(sourceFolders) || sourceFolders.length !== names.length)) {
        fail(400, 'Invalid chapter source folders');
    }
    const plan = names.map((name, index) => {
        imageName(name);
        const extension = name.split('.').pop().replace('jpeg', 'jpg');
        const sourceFolder = sourceFolders?.[index] || folder;
        validateChapterObjectFolder(folder, sourceFolder);
        return {
            source: `${sourceFolder}/${name}`,
            destination: `${destinationFolder}/${index + 1}.${extension}`
        };
    });
    async function read(key) {
        const object = await bounded(() => bucket.get(key), timeoutMs, 'R2 image read');
        if (!object) fail(409, 'Chapter image unavailable; reload before retrying');
        const bytes = new Uint8Array(await bounded(
            () => new Response(object.body).arrayBuffer(), timeoutMs, 'R2 image body read'
        ));
        const format = imageFormat(bytes.subarray(0, 32));
        const ext = key.split('.').pop().replace('jpeg', 'jpg');
        if (!bytes.length || bytes.length > 32 * 1024 * 1024 || !format || format[0] !== ext || object.httpMetadata?.contentType !== format[1]) fail(400, 'Invalid chapter image bytes or type');
        return { bytes, hash: await digest(bytes), httpMetadata: object.httpMetadata };
    }
    const concurrencyLimit = Math.max(1, Math.min(3, concurrency));
    await mapLimit(plan, concurrencyLimit, async item => {
        let source;
        if (committed && !await bounded(() => bucket.head(item.source), timeoutMs, 'R2 image metadata read')) {
            item.sourceKey = item.destination;
            source = await read(item.destination);
        } else {
            item.sourceKey = item.source;
            source = await read(item.source);
        }
        const current = await bounded(() => bucket.head(item.destination), timeoutMs, 'R2 image metadata read');
        item.hash = source.hash;
        if (current) {
            const existing = item.sourceKey === item.destination ? source : await read(item.destination);
            if (existing.hash !== source.hash) {
                fail(409, 'Numbered page already exists with different content; published images retained');
            }
            item.reuse = true;
        }
    });

    await mapLimit(plan, concurrencyLimit, async item => {
        if (item.reuse) return;
        const source = await read(item.sourceKey);
        if (source.hash !== item.hash) fail(409, 'Chapter source changed during promotion');
        const stored = await bounded(() => bucket.put(item.destination, source.bytes, {
            httpMetadata: source.httpMetadata, onlyIf: { etagDoesNotMatch: '*' }
        }), timeoutMs, 'R2 image write');
        if (!stored) fail(409, 'Numbered page changed during promotion; retry after reloading');
        const verified = await bounded(() => bucket.head(item.destination), timeoutMs, 'R2 image verification');
        if (!verified || verified.size !== source.bytes.length ||
            (stored.etag && verified.etag && stored.etag !== verified.etag)) {
            fail(409, 'Numbered page verification failed');
        }
        if (!verified.etag || verified.size === undefined) {
            if ((await read(item.destination)).hash !== source.hash) fail(409, 'Numbered page verification failed');
        }
    });
    return plan.map(item => item.destination.slice(destinationFolder.length + 1));
}

export const stagingName = /^[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:webp|jpg|jpeg|png|gif|avif)$/;

// Include explicit strings anywhere, chapter-relative names, and legacy implicit pages.
export function catalogueKeys(data, base) {
    const used = new Set();
    const walk = value => {
        if (typeof value === 'string') {
            used.add(value);
            if (value.startsWith(base + '/')) used.add(decodeURIComponent(value.slice(base.length + 1).split(/[?#]/)[0]));
        } else if (value && typeof value === 'object') {
            if (typeof value.folder === 'string' && value.pages) {
                const folder = value.folder.startsWith(base + '/') ? value.folder.slice(base.length + 1) : value.folder;
                for (const name of value.images || Array.from({ length: value.pages }, (_, i) => `${i + 1}.jpg`)) used.add(`${folder}/${name}`);
            }
            Object.values(value).forEach(walk);
        }
    };
    walk(data);
    return used;
}

export async function cleanupChapterSources(bucket, folder, names, catalogue, base, destinationFolder = folder) {
    const used = catalogueKeys(catalogue, base);
    // Revalidate every surviving source against its final before any deletion.
    await promoteChapterPages(bucket, folder, names, { committed: true, destinationFolder });
    for (const name of names) {
        const key = `${folder}/${name}`;
        if (stagingName.test(name) && !used.has(key) && !used.has(name)) await bucket.delete(key);
    }
}

export async function cleanupEditedChapterSources(bucket, {
    root, oldFolder, oldNames, stagedNames, destinationFolder, catalogue, base, owner,
    timeoutMs = DEFAULT_R2_TIMEOUT_MS, maxListPages = 100
}) {
    validateChapterObjectFolder(root, oldFolder);
    validateChapterObjectFolder(root, destinationFolder);
    const used = catalogueKeys(catalogue, base);
    const stagedKeys = new Set(stagedNames.map(name => `${root}/${name}`));
    const candidateKeys = new Set([
        ...oldNames.filter(name => /^\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(name))
            .map(name => `${oldFolder}/${name}`),
        ...stagedKeys
    ]);
    let cursor;
    let listPages = 0;
    do {
        if (++listPages > maxListPages) throw new Error('Chapter object cleanup exceeded its page limit');
        const page = await bounded(() => bucket.list({ prefix: `${root}/`, limit: 1000, cursor }), timeoutMs, 'R2 chapter listing');
        if (!page || !Array.isArray(page.objects)) throw new Error('Chapter object listing returned an invalid page');
        for (const object of page.objects) {
            const relative = object.key.slice(root.length + 1);
            if (/^\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(relative) ||
                /^_revision-\d+(?:-\d+)?\/\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(relative) ||
                stagedKeys.has(object.key)) candidateKeys.add(object.key);
        }
        if (!page.truncated || page.objects.length === 0) break;
        if (!page.cursor || page.cursor === cursor) throw new Error('Chapter object listing did not advance');
        cursor = page.cursor;
    } while (true);

    for (const key of candidateKeys) {
        if (key.startsWith(`${destinationFolder}/`) || used.has(key)) continue;
        if (stagedKeys.has(key)) {
            const object = await bounded(() => bucket.head(key), timeoutMs, 'R2 staging metadata read');
            if (object?.customMetadata?.owner === owner) await bounded(() => bucket.delete(key), timeoutMs, 'R2 staging delete');
        } else if (key.startsWith(`${root}/`)) {
            await bounded(() => bucket.delete(key), timeoutMs, 'R2 chapter image delete');
        }
    }
}
