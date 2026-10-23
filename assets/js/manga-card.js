import { mangaUrl } from "./route-urls.mjs";

export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function imageURL(value) {
    try {
        const url = new URL(value, "https://heliumtg.com/");
        return ["http:", "https:"].includes(url.protocol) && typeof value === "string" && value.trim()
            ? value : "/assets/images/helium_logo.webp";
    } catch { return "/assets/images/helium_logo.webp"; }
}

export function rawBadge(manga) {
    return manga.isRawCaughtUp === true ? '<span class="raw-caught-up-badge">Ngang Raw</span>' : '';
}

// The homepage card is shared with team listings, including its existing CSS classes.
export function renderMangaCard(slug, manga, now = Date.now()) {
    const chapter = manga.chapters?.at(-1);
    const age = now - Date.parse(chapter?.createAt);
    return `<a href="${escapeHTML(mangaUrl(slug))}" class="comic-item">
        <div class="comic-poster">
            ${rawBadge(manga)}
            ${manga.status === "Completed" ? '<span class="comic-end-badge">END</span>' : ''}
            ${age >= 0 && age <= 172800000 ? '<span class="new-chapter-badge">UP</span>' : ''}
            <img src="${escapeHTML(imageURL(manga.cover))}" alt="${escapeHTML(manga.title)}" loading="lazy" decoding="async">
        </div>
        <div class="comic-info"><h3 class="comic-name">${escapeHTML(manga.title)}</h3>
        <span class="comic-chapter">${escapeHTML(chapter?.title || "Chưa có chapter")}</span></div>
    </a>`;
}
