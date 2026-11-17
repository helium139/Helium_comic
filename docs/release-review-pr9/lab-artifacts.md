# CPU lab artifacts — offline, same approved proposal scope

No Worker/bucket was created, deployed or invoked. Scope/caps in cpu-workload.json
are unchanged: 2 Workers Free +1 isolated R2 bucket; 30 candidate attempts, <=200
provider invocations, <=36 control calls (7 cleanup reserve), 20-minute guard,
<=512MiB, 1500 Class A/4000 Class B/1500 DELETE. No automatic retries or make-up
samples. Old authority pilot history/reservations are not read or modified.

## Source and build

- worker/cpu-lab/candidate.mjs imports the PR #9 application, preserving signature,
  issuer/audience/time, role/team/version and publication validation. Only synthetic
  subjects/keys and two fake upstream hosts are allowed. It never calls Google or
  GitHub; the proxy uses a private service binding. Native image binding is ONLY
  the approved isolated R2 bucket, verified by deployment metadata before opening.
- worker/cpu-lab/provider.mjs has no public endpoint. It returns fake grants and
  GitHub data from the lab bucket. Immutable raw/base64 versions are staged before
  conditional R2 pointer CAS; concurrent losers get 409 without overwriting the
  winner. Orphaned fixture versions are local to the lab and count toward R2 caps.
- worker/cpu-lab/fixtures.mjs generates all-fictional catalogues/subjects/images.
  Current 41/599, future 50/1199, 2x 50/1799; one synthetic leader per team.

Build with esbuild 0.28.2, browser/ES2022/ESM (no migration PR #7 runtime import):

```powershell
esbuild ./worker/cpu-lab/candidate.mjs --bundle --format=esm --platform=browser --target=es2022 --outfile=.local-cms-build/cpu-lab/candidate.bundle.mjs
esbuild ./worker/cpu-lab/provider.mjs --bundle --format=esm --platform=browser --target=es2022 --outfile=.local-cms-build/cpu-lab/provider.bundle.mjs
node scripts/prepare-cms-cpu-lab.mjs
```

Public SHA256/size inventory: lab-artifact-hashes.json. Core runtime remains
b486a029; the lab wrapper is additional instrumentation, not a production change.
Cloud deployment/version is null until an approved deployment actually exists.

## Generated private artifacts, not in Git

`.local-cms-build/cpu-lab/` contains:
- candidate.bundle.mjs/provider.bundle.mjs;
- deployment.private.json: exact script names, upload metadata/bindings, 100% log
  sampling proposal, public JWKS and synthetic lab key; both endpoints initially
  disabled, provider stays private. These values are not production credentials.
- requests.private.json: exactly 30 fixed cases, byte-accurate multipart/JSON
  request files, synthetic JWTs, hashes and 466 total seed-object writes across
  all phases. Four phases are seeded/purged separately, never all at once.
- image.bin: 838,861 magic-valid synthetic JPEG bytes; not a real reader image.
- cleanup-plan.json: exact two Worker names/lab bucket, bounded allowed namespaces,
  object/byte/delete limits, disable-and-verify and absence verification requirements.
- session.private.json: prepared, zero issued/reserved cases, not opened/deployed.

Preparation uses no network/client/API and has no cloud apply mode. It refuses to
regenerate artifacts if session shows deployed/opened/issued/reserved work. Do not
manually reset that file. Synthetic JWTs expire after one hour: if approval is later,
regenerate OFFLINE before any deployment, not after a session has started. Source
bundle hashes/case count/scope must still match; no extra cloud round is authorized.
No actual key/JWT/private manifest is printed or committed.

## Measurement interpretation

Cold evidence is first invocation of a module instance plus a random module tag,
runtime version and fingerprint. Even unauthorized earlier traffic consumes the
first-invocation flag. Key-cache state is explicitly not directly observed; a
first verification attempt is not mislabeled as a cache hit/miss. Real Google
JWKS network/rotation and Auth/App Check/Firestore transport are not exercised.

Candidate deliberately creates application orchestration per request to isolate
phase transports/counters safely under concurrency. **Ownership cache is MISS by
construction**, including samples with a warm module/JWT. Those samples are not
fully warm production-cache measurements. This is a conservative miss-path case;
do not subtract fixture/factory/log overhead numerically from unmatched samples,
or declare every possible Workers Free design impossible if this branch fails.

Every business sample logs case/phase/version/fingerprint/isolate/status/R2 counts.
It does not populate cpuTimeMs from local clocks. Only matched Cloudflare invocation
CPU may do that. Request separate provider evidence, but do not ASSUME a parent
service-binding CPU record excludes child work: provider/chain attribution must
be established from the actual traces. No numerical subtraction from unrelated
events or isolates. If attribution is unavailable or the fixture chain hits a
limit, report inconclusive for isolated CMS CPU and stop before the next phase.
No averages/percentiles substitute for
missing traces; phase gates and hard/headroom stops in cpu-workload.json apply.

The single-process execution must persist an issued reservation BEFORE each request,
await and save response/transport outcome, never replay unknown writes and wrap
the entire session in endpoint disable/verify finally. This package does not open
an endpoint or auto-execute the request files. Do not use curl retry or redirect
following, parallel independent supervisors or a new journal to reset usage.

## Cleanup and stop contract

No production binding/route, D1, Google resource, CMS/R2 credential or Paid setting.
Verify the account, Free status, actual invocation-log eligibility and quota before
creating anything. Bootstrap permissions and lab-only object credentials must be
ready within the stated plan, never borrowed from CMS/shared bucket keys.

Stop before the next phase on failed CPU/headroom/fingerprint/schema/correctness,
missing logs, provider failure, transport ambiguity, budget or deadline. Never add
samples automatically. Finally disable candidate workers.dev/previews and verify
both false, using the reserved control calls even after a workload error. If unable
to verify, report immediately. Provider stays private throughout.

Between phases, bounded list of the EXACT lab bucket must be empty after purge.
Only fixture-control/ and lab-manga-* keys are eligible. Unknown key, >1000 objects,
>512MiB or deletion cap: stop for review, no wildcard deletion. Last cleanup deletes
the exact two lab Workers and verified-empty lab bucket only under the approved
cleanup scope, verifies absence by resource ID, and retains journals/unknown
reservations. No operation targets helium-cms or helium-comic.

Local validation: 6/6 lab tests and 6/6 bootstrap-planner tests. External HTTP is
disabled in the lab tests. Tests cover synthetic real RS256 verification, private
provider/egress gates, CAS conflict, full 30-page publish, four/eight concurrent
publication integrity, cold-label correctness and refusal to reset issued/reserved
session history. Parallel tests use tiny image
fixtures; no cloud CPU, Free headroom or production performance claim follows.

Service-binding references (billing/limits are not a promise about per-event CPU
attribution): https://developers.cloudflare.com/workers/platform/pricing/#service-bindings
and https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/.
