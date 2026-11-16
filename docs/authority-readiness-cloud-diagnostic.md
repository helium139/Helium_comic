# Approved readiness diagnostic — final reconciliation

Target artifact:bb9a5da5 (both CI checks success before any upload), PR#7 draft.
Workers Free, production A, CMS/R2, Billing and all Google Functions unchanged.
No new Worker/D1, no SQL setup, no real Google transport or benchmark.

## Result: NOT PASSED / response unobserved

Exactly ONE readiness is durably journaled before send at20:56:28.845Z UTC, case
`readiness-bb9a5da5-once`; no response/terminal record exists. Actual wire delivery,
HTTP status, content-type, redirect metadata and error body cannot be confirmed.
No readiness retry, resolve or SET was issued. Do not replay it to obtain evidence.
A final bounded log query failed and recovered no additional evidence.

| Check | Result |
|---|---|
| Tested/uploaded bundle SHA |05fcdd7f7adf52e7e4198f23795b302e500ad9d20e1bc602546d747ea2dc5482 matches local tested artifact |
| Expected embedded fingerprint |b92119e2a82252ab0945f5ec0572ca92407be645df68cb421a31be1dcb8b29ef |
| Control-plane active version |200c526c-1e9f-41c0-86f8-03a725ee2f2a at100% |
| Active deployment object ID |327ff493-9f13-4bef-a47d-c71429d67188 |
| Actual runtime version/fingerprint |Unobserved: no response or invocation event recovered |
| Readiness CPU |Unmeasured; not resolve/set CPU |
| Final workers.dev/previews |Bothfalse, API verified20:58:18.390Z UTC |

The new source remains installed in the existing pilot Worker, diagnostic-only,
with endpoint disabled. Its readiness handler is designed for zero SQL; missing
runtime evidence means this run does NOT empirically establish zero SQL.

## Verified runner ID bug; original response problem still unknown

The first control-only attempt uploaded successfully, then compared upload field
`deployment_id` (`200c526c1e9f41c086f803a725ee2f2a`) with the deployment object'sID.
That comparison was wrong. A later active-version read confirms upload ID equals
the version_id after removing UUID hyphens, and the different deployment objectID
is not a version ID. The corrected pure helper requires one100%version and exact
normalized equality. It fails closed on a different version or partial rollout.
Cloudflare's [Wrangler changelog](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md)
also documents the migration of legacy displayed Deployment ID terminology to
Version ID; the actual mapping above is established by this account's API evidence.
This bug explains the new preflight stop, NOT the previous SET response failure.

A second operational failure followed: the execution session returned without a
final result; an early saved snapshot was incorrectly treated as proof the process
had ended before workload issuance. The later immutable journal proves issuance
had already been recorded. The supervisor then overwrote status with0 from that
stale snapshot. This report supersedes that0-request interpretation. It does not
claim a known process/network termination cause or assume no request reached edge.
A privileged process check eventually found no remaining diagnostic processes;
no further readiness was attempted. Parent journal contents were not changed.

Future controllers must use an exclusive owner lock, append-only durable state
and positive process-liveness evidence; an empty tool/session result or a partial
snapshot is not a completed transaction. Every post-issued outcome stays unknown
until a response/provider record reconciles it. Do not open another cloud round
until lifecycle/termination handling is tested locally.

## Cleanup and budget chronology

- Initial plan omitted logs to fit5 normal control calls +1 cleanup spare within
  cap50. First preflight stopped before enable; finally disabled/verified.
- Before continuation, announced cap50→53: current48 +version-read/enable/disable/
  verify +1 spare. No control counter reset or new workload allowance.
- Endpoint enabled during the incomplete execution. Emergency cleanup made two
  failed5-second disable attempts; GET still showed enabled:true, previews:false.
  That unverified/open state was reported immediately.
- Announced cleanup-only cap53→56. A20-second-timeout disable succeededHTTP200,
  followed by GETHTTP200 verifying bothfalse at20:58:18.390Z.
- Cap59 was subsequently announced for a possible yet-unissued request, but the
  full journal was checked first and showed an issued readiness. No such request
  or cap59 adjustment was executed. One final logs query used control56 after
  endpoint closure. No additional cloud actions followed.

| Cumulative pilot usage | Final conservative amount |
|---|---:|
| Control API issued |56 (cap56, including failed/unknown calls) |
| Workload journaled (all rounds) |43 =41 original +1 unresolved SET +1 readiness |
| Total HTTP issued/reserved |99/250 |
| Rows read retained ceiling |892/5,000 |
| Rows written retained ceiling |401/2,000 |
| Database last measured size |57,344/1,048,576 bytes; not remeasured this round |

R892/W401 retain previousR828/W369 AND a full additional64R/32W for the readiness
whose served runtime/outcome is unknown. This is a safety reservation, not measured
SQL usage. No old reservation refunded. Original failed SET journal hash remains
11bc756825c62c18bcbd8102c43d60b205b0e460b84e940faafd0ed8bab938a7.
Control counter reconciliation is monotonic: initial3 +53 stored issued entries=56.
No service quota, plan or Billing setting was changed by these LOCAL budget caps.

The original response/metrics root cause remains unknown. No Free readiness pass,
Google transport permission, application CPU conclusion or true-cold workload claim
follows from this run. Stop here with pilot endpoint verified disabled.
