// Shared public URLs. API endpoints are deliberately independent of these routes.
import { mangaUrl, chapterUrl } from "./route-urls.mjs";
export { mangaUrl, chapterUrl };

export function getRouteParams() {
    const params = new URLSearchParams(window.location.search);
    const match = window.location.pathname.match(/^\/manga\/([^/]+)(?:\/chapter\/([^/]+))?\/?$/);
    if (match) {
        params.set("id", decodeURIComponent(match[1]));
        if (match[2] !== undefined) params.set("chap", decodeURIComponent(match[2]));
    }
    return params;
}

// Replace legacy entries instead of adding another entry to browser history.
const legacyPages = {
    "/index.html": "/",
    "/login.html": "/login/",
    "/follow.html": "/follow/",
    "/history.html": "/history/",
    "/user.html": "/user/",
    "/admin/index.html": "/admin/",
    "/admin/manga.html": "/admin/manga/",
    "/admin/chapter.html": "/admin/chapter/"
};
const params = new URLSearchParams(window.location.search);
let destination = legacyPages[window.location.pathname];
if (window.location.pathname === "/manga.html" && params.get("id")) {
    destination = mangaUrl(params.get("id"));
    params.delete("id");
} else if (window.location.pathname === "/chapter.html" && params.get("id") && params.has("chap")) {
    destination = chapterUrl(params.get("id"), params.get("chap"));
    params.delete("id");
    params.delete("chap");
}
if (destination) {
    const query = params.toString();
    window.location.replace(destination + (query ? `?${query}` : "") + window.location.hash);
}
