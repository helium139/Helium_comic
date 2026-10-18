# HeliumTG browser notifications

Frontend implemented; production sending is not connected. Nothing here deploys
rules, modifies Firebase Console, sends a push, or changes the publishing workflow.

## Firebase Console setup

Project: `helium-team-d7f80`.

1. Open **Project settings → Cloud Messaging → Web configuration → Web Push
   certificates → Generate key pair** (or use the existing pair). Copy the **public
   key** to `PUBLIC_VAPID_KEY` in `assets/js/push-config.js`. Do not copy a private
   key or service account credential. The empty value intentionally prevents
   permission prompts and token creation until configured.
2. In Google Cloud Console for this same project, ensure **FCM Registration API**
   and **Firebase Cloud Messaging API (HTTP v1)** are enabled. The latter is for
   the eventual trusted sender. Do not enable/use a legacy server key.
3. Check Firebase Authentication's authorized domains include `heliumtg.com` and
   your chosen local test domain (`localhost` when needed for Google login).
4. Merge the following rule match **inside** the existing
   `match /databases/{database}/documents` block in Firestore Database → Rules.
   Do not replace the site's existing rules. Rules are not available in this repo,
   so review the deployed rules first. Overlapping broad `allow` rules are ORed;
   remove any broad rule that would expose other users' token subcollections.
   Do not grant public reads, collection scans, or unauthenticated writes.

```text
match /users/{uid}/pushTokens/{tokenId} {
  function owner() {
    return request.auth != null && request.auth.uid == uid;
  }
  function validToken() {
    return tokenId.matches('^[a-f0-9]{64}$')
      && request.resource.data.keys().hasOnly(['token', 'enabled', 'updatedAt'])
      && request.resource.data.keys().hasAll(['token', 'enabled', 'updatedAt'])
      && request.resource.data.token is string
      && request.resource.data.token.size() > 0
      && request.resource.data.token.size() <= 4096
      && request.resource.data.enabled == true
      && request.resource.data.updatedAt == request.time;
  }
  allow get: if owner();
  allow list: if false;
  allow create: if owner() && validToken();
  allow update: if owner() && validToken()
    && request.resource.data.token == resource.data.token;
  allow delete: if owner();
}
```

Test these rules in Rules Playground/emulator: own get/create/update/delete works;
guest and other UID access fails; list fails; extra fields, bad IDs, false enabled,
client timestamps and oversized tokens fail. Rules cannot prove a token was issued
by FCM. The backend must treat it as untrusted input and remove invalid tokens.

Sources: [FCM web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started),
[message receiving and classic worker support](https://firebase.google.com/docs/cloud-messaging/web/receive-messages).
The project intentionally keeps SDK 12.1.0 and its `getToken` API.

## Frontend behavior and storage

- Homepage: `Admin's Picks!` and the button share a wrapping flex row. Button state
  is based on browser support, permission, current user, actual FCM token and a
  successful Firestore registration check, not just a local flag.
- Permission is requested only from the explicit click handler, only when state
  is `default`. Denied users get browser-settings guidance. Guests are asked to
  log in, matching the existing follow feature; anonymous subscriptions are absent.
- Shared Firebase app/Auth/Firestore are reused. `firebase-config.js` contains only
  the existing public web config, shared with the worker. No server secrets exist.
- `users/{uid}/pushTokens/{sha256Token}` contains
  `{ token: string, enabled: true, updatedAt: serverTimestamp() }`.
  No emails, browser fingerprints, IP addresses, or copied follows are stored.
- One transaction read per token registration/check; one write for a new token or
  a token not refreshed in 30 days; unchanged checks do not write. Conflict retries
  can add reads. No user scans, profile reads, follow listeners or token collection
  queries are added. Registration runs on click or on homepage restoration for
  an already subscribed browser with granted permission. FCM may make its own
  installation/token requests, caching tokens in IndexedDB.
- `heliumtg_push_registration` in localStorage stores only `{uid, id}` as a local
  cleanup hint. It never substitutes for the Firebase check or stores the raw token.
- Token rotation uses a new hash document. Old documents are not queried by the
  client; the sender must delete expired/unregistered tokens and prune records
  stale beyond its chosen retention window. Homepage visits refresh active records
  at most monthly. Other devices for the same user are unaffected.
- Logout unsubscribes this browser's push subscription and tries to remove its
  token document before signing out. If subscription revocation
  fails, logout explains the failure and can be retried. Server cleanup handles
  document deletion failures after successful browser unsubscription. FCM SDK
  metadata is refreshed on the next opt-in when it detects the missing subscription. Shared
  header pages also revoke stale account bindings on auth changes. A missing local
  receipt causes any existing subscription to be revoked before a fresh opt-in,
  preventing a cleared local receipt from silently binding the same token to another account.
- Shared header pages load the foreground receiver. It uses text-only clickable
  toasts (no HTML from messages), with bounded message-ID deduplication. The login
  page has no shared header receiver. No second system notification is shown in
  foreground. Repeated delivery across background sessions must be deduplicated
  by the sender; the notification tag replaces an existing event notification.

## Service worker

Root file: `/firebase-messaging-sw.js`. Explicit scope:
`/firebase-cloud-messaging-push-scope/`. The file is accessible from the root domain
but uses an isolated push-only scope, avoiding replacement of the third-party ad
worker `/sw.js` at `/`. FCM receives the exact registration via
`getToken(..., { vapidKey, serviceWorkerRegistration })`. This worker does not need
to control the homepage. Its own activation is awaited; `serviceWorker.ready`
could resolve the unrelated ad worker, so it is not used. Conflicts at our exact
scope are rejected; existing unrelated registrations are not unregistered.

A classic compat worker is used because Firebase's modular worker guidance calls
for bundling, and this static site has no JS bundler. This is a separate JS context,
not a second Firebase initialization in the page. No fetch/cache interception or
third-party ad script was added to this worker. `/sw.js` is unchanged.

For the future sender, use **data-only** payloads, with every data value a string:

```json
{
  "data": {
    "eventId": "manga-slug:18",
    "title": "HeliumTG • Manga title có chương mới!",
    "body": "Chương 18 vừa được đăng trên HeliumTG.",
    "url": "https://heliumtg.com/manga/manga-slug/chapter/18/",
    "cover": "https://heliumtg.com/assets/og/manga-slug.png"
  },
  "webpush": { "headers": { "TTL": "86400" } }
}
```

The worker displays data-only messages. For payloads containing `notification`,
FCM displays automatically and our handler skips display to avoid duplicates.
Include `data.url` for the custom click target; a notification without a chapter
URL cannot use our chapter navigation. The click handler accepts only same-origin
clean chapter paths, focuses/navigates an existing same-origin tab (including tabs
outside the worker scope), or opens a new tab. Covers are restricted to the site's
own HTTPS origin and its existing R2 origin; the site logo is always used as icon.

## Local tests

Run from repository root:

```sh
node --test scripts/test-push-notifications.mjs scripts/test-firebase-session.mjs
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/` (localhost is a secure-context exception). Use a test
Firebase project/config and its VAPID key/rules for isolated registration tests;
using production config creates a real production device record. Firestore/Auth
emulators alone cannot deliver FCM web pushes. A LAN HTTP address is not equivalent
to localhost; use HTTPS on remote/mobile tests.

1. Without the VAPID key: click gives preparation guidance; no permission prompt.
2. Guest: click asks for login. Unsupported browser: disabled button and guidance.
3. Login, configure key/rules, click, allow: enabled label appears only after token
   registration succeeds. Verify the hash-named document in Firebase Console.
4. Reload/reclick/Back: same token document, no unchanged write. Multiple devices
   create separate documents. Do not copy tokens into public logs or screenshots.
5. Deny/dismiss: no repeat prompt on load; denied click explains site settings.
   Change permission in browser settings, reload and try again.
6. Offline/blocked Firestore rules/worker failure: no false enabled state; retry
   works. Inspect Application → Service Workers: ad scope remains unchanged and
   FCM has the dedicated scope. Scope conflicts must fail rather than overwrite.
7. Logout and switch accounts: browser subscription is revoked; previous account
   gets no further notifications on this device. Re-enable for the new account.
8. At 320px, tablet and desktop widths: button wraps without overflow. Test both
   themes, keyboard focus and toast dismissal.

## Production delivery tests

After explicit deployment, confirm HTTPS 200 responses for the worker and config
files and JavaScript MIME types. Configure the public key/rules first. On
`https://heliumtg.com`, log in, follow a test manga, and enable notifications.
Retrieve that device's token privately from Firestore Console. Send an FCM test
message from Firebase Console using that registration token: foreground should
show a toast when you include `url` as custom data; background should show exactly
one notification. For exact data-only/cover/click tests use Admin SDK or HTTP v1
from a trusted test backend, never a browser or committed script with credentials.

Test tab visible, tab backgrounded, site closed (delivery depends on browser/OS),
existing-tab focus and new-tab opening. Test duplicate message IDs, malformed and
external URLs, permission revoked, logout, account switching and stale tokens.
Browser/OS restrictions vary; unsupported environments get a disabled control.
Mobile devices may require additional browser/platform installation steps; this
change does not add a PWA manifest or promise support on every device.

## Remaining trusted backend and workflow integration

The existing CMS Worker implementation is not in this repo. Do not add Admin
credentials or a privileged send endpoint/secret to public JS. Implement a trusted
Cloud Function/Cloud Run/CMS backend that:

1. Authenticates the GitHub Actions caller (OIDC is preferred; otherwise a secret
   stored only in GitHub Secrets and the backend). Accepts an immutable event ID,
   manga slug and chapter ID; validates them against the published catalogue.
2. Queries users with `where('follows', 'array-contains', mangaSlug)`, then fetches
   those users' enabled `pushTokens` server-side. Re-read follows for each send;
   do not rely on client-copied subscription lists. Unfollow requires no token change.
3. Deduplicates tokens and event deliveries server-side, batches sends to FCM limits,
   isolates per-token errors, removes unregistered/invalid tokens and prunes stale
   records. Use a delivery ledger/outbox so workflow reruns/retries do not re-notify
   already delivered recipients. Never log raw tokens or authorization headers.
4. Constructs canonical URLs via the same clean chapter URL rules, builds the
   data-only payload above, and sends with Admin SDK/HTTP v1 using server identity.
   Scope permissions to required services; keep credentials in managed identity or
   secret storage. Signed-in clients must never be able to invoke arbitrary sends.

Current order in `.github/workflows/site-update.yml` is:
commit → build → successful Pages deploy → public chapter/OG readiness checks →
Discord. `scripts/discord-notify.mjs` already detects stable new chapter IDs and
waits with `waitForChapter`. Once the backend exists, call it immediately after
that chapter's successful Discord response, using the same event identity. Supply
endpoint/auth values through GitHub Secrets (for example `PUSH_BACKEND_URL` and
`PUSH_BACKEND_SECRET`); do not commit them. Do not trigger the backend directly
from the admin upload click or before readiness succeeds. The push integration is
intentionally not wired to a nonexistent endpoint in this frontend phase.
