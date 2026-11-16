# Approved isolated authority pilot — blocked before resource creation

User approved one Workers Free service and one D1 Free, with synthetic data and
Google transport mock; no R2, production route, Firebase credential or production
guard deployment. This approval persists; it is conditional on verified identity,
plan and remaining shared quota. PR7 stays DRAFT. View/accounting expansion paused.

## Fresh prerequisite result, not a repeated audit

16 November2026 16:14:57UTC: cached account matched the user-provided account ending
1a908c95a2. GET account metadata returned403/code9109. Stopped after ONE read request;
no login refresh, further account API query, creation, deployment or deletion.
This result establishes insufficient access for verification, not proof that the
account is Paid, the token expired, or quota is available. Evidence:
migration-evidence/authority-pilot-preflight.json. Account/Free/quota remain unknown.

Required dashboard text, timestamped on the same UTC day before creation:
- account ID/suffix and Workers Free active;
- account-wide Workers requests today, not monthly lifetime snapshot;
- account-wide D1 rows read/written today, total stored bytes and DB count;
- remaining Workers Logs allowance if used for CPU traces (fixture logs only).
The existing2990requests/68520CPU-ms snapshot has unknown time window and cannot
substitute. Need at least250 HTTP,5000reads,2000writes and1MiB storage headroom,
plus agreed allowance for concurrent account traffic. Deployment credentials also
need working narrowly scoped Workers/D1 permissions; no token is to be pasted in
chat/Git/logs. Failure remains a stop condition; never upgrade Paid or change R2.

## Measurement package and limits

Proposed dedicated names: helium-authority-fixture-20261116 for BOTH Worker and D1,
each with its own resource ID recorded before further calls. This task created no
resource; existing inventory/name collisions remain unverified because preflight failed.
No domain/production route/Cron/R2/production service binding. Public workers.dev
endpoint, if created, must require an ephemeral fixture-only secret before any
expensive work, plus synthetic RSA identity validation. No real Google transport.

scripts/authority-pilot/control.mjs is a transport-injected measurement CLIENT,
not a provisioning CLI or a complete deployed fixture backend. It requires exact
approved fixture hostname, <=48 unique workload cases, per-request journal before
send,64read/32write reservation, and confirmed D1 metadata/physical DB bytes. Initial
reserve50HTTP/64reads/128writes covers the preflight/control/setup/log reads;48 worst
case workloads consume<=98HTTP/3136reads/1664writes overall before unused reservations
are released. The entire run still has hard250HTTP/5000reads/2000writes/1MiB bounds.
No hidden automatic retries; lost/missing metrics retain the full reservation and
stop. Failed/OPTIONS requests count too; any added diagnostic must first reserve.
An in-memory client cap is NOT protection against arbitrary third-party traffic or
accidental process restart. A future executable adapter must reload/refuse an existing
journal, guard the fixture endpoint, and implement/persist server-side bounded state
before run. Do not call this client a completed cloud pilot or infer a global cap.

Workload allocation within48 cases:12key-cold resolve,16warm resolve,12set/access
validation cases (no more12effective transitions),4denied/oversized cases,4OPTIONS.
Set cases include A->B transfer, stale claims, revoked leader, foreign-team denial,
regrant, last-admin protection, pending failure/retry, monotonic rollback and owner
recovery. Vary200-team registry/64KiB, legal2048-character body and oversized rejection.
Synthetic OAuth supplier must actually perform RS256 key import/signing while its
fetch is injected mock; a precomputed access-token stub would miss cold CPU cost.
Do not load credentials for helium-team-d7f80, Sheets, existing CMS or R2.

Actual cold means FIRST observed request for an isolate tag; it cannot be forced
by a query parameter. forced-key-cold separately resets fixture crypto/JWK/OAuth
caches and is not mislabeled isolate startup. Record operation, actual isolate-first,
forced-key case, latency, read/write deltas including index/fixture overhead, physical
size, errors, CF correlation and vendor CPU PER REQUEST. No ID tokens/secrets/body
are recorded. Join CPU from Cloudflare invocation logs by pilotCase ID; keep null
when missing. Group resolve/set x first/warm x crypto case, publish counts/p50/p95,
including tiny-sample caveat. Targetp95<=7ms, observed max<=10ms, zero exceededCpu,
unexpected errors, correctness or quota failures. No broad go with missing genuine
cold/large-payload samples. Mock pass never proves Google IAM/OAuth real behavior.

Cloudflare documents invocation CPU/wall times and Workers Logs Free200k events/day,
3-day retention as of16November. Use <=1000 fixture log events, not production logs;
verify remaining allowance and recheck pricing if execution is deferred beyond the
documented1December2026 change. No Logpush/Tail Worker/Paid feature is required.
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/workers/observability/logs/workers-logs/

Dependency check: scripts/authority-pilot/import-graph.mjs finds no view schema/service
or SQL rate-history code reachable from authority-runtime. Its large JSON paths are
team registry and callable/Auth claim JSON, not the10000-entry view rate arrays.
New local tests cover64KiB/200teams and2048/2049 boundaries; a10000-item injected
rateHistory payload is rejected before authority resolution. This is not a cloud
CPU result and does not reopen the paused view/accounting project.
The registry cap now checks actual UTF-8 bytes, not JavaScript character count;
a multibyte JSON fixture below65536characters but above64KiB is correctly rejected.
This candidate-only guard change is locally tested, not deployed.

## Results and cleanup inventory

|Item|Result|
|---|---|
|Cloud pilot invocations|0|
|Worker/D1 resources created|0/0|
|Pilot D1 reads/writes/storage|0/0/0|
|Cloud CPU/latency/correctness result|Not measured; blocked prerequisites|
|Read-only account prerequisite|1request,403/code9109|
|New local controller/import/JSON tests|3passed|
|Free decision|INCONCLUSIVE/BLOCKED, neither pass nor measured no-go|

No cloud cleanup is needed now. After any future run, record exact account, Worker
name/version/ID, D1 ID and synthetic data rows, fixture-only secret and remaining logs.
Before cleanup confirm these IDs are dedicated and preserve sanitized measurement
evidence. Proposed commands, NOT run:

    npx wrangler delete --name helium-authority-fixture-20261116
    npx wrangler d1 delete helium-authority-fixture-20261116

Review exact IDs before executing. Never delete shared DBs, domains, R2, Google users,
existing Workers or other credentials. Cloudflare retained invocation logs may remain
until their Free retention expiry; destroying a Worker is not proof of log erasure.
Real Google stage below needs separate approval even if this pilot eventually passes.
