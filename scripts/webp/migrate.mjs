import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const namePattern = /^[1-9]\d{0,4}(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.(jpg|jpeg|png|webp|gif|avif)$/;

// Only exact catalogue references under the configured public base are eligible.
export function references(data, base, scope, prefix) {
    const refs = [];
    const keyOf = url => typeof url === 'string' && url.startsWith(base + '/') ? url.slice(base.length + 1) : null;
    for (const [slug, manga] of Object.entries(data)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) continue;
        if (scope === 'chapters') for (const chapter of manga.chapters || []) {
            const folder = keyOf(chapter.folder);
            if (folder !== `${slug}/chap${chapter.id}` || !Number.isSafeInteger(chapter.pages) || chapter.pages < 1) continue;
            const names = chapter.images || Array.from({ length: chapter.pages }, (_, i) => `${i+1}.jpg`);
            if (names.length !== chapter.pages || names.some(n => !namePattern.test(n))) throw new Error('Invalid page manifest');
            names.forEach((name, index) => refs.push({ key: `${folder}/${name}`, slug, id: chapter.id, index }));
        }
        if (scope === 'covers') {
            const key = keyOf(manga.cover);
            if (key && new RegExp(`^${slug}/cover(?:-[a-f0-9-]+)?\\.(jpg|jpeg|png|webp|gif|avif)$`).test(key)) refs.push({ key, slug });
        }
    }
    return refs.filter(ref => ref.key.startsWith(prefix));
}

export async function convert(bytes, quality) {
    // libvips may expose only the first APNG frame; detect its animation chunk ourselves.
    if (bytes.subarray(1, 4).toString() === 'PNG') {
        for (let offset = 8; offset + 12 <= bytes.length;) {
            if (bytes.subarray(offset + 4, offset + 8).toString() === 'acTL') return null;
            offset += 12 + bytes.readUInt32BE(offset);
        }
    }
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { limitInputPixels: 100_000_000 });
    const meta = await image.metadata();
    if (!['jpeg', 'png'].includes(meta.format) || (meta.pages || 1) > 1 || (meta.orientation && meta.orientation !== 1)) return null;
    const output = await image.webp({ quality }).toBuffer();
    const verified = await sharp(output).metadata();
    if (verified.format !== 'webp' || verified.width !== meta.width || verified.height !== meta.height) throw new Error('Invalid conversion');
    return output.length < bytes.length ? output : null;
}

export async function migrate({ store, catalogue, scope, prefix, base, apply = false, limit = Infinity,
    encode = convert, journal = async () => {}, log = console.log }) {
    const stats = { scanned: 0, eligible: 0, converted: 0, skipped: 0, failed: 0,
        originalBytes: 0, webpBytes: 0, savedBytes: 0, savedPercent: 0 };
    const initial = await catalogue.read();
    const refs = references(initial.data, base, scope, prefix);
    // Listing is restricted to the requested prefix; unreferenced objects are never changed.
    const objects = await store.list(prefix);
    const available = new Set(objects);
    let attempted = 0;
    for (const ref of refs) {
        stats.scanned++;
        if (!/\.(jpe?g|png)$/i.test(ref.key) || attempted >= limit) { stats.skipped++; continue; }
        attempted++; stats.eligible++;
        if (!available.has(ref.key)) { stats.failed++; log(`Failed ${ref.key}; referenced source is missing`); continue; }
        const destination = ref.key.replace(/\.[^.]+$/, '.webp');
        try {
            const original = await store.get(ref.key);
            const output = await encode(original.bytes, scope === 'covers' ? 88 : 85);
            if (!output) { stats.skipped++; continue; }
            if (apply) {
                // Journal is durable before the first external write; never contains credentials.
                await journal({ ...ref, destination, originalHash: hash(original.bytes), webpHash: hash(output) });
                if (available.has(destination)) {
                    const existing = await store.get(destination);
                    if (hash(existing.bytes) !== hash(output) || existing.contentType !== 'image/webp') throw new Error('Destination collision');
                } else await store.put(destination, output);
                const verified = await store.get(destination);
                if (verified.contentType !== 'image/webp' || verified.bytes.length !== output.length || hash(verified.bytes) !== hash(output)) throw new Error('Replacement verification failed');
                if (hash((await store.get(ref.key)).bytes) !== hash(original.bytes)) throw new Error('Source changed during conversion');
                const latest = await catalogue.read();
                const live = references(latest.data, base, scope, prefix).find(item => item.key === ref.key && item.slug === ref.slug && item.id === ref.id && item.index === ref.index);
                if (!live) throw new Error('Catalogue changed; original retained');
                const manga = latest.data[ref.slug];
                if (scope === 'covers') manga.cover = `${base}/${destination}`;
                else {
                    const chapter = manga.chapters.find(c => c.id === ref.id);
                    chapter.images ||= Array.from({ length: chapter.pages }, (_, i) => `${i+1}.jpg`);
                    chapter.images[ref.index] = destination.split('/').pop();
                }
                await catalogue.save(latest);
                const check = await catalogue.read();
                if (!references(check.data, base, scope, prefix).some(item => item.key === destination && item.slug === ref.slug && item.id === ref.id && item.index === ref.index)) throw new Error('Catalogue verification failed');
                available.add(destination);
            }
            stats.converted++;
            stats.originalBytes += original.bytes.length; stats.webpBytes += output.length;
            log(`${apply ? 'Converted' : 'Would convert'} ${ref.key} -> ${destination}`);
        } catch {
            stats.failed++;
            log(`Failed ${ref.key}; original retained`);
        }
    }
    stats.savedBytes = stats.originalBytes - stats.webpBytes;
    stats.savedPercent = stats.originalBytes ? 100 * stats.savedBytes / stats.originalBytes : 0;
    return stats;
}

export async function connect() {
    const required = name => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; };
    const base = required('R2_PUBLIC_URL').replace(/\/+$/, '');
    if (new URL(base).protocol !== 'https:') throw new Error('HTTPS public base required');
    const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const endpoint = required('R2_ENDPOINT');
    if (!/^https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com$/.test(endpoint)) throw new Error('Invalid R2 endpoint');
    const client = new S3Client({ region: 'auto', endpoint,
        credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') } });
    const Bucket = required('R2_BUCKET');
    const store = {
        async list(Prefix) {
            const keys = []; let ContinuationToken;
            do {
                const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
                keys.push(...(page.Contents || []).map(o => o.Key));
                ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (ContinuationToken);
            return keys;
        },
        async get(Key) {
            const result = await client.send(new GetObjectCommand({ Bucket, Key }));
            return { bytes: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType };
        },
        put: (Key, Body) => client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/webp', IfNoneMatch: '*' }))
    };
    const owner = required('GITHUB_OWNER'), repo = required('GITHUB_REPO'), branch = required('GITHUB_BRANCH');
    const token = required('GITHUB_TOKEN');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/assets/data/data.json`;
    async function request(method, body) {
        const response = await fetch(method === 'GET' ? `${url}?ref=${encodeURIComponent(branch)}` : url, {
            method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok) throw new Error('Catalogue request failed');
        return response.json();
    }
    const catalogue = {
        async read() { const file = await request('GET'); return { sha: file.sha, data: JSON.parse(Buffer.from(file.content, 'base64').toString()) }; },
        save: ({ sha, data }) => request('PUT', { sha, branch, message: 'Migrate verified comic image to WebP', content: Buffer.from(JSON.stringify(data, null, 4)).toString('base64') })
    };
    return { base, store, catalogue };
}

async function main() {
    const args = process.argv.slice(2);
    const value = flag => args[args.indexOf(flag) + 1];
    const allowed = new Set(['--dry-run', '--apply', '--scope', '--prefix', '--limit', '--journal']);
    for (let i = 0; i < args.length; i++) {
        if (!allowed.has(args[i])) throw new Error('Unknown argument');
        if (!['--dry-run', '--apply'].includes(args[i])) { if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing argument'); }
    }
    if (args.includes('--apply') === args.includes('--dry-run')) throw new Error('Choose exactly one of --dry-run or --apply');
    const scope = value('--scope'), prefix = value('--prefix');
    if (!args.includes('--scope') || !['chapters', 'covers'].includes(scope) || !args.includes('--prefix') ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:chap\d+(?:\.\d+)?\/)?$/.test(prefix)) throw new Error('Explicit --scope chapters|covers and --prefix slug/ or slug/chapN/ required');
    const limit = args.includes('--limit') ? Number(value('--limit')) : Infinity;
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Invalid limit');
    const { base, store, catalogue } = await connect();
    const apply = args.includes('--apply');
    const journalPath = args.includes('--journal') ? value('--journal') : `webp-${Date.now()}.jsonl`;
    if (apply) {
        const snapshot = await catalogue.read();
        await writeFile(`${journalPath}.catalogue.json`, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
    }
    const stats = await migrate({ store, catalogue, base, scope, prefix, apply, limit,
        journal: entry => appendFile(journalPath, JSON.stringify(entry) + '\n', { flush: true }) });
    console.log(JSON.stringify(stats, null, 2));
    if (stats.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
    console.error('Migration stopped. Check arguments, environment and service access. Originals retained.'); process.exitCode = 1;
});
