# Phase 3: trusted chapter views

Implementation is in the existing Firebase **default** Functions codebase, project
`helium-team-d7f80`, region `us-central1`. Existing `health`, `registerPushToken`,
`unregisterPushToken`, `setUserAccess`, and `notifyNewChapter` implementations are
preserved. Worker publishing authorization and comments/replies are unchanged.
Nothing has been deployed or activated by this change.

## Activation and eligibility

There is deliberately no hardcoded accounting start date. A one-time operator
script creates `viewSystem/config.activationAt` using a Firestore server timestamp.
Until this exists and `enabled` is true, starts are rejected and dashboard cards
say **Not active yet**. Legacy `mangaStats.views` are frozen, remain publicly
readable, and are never copied into `validViews`.

The chapter reader requires valid catalogue metadata and a successful first image
load. It then obtains a server session and accumulates 10 seconds using
`performance.now()` only while `document.visibilityState === 'visible'`.
Visibility changes pause/resume accumulation. bfcache restoration resumes the same
tracker; ordinary unload removes listeners. Time before session acknowledgement
is conservatively excluded. A detail-page visit never starts a session.

The backend independently verifies the published manga/chapter and explicit
`teamId` from HTTPS `heliumtg.com/assets/data/data.json` and canonical `teams.json`.
The published catalogue is cached for 30 seconds and its SHA-256 revision is
recorded. Requests cannot supply authoritative ownership. Chapter zero works.
Ownership changes invalidate unconsumed sessions; previously accepted aggregates
retain the team that earned them. Availability follows the published catalogue,
including any upstream CDN publication delay.

## Callables and identity

- `startChapterViewSession`: accepts `mangaId` (or `mangaSlug`), `chapterId`,
  `anonymousReaderId` (UUID v4), and `requestId` (UUID v4). Returns only opaque
  `sessionId`, `expiresAt` (milliseconds), and `minimumActiveMs`.
- `recordChapterView`: accepts the same device identifier and `sessionId`.
  Returns `{accepted:true,eventId}` or `{accepted:false,reason}` for duplicate or
  rate-limited sessions. A consumed session returns its saved outcome without
  incrementing again, even if the catalogue subsequently becomes unavailable.
- `getChapterViewAnalytics`: staff-only aggregate reads with custom-claim role and
  team authorization. Takes `scopeId`, optional `period`, `includeChildren`, and
  `cursor`. Returns all/current-month totals and optional 25-child pages.

Sessions live 30 minutes; the server requires at least 10 elapsed seconds.
Frontend retries preserve the session, and start retries preserve the request ID.
Expired sessions require a fresh interval. Auth changes reset the frontend timer.
A signed-in session cannot be consumed by another UID. A guest session may be
consumed after login from the same device.

The browser stores a cryptographically random UUID in
`heliumtg_view_reader_v1`, including for signed-in readers. The backend stores
only HMAC-SHA256 hashes with domain separation, keyed by Secret Manager secret
`VIEW_READER_HMAC_KEY` (at least 32 characters). UID comes exclusively from
verified callable auth. The raw device UUID and raw network address are never
stored in the ledger, sessions, dedup, or rate documents. Do not rotate this key
casually: doing so resets pseudonymous continuity and dedup keys.

## Duplicate and rate policy

`valid-views-v1`: one accepted view per reader/manga/chapter per rolling 24 hours.
Both device and verified account dedup records are checked in the same transaction.
Concurrent tabs and refreshes cannot win more than once. Different chapters are
independent; the exact 24-hour boundary is eligible again.

Rolling-hour ceilings default to 120 accepted views per device/account and 2,400
per hashed network identity. Start ceilings are 360 per device/account and 7,200
per hashed network. These four limits and policyVersion are operator-configurable
in `viewSystem/config`, never browser-writable. All limits use transaction-checked
rolling timestamp queues. Start limits bound unnecessary session writes. Network
identity uses the platform request IP, hashed immediately; it is supplementary,
not the primary dedup identity. Shared-network limits are deliberately generous.

Same-device guest -> login cannot immediately duplicate a guest view. Clearing
storage, private browsing, changing devices/accounts, or automation can bypass
some protections. A guest view cannot retroactively be associated with an account
on a different device. Blocking storage loses cross-page guest continuity.

## Firestore schema and cost

| Path | Contents/access |
| --- | --- |
| `viewSystem/config` | enabled, server activationAt, policyVersion, four limits; backend only |
| `chapterViewSessions/{opaqueId}` | resource/team/revision, verified UID or null, anonymousReaderHash, server startedAt/expiresAt, policy/activation, consumed receipt, deleteAfter |
| `chapterViewEvents/{sessionId}` | immutable teamId/mangaId/chapterId, UID or null, anonymousReaderHash, server createdAt, sessionId, policyVersion, catalogueRevision, sessionCatalogueRevision, activationAt, valid:true |
| `viewDedup/{HMAC}` | nextEligibleAt, deleteAfter; device/account per manga/chapter |
| `viewRateLimits/{type_hash}` | bounded rolling acceptedAt timestamps, deleteAfter |
| `analyticsScopes/{scopeId}/periods/{period}` | validViews, updatedAt, activationAt, scopeId/kind/parentScopeId and minimal resource IDs |

Scope IDs: `site`, `team:T`, `manga:T:M`, `chapter:T:M:C`. Including the team in
resource scopes preserves attribution after an administrative ownership transfer.
Periods are `all` and `YYYY-MM` in **UTC**, based on server acceptance time. Each
accepted event atomically creates its immutable ledger entry, consumes its session,
updates dedup/rates, and updates **eight** aggregate documents: four scopes times
two periods. No ledger scan is used by the dashboard.

Accepted guest: **13 writes**, authenticated: **15 writes**. Session start: 3/4
writes. A duplicate or rate-limited record consumes one receipt (one write);
a receipt retry writes nothing. Successful recording reads roughly 14/16 documents
including receipt lookup, before transaction retries; catalogue fetches are cached.
Dashboard root requests read three documents; expansions use bounded aggregate
queries (up to 26 rows to return 25). No per-manga initial analytics reads.

All six private collection families deny browser reads and writes, even for staff.
Staff read through the authorized callable; leaders can request only scopes whose
team matches their verified claim. Site/global scopes require admin. Admin SDK
performs all authoritative writes. Existing profile/history/push/ownership/comment
rules are retained. The existing unsupported `hasNone()` profile rule is corrected
to `!hasAny()` so safe profile updates work and role/team tampering remains denied.
Legacy stats creation allows only likes/follows zero, and updates only these social
fields. The public detail page initializes absent social stats on like/follow intent.

Deploy the collection-group index in `firestore.indexes.json` for
`parentScopeId, period, scopeId`. Rate timestamp arrays are exempt from indexing.
Set TTL on `deleteAfter` for sessions (48h), dedup (48h), and rate records (2h).
Correctness checks timestamps and does not depend on timely TTL deletion. Never
set TTL on the audit ledger or analytics; choose ledger retention/backups through
an explicit accounting policy. IAM principals with Admin SDK access remain trusted.

The eight shared counters, especially site/month and shared-network rate docs,
can contend at high traffic. Monitor retries, latency, and billing. Sharded counters
and a verified aggregation pipeline are future scaling work, not included now.

## Dashboard

Cards use only `getChapterViewAnalytics`: Total Valid Views and Valid Views This
Month. Admins select all teams or one team; leaders have a fixed own-team root.
Expansion lazily reads Team -> Manga -> Chapter aggregates with total/month period
selection and pagination. Errors show Unavailable rather than false zero counts.
The activation timestamp is displayed. Legacy totals and comments remain separate.

## App Check and limitations

`ENFORCE_VIEW_APP_CHECK` is a Firebase Boolean parameter, default **false**.
`assets/js/view-config.js` has a blank `VIEW_APP_CHECK_SITE_KEY`. This preserves
production until the website is registered for App Check. Configure the public
reCAPTCHA Enterprise site key, publish that client configuration, validate staging
requests/metrics and required service-account permissions, then set the Functions
parameter true and redeploy the three new functions. Existing endpoints are not
changed. See [Firebase App Check enforcement](https://firebase.google.com/docs/app-check/cloud-functions).

Server elapsed time does not prove visibility, image rendering, or human attention;
a modified client can simulate eligibility. App Check, dedup, rate limits, audit
records, and monitoring improve resistance but do not establish fraud-free payment
proof. Review abuse metrics and enable App Check before compensation use. First
image success and active visibility are enforced by the official client; backend
resource checks and elapsed time are independent. Existing five functions have
not been live-tested or redeployed as part of this work.

## Local verification

Use Node **24**, matching the existing Functions runtime, and Java 21 for emulator.

```sh
npm ci --prefix functions
npm --prefix functions run lint
node --test scripts/test-view-service.mjs scripts/test-chapter-views.mjs scripts/test-view-dashboard.mjs
npx firebase-tools@15 emulators:exec --only firestore --project demo-helium-views --config firestore/emulator.json "node --test scripts/test-view-rules.mjs scripts/test-view-firestore.mjs"
```

The emulator uses demo projects only. Rule tests verify all roles cannot directly
write/read authoritative data, legacy views cannot change, profile/history/social/
comment permissions still work, and role/team changes remain denied. Real Admin
Firestore transaction tests exercise concurrent tabs and the UTC month boundary.
Timing tests exercise 6 visible + 30 hidden + 4 visible seconds, readiness, bfcache,
network retries, and identity races. Service tests cover activation, malformed or
missing resources, expiration, receipts, rolling dedup/rates, guest/login continuity,
team transfers, aggregate counts/write counts, and staff scope authorization.
CI runs these checks before the existing publishing sequence. Backend/config files
are excluded from the Pages artifact. Live browser, deployed IAM, App Check, and
production index readiness still require staging validation.

## Operator deployment sequence — not executed

Run in the repository root containing the synced `firebase.json`, using the existing
Firebase project and existing default codebase. Use Node24 and authenticated Firebase
CLI/Google credentials with appropriate IAM. Do not deploy a separate codebase.

1. Install/check and create the secret interactively (do not put its value in source,
   command history, logs, or a committed .env file):

```sh
npm ci --prefix functions
npm --prefix functions run lint
firebase functions:secrets:set VIEW_READER_HMAC_KEY --project helium-team-d7f80
```

2. Deploy only the three additions, initially inactive and with App Check enforcement
   false. The five existing functions remain deployed:

```sh
firebase deploy --project helium-team-d7f80 --only functions:startChapterViewSession,functions:recordChapterView,functions:getChapterViewAnalytics
firebase deploy --project helium-team-d7f80 --only firestore:rules,firestore:indexes
```

Wait for the aggregate index to finish building. Publish the frontend using the
normal site workflow. Old cached clients' legacy view writes will be denied by
the new rules; historical reads and likes/follows remain available. Validate reader
loading, authentication, dashboard scopes, and callable access before activation.
No valid accounting begins during this inactive rollout.

3. Configure cleanup (asynchronous TTL is for storage hygiene only):

```sh
gcloud firestore fields ttls update deleteAfter --collection-group=chapterViewSessions --enable-ttl --project=helium-team-d7f80
gcloud firestore fields ttls update deleteAfter --collection-group=viewDedup --enable-ttl --project=helium-team-d7f80
gcloud firestore fields ttls update deleteAfter --collection-group=viewRateLimits --enable-ttl --project=helium-team-d7f80
```

See [Google's TTL command reference](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/fields/ttls/update).

4. Configure/test App Check as above. Set `ENFORCE_VIEW_APP_CHECK=true` in the local
   Functions parameter environment file `functions/.env.helium-team-d7f80` and redeploy
   the same three functions. This parameter is not a secret; the HMAC key stays in
   Secret Manager. Ensure any local credential/secret files are excluded from git.

5. After validation, initialize Application Default Credentials on the operator
   machine if needed, then deliberately activate once:

```sh
gcloud auth application-default login
GCLOUD_PROJECT=helium-team-d7f80 node functions/lib/views/activate.mjs --activate
```

The script refuses an existing config. Record its actual Firestore activationAt as
the accounting boundary. Do not reset that timestamp to toggle collection. To pause,
set enabled:false using trusted operator tooling; re-enable with the same epoch.
Monitor accepted/duplicate/rate outcomes, ledger totals versus aggregates, errors,
costs, and abuse signals before enabling any payment calculations.

## Changed files

- Existing Functions: `functions/index.js`, `functions/package.json`, `functions/package-lock.json`.
- New backend modules: `functions/lib/views/{policy.mjs,catalogue.mjs,view-service.mjs,endpoints.js,activate.mjs,.eslintrc.cjs}`.
- Rules/config: `firestore.rules`, `firestore.indexes.json`, new `firestore/emulator.json`. Production `firebase.json` remains unchanged.
- Reader: `assets/js/comicpage.js`, `assets/js/comicchap.js`; new `assets/js/{chapter-views.js,active-view-session.mjs,view-callables.js,view-config.js}`.
- Dashboard: `admin/{index.html,dashboard.js,admin.css}`; new `admin/view-analytics.js`, `admin/api/view-analytics.js`.
- Verification: new `scripts/{test-view-service.mjs,test-chapter-views.mjs,test-view-dashboard.mjs,test-view-rules.mjs,test-view-firestore.mjs}`; updated `scripts/{test-dashboard.mjs,test-reading-progress.mjs}`.
- CI: `.github/workflows/site-update.yml`; documentation: this file.
