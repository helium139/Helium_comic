# Investigation of missing candidate response metrics — local only

No Cloudflare API request, endpoint enable, deploy or workload in this task. PR#7
stays draft; production A, Workers Free, CMS/R2 and Billing unchanged. The old
journal and64R/32W unknown reservation are untouched. All timestamps below UTC.

## Confirmed evidence vs gaps

| Item | Existing evidence | What it does NOT establish |
|---|---|---|
| Target URL | `https://helium-authority-fixture-20261116.mylengoctra06.workers.dev/setUserAccess?pilotCase=full-first-set` reconstructed from saved URL, case and runner | No final response URL/status/headers saved |
| Account/resource | Recorded pilot account, Worker and D1 exact-name/UUID guards passed before upload | No new account/plan/quota query in this task |
| Artifact | Commitc3fa39f4, bundleSHA12cdd5bc9c11bb6f3f9e07d8513e63288945be5f7a9f109a9edde37f422b0fd6 | No version metadata binding/active version UUID recorded in old run |
| Upload | PUT issued20:31:33.601Z; succeeded by20:31:35.372Z; ETageb267a5930619d058ba114f1ad951a75ed70317247fd2a8158bb1f1f9f79d457 | ETag is not the runtime version UUID, nor proof which version served a request |
| workers.dev | Enable POST issued20:31:35.372Z returned success; disable POST20:31:36.380Z, GET verified disabled by20:31:37.982Z | Success of control API does not prove edge route was serving at workload time; enable response completion timestamp not saved separately |
| Routing | Direct workers.dev URL, no production routes/domains configured by pilot tools | No historical data-plane/DNS/route snapshot; cannot exclude propagation or edge error |
| Authentication | Upload and runner use same saved synthetic pilot key; request source includes synthetic Bearer JWT | No wire response to prove key/JWT was accepted. Management bootstrap token and runtime pilot key are separate credentials; neither printed |
| Redirect handling then | Fetch used redirect:error, so normal followed redirect could not silently deliver destination HTML | A redirect might have become a generic fetch rejection; observed error was response parsing, not that generic rejection. No Location evidence |
| Post-run | No metrics; two invocation-log queries returned no matching events; D1 unchanged (requests91, SET8, leader v4/a, audit8) | Empty logs are not proof of zero CPU or the exact failure stage |

Verified root problem in observability: old catch combined malformed metrics JSON,
body JSON parsing and body read failure into one message, then discarded response
status/body/headers. JSON.parse(null) for a missing metrics header returns null:
a valid JSON body with merely missing header would normally reach correlation
failure instead. Thus the observed parse message does NOT itself prove missing
header, HTML, authentication failure, deployment failure or exceededCPU.

Source branches that could return non-JSON without metrics include pilot-key
403, invalid case400 and budget429. The saved case is valid and the pre-run budget
was below all limits and unexpired. A normal application's JWT denial happens
after the budget reservation and ordinarily has JSON/metrics. Neither source
review nor unchanged DB can identify the actual response. Edge HTML/error, wrong
runtime credential acceptance and pre-metrics runtime failure remain hypotheses.
The original response cannot be recovered from the saved artifacts.

## Runner changes

`response-diagnostics.mjs` reads at most4,096 bytes, cancels excess body, and logs
only a sanitized representation: known error status/code, redacted messages/other
JSON fields; HTML/text content entirely redacted (recognized numeric Cloudflare
error code retained). No raw user content, token, cookies or arbitrary headers.
Status, MIME type, redirect flag, safe final URL/Location and validated CF-Ray are
captured. URL query values, credentials and unknown paths/hosts are redacted.

Fetch uses redirect:manual: ALL redirects stop, including same-host redirects;
credentials never follow a redirect. Error classes distinguish HTTP401/403,
HTTP404/5xx, JSON/body parse, body loss, metrics parse/schema, application envelope,
reservation overflow and credential preparation. Some failures have both HTTP
classification and protocol detail. No ambiguous reservation is refunded. No
automatic retry exists. A network exception is still unknown outcome, not zero
work. Journal writes issued before send, terminal diagnostic before throwing.

## Read-only readiness

Candidate-only GET `/__pilot/ready` checks the existing pilot key and the SAME
strict synthetic JWT verifier used by application calls. It returns protocolv2,
nonce/case, embedded build fingerprint, runtime version ID, registry mode and
isolate evidence. It does not access DB or Google, allocate a server budget
reservation, change roles/version/audit or initialize registry/OAuth.

Build identity hashes the complete preliminary esbuild bundle including dependencies;
final bundle SHA is recorded separately. Runtime version comes from Cloudflare's
[version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
([upload binding configuration](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings)).
The client must compare BOTH identities against the tested artifact and the
single100%-active version returned by control plane; never accept an ID merely
because the response supplied it. Missing identity fails closed.

A nonce-bound, in-process receipt expires in30seconds and gates SET before sending.
Its clone/serialized form is not valid. SET also carries expected version/build;
fixture checks them before any budget/D1 work. The normal role/version/audit/retry
logic remains. Readiness is necessary, NOT proof of D1 capacity/current authority,
Firestore rules, real Google IAM/OAuth or production readiness. Deadline copies
original guard expiry, does not extend it. If expired, diagnostics can show
matching transport identity but no SET-ready receipt is issued.

All handler invocations, including readiness and denied requests, advance the
in-memory first-invocation marker before authentication. Readiness warms isolate
and JWT cache. A later request in that isolate MUST NOT be labeled true-cold;
key-cache eviction is not isolate cold. Nothing here grants permission for SET.

For a future diagnostic upload, PILOT_DIAGNOSTIC_ONLY=true blocks ALL other paths
before D1, including resolve and SET. This restriction is fixture-only and has
NOT been deployed. The old cloud bundle has no readiness route; do not probe it
as if a404 proves the proposed handler failed.

## Local results

20/20 targeted controller/diagnostics tests pass:401/403/404/500/503, HTML, malformed
JSON, malformed metrics and envelope, redirects, lost response/body,4096-byte bound,
redaction, invalid/mismatched/expired readiness and no-SET-without-receipt.
10/10 exact-bundle local cases pass, including real synthetic RSA verification,
invalid JWT claims, pilot-key rejection, method handling and diagnostic write/resolve
blocking. Database snapshot before/after is identical for all tables: budget,
versions, audit and mock Google projections. A unit-test DB getter throws if touched;
readiness uses zero SQL by implementation, not cloud metadata measurement.
Only affected test suites were run locally, no old audit/view/accounting reruns.

## Proposed cloud diagnostic — awaiting approval, no execution

Use same existing Worker/D1, Free plan and synthetic keys. One new exclusively
created journal links old journal SHA and retains its unresolved reservation.
See `migration-evidence/authority-readiness-diagnostic-plan.json` for exact manifest.

- Upload diagnostic-only tested bundle while endpoint remains disabled, with
  version_metadata binding, original expiry, existing DB and synthetic bindings.
- Read active deployment ONCE: require one matching version at100%, save UUID,
  ETag and artifact hash; otherwise stop before enable.
- Enable only pilot workers.dev, previews:false. Allow a bounded propagation wait
  (no HTTP probes/retry), then ONE authenticated GET readiness with unique nonce.
- Always disable in finally and GET-verify disabled before one bounded logs query.
  All failures stop, do not consume a SET or silently extend the plan. Closure
  takes priority over log collection if control calls fail.

Exactly1 readiness /0 resolve /0 SET; no Google calls, no SQL or schema setup.
Resolve is omitted because it renews mock mirror and updates fixture budget; it is
NOT read-only at database level. No provider plan/R2/Billing change or new resource.

| Budget | Already retained | Diagnostic increment | Ceiling |
|---|---:|---:|---:|
| Control API |44/50 |<=6 (upload, deployment read, enable, disable, verify, logs) |50/50 |
| Conservative total HTTP |92/250 |1 |93/250 |
| Conservative rows read |828/5,000 |0 |828/5,000 |
| Conservative rows written |369/2,000 |0 |369/2,000 |
| Stored DB bytes |57,344/1,048,576 |0 |unchanged |

The old92 HTTP already reserved all50 control calls; adding6 again would double
count. Actual issued control+workload86 rises by7 to93. Server counter91 and SET8
need not change for this read-only handler; the external journal counts readiness.
These are cumulative PILOT caps, not a freshly measured account-wide daily quota.
Account-wide Workers usage was not queried in this task; no new quota headroom is claimed.
Control cap50 leaves no further diagnostic queries after this plan, so an expanded
investigation requires a separately reviewed scope; never reset the cap. No new
journal authorizes resetting counters, guard expiry or returning old reservations.

Conclusion: root cause still unverified; the missing evidence is status, MIME,
final URL/Location, sanitized error body and exact served version. New local code
supplies it for a future narrowly approved diagnostic; no cloud run was made.
