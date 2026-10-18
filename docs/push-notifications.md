# HeliumTG web push

## Confirmed external backend

Project `helium-team-d7f80`, region `us-central1`. The owner reports the backend is
finalized and deployed separately in Google Cloud Shell. Its source tree is not
available in this workspace and was not edited or deployed here.

- `registerPushToken`: Firebase HTTPS callable, payload `{ token }`.
- `unregisterPushToken`: Firebase HTTPS callable, payload `{ token }`.
- Both derive the UID from `request.auth.uid`; no frontend UID is supplied.
- `notifyNewChapter`: HTTPS onRequest, invoked only by GitHub Actions using
  `PUSH_FUNCTION_URL` and `CHAPTER_NOTIFY_SECRET` secrets, with the latter sent as
  `x-helium-secret`. No secret values belong in public files.
- Per the supplied backend contract, the sender filters by current manga follows,
  removes invalid/inactive tokens, preserves `data.cover`, sets the manga cover as
  its web-push image, and uses the clean chapter URL as the click target.
  These deployed behaviors still require integration verification.

## Button toggle

`assets/js/notifications.js` uses the shared app/Auth and modular SDK 12.1.0.
The configured public VAPID key is in `assets/js/push-config.js`.
No second page Firebase app, extra follow reads or realtime listener is added.

Enable:

1. Verify secure context, Service Worker, PushManager and Notification support.
2. Require login, preserving the existing follow/auth behavior.
3. Request permission only from the click handler and only if permission is default.
   Denied permission shows browser-settings guidance without another prompt.
4. Register/reuse `/firebase-messaging-sw.js`, await its activation and get the FCM
   token using the public VAPID key and that exact worker registration.
5. Call `registerPushToken({ token })`; show `🔔 Đã bật thông báo` after success.

Disable (click the enabled button):

1. Get the current token, passing the exact FCM worker registration to `getToken`.
   This also binds the Messaging instance to that worker before deletion.
2. Call `unregisterPushToken({ token })`, then `deleteToken(messaging)`.
3. Clear the local receipt/enabled state and show `🔔 Nhận thông báo`.
4. Preserve browser permission. No API tries to revoke Notification permission.
   A later click enables a new subscription without another permission prompt
   while permission remains granted.

Errors leave a status message and allow retry. An unregister rejection does not
proceed to token deletion. If token deletion fails after backend unregister succeeds,
the disable action reports failure; retry it to finish local cleanup.
The third label is `🔕 Thông báo bị chặn` for denied permission.

On homepage load/Back, only existing subscribed devices with granted permission
are restored. After successful disable, the subscription and receipt are gone, so
refresh does not opt the browser back in. Concurrent registrations for the same
token share an in-flight callable request; backend upserts must remain idempotent.
Raw tokens are not logged or stored in localStorage. The receipt contains only
`{uid, id}` (a hash) and is not proof of backend registration. Logout retains the
existing subscription revocation behavior; invalid server records are cleaned by
the backend. Shared-header foreground receivers are attached once per document.

## Worker and covers

The push-only worker scope `/firebase-cloud-messaging-push-scope/` preserves the
unrelated advertising `/sw.js`. Its own activation is awaited, rather than
`serviceWorker.ready`, which could resolve that unrelated controlling worker.

- Data-only background messages use the supplied title/body, or defaults derived
  from manga/chapter titles, and call `showNotification` once.
- Messages containing `notification` are displayed by FCM automatically; the worker
  skips custom display. The external sender supplies automatic-display styling.
- Icon: `https://heliumtg.com/assets/icons/icon-192.png`.
- Monochrome badge: `https://heliumtg.com/assets/icons/notification-badge.png`.
- Large image: valid absolute HTTPS `data.cover` on the site or its R2 origin.
  Generic `data.image`/`data.ogImage` are not substituted for a missing cover.
- Foreground uses one clickable toast, including the cover if available, with
  message-ID deduplication. It creates no additional system notification.
- Click uses `data.url`/FCM link, restricted to same-origin clean chapter paths;
  navigate/focus an existing tab or open a new one. No action buttons are required.

The existing 312px lossless logo is reused by `scripts/generate-app-icons.py`.
Home Screen exports are 180/192/512px, with preserved proportions and solid pink
background. The 512px icon is upscaled, not a higher-detail replacement. The
manifest uses `Hắc Âm Chi Các`, short name `HeliumTG`, start URL `/`, standalone
mode, pink `#ffe1f7` and yellow `#ffeb78`. Image/badge display depends on OS/browser;
iOS can show its installed app icon and omit large images.

## Publishing workflow

`.github/workflows/site-update.yml` already follows this order:

build → successful Pages deploy → chapter HTTP 200 + matching OG metadata/image
readiness → successful Discord sends → Firebase push step.

`scripts/discord-notify.mjs` compares stable chapter IDs between the previous and
current catalogue. The catalogue key supplies `mangaSlug`, matching the existing
`users/{uid}.follows` array. The URL uses the shared clean chapter URL builder.
Only after every readiness check and Discord send succeeds does it write a
RUNNER_TEMP JSON file. No new chapter means no push file or POST.

Cover comes from that manga's actual `cover` field in `assets/data/data.json`.
Valid relative site paths are normalized to absolute HTTPS; existing public HTTPS
site/R2 covers are retained. Missing/invalid covers become `""` and do not block
text delivery. No generic OG fallback is inserted. If the catalogue moves to
another public CDN, explicitly add that trusted origin to the validators.
The frontend does not fetch covers just to validate them; verify public reachability
and image content in integration tests.

The workflow posts each saved payload using `curl --fail-with-body`, the endpoint
secret and authentication header secret. A backend HTTP error fails/stops the step;
there are no automatic retries that could duplicate sends. Example payload:

```json
{
  "mangaSlug": "example-manga",
  "mangaTitle": "Example Manga",
  "chapterTitle": "Chương 18",
  "url": "https://heliumtg.com/manga/example-manga/chapter/18/",
  "cover": "https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/example-manga/cover.jpg"
}
```

## Verification

```sh
node --test scripts/test-push-notifications.mjs scripts/test-firebase-session.mjs scripts/test-reading-progress.mjs scripts/test-chapter-readiness.mjs
python3 -m http.server 8000 --bind 127.0.0.1
```

Local desktop tests can use `http://localhost:8000/`; mobile/LAN testing needs
trusted HTTPS. This site's supplied config connects to production Firebase, so
use a separate test app/key/callable if isolation is needed. Mocks do not contact
production or establish delivery/filter correctness.

1. Open the site signed out: clicking asks for login without requesting permission.
2. Login in desktop Chrome, click enable, allow permission. Verify callable success
   and the enabled label. Reload/Back must restore the enabled state without prompting.
3. Click again: verify `unregisterPushToken` succeeds before FCM deletion, default
   label returns, and browser permission stays granted. Reload must stay disabled.
   Click a third time to re-enable; test rapid clicks and network failure/retry too.
4. Use two accounts/devices with notifications enabled. Account A follows a test
   manga; account B does not. Publish one new chapter through the normal flow.
5. Confirm deploy, readiness and Discord succeed before the push step. Only account
   A should receive it. Unfollow as A and publish a later test chapter: A must not
   receive it. Disable notifications on A's device and verify delivery stops there.
6. Verify the actual cover URL is public HTTPS and appears where the OS supports
   it (expand the notification on Android/desktop if needed). Test missing cover:
   title/body/icon/link must still work. Click must open/focus the exact chapter.
7. Verify one background system notification and one foreground toast, with no
   duplicate system display. Test logout/account switching and invalid token cleanup.
8. Android Chrome: allow site/OS notifications; test while browsing and backgrounded.
   iOS/iPadOS 16.4+: Safari → Add to Home Screen, launch that app, log in inside it,
   then enable notifications and test background/Lock Screen delivery. Check OS
   notification/Focus settings. An ordinary iOS tab is not the Home Screen context.
9. Deny permission: verify blocked label and settings guidance. Check clean URLs,
   follow/unfollow, progress and Up badge still work. Do not publish raw tokens or
   authenticated network dumps while reviewing DevTools.

No production calls, deployments, commits or pushes are required by these local
checks. Deployment and the real two-account delivery checks remain separate.
