# Next real transport proof and undecided revocation lease

NOT authorized/executed by the mock pilot approval. No production Firebase access,
credential, user, mirror, Rules, old writer or Function is changed. Mock CPU/control
success cannot prove real IAM, OAuth, token revocation, CAS or API quota behavior.

## Isolated Google stage proposal, approval required first

Prefer an existing EMPTY non-production Firebase test project whose ownership and
billing mode are verified. If none exists, propose ONE new isolated Firebase/GCP
project, Auth email/password provider and default Firestore Standard database, with
NO billing link/change, Functions, Hosting, Scheduler, R2, Sheets or real users.
Do not create it or upgrade to Identity Platform/Paid automatically. If console/API
requires Billing for a selected feature, STOP and present an alternative first.

Resources for approval: one project (or explicit existing empty project), one
Firestore DB, one dedicated backend service identity, one custom minimal role, four
synthetic email/password users, <=32 synthetic documents (profiles/mirrors/config),
one isolated Worker/D1 test binding if reusing dedicated pilot IDs is approved.
Choose database location/ID explicitly before creation; do not relocate any project.
No email/SMS delivery, MFA, real tenant or production account import.

Separate operator setup permissions from runtime permissions:

|Identity|Permissions/capability requested|Limits|
|---|---|---|
|Human/bootstrap operator|Create/configure isolated test project/Auth/DB/Rules/users; IAM role/SA setup only as needed|No permission on production requested; no Owner/Editor grant to runtime|
|Runtime test identity|firebaseauth.users.get, firebaseauth.users.update|Lookup exact synthetic UIDs; change claims/disabled/validSince as test requires; no user delete/import/config permissions|
|Runtime test identity|datastore.entities.get, datastore.entities.update|Exact preseeded users/mirrors; no list/query/delete/index/database/admin permissions|
|Bootstrap operator only|datastore.entities.create; firebaseauth.users.create|Preseed test rows/users; runtime create not granted initially|
|Cleanup operator, later approved|Exact test user/doc/key/project removal as separately reviewed|No wildcard delete or production target|

Preseed mirrors for renewal; test missing-mirror failure without automatically
expanding runtime permissions. If actual PATCH/upsert requires create, prove the
specific403 and review adding datastore.entities.create ONLY in the isolated project.
IAM is the privileged REST boundary; Firestore client Rules do not constrain this
service account. Document-level isolation must NOT be claimed from these project/DB
IAM permissions. Therefore an empty dedicated project is important.

Credential choices to review: (1) operator-minted short-lived OAuth token delivered
only to the isolated fixture for the run (does not test service-account JWT exchange);
(2) dedicated TEST-only RSA service-account key in Worker secret storage to test the
existing JWT/OAuth supplier. Option2 requires explicit approval of key creation,
storage, expiry/rotation and cleanup; never use a production key. WIF would require
a reviewed trust setup and compatible external identity, not an assumed capability.
No TokenCreator/keyAdmin is needed by runtime merely to sign with its own supplied
test key. Operator provisioning permissions are not a runtime role recommendation.

Explicit project injection and issuer/audience must target the test project. Current
production Firebase verifier's default project is fixed; do not accidentally use its
default in a test deployment. Supply a dedicated test-project verifier/bridge adapter
and outbound allowlist; any helium-team-d7f80 request must fail before network I/O.

Suggested caps for separate approval:4users,12role transitions,<=100Auth admin API
calls,<=400Firestore reads/200writes,<=1MiB,<=100WorkerHTTP and existing approved
D1 limits only if their UNCONSUMED budget is sufficient. These are a NEW approval
scope, not an extension hidden inside the250-request mock cap. No automated retry
beyond these counts. Check quotas, Free eligibility and currency/tax before execution.
Expected subscription increment$0 if permitted on no-Billing Firebase plan/remaining
Free limits; no invoice guarantee or promotional-credit dependency. Any requirement
for billable resources/key services is presented first, not silently enabled.

Test real ID-token issuance/refresh and issuer mismatch; preserve unrelated claims;
A->B transfer; old-version client read denial; disable user; revoke refresh tokens;
mirror CAS conflicts; prepare/commit timeout/permission failure; lease expiry; pending
retry; version-increasing rollback; denied foreign-team paths. Force refresh and
read real claims rather than trusting update API success. Verify REST Admin IAM
negative cases separately from Firestore Rules requests with client ID tokens.
No existing user's events/profile/login/session is accessed. All outputs redact
tokens, email, private keys and raw user documents.

Authoritative references checked16November2026:
https://docs.cloud.google.com/identity-platform/docs/access-control
https://docs.cloud.google.com/firestore/native/docs/security/iam
https://firebase.google.com/docs/auth/admin/manage-sessions

## Lease policy is NOT accepted by the user

Current candidate lease is5minutes. D1 pending denies new authority resolutions,
but an old active Google mirror can remain usable until the lease expires if
invalidation fails. Already authorized/in-flight writes cannot be retroactively
undone. Revoking Firebase refresh tokens alone does NOT instantly invalidate an
already issued ID token wherever revocation is not checked; ID tokens last about1h.

|Option|Security window|Availability and usage impact|Status|
|---|---|---|---|
|Keep5minute lease|Up to5min residual old privilege during invalidation outage|Fewer forced refreshes; staff idle>5min must renew; renewal failure denies after expiry|Current candidate only; NOT accepted|
|Shorten to30–60seconds|Bounds residual window to shorter TTL; not zero|More renewal traffic/cost and sensitivity to network delay, clock skew, sleeping tabs; fail closed on expiry|Requires a policy choice and load/UX tests|
|Mirror-first durable revocation barrier|Do not report revocation complete until old mirror is pending/denied and current D1 state/projections reconcile|When Google unreachable, show revocation pending and disable further staff changes; cannot promise immediate global revoke before remote acknowledgement|Requires explicit saga redesign; avoid stating two databases are atomic|
|Per-operation current authority through a trusted gateway|Recheck D1 role/version for every privileged action; no cached grants for NEW actions after committed revocation|Adds network/CPU and fail-closed outage dependency; direct privileged Firestore client reads/writes must be removed or use stronger synchronized deny state|Larger architecture change, not covered by mock pilot|
|Emergency disable/revoke sessions plus mirror deny|Reduces token refresh ability and closes enforced mirror paths when acknowledged|Can sign users out; all endpoints must check revocation/current mirror; old JWT alone is insufficient proof of immediate revoke|Supplemental response, not a replacement for a policy|

Do not use a fail-open cached-role fallback to improve availability. Do not disable
mirror enforcement early during rollback: it can resurrect still-valid old admin
tokens. Restore baseline privileges with NEW versions, reconcile all projections,
test owner recovery and wait/revoke old sessions under the policy chosen before
considering any switch back. Lease renewal frequency should be costed against real
staff traffic; no policy is deployed or implicitly accepted by approving the pilot.
