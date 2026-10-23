import { orderedPicks } from "./admin-picks-order.mjs";
import { mangaUrl } from "./route-urls.mjs";
import { escapeHTML as esc, imageURL, rawBadge, installCoverFallback } from "./manga-card.js";

const statuses = { Completed: 'Đã hoàn', Ongoing: 'Đang tiến hành', Hiatus: 'Tạm ngưng' };
export const nextSlide = (current, direction, count) => count ? (current + direction + count) % count : 0;
const plainText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();

export function featuredSlide(slug, manga, index, count) {
    return `<article class="pick-slide" ${index ? 'hidden' : ''} aria-roledescription="trang chiếu" aria-label="${index + 1} / ${count}">
        <div class="pick-backdrop" aria-hidden="true"></div>
        <div class="pick-art">${rawBadge(manga)}<img src="${esc(imageURL(manga.cover))}" alt="Bìa ${esc(manga.title)}" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"></div>
        <div class="pick-copy"><h3>${esc(manga.title)}</h3>
        ${manga.author ? `<p><strong>Tác giả:</strong> ${esc(manga.author)}</p>` : ''}
        ${manga.team ? `<p><strong>Nhóm dịch:</strong> ${esc(manga.team)}</p>` : ''}
        ${statuses[manga.status] ? `<p><strong>Tình trạng:</strong> ${statuses[manga.status]}</p>` : ''}
        ${manga.tags?.length ? `<div class="pick-tags">${manga.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
        ${manga.description ? `<p class="pick-description">${esc(plainText(manga.description))}</p>` : ''}
        <a class="pick-cta" href="${esc(mangaUrl(slug))}">Đọc truyện <span aria-hidden="true">→</span></a></div>
    </article>`;
}

export function renderAdminPicks(catalogue) {
    const root = document.getElementById('admin-picks');
    const entries = orderedPicks(catalogue).slice(-10);
    if (!entries.length) { root.innerHTML = '<p>Chưa có lựa chọn nổi bật.</p>'; return; }
    root.innerHTML = `<div class="pick-stage">${entries.map(([slug, manga], i) => featuredSlide(slug, manga, i, entries.length)).join('')}</div>
        <div class="pick-controls" ${entries.length === 1 ? 'hidden' : ''}>
            <button type="button" class="pick-prev" aria-label="Lựa chọn trước">‹</button>
            <div class="pick-dots">${entries.map((_, i) => `<button type="button" aria-label="Xem lựa chọn ${i + 1}" ${i ? '' : 'aria-current="true"'}></button>`).join('')}</div>
            <button type="button" class="pick-next" aria-label="Lựa chọn tiếp theo">›</button>
            <button type="button" class="pick-pause" aria-label="Tạm dừng tự động chuyển">Ⅱ</button>
        </div>`;
    const slides = [...root.querySelectorAll('.pick-slide')];
    const dots = [...root.querySelectorAll('.pick-dots button')];
    slides.forEach((slide, i) => {
        slide.querySelector('.pick-backdrop').style.backgroundImage = `url(${JSON.stringify(imageURL(entries[i][1].cover))})`;
    });
    installCoverFallback(root, '.pick-art img', img => {
        img.closest('.pick-slide').querySelector('.pick-backdrop').style.backgroundImage = 'none';
    });
    if (entries.length === 1) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let current = 0, timer, paused = false, hovered = false, focused = false;
    function schedule() {
        clearTimeout(timer);
        if (!paused && !hovered && !focused && !document.hidden && !motion.matches) timer = setTimeout(() => show(nextSlide(current, 1, slides.length)), 3000);
    }
    function show(index) {
        slides[current].hidden = true;
        dots[current].removeAttribute('aria-current');
        current = index;
        slides[current].hidden = false;
        dots[current].setAttribute('aria-current', 'true');
        schedule();
    }
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
    root.querySelector('.pick-prev').onclick = () => show(nextSlide(current, -1, slides.length));
    root.querySelector('.pick-next').onclick = () => show(nextSlide(current, 1, slides.length));
    root.querySelector('.pick-pause').onclick = event => {
        paused = !paused;
        event.currentTarget.setAttribute('aria-label', paused ? 'Tiếp tục tự động chuyển' : 'Tạm dừng tự động chuyển');
        event.currentTarget.textContent = paused ? '▶' : 'Ⅱ';
        schedule();
    };
    root.addEventListener('mouseenter', () => { hovered = true; schedule(); });
    root.addEventListener('mouseleave', () => { hovered = false; schedule(); });
    // Navigation buttons retain focus after a click; that must not stop autoplay.
    // Pause only while reading/following a link inside the active slide.
    root.addEventListener('focusin', event => { focused = !!event.target.closest('.pick-slide'); schedule(); });
    root.addEventListener('focusout', event => { focused = !!event.relatedTarget && root.contains(event.relatedTarget) && !!event.relatedTarget.closest('.pick-slide'); schedule(); });
    document.addEventListener('visibilitychange', schedule);
    motion.addEventListener('change', schedule);
    schedule();
}
