import { requireStaff } from '../assets/js/adminGuard.js';
import { scopeMangas, assertCanManageManga, showStaffAccessError } from '../assets/js/staff-access.js';
import { getTeams } from '../assets/js/teams.js';
import { getDashboardScope } from './dashboard-data.mjs';
import { listComments, moderateComment } from '../assets/js/comment-api.js';

export function createCommentManagement({staff, teams, catalogue, dom = document, list = listComments, moderate = moderateComment,
    confirmAction = message => window.confirm(message), requestedManga = null}) {
    const get = id => dom.getElementById(id);
    const allowed = scopeMangas(staff, catalogue);
    const team = get('comments-team'), manga = get('comments-manga'), state = get('comments-state');
    const status = get('comments-status'), rows = get('comments-list'), more = get('comments-more');
    let scope = getDashboardScope(staff, 'all', teams), generation = 0, selected = null, roots = [], cursor = null, busy = false;
    const threads = new Map();
    function node(tag, text, className) {
        const item = dom.createElement(tag); if (text !== undefined) item.textContent = text;
        if (className) item.className = className; return item;
    }
    function action(label, callback) {
        const button = node('button', label); button.type = 'button';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await callback(); } catch { status.textContent = 'Không thể cập nhật bình luận. Vui lòng thử lại.'; }
            finally { button.disabled = false; }
        });
        return button;
    }
    function available() {
        return Object.entries(allowed).filter(([, value]) => scope === 'all' || value.teamId === scope)
            .sort((a, b) => String(a[1].title).localeCompare(String(b[1].title), 'vi'));
    }
    function validate(id) {
        assertCanManageManga(staff, allowed[id]);
        if (!available().some(([key]) => key === id)) throw new Error('Manga outside selected scope');
    }
    function refill() {
        manga.replaceChildren();
        const items = available();
        for (const [id, value] of items) { const option = node('option', value.title); option.value = id; manga.appendChild(option); }
        selected = items.some(([id]) => id === requestedManga) ? requestedManga : items[0]?.[0] || null;
        manga.value = selected || ''; manga.disabled = !selected;
        if (requestedManga) { validate(requestedManga); requestedManga = null; }
    }
    function moderationState(comment) { return comment.deleted ? 'deleted' : comment.moderationStatus === 'hidden' ? 'hidden' : 'visible'; }
    function matches(comment) { return state.value === 'all' || moderationState(comment) === state.value; }
    function renderComment(comment, container, root = false) {
        const renderedManga = selected, renderedVersion = generation;
        const visible = matches(comment);
        if (!root && !visible) return;
        const card = node('article', undefined, 'admin-comment');
        const label = moderationState(comment);
        card.appendChild(node('h3', `${allowed[selected].title} · ${comment.name || 'Reader'}`));
        card.appendChild(node('p', `${comment.createdAt == null ? 'Unknown date' : new Date(comment.createdAt).toISOString()} · ${label} · ${comment.replyCount || 0} replies`, 'dashboard-muted'));
        card.appendChild(node('p', !visible ? 'Thread context — expand replies to check this status.' : comment.deleted ? 'Comment deleted' : label === 'hidden' ? 'Comment hidden' : comment.text, 'admin-comment-text'));
        if (visible && !comment.deleted) {
            const buttons = node('div', undefined, 'admin-comment-actions');
            for (const operation of [label === 'hidden' ? 'restore' : 'hide', 'delete']) {
                buttons.appendChild(action(operation === 'hide' ? 'Hide' : operation === 'restore' ? 'Restore' : 'Delete', async () => {
                    if (renderedVersion !== generation || renderedManga !== selected) return;
                    const id = renderedManga, version = renderedVersion; validate(id);
                    if (!confirmAction(`${operation} this comment?`)) return;
                    await moderate({mangaId: id, commentId: comment.id, action: operation});
                    if (version === generation) await load(true);
                }));
            }
            card.appendChild(buttons);
        }
        if (root) {
            let thread = threads.get(comment.id);
            if (!thread) { thread = {items: [], cursor: null, expanded: false, loaded: false, busy: false}; threads.set(comment.id, thread); }
            const expand = action(`Replies (${comment.replyCount || 0})`, async () => {
                if (renderedVersion !== generation || renderedManga !== selected) return;
                thread.expanded = !thread.expanded; render();
                if (thread.expanded && !thread.loaded) await loadReplies(comment.id);
            });
            expand.setAttribute('aria-expanded', String(thread.expanded)); card.appendChild(expand);
            if (thread.expanded) {
                const nested = node('div', undefined, 'admin-comment-replies');
                for (const entry of thread.items) renderComment(entry, nested);
                if (thread.loaded && !nested.children.length) nested.appendChild(node('p', 'No loaded replies match this status.', 'dashboard-muted'));
                if (thread.cursor) nested.appendChild(action('Load more replies', () => loadReplies(comment.id)));
                card.appendChild(nested);
            }
        }
        container.appendChild(card);
    }
    function render() { rows.replaceChildren(); for (const comment of roots) renderComment(comment, rows, true); }
    async function loadReplies(rootId) {
        const thread = threads.get(rootId); if (!thread || thread.busy) return;
        const id = selected, version = generation; validate(id); thread.busy = true;
        try {
            const result = await list({mangaId: id, rootId, cursor: thread.cursor});
            if (version !== generation) return;
            if (!result.canModerate) throw new Error('Permission denied');
            thread.items.push(...result.comments); thread.cursor = result.nextCursor; thread.loaded = true; render();
        } finally { thread.busy = false; }
    }
    async function load(reset = false) {
        if (reset) { ++generation; roots = []; cursor = null; threads.clear(); busy = false; rows.replaceChildren(); }
        if (busy) return;
        if (!selected) { more.hidden = true; status.textContent = 'No manga in this scope.'; return; }
        const id = selected, version = generation; validate(id); busy = true; more.disabled = true;
        status.textContent = 'Loading comments…';
        try {
            const result = await list({mangaId: id, cursor});
            if (version !== generation) return;
            if (!result.canModerate) throw new Error('Permission denied');
            roots.push(...result.comments); cursor = result.nextCursor; more.hidden = !cursor; render();
            status.textContent = roots.length ? `${roots.length} root comments loaded. Status filter applies to loaded pages; expand replies or load more to check older comments.` : cursor ? 'No roots in this page. Load more to continue.' : 'No comments.';
        } catch {
            if (version === generation) { status.textContent = 'Không thể tải bình luận hoặc quyền quản trị đã thay đổi. Hãy tải lại trang.'; more.hidden = false; }
        } finally { if (version === generation) { busy = false; more.disabled = false; } }
    }
    if (staff.role === 'admin') {
        for (const value of [{id: 'all', name: 'All Teams'}, ...teams]) { const option = node('option', value.name); option.value = value.id; team.appendChild(option); }
        team.value = 'all'; get('comments-team-field').hidden = false;
        team.addEventListener('change', async () => {
            try { scope = getDashboardScope(staff, team.value, teams); refill(); await load(true); }
            catch { status.textContent = 'Permission denied: invalid team scope.'; }
        });
    } else {
        team.disabled = true; get('comments-team-field').hidden = true;
    }
    get('comments-scope').textContent = staff.role === 'admin' ? 'Manage comments by team and manga' : `Team: ${teams.find(value => value.id === staff.teamId)?.name || staff.teamId}`;
    manga.addEventListener('change', async () => {
        try { validate(manga.value); selected = manga.value; await load(true); }
        catch { manga.value = selected || ''; status.textContent = 'Permission denied: manga outside your scope.'; }
    });
    state.addEventListener('change', render);
    more.addEventListener('click', () => load());
    refill();
    return {load: () => load(true)};
}

const currentStaff = await requireStaff();
try {
    const [teams, catalogue] = await Promise.all([getTeams(), fetch('/assets/data/data.json').then(response => {
        if (!response.ok) throw new Error('Cannot load manga catalogue'); return response.json();
    })]);
    const management = createCommentManagement({staff: currentStaff, teams, catalogue, requestedManga: new URLSearchParams(location.search).get('manga')});
    document.getElementById('comments-content').hidden = false;
    await management.load();
} catch (error) { showStaffAccessError(error); }
