import { fail, imageName, uploadFolder } from './cms-authorization.js';
import { imageFormat } from './image-format.js';

const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

// Final keys are immutable here: a failed publish can leave unreferenced objects,
// but must never replace bytes used by the current or an older deployed catalogue.
export async function promoteChapterPages(bucket, folder, names) {
    if (uploadFolder(folder).chapterId === null) fail(400, 'Invalid chapter folder');
    const plan = names.map((name, index) => {
        imageName(name);
        return { source: `${folder}/${name}`, destination: `${folder}/${index + 1}.${name.split('.').pop()}` };
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
        const source = await read(item.source);
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
    return plan.map(item => item.destination.slice(folder.length + 1));
}
