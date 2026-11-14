import { db } from "./firebase.js";
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Existing public popularity counts, not private trusted accounting totals.
let pending;
let memoryCache;
const schema = 2;
const projectId = db.app?.options?.projectId;
// No shared fallback key when project identity is unavailable.
const cacheKey = typeof projectId === 'string' && projectId ?
    `helium:public-popularity:${encodeURIComponent(projectId)}:mangaStats:views-desc:v${schema}` : null;
const cacheMs = 60000;
function validCache(cached) {
    const age = Date.now() - cached?.at;
    return cached?.schema === schema && cached.projectId === projectId &&
        typeof cached.at === 'number' && Number.isFinite(cached.at) && age >= 0 && age < cacheMs &&
        Array.isArray(cached.stats) && cached.stats.every(item =>
            typeof item?.id === 'string' && item.id.length > 0 && Number.isFinite(item.views) && item.views >= 0);
}
function cachedPopularity() {
    if (!cacheKey) return null;
    if (validCache(memoryCache)) return memoryCache;
    try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey));
        if (validCache(cached)) return {schema, projectId, at: cached.at,
            stats: cached.stats.map(item => ({id: item.id, views: item.views}))};
    } catch { /* Storage may be disabled or contain an obsolete value. */ }
    return null;
}
export function loadPopularity() {
    if (pending) return pending;
    const cached = cachedPopularity();
    if (cached) { memoryCache = cached; return Promise.resolve(cached.stats.map(item => ({id: item.id, views: item.views}))); }
    pending = getDocs(query(collection(db, "mangaStats"), orderBy("views", "desc")))
        .then(snapshot => {
            const stats = snapshot.docs.map(doc => ({ id: doc.id, views: doc.data().views }));
            const fresh = {schema, projectId, at: Date.now(), stats};
            // SDK offline fallback must not renew the freshness of old server data.
            if (cacheKey && snapshot.metadata?.fromCache !== true && validCache(fresh)) {
                memoryCache = {...fresh, stats: stats.map(item => ({id: item.id, views: item.views}))};
                try { sessionStorage.setItem(cacheKey, JSON.stringify(fresh)); }
                catch { /* A cache failure must not hide successful fresh data. */ }
            }
            return stats;
        })
        .finally(() => { pending = undefined; });
    return pending;
}
