import { setPick } from "../../assets/js/admin-picks-order.mjs";
import { verifyFirebaseToken } from "./firebase-auth.js";
import { imageFormat } from "./image-format.js";
import {
    promoteChapterPages, cleanupChapterSources, cleanupEditedChapterSources, stagingName
} from "./chapter-promotion.js";
import {
    HttpError, fail, safeSlug, chapterNumber, pageCount, validateRegistry,
    activeTeam, authorizeManga, imageName, uploadFolder, metadata, editorial
} from "./cms-authorization.js";

function rawFlag(body) {
    if (!Object.hasOwn(body, "isRawCaughtUp")) return {};
    if (typeof body.isRawCaughtUp !== "boolean") fail(400, "Invalid Ngang Raw flag");
    return { isRawCaughtUp: body.isRawCaughtUp };
}

const MUTATIONS = new Set([
    "/new-manga", "/edit-manga", "/delete-manga", "/new-chapter",
    "/edit-chapter", "/delete-chapter", "/upload", "/rename-images"
]);
const PUBLIC = new Set(["/mangas", "/status"]);
const ORIGINS = new Set([
    "https://heliumtg.com", "https://www.heliumtg.com",
    "http://localhost:8000", "http://127.0.0.1:8000"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const STAGING_TTL = 24 * 60 * 60 * 1000;
const CHAPTER_EDIT_LOCK_TTL = 30 * 60 * 1000;

function chapterImages(images, count) {
    if (!Array.isArray(images) || images.length !== count || new Set(images).size !== count) fail(400, "Invalid chapter image list");
    return images.map((name, index) => {
        imageName(name);
        if (Number(name.split(/[.-]/)[0]) !== index + 1) fail(400, "Invalid page order");
        return name;
    });
}

// Dependency injection is code-level only; request/env data cannot replace verification.
export function createWorker({ verifyToken = verifyFirebaseToken, fetchImpl = (...args) => fetch(...args),
    log = (details) => console.error("CMS operation failed", details) } = {}) {

    let mangaOwnershipCache;

    async function githubFetch(env, path, method = "GET", body, accept = "application/vnd.github+json", etag) {
        const response = await fetchImpl(`https://api.github.com${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: accept, "User-Agent": "HeliumCMS",
                "X-GitHub-Api-Version": "2022-11-28",
                ...(accept === "application/vnd.github.raw+json" ? { "Cache-Control": "no-cache" } : {}),
                ...(etag ? { "If-None-Match": etag } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status === 304) return response;
        if (!response.ok) {
            // Never include upstream response bodies, headers or credentials in errors/logs.
            log({ service: "github", method, status: response.status });
            fail(response.status === 409 ? 409 : 502,
                response.status === 409 ? "Catalogue changed; reload before retrying" : "Publishing service unavailable");
        }
        return response;
    }

    async function githubRequest(env, path, method = "GET", body) {
        return (await githubFetch(env, path, method, body)).json();
    }

    function repoPath(env, filename) {
        return `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}` +
            `/contents/assets/data/${filename}`;
    }

    async function getFile(env, filename) {
        const file = await githubRequest(env, `${repoPath(env, filename)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
        const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), char => char.charCodeAt(0));
        return { sha: file.sha, data: JSON.parse(new TextDecoder().decode(bytes)) };
    }

    async function getPublicCatalogue(env) {
        const response = await githubFetch(env,
            `${repoPath(env, "data.json")}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,
            "GET", undefined, "application/vnd.github.raw+json");
        if (!response.body) throw new Error("Catalogue response has no body");
        return response.body;
    }

    async function getMangaOwnership(env, slug, forceRefresh = false) {
        const cached = forceRefresh ? null : mangaOwnershipCache;
        const response = await githubFetch(env,
            `${repoPath(env, "data.json")}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,
            "GET", undefined, "application/vnd.github.raw+json", cached?.etag);
        if (response.status === 304) {
            if (!cached) throw new Error("Unexpected not-modified catalogue response");
            if (mangaOwnershipCache !== cached) return getMangaOwnership(env, slug, true);
            const manga = cached.index[slug];
            if (!manga) fail(404, "Manga not found");
            return manga;
        }
        const catalogue = await response.json();
        if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue)) {
            throw new Error("Invalid manga catalogue");
        }
        const index = Object.create(null);
        for (const [id, manga] of Object.entries(catalogue)) {
            index[id] = Object.freeze({ teamId: manga && typeof manga === "object" ? manga.teamId : undefined });
        }
        Object.freeze(index);
        const etag = response.headers.get("ETag");
        mangaOwnershipCache = etag ? { etag, index } : null;
        const manga = index[slug];
        if (!manga) fail(404, "Manga not found");
        return manga;
    }

    async function saveData(env, data, sha, message) {
        const bytes = new TextEncoder().encode(JSON.stringify(data, null, 4));
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await githubRequest(env, repoPath(env, "data.json"), "PUT", {
            message, content: btoa(binary), sha, branch: env.GITHUB_BRANCH
        });
        mangaOwnershipCache = null;
    }

    async function readBody(request) {
        let body;
        try { body = await request.json(); } catch { fail(400, "Invalid JSON request"); }
        if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Invalid request");
        return body;
    }

    async function authenticate(request) {
        const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") || "");
        if (!match || match[1].length > 16384) fail(401, "Authentication required");
        let actor;
        try { actor = await verifyToken(match[1]); } catch { fail(401, "Invalid authentication token"); }
        if (!["admin", "team_leader"].includes(actor.role)) fail(403, "Permission denied");
        return actor;
    }

    function publicBase(env) {
        const value = env.R2_PUBLIC_URL.replace(/\/+$/, "");
        if (new URL(value).protocol !== "https:") throw new Error("Invalid R2 public URL configuration");
        return value;
    }

    async function stagedKey(actor, ref) {
        if (typeof ref !== "string" || !UUID.test(ref)) fail(400, "Invalid staging reference");
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actor.uid));
        const owner = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
        return `staging/manga-covers/${owner}/${ref}`;
    }

    async function validateFile(file) {
        if (!file || typeof file.stream !== "function" || !file.size || file.size > 32 * 1024 * 1024 ||
            !IMAGE_TYPES.has(file.type)) fail(400, "Invalid image upload");
        const format = imageFormat(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
        if (!format) fail(400, "Unrecognized image bytes");
        return format;
    }

    async function upload(request, env, actor) {
        let form;
        try { form = await request.formData(); } catch { fail(400, "Invalid upload request"); }
        const file = form.get("file");
        const [extension, contentType] = await validateFile(file);
        const teams = validateRegistry((await getFile(env, "teams.json")).data);
        if (actor.role === "team_leader") activeTeam(teams, actor.teamId);
        if (form.get("kind") === "new-manga-cover") {
            if (["folder", "filename", "key", "destination", "manga"].some(key => form.has(key))) {
                fail(400, "Invalid upload path");
            }
            const ref = crypto.randomUUID();
            const key = await stagedKey(actor, ref);
            await env.BUCKET.put(key, file.stream(), {
                httpMetadata: { contentType },
                customMetadata: { owner: actor.uid, createdAt: String(Date.now()) }
            });
            return { success: true, stagingRef: ref };
        }
        if (form.has("kind") || form.has("key") || form.has("destination")) fail(400, "Invalid upload path");
        const { slug, folder, chapterId } = uploadFolder(form.get("folder"));
        const filename = form.get("filename");
        if (chapterId === null) {
            if (!/^cover\.(webp|jpg|jpeg|png|gif|avif)$/.test(filename)) fail(400, "Invalid upload path");
        } else imageName(filename);
        const actualExtension = filename.split('.').pop();
        if (chapterId !== null && actualExtension.replace('jpeg', 'jpg') !== extension) fail(400, "Image extension does not match bytes");
        const manga = await getMangaOwnership(env, slug);
        authorizeManga(actor, { [slug]: manga }, slug, teams);
        // Never overwrite a live page/cover before a separate catalogue save succeeds.
        const stem = chapterId === null ? 'cover' : filename.split(/[.-]/)[0];
        const key = `${folder}/${stem}-${crypto.randomUUID()}.${extension}`;
        await env.BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType },
            ...(chapterId !== null ? {
                customMetadata: { owner: actor.uid, createdAt: String(Date.now()) }
            } : {})
        });
        return { success: true, key, url: `${publicBase(env)}/${key}` };
    }

    async function newManga(body, env, actor, result, teams) {
        const slug = safeSlug(body.slug);
        if (Object.hasOwn(result.data, slug)) fail(409, "Manga already exists");
        const team = activeTeam(teams, actor.role === "admin" ? body.teamId : actor.teamId);
        const manga = {
            ...metadata(body), ...rawFlag(body), teamId: team.id, team: team.name,
            ...(actor.role === "admin" ? { ...editorial(body), adminPick: false, pickOrder: 999 } : { adminPick: false, pickOrder: 999 }),
            chapters: []
        };
        // New covers must be caller-owned staged objects, never arbitrary URLs/keys.
        if (body.cover) fail(400, "New manga cover requires staging");
        let stageKey, finalKey;
        if (body.coverStagingRef !== undefined) {
            stageKey = await stagedKey(actor, body.coverStagingRef);
            const stage = await env.BUCKET.get(stageKey);
            const createdAt = Number(stage?.customMetadata?.createdAt);
            if (!stage || stage.customMetadata?.owner !== actor.uid || !Number.isFinite(createdAt) ||
                createdAt > Date.now() || Date.now() - createdAt > STAGING_TTL) {
                fail(403, "Staged cover unavailable or expired");
            }
            // Unique filename prevents a losing concurrent create from overwriting a winner's cover.
            const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
            const ext = formats[stage.httpMetadata?.contentType];
            if (!ext) fail(400, "Invalid staged image type");
            finalKey = `${slug}/cover-${body.coverStagingRef}.${ext}`;
            manga.cover = `${publicBase(env)}/${finalKey}`;
            await env.BUCKET.put(finalKey, stage.body, { httpMetadata: stage.httpMetadata });
        } else manga.cover = "";
        result.data[slug] = manga;
        if (actor.role === "admin" && Object.hasOwn(body, "adminPick")) setPick(result.data, slug, body.adminPick);
        // A failed response can be ambiguous: retain the unique final object in case GitHub committed.
        // Staging and any orphaned final cover can be reconciled by the documented cleanup job.
        await saveData(env, result.data, result.sha, `Create manga ${slug}`);
        if (stageKey) {
            try { await env.BUCKET.delete(stageKey); }
            catch { log({ service: "r2", operation: "staging-cleanup", outcome: "retry-required" }); }
        }
        return { success: true, cover: manga.cover };
    }

    async function editedCover(body, existing, slug, env) {
        if (body.coverStagingRef !== undefined) fail(400, "Staging is only supported for new manga covers");
        if (body.cover === undefined || body.cover === existing.cover) return existing.cover;
        const base = `${publicBase(env)}/${slug}/`;
        if (typeof body.cover !== 'string' || !body.cover.startsWith(base) ||
            !/^cover(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.(webp|jpg|jpeg|png|gif|avif)$/.test(body.cover.slice(base.length))) fail(400, "Invalid cover path");
        if (!await env.BUCKET.head(body.cover.slice(publicBase(env).length + 1))) fail(400, "Cover image not uploaded");
        return body.cover;
    }

    async function renameImages(body, env, actor, data, teams) {
        const { slug, folder, chapterId } = uploadFolder(body.folder);
        authorizeManga(actor, data, slug, teams);
        if (chapterId === null || !Array.isArray(body.images) || !body.images.length ||
            body.images.length > 10000 || new Set(body.images).size !== body.images.length ||
            Object.keys(body).some(key => !["folder", "images"].includes(key))) fail(400, "Invalid rename request");
        // Validate the entire plan before touching R2. Neither sources nor destinations are paths from the client.
        const operation = crypto.randomUUID();
        const plan = body.images.map((name, index) => {
            imageName(name);
            const ext = name.split(".").pop();
            const destination = imageName(`${index + 1}-${operation}.${ext}`);
            return { source: `${folder}/${name}`, destination: `${folder}/${destination}`, ext };
        });
        for (const item of plan) {
            if (!await env.BUCKET.head(item.source)) fail(404, "Chapter image not found");
        }
        for (const item of plan) {
            const object = await env.BUCKET.get(item.source);
            if (!object) fail(409, "Chapter images changed; reload before retrying");
            await env.BUCKET.put(item.destination, object.body, { httpMetadata: object.httpMetadata });
            if (!await env.BUCKET.head(item.destination)) throw new Error("Missing reordered image");
        }
        return { success: true, images: plan.map(item => item.destination.slice(folder.length + 1)) };
    }

    async function acquireChapterEditLock(bucket, root) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(root)));
        const lockId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        const key = `staging/chapter-edit-locks/${lockId}`;
        const owner = crypto.randomUUID();
        // R2 deletes are unconditional, so both acquisition and release use conditional puts.
        for (let attempt = 0; attempt < 3; attempt++) {
            const current = await bucket.get(key);
            if (current && current.customMetadata?.state === 'active') {
                const createdAt = Number(current.customMetadata.createdAt);
                if (!Number.isFinite(createdAt) || Date.now() - createdAt <= CHAPTER_EDIT_LOCK_TTL) {
                    fail(409, 'Chapter edit already in progress; retry after it finishes');
                }
            }
            const stored = await bucket.put(key, owner, {
                onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
                customMetadata: { owner, state: 'active', createdAt: String(Date.now()) }
            });
            if (stored) {
                return async () => {
                    const lock = await bucket.get(key);
                    if (lock?.customMetadata?.owner === owner && lock.etag) {
                        await bucket.put(key, 'released', {
                            onlyIf: { etagMatches: lock.etag },
                            customMetadata: { state: 'released', createdAt: String(Date.now()) }
                        });
                    }
                };
            }
        }
        fail(409, 'Chapter edit already in progress; retry after it finishes');
    }

    async function editChapter(body, env, actor, result, manga, slug) {
        const id = chapterNumber(body.chapterId);
        const chapter = manga.chapters.find(item => Number(item.id) === id);
        if (!chapter) fail(404, "Chapter not found");
        if (typeof body.title !== "string" || !body.title.trim() ||
            typeof body.createAt !== "string" || !Number.isFinite(Date.parse(body.createAt))) fail(400, "Invalid chapter metadata");
        const pages = pageCount(body.pages);
        if (!Array.isArray(body.images) || body.images.length !== pages ||
            new Set(body.images.map(item => item && typeof item === 'object' ? item.name : String(item))).size !== pages) {
            fail(400, "Invalid chapter image list");
        }

        const root = `${slug}/chap${id}`;
        const base = publicBase(env);
        if (typeof chapter.folder !== "string" || !chapter.folder.startsWith(`${base}/`)) fail(400, "Invalid chapter folder");
        const oldFolder = chapter.folder.slice(base.length + 1);
        const revisionPrefix = `${root}/_revision-`;
        const oldRevision = oldFolder.startsWith(revisionPrefix) ? oldFolder.slice(revisionPrefix.length) : '';
        if (oldFolder !== root && !/^\d+(?:-\d+)?$/.test(oldRevision)) {
            fail(400, "Invalid chapter folder");
        }
        const oldNames = chapter.images || Array.from({ length: pageCount(chapter.pages) }, (_, index) => `${index + 1}.jpg`);
        if (!Array.isArray(oldNames) || new Set(oldNames).size !== oldNames.length) fail(400, "Invalid current chapter image list");
        for (const name of oldNames) imageName(name);

        const stagedNames = body.stagedImages === undefined ? [] : body.stagedImages;
        if (!Array.isArray(stagedNames) || stagedNames.length > 10000 ||
            new Set(stagedNames).size !== stagedNames.length ||
            stagedNames.some(name => typeof name !== 'string' || !stagingName.test(name))) {
            fail(400, "Invalid staged image list");
        }
        const names = [], sourceFolders = [], stageObjects = new Map();
        for (const source of body.images) {
            if (!source || typeof source !== 'object' || Array.isArray(source) ||
                Object.keys(source).some(key => !['type', 'name'].includes(key)) ||
                typeof source.name !== 'string') fail(400, "Invalid chapter image source");
            imageName(source.name);
            if (source.type === 'existing' && oldNames.includes(source.name)) {
                names.push(source.name);
                sourceFolders.push(oldFolder);
            } else if (source.type === 'staged' && stagingName.test(source.name) && stagedNames.includes(source.name)) {
                let staged = stageObjects.get(source.name);
                if (!staged) {
                    staged = await env.BUCKET.get(`${root}/${source.name}`);
                    if (!staged || staged.customMetadata?.owner !== actor.uid) fail(400, 'Staged chapter image unavailable');
                    stageObjects.set(source.name, staged);
                }
                names.push(source.name);
                sourceFolders.push(root);
            } else fail(400, "Invalid chapter image source");
        }
        Object.assign(manga, rawFlag(body));
        const finalNames = names.map((name, index) =>
            `${index + 1}.${name.split('.').pop().replace('jpeg', 'jpg')}`);
        const lockRelease = await acquireChapterEditLock(env.BUCKET, root);
        try {
            const latest = await getFile(env, "data.json");
            if (latest.sha !== result.sha) fail(409, "Catalogue changed while editing; reload the chapter and retry");
            let destinationFolder;
            // A distinct immutable revision keeps the currently published pages intact until commit.
            for (let attempt = 0; attempt < 1000; attempt++) {
                const revision = Date.now() + attempt;
                const candidate = `${root}/_revision-${revision}`;
                if (!await env.BUCKET.head(`${candidate}/${finalNames[0]}`)) {
                    destinationFolder = candidate;
                    break;
                }
            }
            if (!destinationFolder) fail(409, "Could not reserve a chapter revision; retry");

            const promotedNames = await promoteChapterPages(env.BUCKET, root, names, {
                sourceFolders, destinationFolder
            });
            Object.assign(chapter, {
                title: body.title, createAt: body.createAt, pages, images: promotedNames,
                folder: `${base}/${destinationFolder}`
            });
            await saveData(env, result.data, result.sha, `Edit ${slug} chapter ${id}`);

            const committed = await getFile(env, "data.json");
            const saved = committed.data[slug]?.chapters?.find(item => Number(item.id) === id);
            if (!saved || saved.folder !== chapter.folder || saved.title !== chapter.title ||
                saved.createAt !== chapter.createAt || saved.pages !== chapter.pages ||
                JSON.stringify(saved.images) !== JSON.stringify(chapter.images)) {
                fail(409, "Committed chapter verification failed; old images retained");
            }
            await promoteChapterPages(env.BUCKET, root, promotedNames, {
                sourceFolders: promotedNames.map(() => destinationFolder), destinationFolder
            });
            try {
                await cleanupEditedChapterSources(env.BUCKET, {
                    root, oldFolder, oldNames, stagedNames, destinationFolder, finalNames: promotedNames,
                    catalogue: committed.data, base, owner: actor.uid
                });
            } catch {
                log({ service: "r2", operation: "chapter-edit-cleanup", outcome: "retry-required" });
            }
            return { success: true, chapter: saved };
        } finally {
            try { await lockRelease(); }
            catch { log({ service: "r2", operation: "chapter-edit-lock-release", outcome: "retry-required" }); }
        }
    }

    async function mutate(path, request, env, actor) {
        if (path === "/upload") return upload(request, env, actor);
        // Read the authoritative GitHub branch, not a browser snapshot/static CDN cache.
        const result = await getFile(env, "data.json");
        const teams = validateRegistry((await getFile(env, "teams.json")).data);
        if (actor.role === "team_leader") activeTeam(teams, actor.teamId);
        const body = await readBody(request);
        if (path === "/new-manga") return newManga(body, env, actor, result, teams);
        if (path === "/rename-images") return renameImages(body, env, actor, result.data, teams);
        const slug = safeSlug(path.endsWith("manga") ? body.slug : body.manga);
        const manga = authorizeManga(actor, result.data, slug, teams);
        if (path === "/edit-chapter") return editChapter(body, env, actor, result, manga, slug);
        let response = { success: true };
        let message;
        let chapterCleanup;
        switch (path) {
            case "/edit-manga": {
                const team = actor.role === "admin" && body.teamId !== undefined && body.teamId !== manga.teamId
                    ? activeTeam(teams, body.teamId)
                    : teams.find(team => team.id === manga.teamId);
                if (actor.role === "admin") {
                    editorial(body);
                    if (Object.hasOwn(body, "adminPick")) setPick(result.data, slug, body.adminPick);
                }
                Object.assign(manga, metadata(body), rawFlag(body), {
                    cover: await editedCover(body, manga, slug, env), teamId: team.id, team: team.name
                });
                // chapters and unknown/global fields remain authoritative for every caller.
                message = `Edit manga ${slug}`;
                break;
            }
            case "/delete-manga":
                delete result.data[slug];
                message = `Delete manga ${slug}`;
                break;
            case "/new-chapter": {
                Object.assign(manga, rawFlag(body));
                const id = chapterNumber(body.chapterNumber);
                const existing = manga.chapters.find(chapter => Number(chapter.id) === id);
                if (existing) {
                    const names = chapterImages(body.images, pageCount(body.imageCount));
                    const finals = names.map((name, i) => `${i + 1}.${name.split('.').pop().replace('jpeg', 'jpg')}`);
                    if (existing.title !== body.title || JSON.stringify(existing.images) !== JSON.stringify(finals)) fail(409, "Chapter already exists");
                    const base = publicBase(env);
                    const root = `${slug}/chap${id}`;
                    if (typeof existing.folder !== 'string' || !existing.folder.startsWith(`${base}/`)) fail(400, 'Invalid chapter folder');
                    const destinationFolder = existing.folder.slice(base.length + 1);
                    const revisionPrefix = `${root}/_revision-`;
                    const destinationRevision = destinationFolder.startsWith(revisionPrefix)
                        ? destinationFolder.slice(revisionPrefix.length) : '';
                    if (destinationFolder !== root && !/^\d+(?:-\d+)?$/.test(destinationRevision)) {
                        fail(400, 'Invalid chapter folder');
                    }
                    await promoteChapterPages(env.BUCKET, root, names, {
                        committed: true, destinationFolder
                    });
                    try {
                        await cleanupChapterSources(env.BUCKET, root, names, result.data, base, destinationFolder);
                    }
                    catch { log({ service: "r2", operation: "chapter-staging-cleanup", outcome: "retry-required" }); }
                    return { success: true, chapter: existing };
                }
                if (typeof body.title !== "string" || !body.title.trim()) fail(400, "Invalid chapter title");
                const chapter = {
                    id, title: body.title, createAt: new Date().toISOString(),
                    folder: `${publicBase(env)}/${slug}/chap${id}`, pages: pageCount(body.imageCount)
                };
                chapter.images = chapterImages(body.images, chapter.pages);
                for (const name of chapter.images) if (!await env.BUCKET.head(`${slug}/chap${id}/${name}`)) fail(400, "Chapter image not uploaded");
                chapterCleanup = { folder: `${slug}/chap${id}`, names: [...chapter.images] };
                chapter.images = await promoteChapterPages(env.BUCKET, chapterCleanup.folder, chapter.images);
                manga.chapters.push(chapter);
                manga.chapters.sort((a, b) => a.id - b.id);
                response.chapter = chapter;
                message = `Add ${slug} chapter ${id}`;
                break;
            }
            case "/delete-chapter": {
                const id = chapterNumber(body.chapterId);
                if (!manga.chapters.some(chapter => Number(chapter.id) === id)) fail(404, "Chapter not found");
                manga.chapters = manga.chapters.filter(chapter => Number(chapter.id) !== id);
                manga.chapters.sort((a, b) => a.id - b.id);
                message = `Delete ${slug} chapter ${id}`;
                break;
            }
        }
        await saveData(env, result.data, result.sha, message);
        if (chapterCleanup) {
            try {
                const committed = await getFile(env, "data.json");
                const saved = committed.data[slug]?.chapters?.find(chapter => chapter.folder === response.chapter.folder);
                if (JSON.stringify(saved?.images) !== JSON.stringify(response.chapter.images)) throw new Error("Catalogue verification failed");
                await cleanupChapterSources(env.BUCKET, chapterCleanup.folder, chapterCleanup.names, committed.data, publicBase(env));
            } catch { log({ service: "r2", operation: "chapter-staging-cleanup", outcome: "retry-required" }); }
        }
        return response;
    }

    return {
        async fetch(request, env) {
            const path = new URL(request.url).pathname;
            const isPublic = PUBLIC.has(path);
            const origin = request.headers.get("Origin");
            const headers = { "Content-Type": "application/json", "Vary": "Origin" };
            if (isPublic) headers["Access-Control-Allow-Origin"] = "*";
            else if (ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
            const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
            try {
                if (!isPublic && !MUTATIONS.has(path)) return json({ success: false, error: "API not found" }, 404);
                if (request.method === "OPTIONS") {
                    if (!isPublic && !ORIGINS.has(origin)) fail(403, "Origin not allowed");
                    const method = request.headers.get("Access-Control-Request-Method");
                    if (!isPublic && method && method !== "POST") fail(405, "Method not allowed");
                    const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "")
                        .split(",").map(header => header.trim().toLowerCase()).filter(Boolean);
                    if (requestedHeaders.some(header => !["authorization", "content-type"].includes(header))) fail(403, "Header not allowed");
                    return new Response(null, { status: 204, headers: {
                        ...headers, "Access-Control-Allow-Methods": isPublic ? "GET,OPTIONS" : "POST,OPTIONS",
                        "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Max-Age": "600"
                    } });
                }
                if (path === "/status") return json({ success: true, message: "Helium CMS Online" });
                if (path === "/mangas") return new Response(await getPublicCatalogue(env), { status: 200, headers });
                if (request.method !== "POST") {
                    headers.Allow = "POST, OPTIONS";
                    fail(405, "Method not allowed");
                }
                const actor = await authenticate(request);
                if (origin && !ORIGINS.has(origin)) fail(403, "Origin not allowed");
                return json(await mutate(path, request, env, actor));
            } catch (error) {
                if (error instanceof HttpError) return json({ success: false, error: error.message, message: error.message }, error.status);
                // No raw messages/stack traces, request bodies, tokens or env values in logs/responses.
                log({ route: path, operation: "request", errorType: error?.name || "Error" });
                return json({ success: false, error: "CMS operation failed", message: "CMS operation failed" }, 500);
            }
        }
    };
}

export default createWorker();
