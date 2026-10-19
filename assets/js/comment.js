import { auth, onAuthStateChanged } from './firebase-session.js';
import { getRouteParams } from './routes.js';
import { listComments, createComment, editComment, deleteComment, moderateComment } from './comment-api.js';

const mangaId = getRouteParams().get('id');
const input = document.getElementById('comment-input');
const send = document.getElementById('send-comment');
const list = document.getElementById('comments-list');
const status = document.createElement('p'); status.setAttribute('role', 'status');
const more = button('Load more comments', () => loadRoots(false));
list.after(more, status);
input.maxLength = 4000;
let generation = 0, cursor = null, rootBusy = false, sending = false, canModerate = false;
let request = null;
const errorMessage = error => error?.code === 'functions/unauthenticated' ? 'Bạn cần đăng nhập.' :
    error?.code === 'functions/permission-denied' ? 'Bạn không có quyền thực hiện thao tác này.' :
    'Không thể cập nhật bình luận. Vui lòng thử lại.';
function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
}
function button(text, action) {
    const item = element('button', 'comment-action', text); item.type = 'button';
    item.addEventListener('click', async () => {
        item.disabled = true;
        try { await action(); } catch (error) { status.textContent = errorMessage(error); }
        finally { item.disabled = false; }
    });
    return item;
}
function render(comment, container, version, replyThread = false) {
    const item = element('article', 'comment'); item.dataset.commentId = comment.id;
    const header = element('div', 'comment-header');
    if (comment.avatar) {
        const avatar = element('img', 'comment-avatar'); avatar.src = comment.avatar; avatar.alt = ''; avatar.loading = 'lazy';
        header.appendChild(avatar);
    }
    header.appendChild(element('h4', '', comment.name));
    if (comment.createdAt !== null) {
        const date = element('time', '', new Date(comment.createdAt).toLocaleString());
        date.dateTime = new Date(comment.createdAt).toISOString(); header.appendChild(date);
    }
    const hidden = comment.moderationStatus === 'hidden';
    const content = element('p', 'comment-content', comment.deleted ? 'Comment deleted' : hidden ? 'Comment hidden' : comment.text);
    item.append(header, content);
    const actions = element('div', 'comment-actions');
    if (auth.currentUser && !comment.deleted && !hidden) {
        actions.appendChild(button('Reply', () => {
            if (item.querySelector('.comment-reply-form')) return;
            const form = element('form', 'comment-reply-form');
            const text = element('textarea'); text.maxLength = 4000; text.required = true; text.setAttribute('aria-label', 'Reply');
            let pending;
            const submit = element('button', 'comment-action', 'Send reply'); submit.type = 'submit';
            form.append(text, submit, button('Cancel', () => form.remove()));
            form.addEventListener('submit', async event => {
                event.preventDefault(); if (submit.disabled || !text.value.trim()) return;
                submit.disabled = true;
                if (!pending || pending.text !== text.value.trim()) pending = {text: text.value.trim(), requestId: crypto.randomUUID()};
                try {
                    await createComment({mangaId, parentId: comment.id, ...pending});
                    if (version === generation) await loadRoots(true);
                } catch (error) { status.textContent = errorMessage(error); }
                finally { submit.disabled = false; }
            });
            item.appendChild(form); text.focus();
        }));
    }
    if (auth.currentUser?.uid === comment.uid && !comment.deleted) {
        if (!hidden) actions.appendChild(button('Edit', async () => {
            const text = window.prompt('Chỉnh sửa bình luận', comment.text);
            if (text === null) return;
            await editComment({mangaId, commentId: comment.id, text});
            if (version === generation) await loadRoots(true);
        }));
        actions.appendChild(button('Delete', async () => {
            if (!window.confirm('Xóa bình luận này?')) return;
            await deleteComment({mangaId, commentId: comment.id});
            if (version === generation) await loadRoots(true);
        }));
    }
    if (canModerate) {
        if (!comment.deleted) for (const action of [hidden ? 'restore' : 'hide', 'delete']) {
            actions.appendChild(button(action === 'hide' ? 'Hide' : action === 'restore' ? 'Restore' : 'Moderate: delete', async () => {
                if (!window.confirm(`Moderation: ${action}?`)) return;
                await moderateComment({mangaId, commentId: comment.id, action});
                if (version === generation) await loadRoots(true);
            }));
        }
    }
    item.appendChild(actions);
    if (!replyThread) {
        const replies = element('div', 'comment-replies'); replies.hidden = true;
        const entries = element('div'); let next = null, loaded = false, busy = false;
        const load = async () => {
            if (busy) return; busy = true;
            try {
                const result = await listComments({mangaId, rootId: comment.id, cursor: next});
                if (version !== generation) return;
                for (const reply of result.comments) render(reply, entries, version, true);
                next = result.nextCursor; loaded = true; loadMore.hidden = !next;
            } finally { busy = false; }
        };
        const loadMore = button('Load more replies', load); loadMore.hidden = true;
        const expand = button(`Replies (${comment.replyCount})`, async () => {
            replies.hidden = !replies.hidden; expand.setAttribute('aria-expanded', String(!replies.hidden));
            if (!replies.hidden && !loaded) await load();
        });
        expand.setAttribute('aria-expanded', 'false');
        replies.append(entries, loadMore); item.append(expand, replies);
    } else if (comment.parentId !== comment.rootId) {
        item.appendChild(element('small', 'comment-parent', `Reply to comment ${comment.parentId}`));
    }
    container.appendChild(item);
}
async function loadRoots(reset) {
    if (reset) { ++generation; rootBusy = false; cursor = null; list.replaceChildren(); }
    if (rootBusy) return;
    rootBusy = true; more.disabled = true;
    const version = generation;
    try {
        const result = await listComments({mangaId, cursor});
        if (version !== generation) return;
        canModerate = result.canModerate;
        for (const comment of result.comments) render(comment, list, version);
        cursor = result.nextCursor; more.hidden = !cursor;
        status.textContent = list.children.length ? '' : cursor ? 'Load more để xem bình luận cũ.' : 'Chưa có bình luận.';
    } catch (error) { if (version === generation) status.textContent = errorMessage(error); }
    finally { if (version === generation) { rootBusy = false; more.disabled = false; } }
}
async function post() {
    if (sending || !input.value.trim()) return;
    if (!auth.currentUser) { status.textContent = 'Bạn cần đăng nhập.'; return; }
    sending = true; send.disabled = true;
    if (!request || request.text !== input.value.trim()) request = {text: input.value.trim(), requestId: crypto.randomUUID()};
    try {
        await createComment({mangaId, ...request});
        input.value = ''; request = null; await loadRoots(true);
    } catch (error) { status.textContent = errorMessage(error); }
    finally { sending = false; send.disabled = false; }
}
send.addEventListener('click', post);
input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); post(); }
});
onAuthStateChanged(auth, () => loadRoots(true));
window.addEventListener('pageshow', event => { if (event.persisted) loadRoots(true); });
