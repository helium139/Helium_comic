# Free migration review — 16 November 2026

The later independent decisions in authority-independent-review.md and
view-free-design-review.md supersede this first single-point estimate. Google is
the current production state, NOT an accepted final view architecture. Refined
cleanup bounds and an independently testable authority entry point are provided.

## Release

PR6 merge51ca9a9490f95a0a185c9207c2d1fe579662e51e is the branch base.
[Update Site43891644241](https://github.com/helium139/Helium_comic/actions/runs/43891644241)
succeeded in update/deploy/notification jobs. Nine production asset checks returned
200 and SHA256 matched Git blobs, including index/login/auth/comments/reader/sw.js.
Messaging SW is a scoped retirement tombstone; cache/PWA remains. Evidence:
`migration-evidence/push-release.json`. No live authenticated write test was performed;
Auth/comments/CMS/publishing are covered by local regressions. No audit collector,
popunder experiment, Logging query, cloud creation or extra Function deletion ran.

## Decision: NO-GO full Free cutover

Checked [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
Account-wide Free allowances:100k Worker requests/day,10ms CPU/request; D1
5M rows read/day,100k written/day,500MB/database,5GB/account,50queries/invocation.
No Paid upgrade is an allowed fallback. Local wall time does not prove cloud CPU.

Reused post-A saved heavier24h window: S6916/R3287,18773 HTTP requests including
preflights. Not a proven maximum UTC day. HTTP200 is NOT accepted views. Outcome
and authenticated mix remain unknown. All Record accepted is sizing only.
Saved evidence: `migration-evidence/saved-baseline.json`; no recollection.

| Planning scenario | Current | 2x |
|---|---:|---:|
| HTTP including reported existing2990 Worker requests on that day |21763|40536|
| Guest-only D1 lifecycle writes/day |71079|142158|
| Auth-only lifecycle writes/day |98059|196118|
| Guest + assumed5000 reserve +1 snapshot |76080|147159|
| Auth + same reserve |103060|201119|
| Prior reads planning envelope/day |2.28–2.40M|4.06–4.30M|

Reserve is NOT measured shared usage; other APIs/bots/retries add requests. New
capacity checks add at least one read per API call. With25% headroom even current
guest sizing exceeds75k writes. Current authenticated and both2x scenarios fail100k.
Actual accepted mix might be cheaper but cannot be invented. Import/audit/authority/
report jobs and cleanup share the SAME account quotas. No accepted view is dropped
or anti-fraud relaxed to force a fit.

Current-schema Miniflare measurements (`test-migration-quota.mjs`):

| Outcome |Guest reads/writes|Auth reads/writes|
|---|---:|---:|
|Start|6/3|6/4|
|Start replay (before RETURNING revision)|4/0|4/0|
|Accepted Record|11/6|11/8|
|Consumed Record replay|1/0|1/0|
|Duplicate Record|10/1|8/1|

Metadata already includes trigger/index writes: receipt1+ledger/index2+dedup1/2+
rates2/3. Do not add indexes again. Transients use WITHOUT ROWID primary keys;
cleanup deletion costs writes. Restore adds2 transfer-mode writes +1 batch receipt
per<=20 rows plus inserts/indexes; collision/gate SELECTs add reads. A20-row import
uses44 batch statements+3 preflight queries, below Free's50-query invocation limit.
No epoch index
or temporary ledger copy was added. Rollback scans<=25 PK rows/page then filters.
Prior21,606-row Start was already fixed to22 in its saved hot fixture; no repeat
prototype audit. Exact timestamp histories remain bounded10000, not approximate.

Reads above are not lifetime bounds. Month index helps monthly reads; exact all-time
and grouped-child analytics still scan growing history. Returned pagination does
not bound GROUP BY rows scanned. A few million-row dashboards can exhaust5M/day.
Additional exact rollups would increase writes and require a new design decision.

Storage: prior10k fixture~328bytes/event including month index predates new epoch.
Planning1KiB/event+50MB transient reserve fills500MB in~134days current/~67days2x
at all-records-accepted, BEFORE historical import. Current cloud size is unknown.
Saved archive proof verifies signature, corruption rejection and report totals,
with zero ledger deletion. Export alone frees no D1 space. No compaction is approved.
Raw archive planning~729bytes/event adds~0.875/1.75GB annually; R2 Standard storage
at year end ~$0.013/$0.026 monthly plus rounding/operations; ~8/15 Class A and B/day.
This is an optional private future destination, not existing public image storage.

## Cost and fallback

Workers/D1 Free add$0 subscription within remaining quota; over quota operations
stop. The evidence gate is not a usage counter/hard availability guarantee.
Record failure must stay explicit/pending; never silently lose revenue or render
incomplete reports as complete. Static pages/images and retained Firebase Auth,
comments/popularity continue on their existing services.

Existing R2 remains unchanged. User-reported19.56GB,5.46k Class A,2.9M Class B imply
~$0.15/month storage and$0 operations IF monthly totals and Standard class apply.
[R2 pricing](https://developers.cloudflare.com/r2/pricing/). No credits counted.
Average storage, billing window, other products and VAT are not invoice-verified.
Google remains EUR with no reported card conversion fee. Current USD/EUR and VAT
remain unconfirmed. Historical pre-push-removal Google model was$11.73–16.80/month
before VAT ($28.59–34.35 at2x); this is NOT a post-retirement invoice/prediction.
No usage reduction is deployed by this PR, so no Google saving is booked.

Recommendation: retain view/ledger/analytics/Sheets together on Google A; review
authority-only Free separately after CPU/shared-usage proof. This does not promise
Google cost reduction. Alternative: separately review exact accounting/analytics/
archive redesign. Do not enable Paid. Google Sheets cannot keep reading old
Firestore counters after D1 accepts views and still claim complete reports.

## Deployment sequence, not executed

1. Review draft PR and choose component split. Full view cutover is blocked above.
   All client providers remain Google, CUTOVER_ENABLED off, Free feature list empty.
2. Only after separate approval: one isolated Free Worker+one Free D1, no public
   route/crons, no R2 change. Review minimal OAuth IAM/secret delivery. No key/account
   was created. A first synthetic cloud verification may be bounded to1000 HTTP
   requests (including preflight),20k writes,250k reads,10MB, after verifying shared
   headroom. Within remaining Free quota increment$0; exclude real Google/Sheets
   writes. Measure cold/warm JWT/JWK CPU, hot SQL JSON CPU, latency and subrequests.
3. Staff cutover: trusted server-role bootstrap, last-admin recovery, ownership
   reconciliation, mirrors, then CMS CURRENT_AUTHORITY_MODE=d1, strict Firestore
   roleSystem/config and Google ENFORCE_CURRENT_AUTHORITY together. Disable old role
   writer. Five-minute mirror leases apply only after every privileged path is
   guarded. Pending saga denies D1; cross-provider updates are not atomic.
4. Future view cutover: explicitly pause BOTH writers; privately export full ledger,
   active sessions/receipts,24h dedup, rate history, immutable snapshots/chunks,
   Sheets IDs/jobs/audit, config and coverage. Operator-sign the manifest; a content
   hash alone is not trusted-origin proof. Restore<=20rows/batch with gate closed;
   reconcile month/team/manga/chapter counts and hashes to originals. Same HMAC,
   policy, activation/catalogue and unique writer epoch are required.
5. Switch Start+Record together to ONE writer. Signed Google bridge preserves old
   tabs and trusted network identity; no fallback/dual-write. Analytics/reports must
   follow the SAME ledger. Old staff Google endpoint routing and report-job conversion
   remain blockers; frontend URL changes alone are insufficient.
6. Rollback: pause both, export final CF epoch and operational state, verify manifest
   completeness, idempotently replay revenue events/8 ORIGINAL Google aggregates,
   restore final receipts/dedup/rates, reconcile reports/Sheets IDs, then resume A.
   Injected restore requires migrationControl/view paused evidence and Google config
   disabled. Never rollback by URL alone. Full report-job format conversion and
   signed backup orchestration still need fixture proof before production use.
7. Preserve Functions/secrets through an agreed rollback window. No further deletion
   until replacement is proven and separately authorized. Any future fixture cleanup
   targets only reviewed dedicated Worker/DB IDs after private backup verification;
   no deploy/delete command is automatically executed by this package.

Remaining: account usage/UTC peak, cloud10ms CPU, bounded lifetime storage/analytics,
IAM, trusted production restore, old staff endpoint routing and job conversion.
Local correctness tests are not a claim that the whole migration operates on Free.
