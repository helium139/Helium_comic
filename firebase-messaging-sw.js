/* Classic worker: compat avoids introducing a bundler into this static site. */
function chapterTarget(value) {
    try {
        const url = new URL(value, self.location.origin);
        if (url.origin === self.location.origin && /^\/manga\/[^/]+\/chapter\/[^/]+\/$/.test(url.pathname)) {
            url.search = "";
            url.hash = "";
            return url.href;
        }
    } catch { /* Ignore malformed targets. */ }
    return null;
}

// Register before FCM so our handler owns navigation for our notifications.
self.addEventListener("notificationclick", event => {
    const data = event.notification.data || {};
    const target = chapterTarget(data.url || data.FCM_MSG?.data?.url || data.FCM_MSG?.fcmOptions?.link);
    if (!target) return;
    event.stopImmediatePropagation();
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const sameOrigin = windows.filter(client => new URL(client.url).origin === self.location.origin);
        const existing = sameOrigin.find(client => client.url === target) || sameOrigin[0];
        if (existing) {
            try {
                const navigated = await existing.navigate(target);
                if (navigated) return await navigated.focus();
            } catch { /* The old tab may have closed; open a new one. */ }
        }
        return self.clients.openWindow(target);
    })());
});

importScripts(
    "/assets/js/firebase-config.js",
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-messaging-compat.js"
);
// Workers have a separate JS context; the page's existing app is not reinitialized.
firebase.initializeApp(self.HELIUM_FIREBASE_CONFIG);
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
    // FCM automatically displays notification payloads. Never display a second one.
    if (payload.notification) return;
    const data = payload.data || {};
    const target = chapterTarget(data.url);
    if (!target) return;
    const mangaTitle = data.mangaTitle || "Truyện bạn theo dõi";
    const chapterTitle = data.chapterTitle || "Chương mới";
    const title = data.title || `${mangaTitle} có chương mới!`;
    const options = {
        body: data.body || `${chapterTitle} vừa được đăng trên Hắc Âm Chi Các.`,
        icon: "/assets/icons/icon-192.png",
        badge: "/assets/icons/notification-badge.png",
        tag: data.eventId || target,
        data: { url: target }
    };
    // Prefer a chapter/manga OG image, then fall back to its cover.
    for (const candidate of [data.image, data.ogImage, data.cover]) {
        if (!candidate) continue;
        try {
            const cover = new URL(candidate, self.location.origin);
            if (cover.protocol === "https:" && [self.location.origin,
                "https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev"].includes(cover.origin)) {
                options.image = cover.href;
                break;
            }
        } catch { /* The site icon remains available. */ }
    }
    return self.registration.showNotification(title, options);
});
