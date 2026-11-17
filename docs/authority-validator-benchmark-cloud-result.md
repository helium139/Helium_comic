# Validator CPU session result — stopped after approved samples

Bundle SHA256:
`d050726262729ecf87cfbafd8dacfbf3cc391e2dff0d738d6a83d05d76dadaf5`

Runtime version V=`56d3d85c-3c80-401b-9a5e-4095ad3687bf`.
Both CI checks for3c21bc8f passed before execution. PR#7 remains draft.

## Decision

This instrumented validator session did NOT meet the10ms business criterion:
resolve-warmup-0 recorded20ms and resolve-warmup-1 recorded11ms, both provider
outcomeok. Another warm resolve recorded8ms. Only3/13 invocation CPU traces were
returned, so SET/key-cold CPU and the complete latency/CPU distribution remain
undetermined. This is not a claim that every Workers Free design is impossible.
No p95 or exact component CPU attribution is computed.

One completed logs query returned6events (3 invocation +3 application-log events),
not13 invocation traces. Query completed, limit100 not reached. The cause of absent
records is NOT established; no second query, poll or compensating workload ran.
Missing CPU is null, never0 and never substituted with client latency.

## Every sample

Provider outcome shown only when an invocation event exists. Vbody means readiness
returned runtime version; V means provider invocation version. All cases were the
same application isolate S=fcf66da4-1656-4529-9a7b-b5601f731726. Readiness has
isolateFirst:true; EVERY business sample hasfalse. Thus no true-cold business
sample was obtained. Key-cold is explicit key/OAuth cache eviction on warm S.

| Case | HTTP/provider outcome | cpuTimeMs | Client latency ms | Version evidence | Cold/warm evidence |
|---|---|---:|---:|---|---|
| readiness |200/— |— |213.9 |Vbody |First S, not business CPU |
| resolve-warmup-0 |200/ok |20 |352.9 |V |S warm; first OAuth import/sign/mock exchange |
| resolve-warmup-1 |200/ok |11 |352.8 |V |S warm, keys/token cached |
| resolve-warm-0 |200/— |— |321.6 |— |S warm |
| resolve-warm-1 |200/— |— |325.1 |— |S warm |
| resolve-warm-2 |200/ok |8 |338.9 |V |S warm |
| resolve-keycold-0 |200/— |— |372.1 |— |S warm; forced key-cache cold |
| resolve-keycold-1 |200/— |— |326.7 |— |S warm; forced key-cache cold |
| resolve-keycold-2 |200/— |— |349.5 |— |S warm; forced key-cache cold |
| set-registry-first |200/— |— |1209.7 |— |S/keys warm; first registry load |
| set-warm-1 |200/— |— |1190.3 |— |S warm, no key reset |
| set-keycold |200/— |— |1092.3 |— |S warm; forced key-cache cold |
| set-warm-2 |200/— |— |1107.7 |— |S warm, no key reset |

All business responses passed result/role/version assertions. Missing provider
version evidence above does not deny the HTTP/isolate evidence: active version
and readiness identity match V, and all app responses share S. It specifically
means the matching CPU invocation event is absent. No latency was used as CPU.

## Branch implicated, without over-attribution

Both known failures are getCurrentAccess/resolve, not SET. First warmup is the
first business use after JWT-only readiness and has4 Google-mock calls, including
initial OAuth PKCS8 import/sign/token exchange. Next warmup has3 mock calls and
still records11ms. Resolve uses13 metadata reads/3writes per request including
session reservation/gate, durable mock projection and final controller write.
These distinguish execution paths but do not numerically isolate CPU components.
JWT verification and OAuth signing remained, with no production Google call.
The new session guard namespace adds instrumentation relative to old fixtures;
there is no matched same-isolate/cache A/B claim against earlier pilot CPU.

## Correctness / boundaries

Preflight confirmed old SET8/12, leader4/team a, owner1/admin,8 audit rows and all
active. Exactly13HTTP/12business/4SET attempts, no retry, no new sample to fill gaps.
Business finished7,633ms after readiness, below30s. New15-minute guard was not
extended; old fixture_budget and migration_gate were byte-equivalent before/after.
Leader a→b→a→b→a, version4→8; claims and mirror both8/active. Audit8→16 immutable
rows. Historical journals all hash-match. Cumulative SET8old+4new=12, no reset.

finally disabled Worker endpoint and independently GET-verified bothfalse at
2026-11-17T06:24:36.111Z UTC. Existing Worker/D1 and new session table retained;
request window expired normally. No additional cloud action after logs.

## Budget / measured usage

| Item | Result |
|---|---:|
| New control calls |10, cleanup spare2 unused |
| Control cumulative |71/73 |
| HTTP cumulative issued |128/250 |
| HTTP conservative incl spare |130/250 |
| New measured D1 metadata |333reads/99writes |
| Known cumulative measured metadata |911reads/311writes, historical gaps still unknown |
| Retained cumulative ceiling |1916reads/849writes |
| Database actual |61,440bytes/1MiB |

New business metadata264R/96W plus admin69R/3W. Index work is already included;
no additional manual multiplier. Held ceilings are not measured usage or invoices.
The logs query backend reports1,256,556scan rows/26,680,960bytes: these are Workers
Logs analytics backend statistics, NOT D1 reads or HTTP requests, and are not used
as a cost estimate. No historical reservation was refunded, including prior
unresolved requests. Pilot counters span dates; they are not measured account-wide
daily Free headroom.

Workers Free, production A, CMS/R2, Billing, other Google Functions unchanged.
Only existing isolated Worker/D1 used; new session table is fixture guard data.
No real Google transport, cutover, CPU/config change or further benchmark.
Stop at these results.
