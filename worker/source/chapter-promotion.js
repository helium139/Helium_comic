import { fail, imageName, uploadFolder } from './cms-authorization.js';
import { imageFormat } from './image-format.js';

const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

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
    committed = false, sourceFolders, destinationFolder = folder
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
        const object = await bucket.get(key);
        if (!object) fail(409, 'Chapter image unavailable; reload before retrying');
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        const format = imageFormat(bytes.subarray(0, 32));
        const ext = key.split('.').pop().replace('jpeg', 'jpg');
        if (!bytes.length || bytes.length > 32 * 1024 * 1024 || !format || format[0] !== ext || object.httpMetadata?.contentType !== format[1]) fail(400, 'Invalid chapter image bytes or type');
        return { bytes, hash: await digest(bytes), httpMetadata: object.httpMetadata };
    }
    // Validate every source and every collision before the first destination write.
    // Retain hashes, not entire chapter buffers, to bound memory to one page.
    for (const item of plan) {
        const source = committed && !await bucket.head(item.source) ? await read(item.destination) : await read(item.source);
        item.hash = source.hash;
        if (await bucket.head(item.destination)) {
            if ((await read(item.destination)).hash !== item.hash) fail(409, 'Numbered page already exists with different content; published images retained');
            item.reuse = true;
        }
    }
    for (const item of plan) {
        if (!item.reuse) {
            const source = await read(item.source);
            if (source.hash !== item.hash) fail(409, 'Chapter source changed during promotion');
            const stored = await bucket.put(item.destination, source.bytes, {
                httpMetadata: source.httpMetadata, onlyIf: { etagDoesNotMatch: '*' }
            });
            // R2 returns null when the create-only precondition loses a race.
            if (!stored) fail(409, 'Numbered page changed during promotion; retry after reloading');
        }
        if ((await read(item.destination)).hash !== item.hash) fail(409, 'Numbered page verification failed');
    }
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
    root, oldFolder, oldNames, stagedNames, destinationFolder, finalNames, catalogue, base, owner
}) {
    validateChapterObjectFolder(root, oldFolder);
    validateChapterObjectFolder(root, destinationFolder);
    const used = catalogueKeys(catalogue, base);
    await promoteChapterPages(bucket, root, finalNames, {
        sourceFolders: finalNames.map(() => destinationFolder), destinationFolder
    });
    const stagedKeys = new Set(stagedNames.map(name => `${root}/${name}`));
    const candidateKeys = new Set([
        ...oldNames.filter(name => /^\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(name))
            .map(name => `${oldFolder}/${name}`),
        ...stagedKeys
    ]);
    let cursor;
    do {
        const page = await bucket.list({ prefix: `${root}/`, limit: 1000, cursor });
        for (const object of page.objects) {
            const relative = object.key.slice(root.length + 1);
            if (/^\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(relative) ||
                /^_revision-\d+(?:-\d+)?\/\d+\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(relative) ||
                stagedKeys.has(object.key)) candidateKeys.add(object.key);
        }
        if (!page.truncated) break;
        if (!page.cursor || page.cursor === cursor) throw new Error('Chapter object listing did not advance');
        cursor = page.cursor;
    } while (true);

    for (const key of candidateKeys) {
        if (key.startsWith(`${destinationFolder}/`) || used.has(key)) continue;
        if (stagedKeys.has(key)) {
            const object = await bucket.get(key);
            if (object?.customMetadata?.owner === owner) await bucket.delete(key);
        } else if (key.startsWith(`${root}/`)) {
            await bucket.delete(key);
        }
    }
}
