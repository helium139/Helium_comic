# HeliumTG browser notifications

The homepage now uses Firebase Messaging with the supplied public VAPID key and
registers tokens through a Firebase HTTPS callable named `registerPushToken`.
The owner confirmed the contract: Firebase `onCall`, region `us-central1`, payload
`{ token }`, with the authenticated UID taken from `request.auth.uid`. Backend
fixes/deployment are in progress; live registration remains unverified. The supplied
backend path `/home/lemy26239/Helium_comic/functions/index.js` is not available
in this workspace.
No deployment, production registration, push send, or rule change was performed.

## Configuration and backend contract

- `assets/js/push-config.js` contains the supplied **public** Web Push VAPID key.
  It is not an Admin credential or private server key. Replace it only with the
  matching public certificate from Firebase Console → Project settings → Cloud
  Messaging → Web configuration → Web Push certificates.
- `PUSH_FUNCTIONS_REGION` is explicitly `us-central1`, matching the confirmed
  callable contract. Deployment must finish before production registration tests.
- The frontend uses the existing app:

```js
const functions = getFunctions(app, PUSH_FUNCTIONS_REGION);
const registerPushToken = httpsCallable(functions, "registerPushToken");
await registerPushToken({ token });
```

This uses the confirmed HTTPS **callable** contract, not a REST endpoint. The SDK
attaches Firebase Auth credentials. The server must derive UID from `request.auth`,
validate the token, upsert it idempotently and reject failures with `HttpsError`.
A response with `success: false` or `ok: false` is also treated as failure. No UID
is sent in the client payload.

The frontend no longer reads/writes Firestore token documents. Do not deploy the
old direct-write token rules from the previous frontend design. The backend owns
its storage schema and token deduplication. A suitable existing schema may be
`users/{uid}/pushTokens/{sha256Token}`, but the client does not assume that path.
Existing direct-write records must be reconciled/pruned by the backend as needed;
no migration or deletion of production records was performed.

Ensure the Firebase project's FCM Registration API is enabled, as well as the FCM
HTTP v1 API for the trusted sender. If the callable enforces App Check, its web
App Check setup must also be provided; none exists in this repository. Verify
Firebase Auth authorized domains include `heliumtg.com` and your test domain.

Sources: [FCM setup](https://firebase.google.com/docs/cloud-messaging/web/get-started),
[Firebase callable SDK](https://firebase.google.com/docs/functions/callable),
[receiving messages](https://firebase.google.com/docs/cloud-messaging/web/receive-messages).
SDK version remains 12.1.0.

## Click and state flow

1. Verify secure context, Service Worker, PushManager and Notification API support.
   The SDK support check also runs on startup, without requesting permission.
2. Require the restored signed-in user, matching the existing follow behavior.
   Guests see a clear login message.
3. For denied permission, show browser-settings guidance without another prompt.
4. Request permission only in the explicit button click handler. A dismissed
   prompt does not create a subscription or call the backend.
5. After permission is granted, register/reuse `/firebase-messaging-sw.js` and
   await that worker's activation. Pass its exact registration to:

```js
const token = await sdk.getToken(sdk.getMessaging(app), {
    vapidKey: PUBLIC_VAPID_KEY,
    serviceWorkerRegistration: registration
});
await registerDeviceToken(account, token); // calls registerPushToken({ token })
```

6. Only a successful backend response enables the label `🔔 Đã bật thông báo`.
   Other labels are `🔔 Nhận thông báo` and `🔕 Thông báo bị chặn`.
   Missing configuration and backend failures have actionable messages instead of
   the old preparation text. No private credentials or raw tokens are logged.

The page does not initialize a second Firebase app. The worker initializes its
own separate execution context using the same public config and Firebase compat
SDK, avoiding a new bundler for this static site.

## Worker, account changes and performance

- Worker file: `/firebase-messaging-sw.js`; scope:
  `/firebase-cloud-messaging-push-scope/`. This isolated push scope preserves the
  unrelated third-party `/sw.js` registration. No fetch interception/cache is added.
- `serviceWorker.ready` is not used: it could resolve the ad worker controlling
  the page. The exact FCM registration's activation is awaited instead.
- Foreground: shared header pages use `onMessage` to show a text-only clickable
  toast, with bounded message-ID deduplication. No extra system notification is
  displayed in foreground. The login page has no shared header receiver.
- Background: data-only messages display once through our handler; messages with
  `notification` rely on FCM automatic display. Include `data.url` for clean chapter
  navigation. Click focuses/navigates an existing same-origin tab or opens a new one.
- Local receipt `heliumtg_push_registration` holds only `{uid, id}` (a token hash),
  never the token itself. It is a cleanup hint, not proof of backend registration.
- Logout waits for active setup, revokes the exact browser push subscription and
  clears its receipt. Stale server records must be pruned by the backend. Account
  changes or missing receipts invalidate old subscriptions before fresh opt-in.
- Concurrent calls for the same UID/token share one in-flight callable request.
  On later homepage loads or Back restoration, an existing subscribed device with
  granted permission is checked through FCM and the backend again. Idempotent
  storage writes and last-seen refresh throttling are the backend's responsibility.
  No frontend Firestore token queries/writes or follow listeners are added.
- Notification sending and filtering remain exclusively server-side. Existing
  chapter-publish/Discord workflows are unchanged.

## Tests

```sh
node --test scripts/test-push-notifications.mjs scripts/test-firebase-session.mjs
python3 -m http.server 8000 --bind 127.0.0.1
```

Use `http://localhost:8000/` for desktop local tests. A LAN HTTP URL is not a secure
context; Android/iOS devices need a trusted HTTPS deployment. The provided config
points at production Firebase: use a test Firebase app/config, its VAPID key and
its callable for isolated tests. Auth/Firestore emulators alone cannot deliver FCM.
Mock tests do not prove deployment has finished or the VAPID key belongs to
this Firebase project.

### Desktop Chrome

1. Deploy only when authorized, then open `https://heliumtg.com` in a normal
   Chrome window. Log in and follow a test manga. Allow notifications in OS settings.
2. Confirm no permission prompt appears on load. Click `🔔 Nhận thông báo`, allow
   permission, and wait for the enabled label.
3. DevTools → Application → Service Workers: verify the dedicated FCM registration
   and preserved ad registration. Network: verify the `registerPushToken` callable
   succeeds in the configured region. Do not publish raw request tokens/screenshots.
4. Retrieve the test device token privately from the backend's storage or trusted
   admin tooling. Send a Firebase Console test message, adding custom `url` data
   with a clean chapter URL. Test a foreground toast, background notification, and
   clicking to focus/open the chapter.
5. Test reload/Back, deny/dismiss, logout, account switching, offline/callable
   failures, and repeated registration. The backend must not create duplicate tokens.

### Android Chrome

1. Open `https://heliumtg.com` in Chrome on the device and log in. Installation is
   not required for Chrome web notifications. Enable Chrome/site notifications in
   Android settings if blocked.
2. Tap the button and allow the prompt. Confirm the enabled label and backend
   device record; send a private test message to that device's token.
3. Test while viewing the site, while Chrome is backgrounded, and by tapping the
   system notification to open the chapter. Delivery depends on OS/browser settings;
   force-stopping Chrome is not a normal background-delivery test.
4. Deny permission and confirm the blocked label; re-enable through site settings
   and repeat. Logout must revoke this device without affecting another device.

### iPhone / iPad

1. Use iOS/iPadOS **16.4 or newer** with Home Screen web apps. Open
   `https://heliumtg.com` in Safari → Share → Add to Home Screen. If offered, leave
   **Open as Web App** enabled. The homepage links a minimal manifest with
   `display: standalone`, the Hắc Âm Chi Các app name, and a dedicated 180px
   Apple touch icon.
2. Launch HeliumTG from its Home Screen icon, then log in **inside that app**;
   do not assume Safari tab authentication is shared. Tap the notification button
   and allow permission. An ordinary browser tab is not the push-test context.
3. Send a private FCM test message to this installation's token. Test the toast
   while open, a background/Lock Screen notification, and its chapter click target.
4. Check iOS Settings → Notifications → HeliumTG if permission/delivery is blocked;
   also check Focus settings. Unsupported contexts show guidance without prompting.

The manifest adds Home Screen app metadata, not offline behavior or a root worker.
See [WebKit Home Screen Web Push requirements](https://webkit.org/blog/13878/) and
[WebKit 26 Home Screen app behavior](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

## Future chapter sends

Keep the existing order: build → Pages deploy → public clean chapter/OG readiness
checks → Discord → trusted push trigger. The sender should validate the chapter,
query current `users.follows` server-side, load enabled tokens using its own
schema, deduplicate events/tokens, and send via Admin SDK/HTTP v1. It must remove
invalid/stale tokens and never expose send credentials to the frontend.

Recommended data-only payload (all data values are strings):

```json
{
  "data": {
    "eventId": "manga-slug:18",
    "title": "HeliumTG • Manga title có chương mới!",
    "body": "Chương 18 vừa được đăng trên HeliumTG.",
    "url": "https://heliumtg.com/manga/manga-slug/chapter/18/",
    "cover": "https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/manga-slug/cover.jpg"
  },
  "webpush": { "headers": { "TTL": "86400" } }
}
```

## App icons and notification appearance

Run `python3 scripts/generate-app-icons.py` (Pillow) to reproduce the PNG assets
from the lossless existing `assets/favicon-32x32.png` logo, which is actually 312px.
Home Screen exports are 180, 192 and 512 pixels, on opaque site-pink `#ffe1f7`.
Aspect ratio and transparent source padding are preserved; the 512px export is
upscaled from the available 312px source, so it cannot add missing fine detail.
The separate 96px white-on-transparent orbital badge omits script lettering for
small monochrome display. App icons have manifest purpose `any`, not `maskable`.
The manifest and homepage theme-color use the site's yellow `#ffeb78`.

For custom worker-rendered notifications send **data-only** FCM messages. Explicit
`data.title` and `data.body` take priority. Otherwise send `data.mangaTitle` and
`data.chapterTitle` to generate the title/body. `data.url` must be the clean chapter
URL. The large image uses only `data.cover`, requiring an absolute HTTPS URL on the
site or its existing R2 origin. Generic `data.image`/`data.ogImage` are ignored. An absent/unavailable image does
not replace the title, body, icon or click target. The site icon is
`https://heliumtg.com/assets/icons/icon-192.png`; the badge is
`https://heliumtg.com/assets/icons/notification-badge.png`.
No action buttons are required or supplied.

If the sender includes a `notification` payload, FCM handles display before the
custom renderer. Set equivalent `webpush.notification.icon`, `badge`, `image`,
`title`, `body` and `data: { url }` on that server payload; alternatively use the
recommended data-only format. The worker intentionally does not display a second
notification just to restyle an automatic FCM notification. The backend is external
to this workspace and has not been modified by this appearance change.

Android Chrome may use the monochrome badge and large image; individual OS/browser
layouts decide which fields appear. iOS Home Screen apps can use their installed
app icon and omit the large image/badge. Validate title, body and clean-URL click
behavior on both platforms without relying on action buttons or an image being
visible. Re-add a Home Screen shortcut if it retains an old cached name/icon.

## Cover change to apply separately in Cloud Shell

The deployed v2 HTTPS `onRequest` sender `notifyNewChapter` in `us-central1` lives
in `/home/lemy26239/Helium_comic/functions/index.js` in Google Cloud Shell, not in
this workspace. No backend source was changed or deployed locally.

Within its existing send loop, keep `batch` and all follower selection exactly as
implemented. Normalize missing covers to `""`, validate nonempty covers as absolute
public HTTPS URLs (no credentials, local/private hosts or generic OG substitution),
then construct the message as follows. This is a patch to apply in Cloud Shell,
not a new frontend send implementation:

```js
const title = mangaTitle + " có chương mới!";
const body = chapterTitle + " vừa được đăng trên Hắc Âm Chi Các.";
const message = {
  tokens: batch, // Preserve the existing filtered recipient batch.
  notification: {
    title,
    body,
    ...(cover ? { imageUrl: cover } : {}),
  },
  data: {
    mangaSlug,
    mangaTitle,
    chapterTitle,
    url,
    cover: cover || "",
  },
  webpush: {
    notification: {
      title,
      body,
      icon: "https://heliumtg.com/assets/icons/icon-192.png",
      badge: "https://heliumtg.com/assets/icons/notification-badge.png",
      ...(cover ? { image: cover } : {}),
      data: { url },
    },
    fcmOptions: { link: url },
  },
};
```

Retain the existing send call, authentication, filtering and cleanup. Deploy only
that function from the Cloud Shell source tree when ready. The local workflow
already passes the manga cover, converts valid relative catalogue covers to an
absolute site URL, and sends `cover: ""` when missing or invalid. It never selects
a generic OG image. The frontend/worker accept the site's HTTPS origin and its
existing R2 origin; add an explicit trusted origin if the catalogue moves CDN.
Neither path fetches the cover just to check it, so the actual URL must be publicly
accessible with an image response. A failed image load must not block text delivery.

Foreground toasts also show `data.cover` when valid and remove failed images.
Messages containing `notification` are still automatically displayed by FCM in
background; the worker returns without showing a second copy. Test automatic and
data-only messages separately on desktop/Android Chrome and an iOS Home Screen
installation. Android/desktop may show the cover only when expanded; iOS may omit
the large image entirely. Title, body and chapter navigation remain functional.
