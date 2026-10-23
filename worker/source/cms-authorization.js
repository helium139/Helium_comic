export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function safeSlug(value) {
    if (typeof value !== "string" || value.length > 200 || !slugPattern.test(value)) {
        fail(400, "Invalid manga identifier");
    }
    return value;
}

export function chapterNumber(value) {
    if (!["string", "number"].includes(typeof value) ||
        !/^\d+(?:\.\d+)?$/.test(String(value))) fail(400, "Invalid chapter identifier");
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1e9) fail(400, "Invalid chapter identifier");
    return number;
}

export function pageCount(value) {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1 || count > 10000) fail(400, "Invalid image count");
    return count;
}

export function validateRegistry(teams) {
    if (!Array.isArray(teams) || !teams.length) throw new Error("Invalid canonical team registry");
    const ids = new Set(), slugs = new Set();
    for (const team of teams) {
        if (!team || typeof team.id !== "string" || !slugPattern.test(team.id) ||
            typeof team.slug !== "string" || !slugPattern.test(team.slug) ||
            typeof team.name !== "string" || !team.name.trim() || typeof team.active !== "boolean" ||
            ids.has(team.id) || slugs.has(team.slug)) throw new Error("Invalid canonical team registry");
        ids.add(team.id); slugs.add(team.slug);
    }
    return teams;
}

export function activeTeam(teams, teamId) {
    const team = teams.find(team => team.id === teamId && team.active);
    if (!team) fail(403, "Unknown or inactive team");
    return team;
}

export function authorizeManga(actor, catalogue, slug, teams) {
    safeSlug(slug);
    if (!Object.hasOwn(catalogue, slug)) fail(404, "Manga not found");
    const manga = catalogue[slug];
    // Deliberately no legacy display-name fallback in authorization.
    if (typeof manga.teamId !== "string" || !teams.some(team => team.id === manga.teamId)) {
        fail(403, "Manga has invalid team ownership");
    }
    if (actor.role !== "admin" && actor.teamId !== manga.teamId) fail(403, "Permission denied");
    return manga;
}

export function imageName(value) {
    if (typeof value !== "string" || !/^[1-9]\d{0,4}(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(value)) {
        fail(400, "Invalid image filename");
    }
    return value;
}

export function uploadFolder(value) {
    if (typeof value !== "string") fail(400, "Invalid upload path");
    // Accept canonical syntax only: no decoding/normalization can hide another prefix.
    const parts = value.split("/");
    if (parts.length < 1 || parts.length > 2) fail(400, "Invalid upload path");
    const slug = safeSlug(parts[0]);
    if (parts.length === 1) return { slug, folder: slug, chapterId: null };
    if (!/^chap\d+(?:\.\d+)?$/.test(parts[1])) fail(400, "Invalid upload path");
    const chapterId = chapterNumber(parts[1].slice(4));
    const folder = `${slug}/chap${chapterId}`;
    if (folder !== value) fail(400, "Invalid upload path");
    return { slug, folder, chapterId };
}

export function metadata(body) {
    const fields = ["title", "original_title", "author", "status", "description"];
    const result = {};
    for (const key of fields) {
        if (typeof body[key] !== "string" || body[key].length > 50000) fail(400, "Invalid manga metadata");
        result[key] = body[key];
    }
    if (!result.title.trim() || !Array.isArray(body.tags) || body.tags.length > 100 ||
        body.tags.some(tag => typeof tag !== "string" || tag.length > 200)) fail(400, "Invalid manga metadata");
    result.tags = body.tags;
    return result;
}

export function editorial(body) {
    if (typeof body.adminPick !== "boolean") fail(400, "Invalid editorial fields");
    return { adminPick: body.adminPick, pickOrder: 999 };
}
