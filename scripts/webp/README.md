# HeliumTG WebP rollout

No deployment or production migration has been performed. Run these commands manually only after reviewing the changes. Use Node 24. Commands below run from the repository root in PowerShell (`npm.cmd` avoids PowerShell's npm.ps1 execution policy).

See [the production-readiness report and phased rollout](ROLLOUT.md) for the current verdict, exact deployment/sample/rollback commands and live verification gates.

## Discovered architecture

- `admin/chapter.js` uploads pages sequentially through `admin/api/upload.js` and publishes/edits chapters through `admin/api/github.js`.
- `admin/manga.js` uploads existing covers through the same upload helper. New manga covers use caller-owned `staging/manga-covers/<uid-hash>/<uuid>` objects, then the Worker promotes them to `<slug>/cover-<uuid>.<extension>`.
- `worker/source/worker.js` verifies Firebase tokens, roles, active teams, and manga ownership before mutations. R2 binding `BUCKET` points to `helium-comic`; returned URLs use `R2_PUBLIC_URL`. Catalogue metadata lives in **GitHub `assets/data/data.json`**, not Firestore. GitHub Contents API SHA checks protect catalogue updates.
- Chapter metadata previously stored `{ id, title, createAt, folder: "https://.../<slug>/chapN", pages }`. Both the CMS editor and reader generated `1.jpg` through `N.jpg`, even though uploads accepted other formats. There were no stored page URL arrays.
- Covers store full URLs. The old existing-cover destination was always `cover.webp` even when the uploaded bytes were JPG/PNG. New code derives cover extensions and Content-Type from signatures and returns unique `cover-<uuid>.<extension>` URLs.
- `scripts/generate-og-images.py` reads cover URLs with Pillow and produces repository `assets/og/<slug>.png` files. These are social preview assets, not chapter R2 objects. They remain PNG. No Firebase, trusted-view, or monthly-report changes are needed.

## Chosen behavior

Browser uploads use createImageBitmap plus Canvas at chapter quality **0.85**, cover quality **0.88**, preserving the full bitmap dimensions and aspect ratio and releasing bitmaps/canvas/object URLs. No crop rectangle or dimension-clamping resize is used: the full bitmap is drawn to a same-size canvas. A conservative conversion safety limit is 16,384 pixels per axis and 16,777,216 total pixels; dimensions are checked before canvas allocation and the actual canvas size is verified before drawing. JPEG chapters above **2 MiB**, JPEGs with unsafe/unreadable dimensions, and JPEGs whose canvas cannot be verified retain their original bytes as `.jpg`. An Image/object-URL decoder is available when createImageBitmap is absent. Existing WebP, GIF, AVIF and detected APNG are passed through. Empty conversion output or decode failure aborts the upload; larger output and unavailable WebP encoders retain the original format. Processing remains sequential; progress identifies the current page. Browser tests use mocked APIs, not a real browser engine; visually smoke-test representative pages, transparency, and EXIF-oriented photos before production.

Canvas `toBlob` may return PNG when a requested encoder is unsupported. The code checks `blob.type` instead of assuming WebP support. See [MDN toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) and [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap).

Chapters now optionally store `images: ["1.webp", "2.png", ...]` with exactly one validated numeric filename (optionally with a UUID suffix) per page. Reader/editor fall back to numbered JPG for legacy data. Upload responses determine actual filenames; CMS rename creates unique ordered copies, retains all source objects, and returns the exact filenames for the manifest. Uploads also use unique filenames to avoid overwriting published images before catalogue save. Worker byte signatures determine Content-Type, and chapter extensions must match those signatures. Signature validation is not a complete image decoder; Sharp decoding/verification occurs only in the local migration tool, never in Workers.

The tool lists only the explicitly requested R2 prefix and changes only exact, currently referenced catalogue images. Eligible scopes are `chapters` and `covers`; staging objects, OG assets, unreferenced files, external hosts and unrelated assets are excluded. Legacy chapters imply numbered JPG references; other orphaned formats are deliberately not guessed. Objects already named WebP are skipped, including historically mislabeled covers; correcting those requires a separate inventory.

Migration downloads and decodes one source at a time, skips animation and output without a size advantage, checks dimensions, writes a durable local journal, uploads a non-overwriting WebP, reads back its bytes and MIME, rechecks the source, rereads the live catalogue, changes only the exact reference, saves with its live GitHub SHA, then rereads the catalogue to verify. Destination collisions fail safely. A matching replacement left by an interrupted run can be reused; a different replacement is never overwritten. After successful migration the new WebP reference is skipped on reruns. Failures retain originals and may leave a verified unreferenced WebP for a retry.

**Originals are never deleted by this tool.** This deliberately preserves old direct URLs, cached reader versions and rollback. Actual served-byte differences must be measured from dry-run/sample results; bucket storage grows while both copies remain. `savedBytes` is the size difference of successfully converted references (or samples in dry-run), not actual bucket space reclaimed. A later reviewed retirement/redirect policy is needed for storage reclamation; no deletion command is provided.

## Install and local verification

```powershell
npm.cmd ci --prefix worker
npm.cmd ci --prefix scripts/webp
node --test scripts/test-image-conversion.mjs scripts/webp/test-migration.mjs scripts/webp/test-rollback.mjs scripts/test-worker-authorization.mjs scripts/test-cms-auth.mjs scripts/test-team-compatibility.mjs
node scripts/validate-catalogue.mjs
git diff --check
```

See ROLLOUT.md for current test totals. A separate existing `scripts/test-staff-access.mjs` pagination assertion fails locally (`14 !== 10`); the production workflow includes that suite, so resolve that independently before publishing. New tests cover real JPG/PNG conversions with Sharp, mocked browser conversion/failure/cleanup, passthrough formats, mixed manifests, sequential upload order, upload failure, signature spoofing, auth/team scope, dry-run, apply, idempotency, collisions, limits, and original preservation on failure.

## Environment and permissions

Set the following in your local process through your normal secret manager; do not commit values:

The Node CLI reads **`process.env` only**. It does not load `.env`, Wrangler
config, Worker bindings, Cloudflare login/session, or Wrangler OAuth. R2 uses
explicit S3-compatible `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, region
`auto`, `R2_ENDPOINT` and `R2_BUCKET`. Configure all nine names below in the
shell launching Node or your local secret manager. With Node 24, you can also
load a private file outside the repository explicitly:
`node --env-file=/absolute/path/to/webp.env scripts/webp/migrate.mjs ...`.
Do not commit that file or paste credentials into chat. No Worker defaults are
inherited. The source HEAD request requires object read permission too.

| Variable | Value / permission |
| --- | --- |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | S3-compatible R2 credentials, restricted to the target bucket |
| `R2_BUCKET` | Target bucket, e.g. `helium-comic`; start with a test bucket |
| `R2_PUBLIC_URL` | Exact HTTPS public base used in catalogue URLs, without trailing slash |
| `GITHUB_OWNER`, `GITHUB_REPO` | Catalogue repository |
| `GITHUB_BRANCH` | Explicit catalogue branch; start with a test branch |
| `GITHUB_TOKEN` | Contents read for dry-run; Contents write for apply |

Dry-run needs R2 List/Get and GitHub Contents read only. Apply additionally needs R2 Put; **Delete is unnecessary and should not be granted**. No new Worker binding or secret is introduced. Existing Firebase verification, GitHub settings, `BUCKET` and `R2_PUBLIC_URL` remain required for the Worker.

Apply performs real GitHub catalogue commits, one per successful object. Those commits may trigger existing repository workflows/deployments. The `--dry-run` path performs no local or remote writes (it does download/encode samples). Use a test branch and bucket first, with catalogue URLs matching the configured public base. Pause CMS/R2 edits during a migration; GitHub SHA checks prevent lost catalogue writes but cannot make R2 and GitHub one atomic transaction. Run one migration process at a time.

## Commands

### Legacy chapter diagnostics

The repository catalogue `assets/data/data.json` contains chapter ID `0` of
`nguoi-hau-trong-tu-kinh`, with four pages and folder
`https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/nguoi-hau-trong-tu-kinh/chap0`.
The supplied prefix `nguoi-hau-trong-tu-kinh/chap0/` is valid and present in
this catalogue. Without an `images` manifest, it implies `1.jpg` through
`4.jpg`. Metadata references do not prove live R2 object existence. The CLI
reads the remote GitHub branch, not the repository working copy.

For one sample, discovery follows: GitHub catalogue GET → legacy reference
`nguoi-hau-trong-tu-kinh/chap0/1.jpg` → R2 prefix LIST → source HEAD and GET →
Sharp decode and WebP encode → verify WebP format and original dimensions →
candidate `nguoi-hau-trong-tu-kinh/chap0/1.webp` → print proposed
`chapters[id=0].images[0]` update. Dry-run writes no objects, catalogue,
journal or snapshot. Replacement readback and catalogue readback happen only
after writes in apply mode; dry-run cannot verify future writes.

With Node 24, dependencies installed, all nine variables configured, and
`R2_PUBLIC_URL=https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev`, run:

```sh
node scripts/webp/migrate.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/chap0/ --limit 1
```

Failures print JSON with operation stage, error class/message, safe key/prefix,
HTTP status and connection code when available. Secret environment values,
authorization headers, URL credentials and URL query strings are redacted;
raw SDK objects, response bodies and stacks are never dumped. Stages identify
arguments/configuration, GitHub access, catalogue parsing/discovery, R2
list/head/get, conversion decode/encode and verification. Unsupported or
animated images are reported as skips; corrupt sources fail during decoding.
Failures exit nonzero and retain originals.

In the inspected local environment, all nine variables were absent: the sample
command stopped at `configuration` before accessing GitHub or R2. This revision
already emits staged diagnostics; the old generic sentence comes from different
code and cannot establish its historical underlying failure. Live R2 membership
via the authenticated S3 API remains unverified until a configured read-only run
succeeds. A public HEAD of the exact `chap0/1.jpg` URL returned HTTP 200,
`Content-Type: image/jpeg`, and `Content-Length: 507858` during this inspection;
the first legacy object is publicly served at that key.

Run migration-only tests with:

```sh
node --test scripts/webp/test-migration.mjs scripts/webp/test-rollback.mjs
```

### Migration invocations

Substitute the actual manga slug for `nguoi-hau-trong-tu-kinh`. Prefixes require a trailing `/`; no whole-bucket default exists. A chapter-specific prefix such as `nguoi-hau-trong-tu-kinh/chap0/` is also allowed. `--limit` bounds eligible originals attempted, including conversion failures/skips.

Dry-run, first three chapter sources:

```powershell
node scripts/webp/migrate.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --limit 3
```

Limited test apply (point environment at the test bucket/branch first):

```powershell
node scripts/webp/migrate.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --limit 3 --journal webp-test.jsonl
```

Full migration of that manga's referenced chapters and covers (use unique journal names per invocation):

```powershell
node scripts/webp/migrate.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-chapters.jsonl
node scripts/webp/migrate.mjs --apply --scope covers --prefix nguoi-hau-trong-tu-kinh/ --journal webp-covers.jsonl
```

For the full catalogue, explicitly repeat those two commands per reviewed manga slug; first run both with `--dry-run` instead of `--apply` and omit journals. No unscoped bucket-wide switch is supplied.

Statistics: `scanned` counts catalogue references in scope; `eligible` counts JPG/JPEG/PNG objects attempted within the limit; `converted` counts successful conversions or dry-run proposals. `skipped` includes other formats, non-beneficial conversions and the limit remainder. Missing referenced originals count as failures. `failed` counts per-object errors; errors print the key but no raw provider messages or credentials. `originalBytes`, `webpBytes`, `savedBytes`, `savedPercent` concern successful proposals/conversions only. No production sample was run, so no production savings estimate is available.

## Manual rollout and rollback

1. Resolve the existing staff pagination test failure and run local checks. Smoke-test browser uploads and edits, mixed JPG/PNG/WebP chapters, staged/existing covers, and social previews on a test branch/bucket.
2. Publish the reader/CMS manifest support first while uploads are paused. Keep the new CMS unavailable until the updated Worker is live, because old Worker code ignores manifests.
3. Deploy the Worker manually using your usual Wrangler process, e.g. `npx.cmd wrangler deploy --name helium-cms --config worker/source/wrangler.toml --keep-vars`. This document's commands have not been executed. Verify existing role/team denials and both cover flows, then resume uploads.
4. After the updated reader is deployed, run explicit production dry-runs. Review statistics, then apply a small limit. Verify the published catalogue and actual reader pages before removing the limit. Pause edits while applying. Keep journals/backups outside ephemeral CI storage.
5. Regenerate OG images through the existing site workflow after cover changes; check the resulting PNG/social previews. Do not convert generated OG assets in R2.

Each apply writes `<journal>.catalogue.json` before external writes (exclusive creation) and appends per-object old/new keys and hashes to `<journal>`. For rollback, pause edits, fetch the latest live catalogue/SHA, and use the journal to revert only entries whose **current** reference still equals the journal destination, back to the original key/filename. Verify retained original bytes against `originalHash` first. Save with the live SHA and reread the catalogue; deploy the regenerated static data. A whole snapshot restore can overwrite later edits, so reserve it for an unchanged catalogue. Do not remove any WebP objects while readers or later edits still reference them. Keep reader manifest support until all new-upload and migrated references have been handled; reverting application code alone is not a data rollback.

## Changed files

- `admin/api/image-conversion.js`, `admin/api/upload.js`: conversion and cover/page uploads.
- `admin/chapter.js`, `assets/js/comicchap.js`: ordered mixed-format manifests and legacy fallback.
- `worker/source/cms-authorization.js`, `worker/source/image-format.js`, `worker/source/worker.js`: signature validation, cover extensions, manifest validation.
- `scripts/webp/migrate.mjs`: scoped migration CLI/core.
- `scripts/webp/package.json`, `scripts/webp/package-lock.json`: isolated, locked local dependencies.
- `scripts/webp/test-migration.mjs`, `scripts/test-image-conversion.mjs`: conversion/migration/upload tests.
- `scripts/test-worker-authorization.mjs`, `scripts/test-cms-auth.mjs`: signature-aware fixtures and Windows-compatible test loading.
- `.gitignore`: local dependencies and default migration journal/backup names.
- `scripts/webp/rollback.mjs`, `scripts/webp/test-rollback.mjs`: exact journal rollback with original-hash checks and SHA-protected updates.
- This runbook and `scripts/webp/ROLLOUT.md`.

## Cleanup of deployed chapter originals

`cleanup-originals.mjs` is a separate, chapters-only deletion tool. Migration
still retains originals; cleanup never updates the catalogue and never invokes
upload conversion. Do not run cleanup until the **Update Site** workflow has
finished deploying the migrated catalogue and the live reader has been checked.

Use Node 24 and `npm ci --prefix scripts/webp`. Configure the same nine migration
variables in the launching process or an explicitly loaded private `.env.webp`
file. Keep this file outside version control (prefer an absolute path outside
this repository). Dry-run needs R2 List/Get (including HEAD) and GitHub Contents
read. Apply also needs R2 Delete, restricted to the intended bucket/prefix;
cleanup needs neither R2 Put nor GitHub Contents write. Use separate credentials
with deletion permission only for cleanup.

Production catalogue verification is pinned to
`https://heliumtg.com/assets/data/data.json`, derived from `CNAME` and the reader's
`/assets/data/data.json` fetch. Every candidate fetch uses a fresh cache-busting
query, no-cache headers, a 30-second timeout, and rejects redirects. GitHub
credentials are never sent to production. Unavailable, malformed, mismatched,
or stale live data yields **live catalogue not verified** and retains the source.
If the production hostname/path changes, update this constant before cleanup.
Do not point it at GitHub or a preview deployment.

For each canonical chapter JPG/JPEG/PNG in the prefix, cleanup requires an exact
same-stem WebP reference at the same chapter and page index in both the current
GitHub catalogue and production. Numbered legacy chapters without manifests
still reference their JPGs and are protected. UUID filenames must match exactly.
The tool checks all catalogue chapters and explicit metadata references for
continued use of the original, including references outside the requested
prefix. Malformed chapter metadata fails closed. Unknown/orphan sources are
reported as `skippedUnknown` and retained; similarly named replacements alone
are insufficient. Covers, OG paths, GIF, WebP, noncanonical paths, and objects
outside the prefix are excluded.

Both WebP HEAD and GET must succeed, report `image/webp`, and agree on nonzero
size. The original is HEAD/GET checked too. Sharp decodes both files, verifies
matching dimensions and supported static source formats, and rejects APNG,
animation and EXIF-oriented originals. Catalogue and live references are checked
again, followed by both object ETags, immediately before the pending journal and
delete. Deletion uses the original ETag as `IfMatch`; failed conditions or
unsupported conditional deletes are failures, never retried unconditionally.
After deletion, source HEAD must return object-not-found. Authentication errors,
connection failures and missing buckets are not accepted as proof of deletion.

Pause catalogue/CMS edits, migration, rollback, deployments and other R2 writers
throughout cleanup. These separate services cannot provide an atomic snapshot;
checks reduce races but cannot prevent a concurrent catalogue rollback or a
replacement deletion after verification. A live catalogue check also cannot
prove that every already-open reader or cached old catalogue has expired.
Allow your desired cache/reader grace period before cleanup. **After deletion,
rollback to JPG/PNG requires an independent backup**; the migration journal does
not contain the original image bytes.

Workflow for `nguoi-hau-trong-tu-kinh/` (examples only; no production cleanup has
been run during development):

A. Preview migration:

```sh
node --env-file=.env.webp scripts/webp/migrate.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/
```

B. Apply migration and retain its journal/backups:

```sh
node --env-file=.env.webp scripts/webp/migrate.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-chapters-reviewed.jsonl
```

C. Deploy using **Update Site**, and wait for successful production deployment.

D. Verify production chapter `images` references and representative reader WebP
requests. Keep originals through your chosen cache/reader grace period.

E. Preview cleanup and review the journal and summary:

```sh
node --env-file=.env.webp scripts/webp/cleanup-originals.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-cleanup-preview.jsonl
```

F. Apply only after reviewing the preview, using a different journal:

```sh
node --env-file=.env.webp scripts/webp/cleanup-originals.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-cleanup-apply.jsonl
```

`--prefix nguoi-hau-trong-tu-kinh/chap0/` narrows to one chapter. Optional
`--limit N` caps canonical source objects checked, including skipped or failed
sources; it does not mean N deletions. No whole-bucket or covers scope exists.
Only one of `--dry-run` and `--apply` is allowed.

Both modes create a local journal exclusively (`wx`, mode `0600`); existing
files are never appended to or overwritten. Without `--journal`, the name is
`webp-cleanup-<timestamp>-<uuid>.jsonl`. Dry-run makes **zero R2 writes/deletes and
zero catalogue writes**, but does write its local audit journal. Each checked
source records `originalKey`, `webpKey`, `originalBytes`, `webpBytes`,
`catalogueVerified`, `liveCatalogueVerified`, `webpVerified`, `deleted`, `reason`,
and `timestamp`. Unread/unverified byte sizes remain zero. Apply syncs a pending
record to disk before deletion and syncs the completed result afterward.
Failures are recorded with redacted stage/class/message diagnostics and
processing continues; any journal failure stops the entire run. A pending
record without a completed result needs inspection after a crash; the tool does
not automatically replay journal entries.

Summary fields are `scanned`, `eligible` (exact current WebP identity found),
`safeToDelete`, `skippedReferenced`, `skippedLiveNotVerified`,
`skippedMissingWebp`, `skippedUnknown`, `deleted`, `failed`, and
`reclaimableBytes`. `safeToDelete`/`reclaimableBytes` describe verified candidates,
including any subsequent delete failures; `deleted` counts only verified
not-found results. Skips are reported without deletion; operational failures
exit nonzero. Preserve journals alongside your independent original backups.

Run all migration/cleanup tests without production requests:

```sh
npm --prefix scripts/webp test
```

## Numbered filenames for new chapters

New chapter publication (`/new-chapter` only) promotes the uploaded source set to
`<slug>/chapN/1.ext`, `2.ext`, and so on. The extension comes from the validated
actual upload format: optimized WebP stays WebP, retained JPG/PNG stays JPG/PNG.
The CMS snapshots the final displayed order before assigning page numbers.
Uploads still use temporary `<slug>/chapN/<page>-<uuid>.<extension>` keys to keep
incomplete uploads isolated from published images. UUIDs are not copied into the
new chapter's final `images` manifest.

The Worker validates all sources and destination collisions before writing final
objects, creates destinations with a create-only condition, verifies their bytes,
then commits the numbered manifest with the GitHub SHA check. Different existing
destination bytes cause a conflict rather than an overwrite. Failed promotion or
catalogue commit retains all sources and existing objects; an unreferenced final
copy may remain for retry. After the GitHub commit succeeds, the Worker rereads the catalogue, confirms the
numbered manifest, revalidates source/final bytes, and deletes only the exact
UUID sources supplied by this publish that are unreferenced anywhere in metadata.
Cleanup failure is logged for retry without failing the committed publication.
An identical publish retry verifies existing final objects and tolerates sources
already deleted; conflicting existing chapter manifests remain protected.

Existing chapter objects and metadata are not renamed or migrated. Existing edit
and reorder behavior is unchanged, including UUID manifests. Reader legacy and
UUID compatibility, migration discovery, and cleanup exact-reference rules are
unchanged. No versioned folders are introduced.

Additional naming checks:

```sh
node --test scripts/test-chapter-promotion.mjs scripts/test-worker-authorization.mjs scripts/test-image-conversion.mjs
```


### One-time duplicate staging cleanup

The upload Worker generates `<page>-<crypto.randomUUID()>.<extension>` (UUID v4).
Promotion copies bytes without re-encoding. The cleanup matcher accepts only that
pattern and preserves its extension; arbitrary hashes and legacy names are skipped.

Use Node 22+ and the existing `.env.webp` migration configuration/dependencies.
A manga or chapter prefix with a trailing slash is mandatory; global scans are
rejected. No mode means dry-run. Both command filenames below are supported:
`cleanup-staging-duplicates.mjs` and the original `cleanup-chapter-staging.mjs`.

```sh
node --env-file=.env.webp scripts/webp/cleanup-staging-duplicates.mjs --dry-run --prefix manga-slug/chap20/
node --env-file=.env.webp scripts/webp/cleanup-staging-duplicates.mjs --dry-run --prefix manga-slug/chap20/ --min-age-hours 0
node --env-file=.env.webp scripts/webp/cleanup-staging-duplicates.mjs --apply --prefix manga-slug/chap20/ --journal cleanup-staging-chap20.jsonl
# Manga scope is also supported:
node --env-file=.env.webp scripts/webp/cleanup-staging-duplicates.mjs --prefix manga-slug/
```

The tool reuses the migration R2 connection and the original-cleanup catalogue
inventory and public catalogue fetch. Both catalogues must be readable and valid.
Any reference to a staging key/URL, including legacy chapter manifests, protects it.
The default minimum object age is 24 hours; override it with
`--min-age-hours <number>` (a nonnegative number). Setting it to `0` removes
only the age threshold; all catalogue and object verification checks still
apply. The exact numbered final must be referenced by both catalogues. It must have a
nonzero size, a signature matching its extension, matching MIME when present,
consistent HEAD/GET sizes, and fully decodable pixels via Sharp. Staging and final
must have identical bytes (and therefore identical dimensions). Both must have
ETags and valid modification timestamps at least the configured age. Missing
timestamps, recent objects, unknown names and failures are skipped with explicit
reasons; recent objects have a separate summary counter.

Apply must run while uploads, edits, publishing and migrations are paused for the
requested prefix. There is no shared cross-service lock between GitHub and R2;
the age guard and repeated checks reduce races but cannot provide an atomic
transaction across them. Before every deletion the tool rereads both catalogues,
rejects any catalogue SHA/content change, revalidates bytes and decoding, then
checks versions and ETags again after flushing the pending journal entry. Source
deletion uses `IfMatch`; missing final objects and changed objects cause a skip.

Reports include each SAFE source/final/size, skip reasons, counts, reclaimable
bytes and MiB before any deletion. Apply journals are created exclusively (`wx`,
mode 0600), with a generated filename if `--journal` is omitted. An existing file
fails rather than being overwritten. Pending deletion entries are flushed before
the request; confirmed/failed results and skips are recorded. Journal failures
stop the run. A crash after deletion may leave a pending entry; rerun with a new
journal and missing sources are harmless. Dry-run does not create a journal.

Local regression checks (no R2 access):

```sh
node --test scripts/webp/test-cleanup-chapter-staging.mjs scripts/webp/test-migration.mjs scripts/webp/test-cleanup-originals.mjs scripts/webp/test-rollback.mjs
```
