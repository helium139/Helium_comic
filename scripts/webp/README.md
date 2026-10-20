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

Browser uploads use createImageBitmap plus Canvas at chapter quality **0.85**, cover quality **0.88**, preserving bitmap dimensions and releasing bitmaps/canvas/object URLs. An Image/object-URL decoder is available when createImageBitmap is absent. Existing WebP, GIF, AVIF and detected APNG are passed through. Empty conversion output or decode failure aborts the upload; larger output and unavailable WebP encoders retain the original format. Processing remains sequential; progress identifies the current page. Browser tests use mocked APIs, not a real browser engine; visually smoke-test representative pages, transparency, and EXIF-oriented photos before production.

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
