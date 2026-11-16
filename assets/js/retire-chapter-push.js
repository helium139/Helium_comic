import { retireChapterPush } from './retire-chapter-push.mjs';
let retirement;
export function stopRetiredChapterPush() {
    let storage, indexedDB;
    try { storage = globalThis.localStorage; } catch { /* Private/blocked storage. */ }
    try { indexedDB = globalThis.indexedDB; } catch { /* Private/blocked storage. */ }
    return retirement ||= retireChapterPush({
        navigator: globalThis.navigator, origin: location.origin,
        storage, indexedDB,
        document: globalThis.document
    }).catch(() => ({ failed: 1 }));
}
void stopRetiredChapterPush();
