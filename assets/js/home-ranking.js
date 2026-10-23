import { mangaUrl } from "./route-urls.mjs";
import { escapeHTML as esc, imageURL } from "./manga-card.js";

const formatViews = new Intl.NumberFormat("vi-VN");
const statusLabels = { Completed: "Completed", Ongoing: "Ongoing", Hiatus: "Drop" };
const fallback = "/assets/images/helium_logo.webp";

// Public historical popularity totals; these are not trusted accounting views.
export function selectRanking(stats, catalogue) {
    return stats.filter(({ id, views }) => Object.hasOwn(catalogue, id) &&
        Number.isSafeInteger(views) && views >= 0)
        .sort((a, b) => b.views - a.views || a.id.localeCompare(b.id))
        .slice(0, 10);
}

export function rankingCard(entry, catalogue, index) {
    const manga = catalogue[entry.id];
    const rank = index + 1;
    const featured = rank <= 3;
    return `<a class="ranking-card ${featured ? 'ranking-featured' : 'ranking-compact'} ranking-place-${rank}" href="${esc(mangaUrl(entry.id))}">
        <span class="ranking-number" aria-label="Hạng ${rank}">${String(rank).padStart(2, '0')}</span>
        <img class="ranking-cover" src="${esc(imageURL(manga.cover))}" alt="Bìa ${esc(manga.title)}" loading="lazy" decoding="async">
        <div class="ranking-copy"><h3>${esc(manga.title)}</h3>
            <p class="ranking-views"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="var(--rank-surface)"/></svg>
            <span class="ranking-total">${formatViews.format(entry.views)}</span> <span class="ranking-unit">lượt xem</span></p>
            ${featured && statusLabels[manga.status] ? `<p class="ranking-status">${statusLabels[manga.status]}</p>` : ''}
        </div>
        <span class="ranking-arrow" aria-hidden="true">›</span>
        ${featured ? `<span class="ranking-decoration" aria-hidden="true">${rank}</span>` : ''}
    </a>`;
}

export function renderRanking(container, stats, catalogue) {
    const entries = selectRanking(stats, catalogue);
    if (!entries.length) {
        container.innerHTML = '<p class="ranking-message" role="status">Chưa có dữ liệu lượt xem để xếp hạng.</p>';
        return;
    }
    container.innerHTML = `<div class="ranking-leaders">${entries.slice(0, 3).map((entry, index) => rankingCard(entry, catalogue, index)).join('')}</div>
        ${entries.length > 3 ? `<div class="ranking-runners">${entries.slice(3).map((entry, index) => rankingCard(entry, catalogue, index + 3)).join('')}</div>` : ''}`;
}

export function installRankingFallback(container) {
    container.addEventListener("error", event => {
        const img = event.target;
        if (!img.matches?.(".ranking-cover")) return;
        if (img.dataset.fallback) { img.hidden = true; return; }
        img.dataset.fallback = "true";
        img.src = fallback;
    }, true);
}
