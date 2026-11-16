# View/team migration — local implementation, not deployed

The former$5/Free-only constraint is superseded. Google Auth, profiles, follows,
history, comments and popularity remain. This package is isolated from the current
CMS Worker and frontend routing. Production A remains the only writer.

Implemented here:

- D1 sessions/immutable ledger/dedup and bounded rate-limit insertion, copied from
  the verified prototype without its local-demo HTTP entry point.
- Callable-compatible view, staff analytics with child pagination and monthly
  dashboard routes, report history/generate/retry, and internal scheduled close.
- D1 report leases, bounded automatic retries3/manual20, immutable snapshots/audit,
  durable Google create intent and uncertain-create recovery. Reuses the existing
  private Drive/Sheets adapter; no OAuth values enter client payloads.
- Current D1 authority and versioned pending->active access synchronization,
  last-admin protection, retry3 ceiling and server-side role/team validation.
- Google Auth/Firestore REST bridge with injected backend OAuth supplier. It
  preserves unrelated claims/profile fields; never reads or logs push token data.
- Both an explicit routing flag and verified restore checkpoint are needed before
  requests can write. Default package exports no configured privileged authority,
  so it denies staff operations until the production adapter is wired and reviewed.

Local tests:

```powershell
node --test scripts/test-cloudflare-view-migration.mjs
```

Tests use ephemeral local D1 and fake identities/exporter. No remote database,
real token, Auth change, profile write, Sheets file or deployment is used.

Still required before cutover (not claimed complete):

1. Review dedicated backend credential mechanism/IAM and authorize Workers Paid
   ($5/month plus usage), one D1 and a private archive bucket. No subscription or
   resource has been created. Existing R2 public image storage is not an archive
   destination for private revenue data.
2. Wire GoogleIdentityBridge's backend-only OAuth supplier and current authority
   into this runtime **and CMS**. Reuse the existing Firebase RS256 verifier.
   Do not leave CMS authorizing solely from stale JWT roles after the transition.
3. Prepare/apply strict Firestore staff rules against authzMirrors: active state,
   exact role/team/version matching token claims, leaseUntilMs > request.time millis.
   Max stale staff privilege is5minutes during mirror failure; pending synchronization
   denies Cloudflare access immediately. Original owner-profile rules remain. Fresh
   privileged Worker requests renew leases; after idle the UI must refresh authority
   before staff Firestore reads and refresh ID token on accessVersion mismatch.
   This candidate policy is NOT yet deployed, so no5minute guarantee is claimed now.
   Retained Google comments/moderation and legacy privileged view/report endpoints
   also need a current-mirror/version guard: Admin SDK bypasses Firestore Rules.
   Disable the old role-changing entry point at cutover so it cannot write claims
   outside the new authority. Updating only CMS/Rules would leave stale-token paths.
4. Bootstrap/import current admins/leaders from trusted server Auth records, verify
   restore and last-admin access, and reconcile current CMS/GitHub catalogue ownership.
   Published manga.teamId remains the server-owned ownership source during this phase;
   no browser owner transfer is trusted. Membership/report-reader extensions and audited
   ownership transfer need explicit implementation/testing, not an invented role grant.
5. Export/restore ledger, receipts/sessions, rate histories,24h dedup and existing
   immutable report snapshots/Sheet IDs. Preserve hashes and event IDs. Compare
   month/team/manga counts/totals against trusted original aggregates. All backups
   must be private and restoration tested. No production events have been scanned.
6. Quiesce A for a bounded, explicitly visible accounting window, import the final
   delta, verify dedup/receipts, then move Start+Record to ONE writer together.
   Do not split old/new sessions across independent dedup stores. No dual-write.
   Keep Google functions/HMAC/report secrets until the rollback window ends.
7. Rollback after any Cloudflare acceptance requires idempotent replay of its ledger
   delta and dedup/receipt state before returning traffic to A. Merely changing a URL
   back is unsafe. Archive/restore verification remains required for long retention.

Paid plan includes10M requests/30M CPU-ms monthly; D1 includes50M written rows/25B
reads and5GB storage. These are allowances, not measured cloud performance or a
hard spend cap. Cloud CPU/latency, OAuth/Sheets behavior and regional D1 queueing
still require a separately approved bounded deployment verification. Google costs
remain for Auth/Firestore/comments/popularity; removing view compute does not remove
all Google charges. Report a fresh provider-separated usage model after cutover.

No old popularity-off, manual-comments, CPU pilot or reader retry draft is included.
Public frontend files and live Firestore rules are unchanged by this package.
