# Phase 1B CMS authorization

This is a source implementation, not a deployment. No Cloudflare, GitHub or R2
production mutation is needed to run the tests. Analytics, views, comments and
statistics are outside this change.

## Files and configuration

The Worker entry point is `worker/source/worker.js`. `worker/source/wrangler.toml`
is already correctly named; no malformed filename or repository reference to it
remained when implementation began. The existing R2 configuration is preserved:

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "helium-comic"
```

The config now identifies `worker.js` as its entry point and sets a compatibility
date. The original file contained no Worker name, GitHub variables or secrets.
Before a separately authorized deployment, confirm the existing target Worker,
its deployed GitHub owner/repository/branch/token and `R2_PUBLIC_URL` settings.
Never replace those deployed secrets with public config values. Install the
locked dependency with `npm ci --prefix worker`; Wrangler must bundle imports
from `jose`. Pasting only the entry-point text into an inline editor is insufficient.
The Pages workflow excludes `worker/` and `node_modules/` from public hosting.

## Authentication and permissions

`firebase-auth.js` uses jose RS256 verification and a module-scoped remote JWK
resolver for Google's securetoken service-account signing keys. It checks the
signature, exact project audience, issuer, required subject/expiration/issued-at/
authentication-time claims, time ordering and key ID. Invalid or missing tokens
receive 401. Body identity fields never establish authorization. Only verified
`sub`, `role` and `teamId` are used. Ordinary users receive 403 before storage or
GitHub access. There is no request/environment option to bypass verification.

`/status` and `/mangas` remain public. All eight mutation routes require POST.
Mutation preflight and actual requests allow these browser origins:

- `https://heliumtg.com`
- `https://www.heliumtg.com`
- `http://localhost:8000`
- `http://127.0.0.1:8000`

Only Authorization and Content-Type are allowed preflight headers. Public read
responses retain wildcard CORS. Nonbrowser requests without Origin still require
a verified JWT. A permitted Origin never substitutes for authentication.

| Mutation | Admin | Team leader |
| --- | --- | --- |
| new-manga | Requested valid active team | Forced verified active claim team |
| edit-manga | Any stored team; active target if reassigned | Own stored team; cannot reassign |
| delete-manga | Any stored team | Own stored team |
| new/edit/delete-chapter | Any authorized parent | Own authorized parent |
| upload existing image | Authorized manga, canonical image path | Same, own team only |
| upload staged cover | Own server-generated staging object | Same, active claim team required |
| rename-images | Authorized chapter folder | Same, own team only |

Every mutation reads the current GitHub branch catalogue and canonical teams.json.
Ownership must be an explicit valid manga.teamId; legacy display names are not an
authorization fallback. Missing ownership fails closed even for administrators.
Leaders with unknown/inactive team claims are denied. Admins can edit an inactive
team's existing manga without changing its ownership; assigning a different target
requires that target to be active.

Metadata updates use a field allowlist. Leaders preserve adminPick, pickOrder and
all other existing global/unknown fields. New leader manga receive neutral
editorial defaults. Every metadata edit, including an admin edit, preserves the
stored chapter array. The editor now calls delete-chapter for chapter deletion.
Chapter ownership is inherited; client chapter team fields are ignored. Zero is
a valid chapter identifier, including in the editor query parser.

## Cover staging

For a new manga, upload sends only file and kind=new-manga-cover. The Worker
chooses `staging/manga-covers/{sha256(verified UID)}/{random UUID}` and stores owner
and creation-time metadata. The response contains success and stagingRef only.
No browser-selected R2 key is accepted. Covers are valid for 24 hours.

new-manga verifies the new request token, validates the target team, and derives
the staging key from that same verified caller and the opaque reference. It checks
ownership and expiry before promotion. The final key is derived as
`{validated slug}/cover-{staging UUID}.webp`. A unique cover filename prevents a
losing concurrent create from overwriting the winning create's cover.

The Worker copies the image before committing the catalogue, commits the final
public URL with the original GitHub SHA-based publishing mechanism, then removes
the staged object. It never commits an inaccessible staged URL. Successful
publishing remains successful even if subsequent staging cleanup fails.

GitHub and R2 have no shared transaction. A failed/ambiguous GitHub response leaves
the unique promoted image and staging object for reconciliation; it does not delete
an image that GitHub might already reference. Reload after a conflict before retrying.
Existing covers can still be replaced at `{manga}/cover.webp`; unchanged existing
cover URLs are retained. No image format conversion was introduced: as before,
content type describes the uploaded bytes even when a cover key ends in .webp.

### Required stale-object housekeeping

No production lifecycle rule was changed. Configure a separately reviewed R2
lifecycle rule on prefix `staging/manga-covers/` to delete objects older than two
days (after the 24-hour eligibility window). Alternatively run a daily privileged
cleanup of that exact prefix with the same age threshold.

For orphan promoted covers, compare the final object URL with the current
authoritative catalogue before deleting anything, allow a minimum 48-hour grace
period, and account for in-flight/ambiguous GitHub commits. Never apply the staging
lifecycle rule to the manga prefixes. Failed rename temporary files may be recovery
copies; inspect/recover affected images before removing them.

## R2 path protection

Existing uploads resolve and authorize a current manga before any write. Accepted
folders are exactly `{slug}` (cover only) or `{slug}/chap{canonical numeric ID}`.
A chapter image upload may precede creation of its chapter record, but its manga
must already exist. Cover filename is cover.webp; page filenames are positive
numbered JPEG/PNG/WebP/GIF/AVIF filenames. Upload files must have an allowed image
MIME type, be nonempty, and be at most 32 MiB.

The Worker accepts canonical syntax only and reconstructs keys from validated
components. It rejects traversal, dot segments, leading slashes, backslashes,
percent-encoded variants, extra/empty segments, unknown prefixes and arbitrary
key/destination overrides. Changing the supplied manga prefix invokes ownership
checks for that actual manga; string prefix matching is never authorization.

Rename accepts only folder and a unique list of numbered filenames. It validates
every source, derives every destination inside the same authorized chapter folder,
and checks all sources exist before the first write. Server-generated temporary
names include a random operation ID. Originals remain until all temporary copies
exist; temporary copies remain until all final copies succeed. As with the previous
implementation, R2 multi-object rename is not atomic: serialize edits to the same
chapter operationally and recover from retained temporary copies after failures.

## Frontend and rollout limits

All protected frontend requests reuse authenticatedFetch and ask the Firebase SDK
for an ID token per request. Tokens are neither manually cached nor persisted.
After custom claims change, call getIdToken(true) or sign out/in before expecting
the new claims. Existing signed tokens remain valid until expiry; this Worker does
not add an immediate Firebase revocation/account-disable lookup.

The frontend staff-access layer now accepts claim-consistent admins and team
leaders and scopes leader lists/editors to their explicit teamId. See
`phase-1b-staff-access.md` for the frontend contract and validation. Deploy and
exercise the backend/frontend together in a test environment and verify trusted
claim provisioning and deployed rules. A UI filter is never a replacement for
the backend checks implemented here.

Coordinate the eventual frontend and Worker release: new staging clients require
this Worker contract, while the new Worker rejects legacy unauthenticated/direct
new-cover writes. Real JWT/JWK retrieval, R2 bindings and GitHub publishing require
integration checks against an isolated environment before production rollout.

## Verification

```sh
npm ci --prefix worker --ignore-scripts --no-audit --no-fund
node --test scripts/test-worker-authorization.mjs scripts/test-cms-auth.mjs scripts/test-team-compatibility.mjs scripts/test-firebase-session.mjs scripts/test-reading-progress.mjs scripts/test-push-notifications.mjs scripts/test-chapter-readiness.mjs
node scripts/validate-catalogue.mjs
python3 scripts/test-og-images.py
git diff --check
```

Worker tests use locally generated RSA signatures and jose verification, with
mock GitHub/R2 services and a test key resolver. Remote JWK caching is tested with
a mock Google-format response, not production Google requests. Tests cover invalid
claims/signatures, all route gates, team ownership, protected fields/chapter arrays,
zero chapters, staging ownership/expiry/failures, path traversal, rename validation,
CORS, public reads and safe errors. No secrets are printed and no production
content, messages, notifications or deployments are created.
