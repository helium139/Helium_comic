import { db } from "./firebase.js";
import {
    collection, doc, getDoc, getDocs, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// The catalogue array is the reading order used by previous/next navigation.
// Keep IDs opaque: decimal IDs and special chapter names need no parsing.
export function chapterIndex(manga, chapterId) {
    if (chapterId === null || chapterId === undefined) return -1;
    return (manga.chapters || []).findIndex(chapter => String(chapter.id) === String(chapterId));
}

export function isChapterRead(manga, chapterId, progress) {
    const index = chapterIndex(manga, chapterId);
    return index >= 0 && index <= chapterIndex(manga, progress?.chapterId);
}

export function hasUnreadChapter(manga, progress) {
    const chapters = manga.chapters || [];
    return chapters.length > 0 && !isChapterRead(manga, chapters[chapters.length - 1].id, progress);
}

// Only share requests while pending. A new page/restore must see fresh progress.
const pending = new Map();
function share(key, request) {
    if (!pending.has(key)) {
        pending.set(key, request().finally(() => pending.delete(key)));
    }
    return pending.get(key);
}

export function getReadingProgress(uid, mangaId) {
    return share(JSON.stringify([uid, mangaId]), async () => {
        const snapshot = await getDoc(doc(db, "users", uid, "history", mangaId));
        return snapshot.exists() ? snapshot.data() : null;
    });
}

export function getReadingProgressMap(uid) {
    return share(JSON.stringify([uid]), async () => {
        const snapshot = await getDocs(collection(db, "users", uid, "history"));
        return new Map(snapshot.docs.map(item => [item.id, item.data()]));
    });
}

export async function markChapterRead(uid, mangaId, manga, chapterId) {
    const index = chapterIndex(manga, chapterId);
    if (index < 0) return false;
    const reference = doc(db, "users", uid, "history", mangaId);
    // Compare authoritative progress inside the transaction, including on retry.
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        const progress = snapshot.exists() ? snapshot.data() : null;
        if (isChapterRead(manga, chapterId, progress)) return false;
        transaction.set(reference, {
            mangaId,
            chapterId: manga.chapters[index].id,
            updatedAt: serverTimestamp()
        }, { merge: true });
        return true;
    });
}

export function showProgressError(container, message) {
    let notice = container.querySelector(".reading-progress-status");
    if (!notice) {
        notice = document.createElement("p");
        notice.className = "reading-progress-status";
        notice.setAttribute("role", "status");
        container.prepend(notice);
    }
    notice.textContent = message;
}
