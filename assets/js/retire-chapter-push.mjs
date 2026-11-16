const SCRIPT = '/firebase-messaging-sw.js';
const SCOPES = ['/firebase-cloud-messaging-push-scope/', '/firebase-cloud-messaging-push-scope'];
export function isRetiredChapterPush(registration, origin) {
    try {
        if (!SCOPES.some(scope => registration.scope === new URL(scope, origin).href)) return false;
        const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
        return workers.length > 0 && workers.every(worker => worker.scriptURL === new URL(SCRIPT, origin).href);
    } catch { return false; }
}
export async function retireChapterPush({ navigator, origin, storage, indexedDB, document }) {
    const result = { matched: 0, unsubscribed: 0, unregistered: 0, failed: 0 };
    try { storage?.removeItem('heliumtg_push_registration'); } catch { /* Storage may be blocked. */ }
    document?.querySelectorAll('#notification-button, #notification-status, .chapter-notification-toast').forEach(node => node.remove());
    if (!navigator?.serviceWorker?.getRegistrations) return result;
    let registrations;
    try { registrations = await navigator.serviceWorker.getRegistrations(); }
    catch { result.failed++; return result; }
    for (const registration of registrations) {
        if (!isRetiredChapterPush(registration, origin)) continue;
        result.matched++;
        try {
            const subscription = await registration.pushManager?.getSubscription();
            if (subscription && await subscription.unsubscribe()) result.unsubscribed++;
        } catch { result.failed++; }
        try {
            if (isRetiredChapterPush(registration, origin) && await registration.unregister()) result.unregistered++;
        } catch { result.failed++; }
    }
    // Dedicated Messaging cache only; Auth/Installations/CacheStorage untouched.
    if (indexedDB) {
        try { indexedDB.deleteDatabase('firebase-messaging-database'); } catch { /* Retry on a future visit. */ }
    }
    return result;
}
