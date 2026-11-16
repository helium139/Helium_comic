# Free-only migration candidate — not deployed

Production A remains the only writer. Workers/D1 **Free** are required. No Paid,
Billing, subscription or existing R2 change is proposed. Never recreate retired push
or health Functions. Frontend defaults and Google writer remain Google.

Implemented: Firebase RS256 JWT/App Check; backend OAuth supplier; D1 current team
authority; leased, versioned role synchronization; Firestore update-time mirror CAS;
CMS and retained Google guards; opt-in strict Firestore Rules; callable transport
and claim refresh; signed old-tab Start/Record bridge preserving trusted identity/IP;
immutable D1 events, A-compatible HMAC dedup, exact rolling limits and atomic receipts;
analytics/monthly snapshots; Sheets creation intent, retry/lease/uncertain recovery;
bounded hash-sealed import and epoch rollback; idempotent injected Google replay.

Restore suppresses Start triggers atomically, preserving original rate history.
No D1 eight-aggregate copy, ledger deletion or fraud relaxation is used. Reports
over200 team/manga groups or128KiB fail explicitly, never truncate. Those local
guards do not prove10ms cloud CPU. Roles synchronize as a cross-provider saga,
not a distributed transaction. Pending denies D1 access; strict Rules lease limits
previous staff privilege to5minutes ONLY after all legacy guards/Rules are deployed.

Run npm ci in functions and worker, then the local-only PR workflow
`.github/workflows/verify-cloudflare-migration.yml`. Miniflare is lockfile-pinned.
Tests use synthetic identities, D1, demo Firestore and mocked OAuth/Sheets only.

**NO-GO full Free cutover:** daily write headroom, lifetime analytics scans, growing
500MB ledger and unmeasured cloud CPU block approval. Both restore checkpoint and
expiring per-feature capacity evidence are required; committed allowlist is empty.
See `docs/cloudflare-free-migration-review.md` for measurements, assumptions, retained
Google alternative, remaining operational tooling and staged rollback requirements.
No cloud resource, IAM/key, backup/import or production deployment was performed.
