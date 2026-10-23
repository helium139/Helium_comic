export const MANGA_PAGE_SIZE = 15;
export function paginateMangas(items, requestedPage = 1) {
    const pageCount = Math.max(1, Math.ceil(items.length / MANGA_PAGE_SIZE));
    const page = Math.min(pageCount, Math.max(1, Math.trunc(Number(requestedPage)) || 1));
    const start = (page - 1) * MANGA_PAGE_SIZE;
    return {items: items.slice(start, start + MANGA_PAGE_SIZE), page, pageCount, total: items.length,
        first: items.length ? start + 1 : 0, last: Math.min(start + MANGA_PAGE_SIZE, items.length),
        previousDisabled: page === 1, nextDisabled: page === pageCount};
}
export function renderPagination(container, model, changePage, dom = document) {
    container.replaceChildren();
    function button(label, page, disabled, current = false) {
        const item = dom.createElement('button'); item.type = 'button'; item.textContent = label; item.disabled = disabled;
        if (current) item.setAttribute('aria-current', 'page');
        item.addEventListener('click', () => { if (!item.disabled) changePage(page); });
        container.appendChild(item);
    }
    button('Previous', model.page - 1, model.previousDisabled);
    for (let page = 1; page <= model.pageCount; page++) button(String(page), page, false, page === model.page);
    button('Next', model.page + 1, model.nextDisabled);
}
