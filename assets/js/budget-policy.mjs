// Review candidate only; nothing is deployed by this file.
// Public popularity is optional, separate from revenue accounting.
export const OPTIONAL_POPULARITY_ENABLED = false;
export const COMMENTS_AUTOLOAD_ENABLED = false;

export function createPopularityRecorder({enabled, record}) {
    const submitted = new Set();
    return ({mangaId, chapterId, firstImage}) => {
        if (!enabled || !firstImage || !(firstImage.naturalWidth > 0)) return;
        const key = JSON.stringify([mangaId, String(chapterId)]);
        if (submitted.has(key)) return;
        submitted.add(key);
        void Promise.resolve().then(() => record({mangaId, chapterId: String(chapterId)})).catch(() => {});
    };
}
