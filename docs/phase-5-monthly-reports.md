# Phase 5: UTC monthly accounting and owner Drive exports

Implementation only: no commit, push, deployment, activation, OAuth consent, Google
file creation, or production data change was performed. Google API tests use mocks;
Firestore integration tests use demo emulator projects. Existing Functions are
preserved, including the full Phase 3 accepted-view/session/dedup/event/aggregate
implementation. No accounting source documents are reset, deleted, or rewritten.

## Functions and schedule

All additions use the existing default Functions codebase and project
`helium-team-d7f80`, region `us-central1`:

| Function | Access/purpose |
| --- | --- |
| getMonthlyViewDashboard | Staff, verified claims: own team for leaders; site or selected team for admins |
| getMonthlyViewReports | Admin-only paginated report history |
| retryMonthlyViewReport | Admin-only existing incomplete reports; generated reports return unchanged |
| closeMonthlyViewReport | Firebase v2 scheduled function, `10 0 1 * *`, timezone **UTC** |

The schedule is 00:10 UTC on the first day. Its original scheduleTime determines
the previous month even if retry delivery crosses another month boundary. Five
scheduler retries, backoff60–3600 seconds, retry window24h, function timeout540s,
512MiB, maxInstances1/concurrency1. Google requests also have an8-minute total
invocation budget and20-second per-request timeouts, preventing stale work from
issuing external writes beyond its lease. A Firestore lease also serializes scheduler and
manual retries, which are separate endpoints. Firebase manages the Scheduler job
and its authenticated default-compute-service-account invocation; verify IAM
remains private, with no allUsers/allAuthenticatedUsers invoker grant.
[Firebase scheduled-functions documentation](https://firebase.google.com/docs/functions/schedule-functions).

UTC helpers are centralized in `functions/lib/reports/utc-months.mjs` and shared
by the monthly dashboard and close service. Current/previous period keys never
come from browser time or browser totals. Missing period documents return0.
The existing getChapterViewAnalytics remains unchanged for lazy drill-down.

The dashboard shows Total Valid Views, Valid Views This Month, and Valid Views
Last Month. Admin All Teams uses site; a selected team uses team:T; leaders use
only the verified token teamId. Explicit foreign/site requests by leaders are
rejected, not silently authorized. Cards use four read-only documents per refresh:
activation config and all/current/previous scope periods. Inactive accounting keeps
the existing Not active yet behavior. `mangaStats.views` is never read here.

An open dashboard refreshes at the server's next UTC boundary, while retaining
team scope. A single cancellable timer checks locally at most once/minute, without
reading Firestore each minute. Visibility return, focus, and bfcache restoration
refresh from the server. Monotonic elapsed time plus wall elapsed time covers
browser sleep/clock adjustments; only server responses determine period keys.
Errors display Unavailable rather than carrying an old monthly value forward.
No aggregate writes, counter reset, or activation update participates in rollover.

## Authoritative snapshot

`monthlyReports/{YYYY-MM}` contains:

- month, timezone:UTC, schemaVersion:1, snapshotVersion:1
- status:generating/failed/generated (pending supported for incomplete-state retry)
- totalValidViews; teams:[{teamId,teamName,validViews}]
- catalogueRevision, snapshotHash (SHA256), mangaCount, chunkCount
- closedAt (snapshot time), generatedAt (export success time)
- spreadsheetId, spreadsheetUrl, driveFolderId, exportKey, creationState
- attempts, lastAttemptAt, lastTrigger, lastRequestedBy, runId, leaseUntil, error
- adjustmentPolicy: future corrections require separate audited adjustments

Immutable manga rows are stored at
`monthlyReports/{month}/snapshotChunks/{zeroPaddedPart}` with rows, part, and
snapshotHash. Each chunk contains at most100 rows. Attempt audit events are
append-only at `monthlyReports/{month}/attempts/{runId}_start|finish`: runId,
trigger, requestedBy, outcome, createdAt. No browser can read or write any of
these documents, including admins; admin history is exposed by a role-checked
callable. Team leaders receive no full-site report data or export links.

The close reads site, team, and manga aggregate periods for the closed month in
one Firestore transaction, plus the trusted published teams/catalogue metadata.
It includes all currently active teams, including zero-view teams, AND historical
inactive/unregistered teams with earnings. This avoids losing valid historical
views when a team is deactivated or renamed. Historical names use registry names
at close time, with stable IDs as fallback. Manga scopes retain their earned-team
attribution even if a manga was subsequently reassigned. No chapter/event scan
or popularity read occurs.

Site total, team sum, and per-team manga sum must reconcile exactly. Invalid or
inconsistent aggregates fail closed for owner investigation instead of issuing
an incorrect report. Source paths must be canonical analyticsScopes paths.

Snapshot creation, all chunks, and the hash are atomic. Sealed snapshots are never
recomputed during retries. Successful reports are never exported again or silently
changed, even if aggregates or Google Sheet cells later change. Spreadsheet edits
are never imported. IAM operators remain trusted; browser admin claims do not
provide direct Firestore report writes. Future corrections should use a separately
specified adjustment ledger/new version, not edits to closed data.

Safety bounds:500 teams,10,000 manga rows,4MB serialized snapshot,500KB summary.
Larger reports fail rather than truncate; partitioned closing/export checkpoints
are future work. The current server catalogue names are capped at300 characters
in snapshots. Very large exports may need an extended resumable export pipeline.

## Idempotent export and failure recovery

1. Claim a15-minute lease and append a start audit event. The lease outlasts the
   scheduled/callable540-second runtime. A live competing run returns aborted.
2. Atomically freeze the snapshot, or reuse its existing hash/chunks.
3. Reuse an existing stored Sheet ID; otherwise search Drive for the stable private
   appProperties heliumReportKey (project/month/version) and snapshotHash.
4. Before any Sheet creation POST, persist creationState:issued. The request creates
   the Google Sheet directly in the configured folder with its recovery markers.
5. Persist verified ID/URL before filling/formating the two sheets.
6. Mark generated and append a completion audit event only after export succeeds.

Failed population/formatting can safely overwrite only the incomplete export using
its immutable Firestore snapshot. Definitive HTTP create rejections permit retry;
timeouts/5xx/process crashes leave an uncertain intent. Retry searches for and
adopts exactly one matching owner-owned Sheet, never blindly creates another.
Multiple matches, a moved/trashed/nonprivate file, or an uncertain intent with no
visible match require owner reconciliation. Restore a moved/trashed known file to
the configured private folder, wait for Drive lookup visibility, then retry.
**Do not delete/reset the issued intent to force a retry.** If creation truly never
reached Drive, an operator-reviewed, audited repair is required; automated retry
intentionally sacrifices availability to prevent duplicate exports. Such a repair
must retain the frozen snapshot/hash and establish whether a file exists before
allowing any new create. No unsafe force-create endpoint is exposed.

This conservative outbox is necessary because Google Workspace Sheets do not
support caller-supplied pre-generated Drive IDs, so an external create cannot be
made atomic with Firestore. See [Google Drive creation/ID limits](https://developers.google.com/workspace/drive/api/guides/create-file).
A generated report returns immediately on subsequent calls (no Google API calls).
Raw Google errors, access tokens, refresh tokens, and client secrets are never
logged, persisted in reports, returned to browsers, or rendered in history.

## Workbook

Title: **HeliumTG Monthly Views - YYYY-MM**. Sheets:

- Team Summary: Team, Month, Valid Views, Percent of Site Views; TOTAL row.
- Manga Breakdown: Team, Manga, Valid Views; TOTAL row.

Rows are frozen/sorted by team name, then stable team ID and manga title/ID.
Header and TOTAL rows are bold with contrasting fill; headers are frozen; integer
and percentage formats are applied; columns are auto-sized with reasonable title
widths. Values use RAW input so names beginning '=' cannot become formulas.
There are no currency/payroll calculations. A default empty Sheet1 may remain;
the two named report tabs are authoritative exports of the snapshot.

Exports use the owner's OAuth account, not a service-account-owned Drive. The
folder and Sheet must be owned by that account and private (owner permission only)
at export time. The application never shares files. Owner sharing changes after
successful export are outside Firebase access control; keep this folder private.

## Required Google setup — operator only, not executed

Use Node24 on the local machine where the owner's browser can reach127.0.0.1.
Do not run the loopback flow in Cloud Shell without an appropriate tunnel.

1. In Google Cloud Console select **helium-team-d7f80**. Enable Google Drive API,
   Google Sheets API, Cloud Scheduler API, and Secret Manager API:

```sh
gcloud services enable drive.googleapis.com sheets.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com --project helium-team-d7f80
```

2. Configure Google Auth Platform/OAuth consent. Use Internal only if the owner
   belongs to the relevant Workspace organization; otherwise External. The only
   scope needed is `https://www.googleapis.com/auth/drive.file`, which also permits
   Sheets operations on app-authorized files. Do not request unrestricted Drive
   access. Create a **Desktop app** OAuth client separate from Firebase's web Auth
   client. Download its JSON outside the repository (for example Downloads).

3. For initial testing, add the owner as a test user. For long-lived automation,
   switch the OAuth app to Production/appropriate organization state and authorize
   again; External Testing refresh tokens expire after7 days for these scopes.
   Follow any applicable Google consent/verification prompts.
   [OAuth token lifetime](https://developers.google.com/identity/protocols/oauth2/),
   [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes).

4. Run the explicit one-time PKCE+state-protected loopback helper locally:

```sh
node functions/lib/reports/authorize.mjs --client-json "$HOME/Downloads/helium-report-desktop-client.json" --authorize-owner --create-folder
```

Choose the report OWNER'S Google account in the consent screen. The helper prints
an authorization URL (public client ID only; no client secret/token), stores three
secret values in a fresh mode0700 temporary directory with mode0600 files, and
prints ready-to-run Secret Manager upload commands containing FILE PATHS only.
It also creates a private app-authorized folder in that owner's Drive and prints
its non-secret folder ID. No secrets are printed. The helper does not upload
secrets or deploy anything automatically.

5. Execute the three printed commands, equivalent to:

```sh
firebase functions:secrets:set GOOGLE_REPORT_CLIENT_ID --project helium-team-d7f80 --data-file /tmp/helium-report-oauth-REPLACE/GOOGLE_REPORT_CLIENT_ID
firebase functions:secrets:set GOOGLE_REPORT_CLIENT_SECRET --project helium-team-d7f80 --data-file /tmp/helium-report-oauth-REPLACE/GOOGLE_REPORT_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_REPORT_REFRESH_TOKEN --project helium-team-d7f80 --data-file /tmp/helium-report-oauth-REPLACE/GOOGLE_REPORT_REFRESH_TOKEN
```

Use the ACTUAL paths printed by the helper. Remove those protected temporary files
and downloaded OAuth JSON after successful upload using your normal secure local
credential-cleanup procedure. Never paste secrets into chat, browser JS, committed
.env files, command arguments, or logs. Do not commit client JSON. Local OAuth
JSON/env patterns are added to functions/.gitignore as an additional safeguard.

6. Add non-secret configuration to `functions/.env.helium-team-d7f80`, preserving
all existing parameter settings:

```dotenv
GOOGLE_REPORT_FOLDER_ID=REPLACE_WITH_HELPER_FOLDER_ID
ENFORCE_REPORT_APP_CHECK=false
```

A random existing folder ID may be inaccessible under drive.file. Use the folder
created/authorized by this app; do not share it with leaders or publish a link.
Keep the OAuth client/owner stable. Reauthorize with the SAME client/owner if a
refresh token is revoked; changing client identity can lose appProperties/file
access needed for recovery. The new report App Check switch is independent of
existing view/comment/popularity switches; enable it after staging if desired.

## Deployment order — commands for the operator, not executed

From the existing repository root, after the OAuth/secrets/config setup above:

```sh
npm ci --prefix functions
npm --prefix functions run lint
firebase deploy --project helium-team-d7f80 --only firestore:rules,firestore:indexes
```

Wait for the new index to finish building in Firestore Console. The one new
collection-group index on periods is kind ASC, period ASC, scopeId ASC. Existing
indexes remain. New index exemptions suppress unnecessary indexing of
monthlyReports.teams and snapshotChunks.rows (neither is queried).

Deploy new read/retry callables, then the scheduled addition:

```sh
firebase deploy --project helium-team-d7f80 --only functions:getMonthlyViewDashboard,functions:getMonthlyViewReports,functions:retryMonthlyViewReport
firebase deploy --project helium-team-d7f80 --only functions:closeMonthlyViewReport
```

Firebase CLI binds the three secrets to close/retry; deployment requires IAM to
read/create secrets and grant runtime access. Read-only endpoints have no Google
secret binding. Verify the Cloud Scheduler job
`firebase-schedule-closeMonthlyViewReport-us-central1` has cron `10 0 1 * *`, UTC,
correct project/default-compute-service-account authenticated invocation, enabled
APIs, and billing. Do not grant public invoker or manually replace/delete managed
jobs. No existing Function is renamed, redeployed, or deleted by these commands.

Publish the frontend through the existing workflow AFTER these endpoints exist.
Admin Reports navigation is claim-visible only for admins; direct leader access
fails before reading history, and backend callables independently deny leaders.
Verify admin/leader scopes, current+previous cards, report history/retry, owner Drive
privacy, and App Check metrics. Optionally set ENFORCE_REPORT_APP_CHECK=true and
redeploy the four NEW Functions after validation. Do not change Phase 3 activation
or enforcement settings. No counter reset/backfill or view-collection migration is
required. The first automatic run closes the previous month at the next scheduled
boundary; it does not automatically backfill older missing months.

## Cost/performance estimates

Let T be earned-team aggregate documents, M earned-manga aggregate documents,
C=ceil(M/100) snapshot chunks. Registry active zero teams add no aggregate reads.

- First successful close: approximately T+M+C+7 document reads and C+7 writes
  (claim/audit, immutable snapshot/chunks, creation intent, file metadata,
  completion/audit). Empty queries have Firestore minimum-read charges; transaction
  retries add reads. Published catalogue/team metadata uses two cached HTTPS reads.
- Completed-month retry:1 report read,0 writes,0 Google calls. Manual retry adds
  one report existence read. Incomplete retry with a stored file generally reads
  C+3 documents and writes4; recovery/file-identification checkpoints add1 read/write.
- Dashboard refresh:4 reads; lazy drill-down remains the existing bounded aggregate
  API. Report history:up to21 reads for20 entries, no per-report child scans.
- New export:one OAuth refresh request; Drive folder GET, marker search, create,
  verify GET (4 Drive calls); Sheets properties GET, sheet setup batchUpdate,
  ceil((T_active_or_historical+2)/200)+ceil((M+2)/200) value batches, formatting
  batchUpdate. Usually10 total HTTP requests for a small report including OAuth.
  Recovery skips creation and may repeat safe value/format calls. No API call count
  depends on the number of raw view events. Access tokens are reused per invocation.

No new permanent realtime listeners, raw-view scans, or per-manga dashboard reads.
Large snapshot/export guards fail visibly; they never silently omit rows or totals.

## Files changed

Backend additions:
`functions/lib/reports/{utc-months.mjs,accounting.mjs,dashboard.mjs,service.mjs,google.mjs,endpoints.js,authorize.mjs,.eslintrc.cjs}`.
Existing backend/config: `functions/index.js` (append exports only),
`functions/.gitignore`, `firestore.rules` (new deny-only namespace),
`firestore.indexes.json` (one new index, two exemptions).

Frontend additions: `assets/js/month-rollover.mjs`, `admin/api/monthly-reports.js`,
`admin/reports.js`, `admin/reports/index.html`.
Updated: `admin/view-analytics.js`, `admin/index.html`, `admin/menu.js`,
`admin/admin.css`, `admin/manga.html`, `admin/chapter.html`,
`admin/manga/index.html`, `admin/chapter/index.html`, `admin/comments/index.html`.

Tests: new `scripts/{report-test-db.mjs,test-monthly-reports.mjs,test-monthly-report-ui.mjs,test-monthly-report-firestore.mjs}`;
updated `scripts/test-view-dashboard.mjs` for the read-only monthly endpoint.
CI: `.github/workflows/site-update.yml`; documentation: this file.

## Verification commands

Use Node24 and Java21. OAuth helper is NOT executed by tests. Google requests are
mocked, so no live owner file/auth validation is claimed.

```sh
npm --prefix functions run lint
node --test scripts/test-monthly-reports.mjs scripts/test-monthly-report-ui.mjs scripts/test-view-dashboard.mjs scripts/test-view-service.mjs scripts/test-chapter-views.mjs scripts/test-comments.mjs scripts/test-admin-comments.mjs scripts/test-dashboard.mjs scripts/test-staff-access.mjs
npx --yes firebase-tools@15 emulators:exec --only firestore --project demo-helium-views --config firebase.emulator.json "node --test scripts/test-view-rules.mjs scripts/test-view-firestore.mjs scripts/test-comment-firestore.mjs scripts/test-monthly-report-firestore.mjs"
```

Coverage:UTC normal/December-January/leap/timezone rollover, missing current period0,
retained previous period, admin/team/leader scopes, foreign accounting denial,
zero-view and inactive earned teams, reconciliation, immutable retries, concurrent
close and expired leases, uncertain/definitive create failures, duplicate prevention,
RAW workbook content/formatting, preserved Function exports/schedule manifest,
admin-only report UI/API, Phase 3 and Phase 4 regressions, and merged rules denying
browser report/chunk/audit writes and full-site report reads. Staging should verify
actual Google consent/access, Scheduler IAM, index readiness, and live UI behavior.

## Results for this implementation

- Functions lint, frontend syntax checks, and whitespace checks passed.
- Broad unit/regression run:18 test files passed,0 failed.
- Merged Firestore emulator run:16 tests passed,0 failed/skipped (Phase 3, Phase 4, and monthly accounting/rules).
- Final monthly read-only transaction/security rerun:2 tests passed,0 failed/skipped.
- Final monthly UI/export unit reruns passed, including expired external-write budget and private-folder enforcement.
- Existing Function bodies were verified byte-for-byte preserved before the appended exports. Existing Phase 3/4/popularity/Worker implementations are unchanged.
- No live Google API/account setup, file creation, production data writes, deployment, activation, commit, or push was performed.
