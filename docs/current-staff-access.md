# Current Google staff access — review only

Branch starts at main 4955c7ca. No source from migration PR #7. No deployment,
cloud benchmark, production identity changes, new resource, subscription or Billing
change is part of this PR. Workers stays Free; R2 configuration stays unchanged.

## Contract and scope

First batch supports one leader per team, with authority over ALL of that team's
manga: create/edit/delete, upload/publish and moderation. No member/uploader or
per-person manga assignment is added. Admin retains cross-team management.

`staffAccess/{uid}` is the current Google Firestore grant, not a client profile:
`{state: pending|active, role, teamId: string|null, version: positive integer,
operationId, updatedAt}`. JWT role/teamId/accessVersion must match an active row.
Missing row/version, pending, superseded token and read outage all fail closed.
There is no legacy fallback or permission cache. A JWT can still be valid as an
identity token while no longer authorizing any staff action.

All eight CMS mutation routes check a fresh row before touching R2/GitHub. All
three catalogue save paths additionally recheck just before GitHub PUT. Worker
reads only the caller's own row with their Firebase ID token via Firestore REST;
no Google OAuth signing, service account, secret or extra Worker endpoint is used.
The ID token and authority response are never logged. Response is bounded to 8KiB,
request/body lifetime uses a 5-second abort signal, redirects are rejected, no
application retry. JWKS caching still caches public signing keys only, not grants.

Callables guarded: setUserAccess; getChapterViewAnalytics; all four interactive
monthly dashboard/history/generate/retry endpoints; moderation; and comment
operations presenting staff claims (including personalized canModerate). Readers
and guest comments retain their existing contract. Firestore Rules use the same
live grant/version for staff reads; only own authority get is exposed, not list
or writes. State/operation/audit/leader-slot writes are Admin-SDK only.

Start/Record accounting, event/aggregate code, rates/dedup and historical
ownership are unchanged. Scheduled reporting has no user JWT and keeps its
trusted scheduler identity. No push/health exports are recreated.

## Revocation semantics and limits

The revocation point is the successful Firestore transaction changing the target
row to pending. Subsequent checks cannot authorize the previous JWT, even while
Auth/profile synchronization is incomplete. Successful completion activates a
new version; user must refresh/re-authenticate to acquire a matching token.

No positive grant cache: permission-cache stale window is ZERO after that commit.
This does not cancel already admitted/in-flight requests or provide a transaction
across Firestore, GitHub and R2. An operation may finish between its last check and
an external service committing. The pre-catalogue recheck narrows that interval;
the next request is always checked anew. A denied publish may leave unreferenced
staging/final objects for safe recovery, never permission to overwrite another team.

Current grant changes MUST use this protocol. Direct Firebase Console/Admin SDK
claim edits, disabling an Auth account or revokeRefreshTokens alone are NOT a
substitute for fencing staffAccess; an already issued token may still pass its
identity checks. For staff suspension, first change role to user through this
protocol, then perform any separately approved Auth account operation. No online
Auth-status lookup on every CMS request is added or claimed by this PR. IAM
operators remain trusted. Legacy direct bootstrap/admin/leader writer scripts now
exit without initializing Firebase, to prevent accidental bypass of the barrier.

## setUserAccess protocol / recovery

Payload now requires uid, role, optional teamId only for leader, UUIDv4 requestId,
and expectedVersion (0 for a target without an authority row). Persist the exact
payload/requestId before calling. Use an active versioned admin; leaders cannot
provision anyone. Self changes require another admin to avoid self-recovery lockout.
Team must exist and be active in the published registry. One leader slot per team
is reserved/released transactionally with the fence; revoke the existing leader
before appointing another. A pending grant reserves its destination slot.

1. Check caller, registry and target Auth user existence. Failures before the fence
   throw a typed error; no success is reported. A network-lost response still means
   inspect/retry the SAME request, not assume it was never submitted.
2. Transaction rechecks caller and expected version, creates pending operation and
   fences target, changes leader slots. Concurrent conflicting requests abort.
3. A cooperative 120s execution lease admits only the current synchronizer. A
   duplicate while leased returns pending without another claims mutation.
4. Recheck caller and lease; update claims, check lease again, merge profile;
   read back Auth ACK; transaction checks current caller, target, lease and profile.
5. Only then activate authority and atomically complete operation plus one audit
   receipt. Existing unrelated claims/profile fields are preserved.

Responses:
- `{ok:true,status:'complete',current:true,accessVersion,requestId}`: ACK and profile
  matched the active grant at completion. Retry of the same completed request
  verifies them again, without another Auth/profile write.
- `{ok:false,status:'pending',retryAfterMs,...}`: incomplete/unknown outcome. Target
  has no staff authorization. After indicated lease, retry identical payload/ID
  from an active admin. Same operation keeps its version and audit identity.
- `superseded`: historical completed request is not the latest grant; never undo
  the later assignment by replaying it.
- `inconsistent`: historical receipt's projection no longer matches. No success
  claim. Inspect current authority/operation and use a NEW requestId with the
  current expectedVersion to repair to the explicitly reviewed desired grant.

The 120s lease is NOT an old-permission lease and not proof a timed-out external
RPC ended. No global atomicity is promised for Firebase Auth + Firestore. A very
late old Auth RPC can overwrite claims after recovery; the old version still
cannot authorize against newer authority, and the old synchronizer cannot publish
an active grant or overwrite the newer profile after its lease check fails.
Such drift can cause temporary unavailability and needs repair, not automatic
restoration of the previous grant. Fault tests cover this exact case.

If admin A is revoked mid-sync, final activation is denied; another active admin
can recover the same request after the lease. If all versioned admins are lost,
use a separately approved IAM operator repair under staff maintenance. No public
bootstrap bypass or automatic scheduler is added. Pending operations have no TTL
that silently reactivates rights; inspect individual known UID/operation records.
Do not delete audit/operation records to make a retry appear new.

## Workers Free and incremental cost

No cloud CPU measurement in this PR. Local timing/bundle size is not a CPU pass.
Existing JWT RS256 verification remains. Added Worker work is one bounded JSON
document read/check (two for a catalogue commit); no registry scan, OAuth signing,
image transformation or new per-read Google Function. Outage denies writes rather
than using cached rights.

| Operation | Extra Firestore reads / external subrequests | Extra incoming Worker requests |
|---|---:|---:|
| Image upload / rename | 1 | 0 |
| Catalogue mutation completing normally | 2 | 0 |
| Denied mutation at entrance | <=1 | 0 |
| Staff callable | 1 authority read | 0 |
| Direct staff Firestore access | Dependent Rule document read; include billed denied evaluations | 0 |

Four teams x5 chapters/day x30 images x0.8MiB -> 600 uploads +20 publishes:
640 authority reads/day; 2x ->1,280. Add 25% for retry/edit allowance ->800/1,600
reads/day (24k/48k per 30 days), excluding dashboard/admin usage. At the SAVED
Nov16 EUR0.000000331/read unit rate, this alone is about EUR0.00794/0.01589 gross
per 30 days before shared allowances/tax. This is NOT an invoice or full project
cost forecast: Function wait/compute, Rule-dependent reads, network, account usage
and current prices are not measured here. An ordinary access change uses up to
13 document reads and 8 writes (two slot documents), plus 3 Auth lookups +1 claims
write, absent transaction/SDK retries. Recovery may repeat RPCs; completed receipt
verification adds reads but never silently skips the ACK check.

Firestore subrequests do NOT create incoming Worker requests, and another Worker
does not create more account quota. Previous planning total 31,240/day normal and
62,480/day stress remains an assumption, not measured current usage/headroom.
Target account <=70k/day; Free limit 100k/day, CPU 10ms/request, memory128MB.
The extra authority call adds network latency; latency is not CPU. Existing CMS
image hashing/catalogue work, true-cold JWT/JWKS and large concurrent publishing
remain unmeasured. Do not claim Free readiness from this local patch.

Local esbuild 0.28.2 browser bundle: 81,792 bytes, 20,995 gzip (source at build).
No migration runtime was bundled; only this branch source and jose. Reproducible
command with that tool version:
`esbuild ./worker/source/worker.js --bundle --format=esm --platform=browser --target=es2022 --outfile=.local-cms-build/worker.mjs`.
No Wrangler deploy, cloud traffic or new resource was used. If later approved,
the smallest isolated real-transport check needs its own explicit workload and
budget: matching invocation CPU for cold/warm upload/publish/denied paths, actual
Firestore rules transport, representative image/catalogue payloads. Missing CPU
traces or >=10ms branch => no Free pass; no automatic Paid upgrade.

## CMS live source/version export (no secrets)

Before any rollout, in Cloudflare dashboard Workers & Pages > helium-cms:
1. Record active deployment ID, version ID, timestamp and traffic allocation.
2. Open Edit code for THAT active version, export/download source modules or copy
   code files only. Do not publish, save changes, export bindings/env values or
   send any token/key. Keep screenshot metadata without account identity as needed.
3. Hash the original exported bytes (Get-FileHash -Algorithm SHA256), retain the
   version metadata alongside. Exporting code does not export IAM credentials.
4. Compare modules with the corresponding repository release. If deployment is
   bundled/minified, reproduce its exact tool version/options and compare bundle
   hash to the build artifact. Do not claim source equality from a version label,
   symbol-name search or a successful Pages run alone. Unknown build provenance
   remains an explicit rollout blocker; no extra CMS credential is requested.
5. After a separately authorized release, record candidate commit, artifact hash
   and new active version/traffic; use the same export comparison. No public health
   endpoint or pilot needs to be opened for this offline comparison.

## Release preparation — not authorized to execute

This is deliberately fail closed and cannot be dropped into production without
staff bootstrap. Existing unversioned tokens will be denied after guards activate.
Plan an approved staff-only maintenance window; keep old unguarded CMS unavailable
through the mixed-version interval, without touching R2 or public view accounting.
Inventory only known staff UIDs (no user/event scan), reconcile actual claims and
profiles and one leader/team, and prepare an explicit operator-reviewed bootstrap
manifest. First admin needs an IAM operator to seed pending state, matching
versioned claims/profile, verify ACK and activate it; no runtime self-bootstrap.
The PR does not include or execute a production bootstrap writer.

Deploy guarded Google adapters/Rules and verified CMS artifact only after that
release package and permissions are approved. Complete bootstrap of existing staff,
refresh sessions, verify stale-token denials on every surface and only then reopen
staff editing. Do not add real team accounts as part of this PR. Rules changes
must be deployed explicitly; Pages workflow does not deploy them or CMS/Functions.

Rollback must keep the new authority fence effective. Do not restore unguarded CMS
or old Rules to regain availability. Close staff writes, retain pending/operation/
audit records, repair or deploy the last guarded version; public reading/view ledger
continues unchanged. Do not decrement versions, delete financial events or move
historical team revenue. Keep Firebase Auth/Firestore and all other Functions.

## Tests

- Real signed JWT Worker fixtures: old tab/token denied on all 8 mutation routes,
  team move needs new matching version, pre-commit revoke blocks catalogue PUT,
  two current leaders upload/publish concurrently with safe CAS conflict/retry.
- Access service: pending fence, claims ACK loss, profile failure, final commit
  failure, retry lock/idempotency, stale operator, unknown/inactive team, no member,
  one leader slot, completed/superseded/inconsistent receipts, late Auth completion.
- All staff callable adapters reject stale authority before accounting/moderation
  reads. Public Start/Record accounting code remains unchanged.
- Actual Firestore emulator: live state/Rules deny old JWT context immediately
  after pending and after transfer/revoke; own state readable, list/other state/
  writes/audit/slot forgery denied; real transaction recovery and slot contention.
- Existing view/comment/monthly report suites and a historical ownership transfer
  regression verify no event/aggregate reassignment. No production data is used.

Local validation completed: 187/187 regression tests, 27/27 emulator tests,
then 2/2 current-access/Rules emulator tests after the final lease checks;
Functions lint and browser bundle pass. Windows CRLF fixtures were normalized
locally to the LF used by CI; reading/follow production source has no Git diff.
No cloud CPU, live CMS export or real Auth transport pilot was run.

References:
- https://firebase.google.com/docs/firestore/use-rest-api
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/firestore/pricing
- https://developers.cloudflare.com/workers/platform/limits/
