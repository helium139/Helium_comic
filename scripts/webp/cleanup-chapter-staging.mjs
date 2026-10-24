import { pathToFileURL } from 'node:url';
import { connect, parseArguments, formatFailure } from './migrate.mjs';
import { inventory, fetchLiveCatalogue, notFound, createJournal } from './cleanup-originals.mjs';
import { stagingName } from '../../worker/source/chapter-promotion.js';
import { imageFormat } from '../../worker/source/image-format.js';

const HOUR = 60 * 60 * 1000;
export function parseStagingArguments(args) {
    const supplied = [];
    let minAgeHours = 24;
    let minAgeProvided = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] !== '--min-age-hours') {
            supplied.push(args[i]);
            continue;
        }
        if (minAgeProvided) throw new Error('Duplicate --min-age-hours');
        if (args[i + 1] === undefined || args[i + 1].startsWith('--')) {
            throw new Error('Missing value for --min-age-hours');
        }
        minAgeProvided = true;
        const value = args[++i];
        minAgeHours = Number(value);
        if (!value.trim() || !Number.isFinite(minAgeHours) || minAgeHours < 0) {
            throw new Error('Invalid --min-age-hours; expected a number greater than or equal to 0');
        }
    }
    if (!supplied.includes('--apply') && !supplied.includes('--dry-run')) supplied.push('--dry-run');
    if (!supplied.includes('--scope')) supplied.push('--scope', 'chapters');
    const options = parseArguments(supplied);
    if (options.scope !== 'chapters') throw new Error('Only chapters supported');
    return { ...options, minAgeHours };
}

export async function decodeImage(bytes) {
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { animated: true, limitInputPixels: 100_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error('Missing image dimensions');
    await image.stats();
}

export async function cleanupStaging({ store, catalogue, liveCatalogue, base, prefix, apply = false,
    journal, verify = decodeImage, log = console.log, now = Date.now(), limit = Infinity,
    minAgeHours = 24 }) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:chap\d+(?:\.\d+)?\/)?$/.test(prefix)) throw new Error('Explicit manga/chapter prefix required');
    if (!Number.isFinite(minAgeHours) || minAgeHours < 0) throw new Error('Invalid minimum age; expected a number greater than or equal to 0');
    if (apply && typeof journal !== 'function') throw new Error('Apply requires a durable journal');
    log(apply ? 'APPLY MODE' : 'DRY RUN - NO FILES WILL BE DELETED');
    log(`Prefix: ${prefix}`);
    const snapshot = async () => {
        const current = await catalogue.read(), live = await liveCatalogue.read();
        return { current: inventory(current.data, base), live: inventory(live, base),
            version: JSON.stringify([current.sha, current.data, live]) };
    };
    const initial = await snapshot(); // Fail closed on incomplete/unreadable metadata.
    const referenceReason = (state, key, final) => {
        for (const view of [state.current, state.live]) {
            if (view.used.has(key) || view.used.has(key.split('/').pop())) return 'SKIP_REFERENCED';
        }
        if (![state.current, state.live].every(view => view.refs.some(ref => ref.key === final))) return 'SKIP_UNKNOWN';
        return null;
    };
    const stats = { scanned: 0, candidates: 0, safeToDelete: 0, skippedReferenced: 0,
        skippedMissingFinal: 0, skippedRecent: 0, skippedVerificationFailed: 0, skippedUnknown: 0,
        deleted: 0, reclaimableBytes: 0 };
    const count = { SKIP_REFERENCED: 'skippedReferenced', SKIP_MISSING_FINAL: 'skippedMissingFinal',
        SKIP_UNKNOWN: 'skippedUnknown', SKIP_VERIFICATION_FAILED: 'skippedVerificationFailed',
        SKIP_CHANGED: 'skippedVerificationFailed', SKIP_RECENT: 'skippedRecent' };
    const skip = async (key, reason) => {
        stats[count[reason]]++; log(`${reason} ${key}`);
        if (apply) await journal({ stagingKey: key, finalKey: null, action: 'skip',
            timestamp: new Date().toISOString(), size: null, verificationResult: reason, deletionResult: 'not attempted' });
    };
    const inspect = async (key, final) => {
        let bh, b;
        try { bh = await store.head(final); b = await store.get(final); }
        catch (error) { if (notFound(error)) return { reason: 'SKIP_MISSING_FINAL' }; throw error; }
        const ah = await store.head(key), a = await store.get(key);
        // Missing timestamps cannot establish that publication is quiescent.
        if (![ah, bh].every(head => Number.isFinite(new Date(head.LastModified).getTime()) &&
            new Date(head.LastModified).getTime() <= now - minAgeHours * HOUR)) return { reason: 'SKIP_RECENT' };
        const format = imageFormat(b.bytes.subarray(0, 32));
        if (!format || !b.bytes.length || b.bytes.length > 32 * 1024 * 1024 ||
            format[0] !== final.split('.').pop().replace('jpeg', 'jpg') ||
            [a.contentType, b.contentType, ah.ContentType, bh.ContentType].some(type => type && type !== format[1]) ||
            ah.ContentLength !== a.bytes.length || bh.ContentLength !== b.bytes.length ||
            !a.bytes.equals(b.bytes) || !ah.ETag || !bh.ETag) return { reason: 'SKIP_VERIFICATION_FAILED' };
        await verify(b.bytes); // Equality also establishes identical dimensions and pixels.
        return { size: a.bytes.length, sourceEtag: ah.ETag, finalEtag: bh.ETag };
    };
    const safe = [];
    for (const key of new Set(await store.list(prefix))) {
        if (!key.startsWith(prefix)) continue;
        stats.scanned++;
        const parts = key.split('/');
        if (parts.length !== 3 || !/^chap\d+(?:\.\d+)?$/.test(parts[1]) || !stagingName.test(parts[2])) { await skip(key, 'SKIP_UNKNOWN'); continue; }
        if (stats.candidates >= limit) { await skip(key, 'SKIP_UNKNOWN'); continue; }
        stats.candidates++;
        const final = key.replace(/\/([1-9]\d*)-[^/]+\.(\w+)$/, '/$1.$2');
        const reason = referenceReason(initial, key, final);
        if (reason) { await skip(key, reason); continue; }
        let verified;
        try { verified = await inspect(key, final); }
        catch { verified = { reason: 'SKIP_VERIFICATION_FAILED' }; }
        if (verified.reason) { await skip(key, verified.reason); continue; }
        safe.push({ key, final, ...verified });
        stats.safeToDelete++; stats.reclaimableBytes += verified.size;
        log(`SAFE\nstaging: ${key}\nfinal:   ${final}\nbytes:   ${verified.size}`);
    }
    log(`Reclaimable bytes: ${stats.reclaimableBytes}\nReclaimable MiB: ${(stats.reclaimableBytes / 1048576).toFixed(2)}`);
    for (const item of safe) {
        if (!apply) continue;
        const record = (action, result) => journal({ stagingKey: item.key, finalKey: item.final,
            action, timestamp: new Date().toISOString(), size: item.size, verificationResult: 'byte-identical, decoded', deletionResult: result });
        let reason, verified;
        try {
            const latest = await snapshot();
            reason = referenceReason(latest, item.key, item.final);
            if (!reason && latest.version !== initial.version) reason = 'SKIP_CHANGED';
            if (!reason) {
                verified = await inspect(item.key, item.final);
                reason = verified.reason;
                if (!reason && (verified.sourceEtag !== item.sourceEtag || verified.finalEtag !== item.finalEtag)) reason = 'SKIP_CHANGED';
            }
            // Recheck after decoding and directly before the journal/delete pair.
            if (!reason && (await snapshot()).version !== initial.version) reason = 'SKIP_CHANGED';
        } catch { reason = 'SKIP_VERIFICATION_FAILED'; }
        if (reason) { await skip(item.key, reason); await record('skip', reason); continue; }
        await record('delete', 'pending'); // A journal failure aborts before deletion.
        let finalReason;
        try {
            // Journal fsync can take time: recheck versions and both objects once more.
            if ((await snapshot()).version !== initial.version ||
                (await store.head(item.key)).ETag !== item.sourceEtag ||
                (await store.head(item.final)).ETag !== item.finalEtag) finalReason = 'SKIP_CHANGED';
        } catch { finalReason = 'SKIP_VERIFICATION_FAILED'; }
        if (finalReason) { await skip(item.key, finalReason); continue; }
        try {
            await store.delete(item.key, { ifMatch: item.sourceEtag });
            try { await store.head(item.key); throw new Error('Deletion not confirmed'); }
            catch (error) { if (!notFound(error)) throw error; }
        } catch (error) {
            await record('delete', 'failed');
            throw error;
        }
        stats.deleted++;
        await record('delete', 'confirmed missing');
    }
    log(`Scanned: ${stats.scanned}\nCandidates: ${stats.candidates}\nSafe to delete: ${stats.safeToDelete}\nSkipped referenced: ${stats.skippedReferenced}\nSkipped missing final: ${stats.skippedMissingFinal}\nSkipped recent: ${stats.skippedRecent}\nSkipped verification failed: ${stats.skippedVerificationFailed}\nSkipped unknown: ${stats.skippedUnknown}\nDeleted: ${stats.deleted}`);
    log(apply ? 'APPLY COMPLETE' : 'DRY RUN - NO FILES DELETED');
    return stats;
}

export async function main(args = process.argv.slice(2)) {
    const options = parseStagingArguments(args);
    // Reserve the journal before connecting; existing files must never be overwritten.
    const journal = options.apply ? await createJournal(options.journalPath) : null;
    let clients;
    try {
        if (journal) console.log(`Journal: ${options.journalPath}`);
        clients = await connect();
        await cleanupStaging({ ...options, ...clients, liveCatalogue: { read: () => fetchLiveCatalogue() },
            journal: journal ? entry => journal.append(entry) : undefined });
    } finally { await journal?.close(); clients?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
    console.error(`Cleanup stopped: ${formatFailure(error)}`); process.exitCode = 1;
});
