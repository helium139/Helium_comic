import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const namePattern = /^[1-9]\d{0,4}(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.(jpg|jpeg|png|webp|gif|avif)$/;

export const REQUIRED_ENV = ['R2_PUBLIC_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_TOKEN'];

class MigrationError extends Error {
    constructor(stage, message, context = {}, cause) {
        super(message, { cause }); this.name = 'MigrationError'; this.stage = stage; this.context = context;
    }
}

// Print only selected diagnostic fields, never raw SDK errors, responses or stacks.
export function redact(value, env = process.env) {
    let result = String(value);
    for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'AWS_SESSION_TOKEN', 'CLOUDFLARE_API_TOKEN']) {
        if (env[name]) for (const secret of [env[name], encodeURIComponent(env[name])]) result = result.split(secret).join('[REDACTED]');
    }
    return result.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi, '$1 [REDACTED]')
        .replace(/(["']?(?:authorization|accessKeyId|secretAccessKey|access_token|token|password|credential|signature|x-amz-credential|x-amz-signature)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1[REDACTED]')
        .replace(/https?:\/\/[^\s<>"']+/gi, value => {
            try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
            catch { return '[REDACTED_URL]'; }
        }).replace(/[\r\n]+/g, ' ').slice(0, 1500);
}

export function formatFailure(error, context = {}, env = process.env) {
    const original = error?.cause || error;
    const details = { ...context, ...error?.context };
    const status = details.status || original?.$metadata?.httpStatusCode || original?.status;
    const code = original?.code || original?.cause?.code;
    const stage = error?.stage || context.stage || 'startup';
    const diagnostic = { stage: redact(stage, env), class: redact(original?.name || 'Error', env), message: redact(error?.message || 'Unknown failure', env) };
    if (code) diagnostic.code = redact(code, env);
    if (Number.isInteger(status)) diagnostic.httpStatus = status;
    for (const field of ['key', 'prefix', 'destination']) if (details[field]) diagnostic[field] = redact(details[field], env);
    if (original?.cause?.message) diagnostic.cause = redact(original.cause.message, env);
    if (stage.startsWith('r2.') && (status === 401 || status === 403 || /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/.test(original?.name || ''))) {
        diagnostic.hint = 'Check R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT and bucket permissions.';
    }
    return JSON.stringify(diagnostic);
}

async function atStage(stage, context, action) {
    try { return await action(); }
    catch (error) {
        if (error instanceof MigrationError) { error.context = { ...context, ...error.context }; throw error; }
        throw new MigrationError(stage, error?.message || 'Operation failed', context, error);
    }
}

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

export async function convert(bytes, quality, { onSkip = () => {} } = {}) {
    // libvips may expose only the first APNG frame; detect its animation chunk ourselves.
    if (bytes.subarray(1, 4).toString() === 'PNG') {
        for (let offset = 8; offset + 12 <= bytes.length;) {
            if (bytes.subarray(offset + 4, offset + 8).toString() === 'acTL') { onSkip('Animated PNG preserved'); return null; }
            offset += 12 + bytes.readUInt32BE(offset);
        }
    }
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { limitInputPixels: 100_000_000 });
    const meta = await image.metadata();
    if (!['jpeg', 'png'].includes(meta.format)) { onSkip(`Unsupported source format for conversion: ${meta.format}; original retained`); return null; }
    if ((meta.pages || 1) > 1) { onSkip('Animated image preserved'); return null; }
    if (meta.orientation && meta.orientation !== 1) { onSkip('EXIF-oriented original preserved'); return null; }
    const output = await image.webp({ quality }).toBuffer();
    const verified = await sharp(output).metadata();
    if (verified.format !== 'webp' || verified.width !== meta.width || verified.height !== meta.height) throw new MigrationError('verification.conversion', 'Converted WebP format or dimensions do not match source');
    if (output.length >= bytes.length) { onSkip('WebP is not smaller; original retained'); return null; }
    return output;
}

export async function migrate({ store, catalogue, scope, prefix, base, apply = false, limit = Infinity,
    encode = convert, journal = async () => {}, log = console.log }) {
    const stats = { scanned: 0, eligible: 0, converted: 0, skipped: 0, failed: 0,
        originalBytes: 0, webpBytes: 0, savedBytes: 0, savedPercent: 0 };
    const initial = await atStage('catalogue.read', { prefix }, () => catalogue.read());
    const refs = await atStage('catalogue.discovery', { prefix }, () => references(initial.data, base, scope, prefix));
    if (!refs.length) throw new MigrationError('catalogue.discovery', 'No catalogue references match this prefix and R2_PUBLIC_URL; check prefix, public base and GITHUB_BRANCH', { prefix });
    // Listing is restricted to the requested prefix; unreferenced objects are never changed.
    const objects = await atStage('r2.list', { prefix }, () => store.list(prefix));
    log(`Discovery: ${refs.length} catalogue references, ${objects.length} R2 objects under ${prefix}`);
    const available = new Set(objects);
    let attempted = 0;
    for (const ref of refs) {
        stats.scanned++;
        if (!/\.(jpe?g|png)$/i.test(ref.key) || attempted >= limit) { stats.skipped++; continue; }
        attempted++; stats.eligible++;
        if (!available.has(ref.key)) {
            stats.failed++;
            log(formatFailure(new MigrationError('r2.discovery', 'Referenced source object not found in prefix listing', { key: ref.key, prefix, status: 404 })));
            continue;
        }
        const destination = ref.key.replace(/\.[^.]+$/, '.webp');
        try {
            if (store.head) await atStage('r2.head', { key: ref.key, prefix }, () => store.head(ref.key));
            const original = await atStage('r2.get', { key: ref.key, prefix }, () => store.get(ref.key));
            let skipReported = false;
            const output = await atStage('conversion', { key: ref.key, prefix }, () => encode(original.bytes, scope === 'covers' ? 88 : 85, {
                onSkip: reason => { skipReported = true; log(`Skipped ${ref.key}: ${redact(reason)}`); }
            }));
            if (!output) { stats.skipped++; if (!skipReported) log(`Skipped ${ref.key}: no smaller safe WebP produced; original retained`); continue; }
            if (apply) {
                // Journal is durable before the first external write; never contains credentials.
                await atStage('journal.write', { key: ref.key, destination }, () => journal({ ...ref, destination, originalHash: hash(original.bytes), webpHash: hash(output) }));
                if (available.has(destination)) {
                    const existing = await atStage('r2.get', { key: destination }, () => store.get(destination));
                    if (hash(existing.bytes) !== hash(output) || existing.contentType !== 'image/webp') throw new MigrationError('verification.replacement', 'Destination collision', { key: ref.key, destination });
                } else await atStage('r2.put', { key: destination }, () => store.put(destination, output));
                const verified = await atStage('verification.replacement', { key: destination }, () => store.get(destination));
                if (verified.contentType !== 'image/webp' || verified.bytes.length !== output.length || hash(verified.bytes) !== hash(output)) throw new MigrationError('verification.replacement', 'Replacement verification failed', { key: ref.key, destination });
                const sourceCheck = await atStage('verification.source', { key: ref.key }, () => store.get(ref.key));
                if (hash(sourceCheck.bytes) !== hash(original.bytes)) throw new MigrationError('verification.source', 'Source changed during conversion', { key: ref.key });
                const latest = await atStage('catalogue.read', { key: ref.key }, () => catalogue.read());
                const live = references(latest.data, base, scope, prefix).find(item => item.key === ref.key && item.slug === ref.slug && item.id === ref.id && item.index === ref.index);
                if (!live) throw new MigrationError('catalogue.plan', 'Catalogue changed; original retained', { key: ref.key });
                const manga = latest.data[ref.slug];
                if (scope === 'covers') manga.cover = `${base}/${destination}`;
                else {
                    const chapter = manga.chapters.find(c => c.id === ref.id);
                    chapter.images ||= Array.from({ length: chapter.pages }, (_, i) => `${i+1}.jpg`);
                    chapter.images[ref.index] = destination.split('/').pop();
                }
                await atStage('catalogue.save', { key: ref.key, destination }, () => catalogue.save(latest));
                const check = await atStage('verification.catalogue', { key: destination }, () => catalogue.read());
                if (!references(check.data, base, scope, prefix).some(item => item.key === destination && item.slug === ref.slug && item.id === ref.id && item.index === ref.index)) throw new MigrationError('verification.catalogue', 'Catalogue verification failed', { key: ref.key, destination });
                available.add(destination);
            }
            stats.converted++;
            stats.originalBytes += original.bytes.length; stats.webpBytes += output.length;
            log(`${apply ? 'Converted' : 'Would convert'} ${ref.key} -> ${destination}; ${original.bytes.length} -> ${output.length} bytes`);
            if (!apply) log(`Would update catalogue: ${ref.slug}${ref.index === undefined ? '.cover' : `.chapters[id=${ref.id}].images[${ref.index}]`} -> ${destination}`);
        } catch (error) {
            stats.failed++;
            log(formatFailure(error, { key: ref.key, prefix }));
            log(`Original retained: ${ref.key}`);
        }
    }
    stats.savedBytes = stats.originalBytes - stats.webpBytes;
    stats.savedPercent = stats.originalBytes ? 100 * stats.savedBytes / stats.originalBytes : 0;
    return stats;
}

export async function connect({ env = process.env, fetchImpl = fetch, sendS3 } = {}) {
    const missing = REQUIRED_ENV.filter(name => !env[name]?.trim());
    if (missing.length) throw new MigrationError('configuration', `Missing required environment variables: ${missing.join(', ')}`);
    const required = name => env[name];
    const base = required('R2_PUBLIC_URL').replace(/\/+$/, '');
    let publicUrl;
    try { publicUrl = new URL(base); } catch { throw new MigrationError('configuration', 'Invalid R2_PUBLIC_URL; expected an HTTPS public image base'); }
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new MigrationError('configuration', 'Invalid R2_PUBLIC_URL; HTTPS required, without credentials, query or fragment');
    const endpoint = required('R2_ENDPOINT').replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com$/.test(endpoint)) throw new MigrationError('configuration', 'Invalid R2_ENDPOINT; expected https://<account-id>.r2.cloudflarestorage.com (not the public r2.dev URL)');
    const { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand } =
        await atStage('dependencies', {}, () => import('@aws-sdk/client-s3'));
    const client = new S3Client({ region: 'auto', endpoint,
        credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') } });
    const send = command => sendS3 ? sendS3(command) : client.send(command);
    const Bucket = required('R2_BUCKET');
    const store = {
        async list(Prefix) {
            const keys = []; let ContinuationToken;
            do {
                const page = await atStage('r2.list', { prefix: Prefix }, () => send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })));
                keys.push(...(page.Contents || []).map(o => o.Key));
                ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (ContinuationToken);
            return keys;
        },
        head: Key => atStage('r2.head', { key: Key }, () => send(new HeadObjectCommand({ Bucket, Key }))),
        async get(Key) {
            return atStage('r2.get', { key: Key }, async () => {
                const result = await send(new GetObjectCommand({ Bucket, Key }));
                return { bytes: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType };
            });
        },
        put: (Key, Body) => atStage('r2.put', { key: Key }, () => send(new PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/webp', IfNoneMatch: '*' })))
    };
    const owner = required('GITHUB_OWNER'), repo = required('GITHUB_REPO'), branch = required('GITHUB_BRANCH');
    const token = required('GITHUB_TOKEN');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/assets/data/data.json`;
    async function request(method, body) {
        const stage = method === 'GET' ? 'github.read' : 'github.save';
        const response = await atStage(stage, {}, () => fetchImpl(method === 'GET' ? `${url}?ref=${encodeURIComponent(branch)}` : url, {
            method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        }));
        if (!response.ok) {
            const reason = { 401: 'GitHub authentication failed; check GITHUB_TOKEN',
                403: 'GitHub access denied; check token Contents permissions and rate limits',
                404: 'GitHub catalogue not found or inaccessible; check GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, token access and assets/data/data.json',
                409: 'GitHub catalogue SHA conflict; reread before retrying',
                429: 'GitHub rate limit reached; retry later' }[response.status] || 'GitHub catalogue request failed';
            throw new MigrationError(stage, `${reason} (HTTP ${response.status})`, { status: response.status });
        }
        return atStage('github.response', {}, () => response.json());
    }
    const catalogue = {
        async read() {
            const file = await request('GET');
            return atStage('catalogue.parse', {}, () => {
                if (typeof file.content !== 'string' || typeof file.sha !== 'string') throw new Error('GitHub Contents response is missing content or SHA');
                const data = JSON.parse(Buffer.from(file.content, 'base64').toString());
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Catalogue JSON must be a manga object');
                return { sha: file.sha, data };
            });
        },
        save: ({ sha, data }) => request('PUT', { sha, branch, message: 'Migrate verified comic image to WebP', content: Buffer.from(JSON.stringify(data, null, 4)).toString('base64') })
    };
    return { base, store, catalogue };
}

export function parseArguments(args) {
    const options = {};
    const allowed = new Set(['--dry-run', '--apply', '--scope', '--prefix', '--limit', '--journal']);
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (!allowed.has(flag)) throw new MigrationError('arguments', 'Unknown argument; supported flags: --dry-run, --apply, --scope, --prefix, --limit, --journal');
        if (Object.hasOwn(options, flag)) throw new MigrationError('arguments', `Duplicate ${flag}`);
        if (['--dry-run', '--apply'].includes(flag)) options[flag] = true;
        else {
            if (!args[i+1] || args[i+1].startsWith('--')) throw new MigrationError('arguments', `Missing value for ${flag}`);
            options[flag] = args[++i];
        }
    }
    if (!!options['--apply'] === !!options['--dry-run']) throw new MigrationError('arguments', 'Choose exactly one of --dry-run or --apply');
    const scope = options['--scope'], prefix = options['--prefix'];
    if (!['chapters', 'covers'].includes(scope)) throw new MigrationError('arguments', 'Missing or invalid --scope; expected chapters or covers');
    if (!prefix) throw new MigrationError('arguments', 'Missing --prefix; expected slug/ or slug/chapN/');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:chap\d+(?:\.\d+)?\/)?$/.test(prefix)) throw new MigrationError('arguments', 'Invalid --prefix; expected a bucket-relative slug/ or slug/chapN/ with a trailing slash');
    const limit = options['--limit'] === undefined ? Infinity : Number(options['--limit']);
    if (options['--limit'] !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new MigrationError('arguments', 'Invalid --limit; expected a positive integer');
    return { scope, prefix, limit, apply: !!options['--apply'], journalPath: options['--journal'] || `webp-${Date.now()}.jsonl` };
}

async function main() {
    const { scope, prefix, limit, apply, journalPath } = parseArguments(process.argv.slice(2));
    const { base, store, catalogue } = await connect();
    if (apply) {
        const snapshot = await atStage('catalogue.snapshot', { prefix }, () => catalogue.read());
        await atStage('journal.snapshot', { prefix }, () => writeFile(`${journalPath}.catalogue.json`, JSON.stringify(snapshot, null, 2), { flag: 'wx' }));
    }
    const stats = await migrate({ store, catalogue, base, scope, prefix, apply, limit,
        journal: entry => appendFile(journalPath, JSON.stringify(entry) + '\n', { flush: true }) });
    console.log(JSON.stringify(stats, null, 2));
    if (stats.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
    console.error(`Migration stopped: ${formatFailure(error)} Originals retained.`); process.exitCode = 1;
});
