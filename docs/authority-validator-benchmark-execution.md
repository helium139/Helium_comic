# Validator CPU session — approved bounded execution

Fixture bundleSHA256:
`d050726262729ecf87cfbafd8dacfbf3cc391e2dff0d738d6a83d05d76dadaf5`

Embedded build fingerprint:
`7aa6ce2eaa43514962653c7d29b0e59b080aade91c920b4b32cff34220feb63d`

Reviewed application modules untouched. benchmark-worker copies reviewed candidate
with only isolated guard-table reservation, migration-gate namespace mapping and
readiness timestamp/session envelope changes. JWT, OAuth, authorization/version,
fences, immutable audit, retry logic and Google mock are unchanged. CPU/config,
compatibility flags and synthetic RSA2048 unchanged. No production resources/data.

New table authority_bench_validator_20261117 is created/seeded in ONE atomic
CREATE TABLE AS SELECT statement conditioned on exact historical counters. No
UPDATE/reset/expiry extension of fixture_budget or migration_gate. New gate row
carries verified local artifact evidence and15-minute expiry. Business reservation
latches readiness timestamp+30seconds ONCE, capped by request/SET/rows ceilings.
Old rows remain byte-equivalent in pre/post snapshots. No new database/resource.

The single-process runner consumes each response once and commits journal before
result projection. Exclusive new directory; no old-run continuation/retry. GET
readiness then12 business requests exactly as approved:2 warmup resolves,3 warm,
3 key-cache-cold, registry-first SET, warm SET, key-cache-cold SET, warm SET.
SETs a→b→a→b→a, versions4→5→6→7→8; only if preflight confirms leader4/owner1,
active states,8 audit rows and historical SET8/12. Any mismatch stops before enable.
Readiness and every invocation count for isolateFirst; key reset is not cold isolate.

Requests timeout<=5s AND remaining30-second window. If window expires, stop with
insufficient samples/unknown outcome, no extra requests or auto-renewal. On any
bad response/unknown/correctness/budget issue stop without retry. CPU>10ms is
assessed after the sole post-closure CPU query; not a promised real-time abort.

Control calls from counter61: GETdisabled, SQLpreflight, CTASseed, upload, GETversion,
enable, SQLpost, disable, GETverify, one logs query =10 normal;2 spare cleanup.
New internal cap73; global conservative HTTP130, reads1916, writes849, bytes1MiB.
Old892R/401W holds retained; admin256R/64W +12*64R/32W reserved. These are ceilings,
not billable/measured SQL. One readiness reserves no D1. Per-call D1 metadata is
reported separately including index work, no extra manual index multiplier.

Finally always attempts disable+GETverification, with one additional pair if needed.
Log query only after closure attempt, once, with a fixed3s ingestion wait; no poll.
Missing/ambiguous CPU or wrong version is inconclusive; any known business>10ms
is not passed. Mixed/missing cells are explicit, no reliable p95 or causal CPU
subtraction across isolates. Whole invocation includes fixture guard/mock/log CPU.

Local exact-bundle tests:13 planned HTTP plus3 quota/window/expiry negative cases,
all pass. Max40reads/18writes per business request,57,344bytes local. Historical
rows unchanged. Lifecycle/adapter regression33/33; benchmark adapter2/2. New guard
counter totals reach130HTTP/1916R/849W and4SETs, rejecting extra requests/expired
window. Metadata source does not provide cloud CPU until actual invocation logs.

Do not change Workers Free, PR#7 draft, CMS/R2/Billing/production. No real Google
transport, cutover, CPU adjustment, new cloud resource or follow-up benchmark.
