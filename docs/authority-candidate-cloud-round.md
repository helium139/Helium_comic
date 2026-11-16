# Candidate c3fa39f4 cloud round — stopped, inconclusive

Both CI checks passed before cloud execution; PR #7 remained draft. Source review
confirmed full/validator differ only in fixture registry strategy. Both use the
same strict JWT validation, authority, durable Google mock, audit and budget SQL.
The exact candidate bundle SHA256 was
`12cdd5bc9c11bb6f3f9e07d8513e63288945be5f7a9f109a9edde37f422b0fd6`.

Preflight reconciled existing server counters: requests91, SET8/12, R585/W308,
leader team a/version4, audit8, all active, expiry unchanged21:50:49.073Z.
No schema/seed/counter/expiry reset. Only existing Worker/D1 touched.

Planned per variant: first SET after deploy, second SET, four resolves. This spends
exactly four SET attempts across both variants and prioritizes previously missing
cold SET evidence. True-cold resolve was deliberately not covered. An isolate
change or missing first-invocation marker would make a cold/warm cell inconclusive.
No forced-key-cold requests were planned.

## Actual result

At20:31:35Z full variant upload/enable completed. The first SET response could not
be parsed as a fixture response; controller retained64R/32W and stopped without
retry. The old parser did not persist status/body, so HTTP status and root cause
cannot be reconstructed. Route propagation is only a possibility, not a finding.
Local controller now journals status/content-type on parse failure, without body
or credentials; its four tests pass. This fix was NOT deployed or retried.

Endpoint disabled and GET verified enabled:false/previews_enabled:false at
20:31:37.982Z. Two bounded invocation-log queries, the second after ingestion time,
returned no matching events. D1 reconciliation showed no changes: SET8, requests91,
leader a/version4, audit8. No further workload issued. No CPU sample was recovered.

| Planned cell | Result |
|---|---|
| full cold SET | Issued; no metrics/log evidence, CPU/outcome/cold state unknown |
| full warm SET | Not run |
| full warm resolve x4 | Not run |
| validator cold/warm SET | Not run |
| validator warm resolve x4 | Not run |
| true-cold resolve, either mode | Outside this matrix; not measured |

## Cumulative budget / inventory

New:1 workload request issued;8 control HTTP (prequery, deploy, enable, disable,
verify, two logs, postquery),28 metadata reads,0 metadata writes. Old control count
36 becomes44 of50. Actual control+issued workload cumulative86; conservative HTTP92
retains all50 control slots. Conservative R828/W369 includes full128R control-query
reservation and the unverified request64R/32W; no refund of unknown work. Combined
metadata R578/W212 is not an upper bound (previous failed SQL lacks metadata).
DB remains57,344 bytes; caps250HTTP/5,000R/2,000W/1MiB unchanged.

Worker `helium-authority-fixture-20261116`, D1 UUID
`ee5d9c49-9db4-479a-92e2-22b8e19d22bc` retained; endpoint disabled, no routes/domains,
no new resources. Worker currently holds candidate full, not validator. Workers
Free, Billing, CMS/R2, Google production and Auth credentials unchanged.

## Comparison / next step

Previous pilot had41 measured invocation samples, five CPU>10ms, warm successful
SET11ms and forced-key-cold SET14/17ms. This round provides ZERO new CPU samples;
no numeric improvement, overhead attribution or reliable SET percentile is possible.
Decision: INCONCLUSIVE; the prior fixture no-go has not been overturned.

Do not continue this stopped journal or silently replay its SET. Before any newly
authorized round, validate the runner's response-status journaling locally and
prepare bounded route-readiness handling without warming an isolate then calling
its SET true-cold. Do not infer readiness from a successful enable API alone.
Reconcile all budgets again; the server still shows four slots but one additional
client-issued request retains its reservation. No real Google transport pilot or
production cutover is authorized by this result. Existing isolated transport/lease
proposal remains unapproved; real Google CPU/IAM/OAuth is still unmeasured.
