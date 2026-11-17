# Approved fixed-runner readiness, 2026-11-17 — execution plan

User approved pushing5f73f069, requiring CI success before one pilot readiness.
5f73f069 regression and synthetic checks succeeded; PR#7 confirmed draft.
This follow-up tooling adapter also requires CI success before execution.

No Worker upload is needed: existing pilot already has tested diagnostic-only
readiness bundleSHA05fcdd7f7adf52e7e4198f23795b302e500ad9d20e1bc602546d747ea2dc5482,
fingerprintb92119e2a82252ab0945f5ec0572ca92407be645df68cb421a31be1dcb8b29ef.
Existing Workerhelium-authority-fixture-20261116 and D1ee5d9c49-9db4-479a-92e2-22b8e19d22bc
only; no resource creation, schema, production route, CMS/R2/Billing/plan changes.

The new export reuses the tested one-process request implementation, with exact
HTTPS host/path/case allowlist. GETreadiness only, no request body, no redirects or
retries. Loopback CLI still rejects cloud URLs. Header secrets stay in memory,
not journals. Body is consumed once; status/error diagnostics and protocol identity
are durably committed before result projection. Deadline5s, no CPU claim.

Exact workload1 readiness /0 resolve /0 SET. New exclusively created run directory
and request journal link hashes of all prior journals. Existing outcomes remain
unknown and reservations are not refunded or reset. SQL reservation increment0/0.
Historical SQL ceiling892R/401W is kept separate from measured SQL.

Control budget announced before Cloudflare access: counter56 retained, cap56→63.
Normal calls5: GET endpoint state, GETactive version, POSTenable, POSTdisable,
GETverify disabled. Cleanup has2 extra calls for a second disable+verify pair.
Before enable, one enable slot +4 cleanup slots must remain. No logs API call.
Conservative total HTTP ceiling63control+43oldworkload+1newready=107/250.
If cleanup cannot prove workers.dev=false and previews=false, report immediately.

The historical guard deadline is NOT extended. Transport/version readiness can
pass even when the response reports guardUnexpired:false; this authorizes NO
workload or migration and will be reported separately. Stop after the response,
no CPU benchmark and no automatic retry on any failure.

Local verification:33/33 affected lifecycle+adapter/cleanup tests pass, including
exact-host restriction, one request, redacted headers, zero SQL and cleanup faults.
Worker business runtime unchanged. Actual result must be recorded separately.
