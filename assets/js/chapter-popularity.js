import { viewCallable } from './view-callables.js';

// Historical mangaStats.views is popularity only, never payroll/accounting.
const record = viewCallable('recordChapterPopularity');
const submitted = new Set();
export function recordChapterPopularity({ mangaId, chapterId, firstImage }) {
    if (!firstImage || !(firstImage.naturalWidth > 0)) return;
    const key = JSON.stringify([mangaId, String(chapterId)]);
    if (submitted.has(key)) return;
    submitted.add(key); // One attempt per successfully opened chapter per page lifecycle.
    void record({ mangaId, chapterId: String(chapterId) }).catch(() => {
        // Popularity failures must never interfere with reading or accounting.
    });
}
