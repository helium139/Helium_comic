# A — Independent multi-team authority review

PR7 remains DRAFT. Workers Free is mandatory; no Billing/R2/production changes.
Keeping views on Google is only the present state, not an accepted final design.

## Independently reviewable code boundary

Entry: worker/view-runtime/authority-runtime.mjs; installAuthorityPackage creates
ONLY access_rows, role/state index, immutable access_audit and disabled evidence gate.
No sessions/events/rates/report tables, view HMAC, Sheets secrets or view rollout
checkpoint is required. Catalogue assignment validation fetches ONLY trusted
teams.json, <=64KiB/200 teams, not the entire manga catalogue. No D1 team catalogue
copy or browser-provided manga ownership becomes trusted.

| Endpoint/path | Change | Authority/data remaining |
|---|---|---|
|POST /getCurrentAccess|Verified Firebase identity -> fresh D1 role/team/version|Auth issuer/audience/signature/time + disabled/revoked check through Google Auth REST|
|POST /setUserAccess|Admin only; active-team validation; pending saga and immutable audit|D1 access_rows; Google custom claims role/teamId/accessVersion; users role/teamId hints; authzMirrors version/state/lease|
|CMS /new-manga,/edit-manga,/delete-manga,/new-chapter,/edit-chapter,/delete-chapter,/upload,/rename-images|CURRENT_AUTHORITY_MODE=d1 resolves current role before existing ownership validation|GitHub published catalogue/teams and existing R2 images unchanged|
|Retained Google staff paths|ENFORCE_CURRENT_AUTHORITY requires fresh exact mirror/version|moderateComment, other comment paths when staff; getChapterViewAnalytics; monthly dashboard/history/generate/retry|
|Legacy Google setUserAccess|Keep deployed for rollback but disable writer when enforcement on|Must not independently overwrite claims after D1 becomes authority|
|Firestore Rules|Operator roleSystem/config switch; exact active mirror role/team/version + unexpired lease|User own-profile/history, Auth, comments, mangaStats/popularity retained; clients cannot write mirrors/config/accessVersion|
|Client staff scope|getCurrentAccess + forced ID-token refresh on version mismatch|Profile remains hint; never authority; stale disagreement denies privilege|

There is NO Google Function dependency for the new synchronization: Worker calls
Google Auth/Firestore REST directly with a backend OAuth credential. Firebase Auth
and Firestore themselves remain dependencies, as do their quotas/costs. No credential
was created. IAM/custom-role permissions and secure key lifecycle remain deployment
review items; do not pretend Firestore Rules constrain this privileged REST credential.

All existing15 Google Functions remain until separate decisions/rollback window:
setUserAccess; Start/Record/analytics; five comment Functions; recordChapterPopularity;
getMonthlyViewDashboard/getMonthlyViewReports/generateMonthlyViewReport/
retryMonthlyViewReport/closeMonthlyViewReport. Push/health never return. Comments and
reports need mirror guards because Admin SDK bypasses Rules, even with independent
authority. No new sync Function or Scheduler is needed.

## Revocation and rollback

1. D1 pending immediately rejects new privilege resolutions. In-flight authorized
   operations are not retroactively cancelled. Google/Firestore old privilege can
   remain for at most the existing five-minute lease until pending mirror succeeds;
   do NOT claim instantaneous cross-provider revocation.
2. Mirror GET/update-time CAS prevents old renewals overwriting pending/new versions.
   Per-target D1 synchronization lease prevents concurrent claims writers. Auth claims
   projection is not a distributed transaction: timeout can require owner repair;
   stale claims fail current-mirror version checks rather than regain privilege.
3. D1 resolves the verified UID's CURRENT team, ignoring stale role/team token hints.
   A revoked user becomes user; team A token cannot authorize team A after transfer
   to B. Existing CMS ownership checks enforce actor team on every mutation.
4. Rollback must quiesce access changes and baseline-diff trusted complete identities.
   authority-rollback.mjs promotes baseline admins first, preserves last-admin safety
   and restores baseline roles with INCREASED versions through the same saga. Never
   restore old version numbers/token claims. Pending/new identities require explicit
   reconciliation; absent/extra accounts are not deleted or silently assigned roles.
5. Reconcile Auth claims/profile/mirrors for ALL identities, keep strict Rules/Google
   guards active, refresh staff tokens and verify owner recovery before switching
   role writers. Rollback helper deliberately never authorizes disabling strict guards.
   After final Google-only rollback keep mirrored revocations enforced until all
   pre-cutover ID tokens have expired/revoked and fresh current claims are verified;
   disabling strict checks early can resurrect old admin tokens. No automated bypass.

New local tests prove no view tables are required; transferred/revoked users cannot
use stale role hints; concurrent sync and lookup revocation remain covered by changed
authority tests; rollback version1(A)->2(B)->3(A) rejects both old mirror tokens while
accepting version3. Rules source is unchanged from the previously passed emulator
suite; it was not manually rerun. No real user/profile/claim was read or written.

## Usage, cost and smallest cloud proof — not executed

Current small-fixture D1 metadata includes the role/state index ONCE:
resolve=3 queries/3rows read/0writes; team transfer=11queries/16reads/11writes.
The16reads include atomic actor-authority rechecks at claim/lease/fence points;
an admin revoked during registry fetch cannot start a change. These guards add
reads deliberately rather than allowing a revoked admin to finish authorizing one.
HTTP capacity gate adds1query/read. Thus roughly4P+16T reads and11T writes/day for
P staff calls (including T access changes); bootstrap/index/audit/import add usage.
Last-admin index avoids a full managed-user table scan. These are local observations,
not a universal bound for every transition/error. Budget conservative32reads/call,
32writes/change plus bootstrap separately. At assumedP1000/T20 per day: local
formula4320reads/220writes; conservative32kreads/640writes. Real staff usage unknown.

Each resolve additionally does Google Auth lookup, Firestore mirror GET+CAS PATCH.
Each changed role adds Auth lookup/update, two mirror GET+PATCH pairs, profile PATCH
(7Google calls), plus teams registry fetch only for leader assignment. So approximate
Firestore usage=P+2T reads, P+3T writes; staff Google Functions add mirror reads.
Claims sync does not remove Google costs. OAuth exchange/RS256 signing is cached per
isolate and can dominate cold CPU. Existing CMS upload CPU is not certified by this
authority-only proof. No subscription charge under Free; Google API/Firestore/MAU
charges depend on existing shared allowances; VAT unverified, no credits assumed.

Smallest proposed first pilot: ONE isolated Free Worker (authority entry only), ONE
D1 Free DB <=1MiB, <=250 HTTP requests INCLUDING OPTIONS, <=5000rows read,
<=2000writes, <=10 synthetic identities and12 access transitions including rollback.
Use synthetic RSA/JWK and injected mock Google transport; exercise real JWT verify,
OAuth RS256 signing, cold/warm cases and failures, without production Google calls.
No R2 binding, route on website, Cron, Sheets, real Auth user or new Google resource.
Workers/D1 increment$0 IF remaining shared quota is confirmed; no billable upgrade.

Confirm shared UTC-day request/read/write headroom first; snapshot2990requests and
68520CPU-ms has unknown time window and gives no per-request CPU guarantee. Measure
CPU per invocation, not wall time: every path <=10ms, targetp95<=7ms with zero CPU
limit errors; include cold key parsing/signing and largest200-team registry. Validate
all outcomes/role states and15-query path/subrequest envelope. Abort at fixed counts;
do not fall back to Paid. This fixture proves CPU/control logic only. A second,
separately authorized isolated Google integration/IAM test is still needed for real
token revocation, OAuth permission/scopes, mirror CAS and failure recovery.

**A decision:** independent local package and small Free pilot PLAN are ready for
review. NOT cleared to run: account headroom, provision approval, credential/IAM and
cloud CPU remain. No prerequisite to accept Google as final view architecture.
