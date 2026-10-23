import { loadPopularity } from './popularity.js';
import { completedEntries } from './completed-catalogue.mjs';
import { renderMangaCard, installCoverFallback } from './manga-card.js';

const grid = document.getElementById('completed-grid');
const search = document.getElementById('completed-search');
const sort = document.getElementById('completed-sort');
const status = document.getElementById('completed-status');
try {
    if (localStorage.getItem('userWebTheme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch { /* Storage can be disabled. */ }

installCoverFallback(grid);

async function init() {
    try {
        const [catalogue, popularity] = await Promise.all([
            fetch('/assets/data/data.json').then(response => {
                if (!response.ok) throw new Error('Catalogue unavailable');
                return response.json();
            }),
            loadPopularity().then(stats => ({ stats })).catch(() => ({ stats: [], failed: true }))
        ]);
        function render() {
            const entries = completedEntries(catalogue, popularity.stats, search.value, sort.value);
            grid.innerHTML = entries.map(([slug, manga]) => renderMangaCard(slug, manga)).join('');
            status.textContent = entries.length ? `${entries.length} bộ truyện hoàn thành` :
                search.value.trim() ? 'Không tìm thấy truyện hoàn thành phù hợp.' : 'Hiện chưa có truyện hoàn thành.';
            if (popularity.failed) status.textContent += ' Chưa thể tải lượt xem; thứ tự phổ biến tạm thời chưa khả dụng.';
        }
        search.disabled = false;
        sort.disabled = false;
        search.addEventListener('input', render);
        sort.addEventListener('change', render);
        render();
    } catch {
        status.textContent = 'Chưa thể tải truyện hoàn thành. Vui lòng thử lại sau.';
    }
}
init();
