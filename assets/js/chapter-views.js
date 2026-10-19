import { auth, onAuthStateChanged } from './firebase-session.js';
import { viewCallable } from './view-callables.js';
import { createActiveViewSession } from './active-view-session.mjs';

let current;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function readerId() {
    const key = 'heliumtg_view_reader_v1';
    try {
        let value = localStorage.getItem(key);
        if (!UUID.test(value || '')) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
        return value;
    } catch { return crypto.randomUUID(); } // Blocked storage loses cross-page guest continuity.
}
export function startChapterViews(options) {
    try { initializeChapterViews(options); } catch { /* Analytics must never prevent reading. */ }
}
function initializeChapterViews({ mangaId, chapterId, manga, chapter, firstImage }) {
    if (!manga || !chapter || !Number.isSafeInteger(chapter.pages) || chapter.pages < 1 || !chapter.folder ||
        !manga.chapters?.some(item => String(item.id) === String(chapterId)) || !firstImage || !(firstImage.naturalWidth > 0)) return;
    const key = JSON.stringify([mangaId, String(chapterId)]);
    if (current?.key === key) return;
    if (current) { current.tracker.dispose(); current.stopAuth(); }
    const anonymousReaderId = readerId(); // Also present when signed in, to bridge guest -> login.
    const start = viewCallable('startChapterViewSession');
    const record = viewCallable('recordChapterView');
    const tracker = createActiveViewSession({
        doc: document, win: window, now: () => performance.now(), wallNow: () => Date.now(),
        schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle),
        makeRequestId: () => crypto.randomUUID(),
        start: data => start({ ...data, anonymousReaderId, mangaId, chapterId: String(chapterId) }),
        record: data => record({ ...data, anonymousReaderId })
    });
    current = { key, tracker, stopAuth: onAuthStateChanged(auth, user => tracker.setIdentity(user?.uid || null)) };
    tracker.ready();
}
