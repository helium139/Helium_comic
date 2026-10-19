# Phase 4: threaded comments and moderation

No deployment, activation, commit, or push was performed. Existing Functions,
Phase 3 accounting modules/client code, and non-comment rules remain unchanged.
The current Functions runtime is Node24, region us-central1, project
`helium-team-d7f80`, existing default codebase.

## API and authorization

Five additions, all Firebase callables:

| Function | Input | Permission |
| --- | --- | --- |
| listComments | mangaId, optional rootId/cursor | Public sanitized reads |
| createComment | mangaId, text, optional parentId, UUID-v4 requestId | Authenticated |
| editComment | mangaId, commentId, text | Own non-deleted/non-hidden comment |
| deleteComment | mangaId, commentId | Own comment; soft deletion |
| moderateComment | mangaId, commentId, action: hide/restore/delete | Admin all teams; leader own verified team |

UID/role/team come exclusively from verified callable auth. Body uid, role,
teamId, rootId, replyCount, and all other system fields cannot grant permissions
or change system state. Ownership is resolved from the existing server-fetched
published catalogue and canonical teams.json, never comment/browser ownership.
The shared catalogue reader has a 30-second cache and follows published CDN
visibility. It is reused read-only; Phase 3 implementation is not edited.

Text must trim to 1–4000 characters. Invalid resource/comment/parent/cursor IDs
are rejected. All new reply relationships are resolved inside a transaction:
parent must exist in the same manga and reference an actual root. New IDs cannot
reference themselves; clients cannot update relationships later, preventing cycles.
Ancestry is also validated through at most32 ancestors, rejecting missing links,
cycles, cross-thread links, and deeper nesting. Hidden/deleted parents or roots do not accept new replies. A caller-generated
UUID provides idempotent create retries and cannot overwrite another user's ID.

## Storage

Canonical content stays at `comments/{mangaId}/messages/{commentId}`:

- uid, text, name/avatar snapshot from the authenticated user's profile
- createdAt, updatedAt: Firestore serverTimestamp values
- parentId/rootId null for roots; replies have direct parent and root IDs
- replyCount: root's total descendants, including deleted/hidden placeholders
- deleted:false, deletedAt:null, moderationStatus:visible initially

Creation of each reply and root replyCount increment happen in one Firestore
transaction. A nested reply increments the root, not each ancestor. Editing changes
only text/content compatibility and updatedAt. Deletion erases text, removes legacy
content, and records deleted/deletedAt/updatedAt; the document and descendants stay.
Public output substitutes **Comment deleted**. Deletion is irreversible through the
API; restore applies to hidden comments only. Hiding preserves text server-side so
staff can restore visibility. Hidden rows render **Comment hidden**, and their text
is omitted from callable responses. Moderating one comment does not hide its entire
thread; descendants remain individually visible.

`commentModerationEvents/{randomUuid}` is created atomically with each successful
moderation: moderatorUid, moderatorRole, authoritative teamId, mangaId, commentId,
action, createdAt. Events are never updated by this implementation, and browser
reads/writes are denied. Moderation retries may produce multiple audit entries for
the same requested action; every successful invocation is recorded. Audit text is
not retained. IAM/Admin SDK operators remain trusted.

Direct browser reads/writes to comments are denied for every role. Public reads
remain available via listComments; authors use the authenticated callables. This
prevents direct SDK retrieval of hidden text or forgery of counters/system fields.
Firestore rules cannot redact individual fields from an allowed document read:
[Firebase field access documentation](https://firebase.google.com/docs/firestore/security/rules-fields).
Users/history/push/mangaOwnership/legacy stats and all Phase 3 private collections
keep their existing rules. The old view-rules test's direct-comment-write assertion
is updated to expect denial; all of its accounting assertions remain unchanged.

## Pagination and legacy compatibility

New comments use text; old content remains a supported fallback. Missing parentId,
rootId, deleted, moderationStatus, or replyCount defaults to a visible root and zero
replies. No content is moved or destructively migrated.

Each root page is newest-first by createdAt DESC, document ID DESC, limit20 plus
one lookahead. Replies query rootId, oldest-first by createdAt ASC, document ID ASC,
20 plus one lookahead. Cursors carry exact timestamp seconds/nanoseconds and ID,
including for legacy timestamps. Replies are fetched only on expansion, support
Load more, and show their direct-parent ID when nested. No realtime listeners or
per-comment profile reads are added. Each public page reads one metadata document
plus at most21 comment documents; the catalogue fetch is shared/cached.

Firestore equality queries exclude missing fields. Before normalization, the root
compatibility reader processes a bounded page of20 chronological documents and
filters replies; it can return fewer roots or even an empty page with a next cursor.
It never scans an entire manga to fill a page. For consistently full/scalable root
pages, run the non-destructive, resumable normalization helper after the new rules
block old client writes. It pages100 documents at a time, transactionally fills only
missing parentId/rootId with null, and sets `commentSystem/{mangaId}.rootsReady`.
Existing IDs, text, timestamps, and relationships remain intact. Any legacy document
missing createdAt receives its first known server timestamp; until normalization,
such undated records cannot appear in a chronological query. That is a technical
limitation of Firestore's ordering, documented in
[Firebase ordering behavior](https://firebase.google.com/docs/firestore/query-data/order-limit-data).
Do not manually set rootsReady before normalization. No extra team metadata is stored.

Two new collection-scoped indexes on messages:

1. parentId ASC, createdAt DESC, __name__ DESC
2. rootId ASC, createdAt ASC, __name__ ASC

Existing Phase 3 indexes and exemptions remain intact. The emulator does not prove
production composite-index readiness: wait for indexes to finish building.

## UI

The manga comment module retains the existing card/avatar/typography styles.
Root posting, inline reply composers, expandable threads, both Load more controls,
editing/deleting own comments, and scoped staff Hide/Restore/Delete controls are
included. Auth changes refresh the current list; bfcache restoration does likewise.
Text/name/parent labels use textContent; HTML is not interpreted. Avatar URLs are
limited to HTTPS in the server response. UI controls are convenience only; backend
checks remain authoritative. There is no new staff inbox/dashboard count in this
change, and no comment notifications, spam scoring, or payment/view changes.

## Verification

```sh
npm --prefix functions run lint
node --test scripts/test-comments.mjs scripts/test-firebase-session.mjs scripts/test-view-service.mjs scripts/test-chapter-views.mjs scripts/test-view-dashboard.mjs scripts/test-dashboard.mjs scripts/test-reading-progress.mjs scripts/test-push-notifications.mjs
npx --yes firebase-tools@15 emulators:exec --only firestore --project demo-helium-views --config firebase.emulator.json "node --test scripts/test-view-rules.mjs scripts/test-view-firestore.mjs scripts/test-comment-firestore.mjs"
```

Use Node24 and Java21. Tests use demo projects only and exercise the actual Admin
Firestore transactions and merged rules, concurrent reply creation, author/system
field protection, all moderation roles, append-only audit restrictions, legacy
render/edit/reply behavior, deterministic pages including timestamp nanoseconds,
and Phase 3 view concurrency/rules. Unit tests reject unsafe text rendering and
verify tombstones/input limits/lazy replies. CI runs comment tests alongside the
existing view checks. Live browser and production IAM/index readiness still require
staging validation; no production requests are made by these tests.

## Deployment — operator commands, not executed

From the repository root with Node24, authenticated Firebase CLI, and existing
project permissions:

```sh
npm ci --prefix functions
npm --prefix functions run lint
firebase deploy --project helium-team-d7f80 --only functions:listComments,functions:createComment,functions:editComment,functions:deleteComment,functions:moderateComment
firebase deploy --project helium-team-d7f80 --only firestore:indexes
```

Wait for both indexes to become ready in Firestore Console. The production
firebase.json/default codebase remains unchanged, and this scoped command does
not redeploy/remove the existing eight Functions.

Coordinate the comment frontend and rules rollout: publish the new comment JS/CSS
through the normal site workflow, then promptly deploy the merged rules below.
Before the new rules are live, do not use moderation: old public Firestore read
rules would still expose hidden text. Old cached clients using direct SDK comments
will need a reload after cutover. A brief maintenance window is appropriate if an
atomic release is required.

```sh
firebase deploy --project helium-team-d7f80 --only firestore:rules
gcloud auth application-default login
GCLOUD_PROJECT=helium-team-d7f80 node functions/lib/comments/normalize.mjs --normalize
```

Normalization uses the operator's ADC/IAM and the published manga catalogue. It is
not imported by Functions and never runs on deployment. It may be rerun safely,
and is recommended before large reply threads accumulate. Deleted or unpublished
manga not in the trusted catalogue are intentionally unavailable to these callables.

No new Firebase secrets or manual role changes are required. Staff claims must
already be configured; refresh the ID token/sign out-in after role changes. App
Check has an independent `ENFORCE_COMMENT_APP_CHECK` Boolean parameter defaultfalse
and reuses existing client App Check initialization. To enforce after staging,
configure the website's existing App Check site key/provider if not already done,
set `ENFORCE_COMMENT_APP_CHECK=true` in `functions/.env.helium-team-d7f80`, and redeploy
only the five new Functions. Do not change ENFORCE_VIEW_APP_CHECK or view activation.
The required Console checks are index readiness and post-cutover staff/guest smoke
tests; App Check registration/metrics review is optional until enforcement enabled.

## Files changed

- `functions/index.js` (append five exports only)
- New `functions/lib/comments/{service.mjs,endpoints.js,normalize.mjs,.eslintrc.cjs}`
- `firestore.rules`, `firestore.indexes.json`
- `assets/js/comment.js`, new `assets/js/comment-api.js`, `assets/css/homepage.css`
- New `scripts/test-comments.mjs`, `scripts/test-comment-firestore.mjs`
- `scripts/test-firebase-session.mjs`, `scripts/test-view-rules.mjs`
- `.github/workflows/site-update.yml`, this document

## Verified results for this change

Functions lint passed. UI/unit and existing auth, staff, publishing, push, dashboard,
history, and Phase 3 timing/service tests passed. The merged emulator run passed
14 tests including Phase 3 rules and real view transactions. After final ancestry
validation, the comment-only emulator rerun passed12 tests, zero failures/skips,
exit0. Local test runtimes: Node24 and Java21. Production was not contacted for
comment/view writes, deployed, or activated.
