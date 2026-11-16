// Retirement at the old push-only URL. The independent /sw.js is unchanged.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
    const ownURL = new URL('/firebase-messaging-sw.js', self.location.origin).href;
    const scopes = ['/firebase-cloud-messaging-push-scope/', '/firebase-cloud-messaging-push-scope'].map(path => new URL(path, self.location.origin).href);
    if (self.location.href !== ownURL || !scopes.includes(self.registration.scope)) return;
    const workers = [self.registration.active, self.registration.waiting, self.registration.installing].filter(Boolean);
    if (!workers.length || workers.some(worker => worker.scriptURL !== ownURL)) return;
    try {
        const subscription = await self.registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
    } catch { /* Still retire this exact push registration. */ }
    await self.registration.unregister();
})()));
