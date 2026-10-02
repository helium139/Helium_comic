// Pure URL builders shared by the browser and Discord notifier.
export function mangaUrl(slug) {
    return `/manga/${encodeURIComponent(slug)}/`;
}

export function chapterUrl(slug, chapter) {
    return `${mangaUrl(slug)}chapter/${encodeURIComponent(String(chapter))}/`;
}
