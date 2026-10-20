import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { connect, references } from './migrate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Restores exact journal references only. It never restores the entire old catalogue.
export async function rollback({ entries, scope, prefix, base, store, catalogue, apply = false,
    backup = async () => {}, log = console.log }) {
    const latest = await catalogue.read();
    const stats = { restored: 0, unchanged: 0 };
    const selected = entries.filter(entry => entry.key?.startsWith(prefix) &&
        (scope === 'chapters' ? entry.index !== undefined : entry.index === undefined));
    const unique = new Map();
    for (const entry of selected) {
        const id = JSON.stringify([entry.slug, entry.id, entry.index]);
        if (unique.has(id) && JSON.stringify(unique.get(id)) !== JSON.stringify(entry)) throw new Error('Conflicting journal entries');
        unique.set(id, entry);
    }
    for (const entry of unique.values()) {
        if (!/^[a-f0-9]{64}$/.test(entry.originalHash) ||
            entry.destination !== entry.key.replace(/\.(jpe?g|png)$/, '.webp')) throw new Error('Invalid journal entry');
        const refs = references(latest.data, base, scope, prefix);
        const live = refs.find(ref => ref.slug === entry.slug && ref.id === entry.id && ref.index === entry.index);
        if (!live) throw new Error('Journal target missing; no catalogue changes saved');
        if (live.key === entry.key) { stats.unchanged++; continue; }
        if (live.key !== entry.destination) throw new Error('Reference changed since migration; no catalogue changes saved');
        if (hash((await store.get(entry.key)).bytes) !== entry.originalHash) throw new Error('Original no longer matches journal');
        const manga = latest.data[entry.slug];
        if (scope === 'covers') manga.cover = `${base}/${entry.key}`;
        else manga.chapters.find(c => c.id === entry.id).images[entry.index] = entry.key.split('/').pop();
        stats.restored++;
        log(`${apply ? 'Restore' : 'Would restore'} ${entry.destination} -> ${entry.key}`);
    }
    if (apply && stats.restored) {
        // Backup the authoritative pre-rollback state before the single SHA-checked save.
        await backup(await catalogue.read());
        await catalogue.save(latest);
        const verified = await catalogue.read();
        const refs = references(verified.data, base, scope, prefix);
        for (const entry of unique.values()) if (!refs.some(ref => ref.key === entry.key && ref.slug === entry.slug && ref.id === entry.id && ref.index === entry.index)) throw new Error('Rollback verification failed; inspect live catalogue');
    }
    return stats;
}

async function main() {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (['--dry-run', '--apply'].includes(arg)) options[arg] = true;
        else if (['--journal', '--scope', '--prefix', '--backup'].includes(arg) && args[i+1] && !args[i+1].startsWith('--')) options[arg] = args[++i];
        else throw new Error('Invalid rollback argument');
    }
    if (!!options['--dry-run'] === !!options['--apply'] || !options['--journal'] ||
        !['chapters', 'covers'].includes(options['--scope']) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:chap\d+(?:\.\d+)?\/)?$/.test(options['--prefix'] || '') ||
        (options['--apply'] && !options['--backup'])) throw new Error('Explicit mode, journal, scope, prefix and apply backup required');
    const entries = (await readFile(options['--journal'], 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const clients = await connect();
    const result = await rollback({ ...clients, entries, scope: options['--scope'], prefix: options['--prefix'], apply: !!options['--apply'],
        backup: snapshot => writeFile(options['--backup'], JSON.stringify(snapshot, null, 2), { flag: 'wx' }) });
    console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
    console.error('Rollback stopped; check journal, original objects, live references and catalogue SHA. No objects deleted.'); process.exitCode = 1;
});
