import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { connect, references, parseArguments, formatFailure, redact } from './migrate.mjs';

export const LIVE_CATALOGUE_URL = 'https://heliumtg.com/assets/data/data.json';
const page = /^[1-9]\d{0,4}(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.(jpg|jpeg|png)$/;
const prefixPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:chap\d+(?:\.\d+)?\/)?$/;
export const notFound = error => {
    const cause = error?.cause || error;
    return ['NoSuchKey', 'NotFound'].includes(cause?.name) ||
        (cause?.$metadata?.httpStatusCode === 404 && cause?.name !== 'NoSuchBucket');
};

export function parseCleanupArguments(args) {
    const options = parseArguments(args);
    if (options.scope !== 'chapters') throw new Error('Cleanup supports --scope chapters only');
    options.journalPath = args.includes('--journal') ? options.journalPath : `webp-cleanup-${Date.now()}-${randomUUID()}.jsonl`;
    return options;
}

// Include explicit references anywhere in metadata, and implicit numbered legacy pages.
// Malformed chapter metadata aborts rather than allowing incomplete reference discovery.
export function inventory(data, base) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid catalogue');
    for (const [slug, manga] of Object.entries(data)) {
        if (!manga || typeof manga !== 'object' || (manga.chapters !== undefined && !Array.isArray(manga.chapters))) throw new Error('Invalid manga metadata');
        for (const chapter of manga.chapters || []) {
            if (!chapter || !Number.isFinite(chapter.id) || chapter.id < 0 || !Number.isSafeInteger(chapter.pages) || chapter.pages < 1 ||
                chapter.folder !== `${base}/${slug}/chap${chapter.id}` ||
                (chapter.images !== undefined && (!Array.isArray(chapter.images) || chapter.images.length !== chapter.pages))) {
                throw new Error('Cannot safely enumerate every catalogue chapter reference');
            }
        }
    }
    const refs = references(data, base, 'chapters', '');
    const used = new Set(refs.map(ref => ref.key));
    const walk = value => {
        if (typeof value === 'string') {
            // Treat URL variants and bucket-relative strings conservatively as references.
            if (value.startsWith(base + '/')) {
                try { used.add(decodeURIComponent(value.slice(base.length + 1).split(/[?#]/)[0])); } catch { throw new Error('Invalid catalogue URL encoding'); }
            }
            used.add(value);
        } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(data);
    return { refs, used };
}

function matching(refs, key, identity) {
    const matches = refs.filter(ref => ref.key === key);
    return matches.length === 1 && (!identity || ['slug', 'id', 'index'].every(field => matches[0][field] === identity[field])) ? matches[0] : null;
}

export async function verifyImages(original, replacement) {
    const { default: sharp } = await import('sharp');
    // APNG must never be removed, even when a decoder exposes only its first frame.
    if (original.subarray(1, 4).toString() === 'PNG') {
        for (let offset = 8; offset + 12 <= original.length;) {
            if (original.subarray(offset + 4, offset + 8).toString() === 'acTL') throw new Error('Animated PNG retained');
            offset += 12 + original.readUInt32BE(offset);
        }
    }
    const source = sharp(original, { limitInputPixels: 100_000_000 });
    const webp = sharp(replacement, { limitInputPixels: 100_000_000 });
    const a = await source.metadata(), b = await webp.metadata();
    if (!['jpeg', 'png'].includes(a.format) || b.format !== 'webp' || (a.pages || 1) !== 1 || (b.pages || 1) !== 1 ||
        (a.orientation && a.orientation !== 1) || a.width !== b.width || a.height !== b.height) throw new Error('Unsafe source/replacement format, animation, orientation or dimensions');
    await source.stats(); await webp.stats(); // Decode pixels; metadata alone can accept truncated files.
}

export async function fetchLiveCatalogue(fetchImpl = fetch) {
    const url = new URL(LIVE_CATALOGUE_URL);
    url.searchParams.set('cleanup_check', randomUUID());
    const response = await fetchImpl(url.href, { redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store' }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Live catalogue HTTP ${response.status}`);
    return response.json();
}

export async function createJournal(path) {
    const file = await open(path, 'wx', 0o600);
    return {
        async append(entry) { await file.writeFile(JSON.stringify(entry) + '\n'); await file.sync(); },
        close: () => file.close()
    };
}

export async function cleanupOriginals({ store, catalogue, liveCatalogue, base, scope, prefix, limit = Infinity,
    apply = false, journal, verify = verifyImages, log = console.log }) {
    if (scope !== 'chapters' || !prefixPattern.test(prefix || '') || !(limit === Infinity || Number.isSafeInteger(limit) && limit > 0)) throw new Error('Invalid cleanup scope, prefix or limit');
    if (!journal) throw new Error('A durable journal is required');
    const stats = { scanned: 0, eligible: 0, safeToDelete: 0, skippedReferenced: 0, skippedLiveNotVerified: 0,
        skippedMissingWebp: 0, skippedUnknown: 0, deleted: 0, failed: 0, reclaimableBytes: 0 };
    inventory((await catalogue.read()).data, base); // Fail closed before scanning on unreadable metadata.
    const keys = [...new Set(await store.list(prefix))];
    let attempted = 0;
    for (const originalKey of keys) {
        if (!originalKey.startsWith(prefix)) continue;
        const parts = originalKey.split('/');
        if (parts.length !== 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[0]) || !/^chap\d+(?:\.\d+)?$/.test(parts[1]) || !page.test(parts[2])) continue;
        stats.scanned++;
        if (attempted >= limit) continue;
        attempted++;
        const webpKey = originalKey.replace(/\.[^.]+$/, '.webp');
        const record = { originalKey, webpKey, originalBytes: 0, webpBytes: 0, catalogueVerified: false,
            liveCatalogueVerified: false, webpVerified: false, deleted: false, reason: '', timestamp: '' };
        let journalFailed = false;
        const emit = async reason => {
            record.reason = redact(reason); record.timestamp = new Date().toISOString();
            try { await journal({ ...record, originalKey: redact(record.originalKey), webpKey: redact(record.webpKey) }); }
            catch (error) { journalFailed = true; throw error; } // Audit failures stop the entire run.
        };
        let stage = 'catalogue.verify', failure;
        try {
            const current = inventory((await catalogue.read()).data, base);
            if (current.used.has(originalKey)) { stats.skippedReferenced++; record.reason = 'original still referenced'; }
            else {
                const identity = matching(current.refs, webpKey);
                if (!identity || Number(parts[2].split(/[.-]/)[0]) !== identity.index + 1) { stats.skippedUnknown++; record.reason = 'unknown/orphan original; no exact current chapter/page replacement'; }
                else {
                    stats.eligible++; record.catalogueVerified = true;
                    const checkLive = async () => {
                        try {
                            const live = inventory(await liveCatalogue.read(), base);
                            return !live.used.has(originalKey) && !!matching(live.refs, webpKey, identity);
                        } catch (error) { log(formatFailure(error, { stage: 'live.catalogue', key: originalKey })); return false; }
                    };
                    if (!await checkLive()) { stats.skippedLiveNotVerified++; record.reason = 'live catalogue not verified'; }
                    else {
                        record.liveCatalogueVerified = true;
                        stage = 'r2.webp.verify';
                        let head, replacement;
                        try { head = await store.head(webpKey); replacement = await store.get(webpKey); }
                        catch (error) { if (!notFound(error)) throw error; stats.skippedMissingWebp++; record.reason = 'replacement WebP not found'; }
                        if (!record.reason) {
                            if (head.ContentType !== 'image/webp' || replacement.contentType !== 'image/webp' || !replacement.bytes?.length || head.ContentLength !== replacement.bytes.length) throw new Error('WebP MIME or non-zero size verification failed');
                            record.webpBytes = replacement.bytes.length;
                            stage = 'r2.original.verify';
                            const originalHead = await store.head(originalKey), original = await store.get(originalKey);
                            record.originalBytes = original.bytes.length;
                            if (!record.originalBytes || originalHead.ContentLength !== record.originalBytes) throw new Error('Original size verification failed');
                            await verify(original.bytes, replacement.bytes);
                            record.webpVerified = true;
                            // Recheck catalogues and replacement immediately before the destructive operation.
                            const latest = inventory((await catalogue.read()).data, base);
                            if (latest.used.has(originalKey) || !matching(latest.refs, webpKey, identity)) throw new Error('Catalogue changed during verification');
                            if (!await checkLive()) { stats.skippedLiveNotVerified++; record.liveCatalogueVerified = false; record.reason = 'live catalogue not verified'; }
                            else {
                                const finalWebp = await store.head(webpKey), finalOriginal = await store.head(originalKey);
                                if (!head.ETag || head.ETag !== finalWebp.ETag || !originalHead.ETag || originalHead.ETag !== finalOriginal.ETag) throw new Error('Object changed or ETag unavailable');
                                stats.safeToDelete++; stats.reclaimableBytes += record.originalBytes;
                                if (apply) {
                                    await emit('pending deletion');
                                    stage = 'r2.delete';
                                    await store.delete(originalKey, { ifMatch: originalHead.ETag });
                                    stage = 'r2.delete.verify';
                                    try { await store.head(originalKey); throw new Error('Original still exists after delete'); }
                                    catch (error) { if (!notFound(error)) throw error; }
                                    record.deleted = true; stats.deleted++; record.reason = 'deleted and verified not found';
                                } else {
                                    record.reason = 'would delete';
                                    log(`Would delete:\n${originalKey}\nreplacement:\n${webpKey}\nreclaim: ${record.originalBytes} bytes`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) { if (journalFailed) throw error; failure = error; stats.failed++; record.reason = formatFailure(error, { stage, key: originalKey, prefix }); }
        await emit(record.reason);
        if (failure) log(record.reason);
        else if (!record.deleted && record.reason !== 'would delete') log(`Skipped ${originalKey}: ${record.reason}`);
    }
    return stats;
}

async function main() {
    const options = parseCleanupArguments(process.argv.slice(2));
    const clients = await connect(); // Shared read/list adapters; cleanup never calls put/save.
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    const store = { list: clients.store.list, head: clients.store.head, get: clients.store.get,
        delete: (Key, { ifMatch }) => client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key, IfMatch: ifMatch })) };
    const journal = await createJournal(options.journalPath);
    try {
        const stats = await cleanupOriginals({ ...options, base: clients.base, store,
            catalogue: { read: clients.catalogue.read }, liveCatalogue: { read: () => fetchLiveCatalogue() }, journal: entry => journal.append(entry) });
        console.log(JSON.stringify(stats, null, 2));
        if (stats.failed) process.exitCode = 1;
    } finally { await journal.close(); client.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
    console.error(`Cleanup stopped: ${formatFailure(error)}`); process.exitCode = 1;
});
