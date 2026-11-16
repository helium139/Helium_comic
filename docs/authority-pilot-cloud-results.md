# Isolated authority pilot: completed, current fixture NO-GO for Free CPU

PR7 remains DRAFT. No production, Billing, Workers plan, CMS/R2 credential, mirror
guard or legacy writer was changed. No real Google/Firebase API request was made.
View/accounting expansion remains paused. This is not a Google integration approval.

## Basis and deployed scope

Account identity was verified using the dedicated read token. User confirmed Workers
Free active and D1 never created/used. Inventory showed0DB/0bytes. Proceeding used
that explicit user-approved attestation; remaining daily D1 quota was NOT measured
directly and is not now retrospectively called a measured zero. Dedicated bootstrap
token was process-only; OAuth/CMS/R2 credentials were not overwritten or bound.

One Worker and one D1: helium-authority-fixture-20261116.5synthetic identities, real
RSA2048 signature verification and OAuth assertion signing, injected Google REST
mock persisted in the SAME fixture D1,200-team registry padded to64KiB. No R2,
production route, custom domain, Cron, real Auth user or credential. Global outbound
fetch is denied; the Google adapter explicitly targets demo-authority-fixture and
uses injected mock transport. No extra Worker/Tail service was created.

Bundle71398bytes, SHA25633b8c2dd9bffe9228d7e7484e844f8794a7561f77705c277cf123da8fb25afd0.
Local and cloud used the same bundle; lockfile-pinned esbuild0.28.2 reproduced the
hash after execution without touching deployed keys. No synthetic private key or
bootstrap token is in Git. Tooling refuses to regenerate keys in an existing cloud
run directory. Local workerd14-case validation passed before upload.

The stronger mock caught accounts:update incorrectly sending localId as an array.
Google's contract requires a string. Candidate adapter fixed with an explicit unit
assertion; no Google production deployment or real API claim is implied.
https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update

## Cloud CPU and latency

CPU comes from41 Cloudflare invocation-log cpuTimeMs fields, joined by pilotCase ID,
not client timers. End-to-end latency is client fetch duration, excluding client
JWT signing. Percentiles use nearest-rank; tiny n, especially cold/set groups, does
not establish a production distribution.

|Successful category|n|CPU p50/p95 ms|Latency p50/p95 ms|
|---|---:|---:|---:|
|Resolve, true isolate first|1|11/11|532/532|
|Resolve, forced key cold on warm isolate|8|5/7|216/317|
|Resolve, warm|16|3/5|218/255|
|Set access, forced key cold on warm isolate|2|14/17|786/860|
|Set access, warm|2|11/11|730/791|

5/41requests exceeded10ms measured CPU, max17ms. All invocation outcomes were ok;
there were zero exceededCpu or quota failures. Cloudflare permits occasional CPU
flexibility, so absence of1102 is NOT evidence that the10ms target passed. The
predeclared max10ms/targetp95<=7ms criterion fails. No more workload was issued after
this result. No Paid upgrade or CPU limit increase was attempted.
https://developers.cloudflare.com/workers/platform/limits/#cpu-time

This measures the whole instrumented MOCK fixture: budget checks, logging and D1
mock projection storage add CPU/latency. No baseline subtraction isolates application
CPU. It is NO-GO for the current tested package, not proof that every authority-only
design or the real Google transport must fail Free. True isolate-cold SET was not
observed; forced crypto cold is labeled separately. Warm successful SET already
failed11ms in two samples, so more cold/load trials were not justified here.

## Correctness, errors and limits

All41 HTTP outcomes matched the planned expectations:29x200,4x403,2x503,1x401,
1x400,4x204. This includes expected denial, injected claims failure, pending denial,
retry/revocation, stale admin/team hints, foreign-team access change denial, disabled
account, revoked auth_time, owner recovery/last-admin protection and rollback to
teamA with NEW version4. Final D1 state: owner remains active admin; leader active
teamA/version4; backup user/version2. These are mock server-authority proofs, not
actual Firestore client Rules/IAM proofs.4access changes committed, plus1failed/pending
attempt;8set requests include denied attempts, below the12-transition cap.

The large rate-history branch is NOT imported into authority. Cloud includes200-team
64KiB registry in successful team SET; an injected10000-element history BODY returns
400 before authority resolution. No view rate SQL, event collector or view workload
was deployed. Multibyte UTF-8 registry limits and2048/2049body boundaries also passed
local tests. Heavy valid JSON was not replaced with a tiny-only payload benchmark.

|Budget item|Observed metadata / requests|Conservative bound|Approved limit|
|---|---:|---:|---:|
|HTTP: workload + control-plane|41+36=77|91|250|
|D1 rows read|550|636|5000|
|D1 rows written|212|337|2000|
|D1 physical size|max57344bytes (56KiB)|57344|1048576|

Control calls include inventory, setup, logs and dedicated endpoint shutdown
verification. One setup API400 rejected an array body BEFORE SQL execution; corrected
with object requests, without another DB creation or an ambiguous retry. Aborted
last-admin SQL did not return query metadata. Post-run conservative ceiling holds
its FULL64read/32write reservation rather than refunding missing work; this raises
the server's settled585/308 counters to636/337 for reporting. Unknown/aborted work
is not silently billed as zero. Initial50HTTP reserve covers all36control requests.

No new subscription; expected incremental Workers/D1 charge$0 under Free and the
attested unused D1 allowance. Not an independently measured account invoice. R2 had
no binding/operation/change. No credits are used to claim a saving.

## Inventory and cleanup

- Worker: helium-authority-fixture-20261116; workers.dev DISABLED and read-back
  verified after propagation. No endpoint probe or production route change needed.
- D1: helium-authority-fixture-20261116,
  UUID ee5d9c49-9db4-479a-92e2-22b8e19d22bc,57344bytes, synthetic data only.
- Fixture-only synthetic RSA/JWK and pilot gate secret remain bound to the disabled
  Worker until cleanup; no production credentials. Local private keys/logs/journal
  stay in Git-ignored private run directory. Sanitized per-request measurements:
  migration-evidence/authority-pilot-cloud-result.json.
- Resources retained for review, NOT deleted. No shared database/Worker/R2/user was
  deleted. Future cleanup must verify recorded account and exact IDs, then delete
  ONLY this Worker and D1. Do not recreate them or blindly replay the run journal.

Proposed cleanup commands, NOT executed:

    npx wrangler delete --name helium-authority-fixture-20261116
    npx wrangler d1 delete ee5d9c49-9db4-479a-92e2-22b8e19d22bc

Retained provider invocation logs may outlive Worker deletion until log retention
expires. Revoke the dedicated bootstrap token after the approved cleanup/review;
never rotate shared CMS/R2 credentials as a side effect.

## Next decision

Do not cut over or start real Google integration from this mock result. First review
how to reduce SET/cold CPU and distinguish measurement overhead without weakening
revocation/authorization; a new bounded experiment needs a concrete reviewed change,
not Paid or repeated unchanged tests. Real isolated Google resources/permissions and
lease alternatives are prepared in authority-real-transport-and-lease-options.md.
They remain unapproved. The5minute residual privilege lease is NOT accepted by the
user, and this pilot did not change that policy on production.
