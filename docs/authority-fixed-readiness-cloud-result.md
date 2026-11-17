# Fixed single-process pilot readiness — PASS, stopped

Requested commit5f73f069 was pushed to PR#7 and both CI checks succeeded.
Exact-host adapter6fc256d8 also passed both checks before Cloudflare access.
PR remains draft; no merge or production cutover. No Worker upload/resource creation,
Workers Paid/Billing/CMS/R2 change, SQL setup, Google transport or CPU benchmark.

## One response, durably saved

- Exactly1 GET readiness,0 resolve/SET, no retry; exclusive new journal.
- HTTP200, application/json,393bytes, not truncated, no redirect/Location.
- Terminal state response-saved committed/fsync before result projection.
- Protocol, fresh case, scope, registry mode and zero-SQL declaration all match.
- Observed runtime version200c526c-1e9f-41c0-86f8-03a725ee2f2a matches the100%active
  control-plane version and normalized legacy upload ID.
- Observed fingerprintb92119e2a82252ab0945f5ec0572ca92407be645df68cb421a31be1dcb8b29ef
  matches the previously tested/uploaded readiness artifact.
- Error-body capture was unnecessary because response succeeded; bounded/redacted
  diagnostics are saved. No response clone, double body read or separate supervisor.

The historical guard remained expired (guardUnexpired:false). It was NOT extended.
PASS here means transport/protocol/runtime identity; it is not permission to issue
resolve/SET, migration, Google transport or any benchmark.

## Closure / cumulative usage

finally successfully disabled pilot endpoint, then GET independently verified
workers.dev=false and previews_enabled=false. Exact UTC verification/completion
and per-call metadata are in the sanitized JSON artifact. No calls after cleanup.

| Counter | Final |
|---|---:|
| New control API calls |5 normal;2 cleanup spare unused |
| Cumulative control |61/63 |
| New workload |1 readiness |
| Cumulative issued control+workload |105/250 |
| Conservative HTTP ceiling including unused cleanup reserve |107/250 |
| Historical SQL ceiling retained (not new measured usage) |892reads/401writes |
| New readiness SQL/reservation |0/0; no DB code path, no provider SQL measurement |

All three historical journal hashes were checked and unchanged; no old run resumed,
reservation refunded, counter reset or storage cleanup. The existing Worker/D1
remain; endpoint disabled. No data migration or Google Function deletion.

This successful response shows that the repaired one-process pipeline can capture
and persist this invocation. It does not retrospectively prove what body caused
the older cloud failure, nor establish production Free eligibility or real Google
transport correctness. No CPU measurements were taken or inferred from latency.
Stop after this response, as authorized.
