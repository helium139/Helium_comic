# Authority CPU review — local candidate, not deployed

Production A unchanged; PR #7 remains draft. No cloud request, resource creation,
plan/quota/Billing change, real Google transport or CMS/R2 change in this review.

## What the existing invocation CPU establishes

Old cloud sample: true isolate-first resolve 11 ms (n=1), forced-key-cold resolve
p50/p95 5/7 ms (n=8), warm resolve 3/5 ms (n=16); forced-key-cold SET 14/17 ms
(n=2), warm SET 11/11 ms (n=2). Five of 41 requests exceeded 10 ms.
These are whole invocation CPU, NOT component measurements. Forced key eviction
is not cold isolate startup. True isolate-first SET remains unmeasured.

| Layer | Work retained / expected CPU source | Evidence and limitation |
|---|---|---|
| Authorization resolve | Fresh authority row, two version/state rereads, account revocation check, mirror CAS | Local core 3 queries, 3 reads, 0 writes; runtime gate adds one query. No cached grants. |
| Set access | Current admin, active team, target, pending CAS, lock/fences, immutable audit, projection saga | Local change core 11 queries, 16 reads, 11 writes including existing index. Do not remove fences or audit. |
| JWT | RS256 verify each request, issuer/audience/kid/time/sub checks; bounded JWK set | Candidate strengthens fixture claims checks to match production checks. Signature verification is never skipped on warm requests. Production remote JWK retrieval remains unmeasured. |
| OAuth | PKCS8 import + signed assertion and exchange on cache miss; bounded one-key/one-token cache | Signing preserved. Mock exchange omits actual Google CPU/network/response behaviour. |
| Registry | Old fixture allocates 200-team/64 KiB text every request, then parses on leader assignment | Candidate lazy source and bounded parsed Map; fresh conditional fetch every use. No stale-on-error. |
| D1 | Bind/result serialization and promises, plus application SQL | Network wait is not CPU. Local rows are not cloud CPU. |
| Budget controller | Reserve and settle UPDATEs, metadata wrapper, JSON metrics | Remain in fixture wrapper, not application runtime. Controller also journals/reserves before send, no retry. |
| Google mock | D1-backed JSON state per RPC, account/profile/mirror CAS, response serialization | Deliberately retained for durable correctness; overhead is additional to application SQL. Not a prediction of real Google transport. |
| Logging | Fixture metrics/header serialization and console log plus provider invocation event | Retained in both comparison variants. No per-component CPU attribution from console timestamps. |

## Code diff and boundaries

- `team-registry.mjs`: one bounded registry (<=200 entries, <=64 KiB), Map point
  lookup; at most one in-flight fetch; ETag conditional validation per access.
  Validators expire after 30 seconds from full fetch, NOT from 304. Changes/errors
  invalidate; explicit invalidation also fences in-flight fetch/text parsing.
  Immutable returned entries/array. No cached authorization or mirror result.
- `authority.mjs`: uses getTeam when available, retaining legacy catalogue adapter.
  Actor/version/lock/audit/projection/retry logic unchanged.
- `candidate-worker.mjs`: separate fixture entry, original fixture source untouched.
  Synthetic registry generation is outside application logic and lazy in validator
  mode; JWT/OAuth work stays. Full mode reproduces per-request registry work with
  the SAME strengthened JWT checks for a matched comparison.
- Application entry remains `authority-runtime.mjs`: no fixture budget tables,
  mock transport or fixture metrics imported there. Candidate is an instrumented
  approximation, not a production deployment artifact or an overhead-free CPU claim.
- Build accepts `--candidate`; local validation and CI cover both registry modes.
  Local private bundles/keys are ignored, never committed.

Point lookup currently avoids repeated parse/linear search on a validated 304;
first load and changed ETag still fetch/validate the full trusted JSON. The trusted
source has no per-team API. A true D1 point directory would need a trusted atomic
revision publisher and revision predicates inside claim/fence/commit, plus a
fail-closed update/rollback procedure. It is NOT wired here: blindly copying JSON
into a team table would introduce stale-team authorization. Existing team-source
race semantics are preserved, not asserted to be a stronger transactional policy.

## Local evidence

Run 9 related tests, and bundle validation 17 cases PER mode. Covers registry 200
teams/64 KiB, byte limits, changed ETag, failed source, expiry, concurrent readers,
in-flight invalidation, stale actor, old token, cross-team, pending denial, retry,
rollback, disabled/revoked account, last-admin and signed invalid JWT claims.
See sanitized JSON evidence. Maximum fixture request 40 reads/18 writes; database
53,248 bytes. These counts include mock/controller; no cloud CPU inference.

## Next cloud comparison — PLAN ONLY, NOT EXECUTED

1. Reuse ONLY the already approved isolated Worker/D1, same synthetic identities,
   same bundle/config and logs. Keep workers.dev disabled until a separately
   approved bounded run. Never connect Google production.
2. Compare candidate full vs validator mode with identical strict JWT, durable
   mock, budget SQL, metrics, state transitions and 200-team/64 KiB payload.
   Frozen historical bundle is context, not a matched control after JWT hardening.
3. Per mode: first-isolate SET and warm SET (2 attempts), first-isolate resolve
   and warm resolves (4 calls). Cold SET and cold resolve require distinct new
   isolate observations; deployments do not guarantee this. Use invocation logs'
   cpuTimeMs and correlation IDs, isolate tag/first flag. Report missing true-cold
   groups as inconclusive. Never replace CPU with latency or subtract latency.
4. Existing server SET cap used 8/12 attempts, leaving ONLY four: two modes x two
   SET fits, with no retries, no new negative SET probes and no counter reset.
   Existing conservative total 91 HTTP / 636 reads / 337 writes. Reserve full
   64R/32W for each of 12 workload requests: +12 HTTP/+768R/+384W. Hold <=20
   extra control HTTP and separately reserve their SQL within global 250 HTTP,
   5,000R/2,000W/1MiB. Reconcile actual ledger before any future run; do not reset
   budgets to create room. Need separate scope if true cold coverage fails or
   more samples/diagnostic variants are wanted.
5. Collect provider invocation CPU for all calls, including quota/errors. Report
   individual cold samples and warm samples; n=1 or n=2 is not a robust p95 claim.
   The A/B difference estimates registry change only. Component probes or removing
   budget/log/mock overhead require another controlled design; do not subtract
   independently measured CPU and label it production CPU.

Recommendation: local candidate is ready for review, NOT a Free production go.
Real Google transport CPU, real JWK refresh, IAM/OAuth behaviour and true cold SET
remain unmeasured. Keep mock/state/budget overhead visible; do not relax security
or workload caps to obtain a passing number. No new cloud round has been run.
