# B — View/accounting Free design review (supersedes prior single-point sizing)

No production migration/telemetry/audit was performed. Google is the current writer,
not an accepted final architecture. This review does not conclude that every possible
Free architecture is impossible; the current exact D1 design is not cleared for Free.

## Operations and bounded rate limits

Current service uses INSERT/UPDATE RETURNING, removing the trailing receipt SELECT
for new Start and newly consumed Record. Main path goes3->2queries per operation
(including initial config/receipt lookup); concurrent/replayed paths still read the
committed receipt. Local rows_read did NOT decrease: SQLite counts RETURNING work.
Start replay reads4->5 in the small fixture. This is query reduction, not claimed CPU
or written-row savings. Replay, lost response, transaction failure and import tests
were rerun because service code changed; unchanged browser/audit tests were not.

Measured accepted write decomposition is unchanged:

|Operation|Guest|Authenticated|
|---|---:|---:|
|Start: session + device/account/network rate rows|3|4|
|Accepted Record: receipt1 + event/month-index2 + dedup + rate rows|6|8|
|Duplicate Record|1|1|
|Consumed replay|0|0|

D1 metadata already includes triggers and index maintenance. No extra multiplier
for event_month; no duplicate PK index on WITHOUT ROWID tables. event_month supports
monthly exports/analytics; it is not redundant. No epoch index was added. Transfer
mode writes are import-only, not a per-view cost. No removable temporary event table.
The two receipt dedup fields feed the atomic trigger; clearing them in another UPDATE
would ADD a write. No revenue/fraud data was removed.

Start's former json_each/full sort was already replaced with indexed identity
lookups and binary insertion in canonical sorted arrays. Three10000-entry histories,
all reordered, now measure60 rows/2queries; exact newest10000 timestamps match a full
reference sort. Test asserts <=128 rows for this fixture. <=15 binary steps/key and
three keys bound recursive SQL work; there is no full SQL row expansion. Arrays are
schema-bounded10000 (policy upper limit), but JSON parsing/string copy is still up to
hundreds of KiB and may fail10ms cloud CPU. Low rows_read is NOT a CPU guarantee.

Further options, not silently enabled:

- Reuse stable rate/dedup keys until their real expiry; delete only actual expired
  keys. This already occurs on upsert. Counting a rate deletion for EVERY Start and
  Record exaggerates steady-state cleanup if identities are reused.
- Pair Start/accepted histories in one row per identity, keeping separate exact
  arrays/limits. This can reduce rate storage/cleanup, not the foreground writes per
  identity. Network changes and guest->login transitions mean overlap is not assured.
  A schema/import/rollback rewrite is not justified as a claimed2x quota solution.
- A stateless Start ticket alone loses exact Start rate limits and durable request
  replay semantics. A global giant rate row adds a hot bottleneck/size/CPU problem.
  Neither is accepted as a correctness-preserving Free solution without proof.

## Revised sizing and account remainder

Saved post-A S6916/R3287 is the heavier deployment-aligned24h window, NOT true UTC
peak. HTTP200 is not accepted. Auth and outcome mix are unknown. Define accepted A,
authenticated Start share pS, authenticated accepted share pA:

`foreground = (3+pS)*S + R + (5+2*pA)*A`

This conservatively treats each Start as unique and each non-replay Record as a
receipt write; request retries/replays can be cheaper. Index/trigger writes included.
Add UNIQUE session deletion S; actual expired rate keys Cr; expired dedup keys Cd:

`lifecycle = foreground + S + Cr + Cd`

Upper planning bounds: Cr<=(2+pS)S+(2+pA)A; Cd<=(1+pA)A. Lower bound excludes BOTH
rate/dedup deletes; it is an optimistic bound, NOT a proposed cleanup policy or
proof that indefinite transient retention fits storage. Active key reuse may make
deletion infrequent; abandoned keys still must be cleaned and cost writes.

|All Record accepted; auth assumption|Current lower–upper writes/day|2x lower–upper|
|---|---:|---:|
|Guest-only lifecycle|47386–71079|94772–142158|
|Guest + assumed5000 reserve +1 snapshot|52387–76080|99773–147159|
|Auth-only lifecycle|60876–98059|121752–196118|
|Auth + same assumed reserve|65877–103060|126753–201119|

Reserve is not measured account usage. Lower/upper differ by key churn, not reduced
accepted views or weaker fraud rules. New script review-free-sizing.mjs accepts
separate pS/pA, accepted count and ACTUAL expired-key counts; unknown shared reads/
writes are null, not fabricated0. Output: migration-evidence/refined-sizing.json.

Against100k writes/day, remaining budget after assumed reserve is23920–47613 current
guest, -3060–34123 current auth;2x guest -47159–227,2x auth -101119–-26753. Deduct
measured shared usage IN ADDITION unless it replaces the assumed reserve. Therefore
current traffic might fit with real mix/reuse, but is not proved. Fully authenticated
2x foreground ALONE107920 exceeds100k before any cleanup/report/archive. Guest2x
optimistic lifecycle leaves5228 before reserve,227 after reserve: no growth margin.
At equal Start/accepted auth share,2x optimistic sizing with reserve permits only
~0.84% authenticated share. This is sensitivity, not observed mix.

Account-wide requests: view18773/37546 including preflight; pessimistically adding
all reported2990 existing Worker requests on the same day yields21763/40536. Other
APIs/bots/retries and UTC peak unknown. Prior read envelope2.28–2.40M /4.06–4.30M
is planning only and excludes new per-API gate reads/lifetime scan growth. No account
D1 daily readings were verified; real remaining read/write allowance is UNKNOWN.
No production telemetry was installed to obtain mix.

## Large ledger, exact analytics and report design

archive-local.mjs is an OFFLINE reference with injected private immutable object
store; no R2 client/bucket or Worker HTTP binding. It streams <=100events/segment,
rejects objects>256KiB, creates content-addressed segments + linked manifests of20
refs and an HMAC seal. Source must be frozen and PK-ordered; verifier checks global
ordering/duplicates, hashes, signature, segment counts and per-scope totals BEFORE
restore callbacks. Restore does a second bounded-memory pass. Failure never deletes
source ledger. Synthetic2101 events:22segments/2manifests,463529bytes, exact scope
report parity, corrupt object rejected before any restore callback, repeat identical.
An additional55 full-schema events restore through <=20-row batches into a fresh
local D1, including the month index; repeating the restore leaves55 events and
matching reconciled totals. No production data or database was used.

Cloud implementation would need a frozen closed partition, resumable cursors,
per-step CPU proof and private storage. Merely selecting a timestamp/high-water ID
from a mutable month is NOT a complete snapshot. Keep ledger copies until source,
seal, independent readback, report reconciliation and restore have all passed.
No D1 compaction or canonical ledger removal is implemented/authorized. Archiving
without removing D1 copies cannot solve growing500MB storage. This is a real blocker
for unbounded retention, not permission to delete revenue history.

Proposed scalable reports: exact atomic per-(month,team,manga,chapter) compact
rollup updated alongside ledger (one additional write/accepted event, no extra index
with WITHOUT ROWID composite PK); seal closed-month snapshot pages<=100groups and
hash-chain them; incremental Sheets fill by page/fileID checkpoint. Derive site/team/
manga totals by bounded merge of those pages, not repeated lifetime ledger scans.
All-time reports merge verified closed-month pages plus live exact current rollup;
never show a partial merge as complete. No approximate counter or8aggregate copy.

This design adds A writes/day plus checkpoint/snapshot rows; at all accepted the
current schema's2x auth foreground would increase107920->114494. It improves reads
but worsens the binding write constraint. Scope cardinality, concurrent snapshot
freeze, real Sheets batching and Worker10ms remain unproved. Existing inline report
guard200groups/128KiB is a refusal limit, NOT feature parity for larger reports.
The scalable design is not falsely marked implemented by the archive reference.

## R2/cleanup cost, not shifted-away cost

Existing image R2 stays untouched. Any private ledger destination needs separate
approval; public image buckets must not expose ledger/UID hashes. Standard pricing:
https://developers.cloudflare.com/r2/pricing/ . No new subscription under Workers
Free; R2 usage is still counted separately and credits are excluded.

Conservative source page50events (<=100 cap; wider rows may require smaller pages),
20segment refs/manifest: at3287accepted/day about66segments+4manifests+1seal =71
Class A/day;2x132+7+1=140. Two full verification reads cost141/279 Class B/day.
Returning a seal is not a stored durable copy: operator must privately store it,
which is INCLUDED in these object/operation counts. Restore adds another two full
read passes only when used. Failed retries/manifest probes add operations; immutable
same-key retry does not justify counting a PUT as free. No R2 DELETE assumed.

Planning1KiB/event plus30% manifests/partial totals:~1.60GB/year current,3.19GB/year2x,
~$0.024/$0.048 incremental monthly storage at year end at$0.015/GB-month plus rounding.
These are assumptions, NOT compression savings or measured real ledger size. With
reported existing19.56GB storage,5.46k A/2.9M B monthly, archive operations would
remain inside1M A/10M B IF those are complete monthly shared totals. Monthly storage
~$0.15 existing + archive increment, billed rounding may add another$0.015 step.
Other buckets, average GB-month, billing period and VAT are unverified. At2x image
operations5.8M B would still fit the10M allowance under the same assumption; traffic
doubling does not necessarily double stored images. No R2 setting was changed.

D1 archive source reads roughly N plus bounded cursor probes, and independent
report reconciliation scans/rollups are extra. Resumable export checkpoint design
may add up to2writes/50events (~132/264writes/day current/2x), before close/snapshot
work; this is not included as proven by the old1snapshot sizing. Delete/copy GC,
if ever designed and authorized, costs additional rows/index writes and proof steps.

**B decision:** still NO-GO for full current design on Free with required2x safety,
unbounded accurate retention and large-report parity. Not proved impossible for
every architecture/current mix. Blocking requirements are precisely:100k shared
writes under authenticated2x;500MB finite online ledger without verified tiering;
exact large analytics/report completion under daily reads and10ms CPU; unverified
account headroom/outcome mix. A different authoritative storage/write layout and
incremental archive/report design need proof; neither Paid nor retaining Google is
silently chosen as the final solution. No more broad porting is warranted merely
to fit quota; independent multi-team pilot can be reviewed without that decision.
