import { getViewAnalytics } from './api/view-analytics.js';

export function createDashboardAnalytics({ staff, teams, catalogue, call = getViewAnalytics }) {
    const total = document.getElementById('total-valid-views');
    const monthly = document.getElementById('monthly-valid-views');
    const status = document.getElementById('view-analytics-status');
    const tree = document.getElementById('view-analytics-tree');
    const expand = document.getElementById('view-analytics-expand');
    const periodSelect = document.getElementById('view-analytics-period');
    let revision = 0, currentScope, currentRoot, expanded = false, active = false;
    let serverMonth;
    const period = () => periodSelect.value === 'month' ? (serverMonth || new Date().toISOString().slice(0, 7)) : 'all';
    function title(row) {
        if (row.kind === 'team') return teams.find(team => team.id === row.teamId)?.name || row.teamId;
        const manga = catalogue[row.mangaId];
        if (row.kind === 'manga') return manga?.title || row.mangaId;
        return manga?.chapters?.find(chapter => String(chapter.id) === String(row.chapterId))?.title || `Chapter ${row.chapterId}`;
    }
    async function children(scopeId, container, cursor, version) {
        const response = await call({ scopeId, period: period(), includeChildren: true, ...(cursor ? { cursor } : {}) });
        if (version !== revision) return;
        for (const row of response.children) {
            const item = document.createElement('li');
            const label = document.createElement(row.kind === 'chapter' ? 'span' : 'button');
            label.textContent = `${title(row)} · ${Number(row.validViews).toLocaleString()} valid views`;
            item.appendChild(label);
            if (row.kind !== 'chapter') {
                label.type = 'button';
                label.setAttribute('aria-expanded', 'false');
                const nested = document.createElement('ul'); nested.hidden = true;
                let loaded = false, loading = false;
                label.addEventListener('click', async () => {
                    if (loading) return;
                    nested.hidden = !nested.hidden;
                    label.setAttribute('aria-expanded', String(!nested.hidden));
                    if (nested.hidden || loaded) return;
                    loading = true; label.disabled = true;
                    try { await children(row.scopeId, nested, null, version); loaded = true; }
                    catch { if (version === revision) status.textContent = 'Không thể tải thống kê. Hãy thử lại.'; }
                    finally { loading = false; label.disabled = false; }
                });
                item.appendChild(nested);
            }
            container.appendChild(item);
        }
        if (!response.children.length && !cursor) {
            const empty = document.createElement('li'); empty.textContent = 'Chưa có lượt xem hợp lệ.'; container.appendChild(empty);
        }
        if (response.nextCursor) {
            const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Load more';
            more.addEventListener('click', async () => {
                more.disabled = true;
                try { await children(scopeId, container, response.nextCursor, version); more.remove(); }
                catch { more.disabled = false; status.textContent = 'Không thể tải thêm thống kê.'; }
            });
            container.appendChild(more);
        }
    }
    async function update(scope) {
        currentScope = scope;
        currentRoot = staff.role === 'team_leader' ? `team:${staff.teamId}` : scope === 'all' ? 'site' : `team:${scope}`;
        const version = ++revision;
        expanded = false; active = false; tree.replaceChildren(); tree.hidden = true;
        expand.disabled = true; expand.setAttribute('aria-expanded', 'false');
        total.textContent = monthly.textContent = 'Loading…';
        status.textContent = 'Đang tải thống kê tổng hợp…';
        try {
            const result = await call({ scopeId: currentRoot, period: period() });
            if (version !== revision) return;
            serverMonth = result.month;
            active = result.active;
            total.textContent = active ? Number(result.total).toLocaleString() : 'Not active yet';
            monthly.textContent = active ? Number(result.monthly).toLocaleString() : 'Not active yet';
            status.textContent = active
                ? `Valid views since ${new Date(result.activationAt).toISOString()} · UTC month ${result.month}`
                : 'Valid views chưa được kích hoạt. Không bao gồm lượt xem lịch sử.';
            expand.disabled = !active;
        } catch (error) {
            if (version !== revision) return;
            const missing = ['functions/not-found', 'functions/failed-precondition'].includes(error.code);
            total.textContent = monthly.textContent = missing ? 'Not active yet' : 'Unavailable';
            status.textContent = missing ? 'Backend valid views chưa sẵn sàng.' : 'Không thể tải thống kê hợp lệ. Vui lòng thử lại sau.';
        }
    }
    expand.addEventListener('click', async () => {
        if (!active) return;
        expanded = !expanded; tree.hidden = !expanded; expand.setAttribute('aria-expanded', String(expanded));
        if (!expanded || tree.children.length) return;
        expand.disabled = true;
        try { await children(currentRoot, tree, null, revision); }
        catch { status.textContent = 'Không thể tải thống kê. Hãy thử lại.'; }
        finally { expand.disabled = !active; }
    });
    periodSelect.addEventListener('change', () => { if (currentScope) update(currentScope); });
    return { update };
}
