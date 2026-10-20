# Production-readiness review and controlled rollout

All commands below are **manual instructions**, not actions performed by this review. Run from the repository root with Node 24 and PowerShell. No deployment, commit, push, production migration, production object deletion or production catalogue request was performed. No credentials were added to files or printed.

## A. Verdict

**Hold production deployment until the independent staff/popularity test issues are reconciled and browser/OG release checks pass.** The WebP feature is ready for a controlled test after those gates, not a full migration. No original retirement is authorized.

## B. Findings and remaining risks

Fixed during review:

- Preview object URLs were leaked on rerender, and all preview images requested eager decoding. Previews now release URLs on load/error/rerender and request lazy/asynchronous decoding. Actual decoded-image eviction remains browser-controlled.
- Reordering deleted/overwrote published R2 pages before the separate catalogue save succeeded. Uploads now return unique `<number>-<uuid>.<ext>` / `cover-<uuid>.<ext>` objects. Reorder creates uniquely named copies, verifies existence, returns their exact ordered names, and retains sources. A failed upload/reorder/catalogue save leaves old metadata and its objects intact; unreferenced replacements may remain.
- Dragging a new page between existing pages was partitioned back into “existing then new.” A shared displayed order now survives that partition and determines the saved manifest. No lexicographic filename sort was added. Selection order `1.jpg, 2.jpg, 10.jpg` remains that order.
- Conversion errors now name the exact source file; network upload failures preserve that name. Form controls, dropping, removing and sorting are blocked during save. Conversion remains sequential, with bitmap/canvas/object URLs released per file; the queue retains compressed File objects, not a deliberate array of all decoded pages.
- EXIF-oriented JPEGs remain in their original format in both browser uploads and migration, so conversion cannot strip their orientation. GIF/WebP bytes disguised under a JPG filename are also excluded from browser recompression.
- New chapters require explicit manifests; existing legacy chapter data remains readable. Manifests, inferred legacy edit paths and replacement covers are checked against existing R2 objects before catalogue publication. Byte signatures determine upload Content-Type; chapter filename extensions must match. Authentication, Firebase JWT verification, roles, active-team checks, manga ownership and origin protections remain in place. No route was added.
- Missing migration source references now count as failures rather than silently skipped entries. The migration accepts the new UUID page filenames and still changes only exact references under an explicit prefix/scope.
- Added an actual journal rollback CLI with original SHA-256 verification, current-reference conflict checks, one SHA-checked catalogue write, a required pre-rollback backup for apply, and post-save reference verification. It never writes/deletes R2 objects.

Remaining limitations/gates:

- `scripts/test-staff-access.mjs:264` still expects 10 manga while current pagination returns 14. That test is included in the release workflow. Pagination and its expectations were not changed by this review.
- `scripts/test-chapter-popularity.mjs:20` fails locally because its VM loader strips imports using LF-only matching against CRLF source (`Cannot use import statement outside a module`). Its production implementation and test were left unchanged. The other popularity assertions, valid-view tests and comments tests pass; this failed adapter test is not claimed as verified.
- Browser tests use mocked Canvas APIs. Desktop/mobile browser smoke tests, high-resolution 50–100 page memory observation, transparent images and EXIF-oriented source images still need human verification. Native encoder output varies; unsupported WebP encoding and larger output retain the original. An oriented photo must retain its visual orientation; if a test fails, hold deployment and keep that source in its original format.
- Worker checks identify allowed signatures, not full image decodability. Signature spoofing alone cannot establish that an image is complete. Native browser decoding checks convertible sources; passthrough files still need sensible source content. Sharp fully decodes/verifies local migration outputs.
- R2/GitHub do not share an atomic transaction. Pause CMS and R2 edits and use one migration/rollback process. SHA conflicts stop metadata overwrites; verified orphan replacements can be reused on a retry.
- Legacy chapters without `images` imply numbered JPGs, as before. Existing explicit PNG/mixed manifests are supported. A previously unreferenced PNG object is not guessed into a legacy chapter. Historically mislabeled `cover.webp` files are excluded from this migration; they require a separate inventory.
- Originals, failed-operation replacements and reorder sources are retained. No storage/bandwidth estimate is made without measured production dry-run/sample bytes, and `savedBytes` is not bucket space reclaimed.
- Python/Pillow OG tests could not run locally: installed Python launcher paths are inaccessible. Run the documented offline OG check on a working Python environment and require the existing Actions OG checks before release.

## C. Files changed

This review changes only the WebP/upload/reorder path and its tests/docs:

- `admin/api/image-conversion.js`, `admin/api/upload.js`, `admin/chapter.js`
- `worker/source/worker.js`, `worker/source/cms-authorization.js`
- `scripts/webp/migrate.mjs`, `scripts/webp/test-migration.mjs`
- `scripts/test-image-conversion.mjs`, `scripts/test-worker-authorization.mjs`
- `scripts/webp/rollback.mjs`, `scripts/webp/test-rollback.mjs`, `scripts/webp/package.json`
- `scripts/webp/README.md`, this report
- `.github/workflows/site-update.yml`: offline WebP conversion/migration/rollback tests using the locked local dependencies

Earlier WebP changes still present include `assets/js/comicchap.js`, `worker/source/image-format.js`, `scripts/test-cms-auth.mjs`, isolated migration dependencies/lockfile and `.gitignore`. No catalogue JSON content, OG generator, pagination, popularity, comments, trusted-view or monthly-report implementation changed.

## D. Local checks

```powershell
npm.cmd ci --prefix worker
npm.cmd ci --prefix scripts/webp
node --test scripts/test-image-conversion.mjs scripts/webp/test-migration.mjs scripts/webp/test-rollback.mjs scripts/test-worker-authorization.mjs scripts/test-cms-auth.mjs scripts/test-team-compatibility.mjs scripts/test-staff-access.mjs scripts/test-chapter-readiness.mjs scripts/test-chapter-views.mjs scripts/test-chapter-popularity.mjs scripts/test-comments.mjs
node scripts/validate-catalogue.mjs
git diff --check
```

Run the following separately where Python/Pillow work; this is an offline test, not OG regeneration or a production request:

```powershell
python -m pip install -r scripts/requirements-og.txt
python scripts/test-og-images.py
```

Current combined Node results: **94 passed, 2 failed, 0 skipped** (96 total). Failures are the independent staff pagination and popularity adapter test-loader issues above. Catalogue validation passes (34 manga, 2 teams); `git diff --check` passes. The chapter readiness tests mock their HTTP requests; their printed example URLs do not mean production was contacted. Browser automation/live checks and Python OG tests are not counted as passing Node tests.

## E. Phase A — deploy upload/reader support

First resolve the independent release blocker and complete the local/browser/OG checks. Have an authorized maintainer make the reviewed code available on the release branch through the normal review process; no commit/push command is part of this preparation. A workflow dispatch deploys **remote branch content**, not this uncommitted workspace.

Pause CMS writes externally during the deployment window. The repository has no maintenance-toggle command; disabling a local browser button is not a global write freeze. Record the existing Worker deployment/version and remote release revision for recovery. Confirm the correct Cloudflare account and existing `helium-cms` Worker. Required existing Worker configuration: `BUCKET`, `R2_PUBLIC_URL`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN`; Firebase verification remains configured in code. Do not print any secret value.

Publish the reader/CMS support through the actual Pages workflow while uploads remain paused:

```powershell
gh workflow run site-update.yml --ref main
gh run list --workflow site-update.yml --branch main --limit 5
```

Select the run whose head commit is the reviewed release; watch that exact run (replace the number with its actual ID):

```powershell
gh run watch <RUN_ID> --exit-status
```

Deploy the Worker from the reviewed workspace only after the reader workflow succeeds:

```powershell
npx.cmd wrangler deploy --name helium-cms --config worker/source/wrangler.toml --keep-vars
curl.exe --fail --silent --show-error https://helium-cms.mylengoctra06.workers.dev/status
```

The explicit name comes from the CMS API origin; the checked-in Wrangler config omits it. `--keep-vars` preserves existing dashboard variables. See [Cloudflare deploy flags](https://developers.cloudflare.com/workers/wrangler/commands/workers/) and [GitHub workflow dispatch](https://cli.github.com/manual/gh_workflow_run). `/status` is a smoke check only; it does not prove authorization or R2 writes work. Hard-reload/reopen CMS tabs after deployment. Old CMS code does not understand unique response filenames/reorder responses; do not permit stale CMS tabs during the window. Resume only the controlled tester's access for Phases B/C.

## F. Phases B/C — new upload tests

**B: one new chapter.** Use a dedicated authorized test manga and an unused chapter number. Open the CMS:

```powershell
Start-Process 'https://heliumtg.com/admin/chapter/'
```

1. Sign in as an authorized admin/team leader. Select the test manga. Record its current catalogue/chapter list.
2. Select a small set in the intended order, including source names `1.jpg`, `2.jpg`, `10.jpg`; include PNG and an existing WebP. Confirm the displayed order; the filename strings are not the sorting authority. Drag deliberately if needed.
3. Watch conversion/upload progress and Network. Upload once. Confirm returned numeric+UUID filenames, matching extensions/Content-Type, explicit ordered `images`, and unchanged dimensions.
4. Open the resulting public chapter link and confirm every page in order on desktop/mobile. Test a controlled conversion/network failure on the **test** upload: the exact failed source must be reported, no new chapter record published, and the queue must remain available for retry.
5. On the test chapter only, remove a middle page, add a new page and drag it between old pages. Save and confirm the reader order matches the preview. On a controlled failed save, old references/objects must still work.
6. Repeat authorization smoke checks: another team's manga cannot be edited/uploaded by a team leader; signed-out and ordinary accounts cannot mutate. Do not copy tokens into commands/logs.

**C: one cover.** Open the manga manager:

```powershell
Start-Process 'https://heliumtg.com/admin/manga/'
```

On the test manga, record the original full cover URL, select a JPG/PNG, save, and confirm the returned unique cover URL and actual Content-Type. Confirm a larger encoding keeps the original format, and the old cover remains available. Check manga listing/detail/mobile and regenerated PNG OG/social preview after the site workflow succeeds. Test caller-owned staging with a dedicated new test manga before releasing that workflow to staff. Do not run the OG generator locally against production during this review.

## G. Phase D — migration dry-run only

Use the existing migration environment in README: R2 endpoint/bucket/public URL/access keys and GitHub owner/repo/branch/token. Start with read-only R2 List/Get and GitHub Contents read. Do not grant Delete. The following candidate is an actual catalogue chapter; confirm scope with the content owner before manual production use:

```powershell
node scripts/webp/migrate.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/chap0/ --limit 1
```

Check `failed = 0`, exact proposed key and actual byte statistics. No eligible conversion is a valid no-op, not evidence of a successful WebP sample; select another reviewed single chapter if necessary. Do not remove the prefix/limit to chase a result. This dry-run writes nothing locally/remotely and does not create a rollback journal.

## H. Phase E — one controlled object

After A–D pass, pause all edits, use credentials with R2 Put and GitHub Contents write (still no Delete), retain the matching catalogue snapshot/journal, and run exactly:

```powershell
node scripts/webp/migrate.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/chap0/ --limit 1 --journal webp-production-sample.jsonl
```

Use a fresh journal name per invocation. The tool creates `webp-production-sample.jsonl.catalogue.json` exclusively and flushes intent records before external writes. It may commit one catalogue update and trigger the normal site workflow. `--limit 1` caps eligible attempts, not guaranteed successful conversions. Stop on a nonzero exit/failure and inspect current references before retrying. Never delete an original or a verified replacement after an ambiguous GitHub response.

## I. Phase F — verify the live sample

Wait for the exact site workflow triggered by the catalogue update to succeed (`gh run list ...`, then `gh run watch <RUN_ID> --exit-status`). Open both forms of the chapter URL:

```powershell
Start-Process 'https://heliumtg.com/manga/nguoi-hau-trong-tu-kinh/chapter/0/'
Start-Process 'https://heliumtg.com/chapter.html?id=nguoi-hau-trong-tu-kinh&chap=0'
```

HEAD-check every currently published page, using the manifest or legacy fallback without sorting:

```powershell
$liveCatalogue = Invoke-RestMethod 'https://heliumtg.com/assets/data/data.json'
$sampleManga = $liveCatalogue.'nguoi-hau-trong-tu-kinh'
$sampleChapter = $sampleManga.chapters | Where-Object { $_.id -eq 0 }
$sampleNames = if ($sampleChapter.images) { @($sampleChapter.images) } else { @(1..$sampleChapter.pages | ForEach-Object { "$_.jpg" }) }
foreach ($sampleName in $sampleNames) {
    $pageResponse = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "$($sampleChapter.folder)/$sampleName"
    [pscustomobject]@{ Name = $sampleName; Status = $pageResponse.StatusCode; ContentType = $pageResponse.Headers['Content-Type'] }
}
curl.exe --fail --head 'https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/nguoi-hau-trong-tu-kinh/chap0/1.jpg'
```

The final command checks the retained legacy first-page object; if the journal selected another source, also check that exact original URL. These are future manual requests, not verification already performed. HEAD checks do not establish image decodability; complete the browser checks:

- [ ] Clean and legacy chapter URLs open; desktop and mobile reader work.
- [ ] Every page decodes, has nonzero natural dimensions, and appears in manifest order.
- [ ] Network shows no 404s or failed images; migrated objects return `image/webp`.
- [ ] JPG/PNG pages in a partial migration still load; explicit PNG and legacy JPG chapters still work.
- [ ] Original object URLs named in the journal remain accessible; use a fresh/cold request as well as cached pages.
- [ ] Manga cover/listing/detail still work; cover URL is unchanged for this chapter-only sample.
- [ ] Generated OG image remains PNG and the existing social preview points to it.
- [ ] Comments render; use normal authorized test comments only if needed.
- [ ] Popularity display/counter behaves as before; do not reset or manufacture counts.
- [ ] Phase 3 valid-view tracking follows its existing timing/visibility rules; verify through the existing dashboard/normal test procedure without bypassing accounting.
- [ ] Catalogue diff changes only the selected chapter page reference; its title/date/page count and unrelated manga/chapters remain intact.
- [ ] Journal and original-hash snapshot are stored outside ephemeral CI storage; actual byte stats and observations are recorded.

## J. Exact rollback

The **new** `rollback.mjs` CLI below is separate from `migrate.mjs`. Its flags are implemented/tested; no rollback flag has been invented for the migration CLI. Pause writes, keep the same correct R2/GitHub environment, use a fresh `--backup` filename on apply, dry-run first, then apply. It reads originals and changes catalogue metadata only; no R2 Put/Delete is needed. GitHub Contents write is needed for apply.

**A: a single migrated chapter**, including only its entries from a larger journal:

```powershell
node scripts/webp/rollback.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/chap0/ --journal webp-production-sample.jsonl
node scripts/webp/rollback.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/chap0/ --journal webp-production-sample.jsonl --backup webp-rollback-chapter.json
```

**B: a migrated cover**, using the journal that actually migrated that cover, not the chapter-only sample journal:

```powershell
node scripts/webp/rollback.mjs --dry-run --scope covers --prefix nguoi-hau-trong-tu-kinh/ --journal webp-covers.jsonl
node scripts/webp/rollback.mjs --apply --scope covers --prefix nguoi-hau-trong-tu-kinh/ --journal webp-covers.jsonl --backup webp-rollback-cover.json
```

**C: catalogue metadata.** A/B already restore the relevant catalogue references using the current GitHub SHA; unrelated later title/date/team/editorial changes remain intact. The original `images` array may remain explicit JPG entries, which is equivalent for the reader. Do not blindly replace the live file with `<journal>.catalogue.json`: that snapshot may predate unrelated edits. Preserve it as evidence of the pre-migration state. If whole-file recovery is necessary, perform a separate reviewed merge of its `data` against the live catalogue and a live-SHA update; automatic whole-file restore is intentionally not provided.

**D: a batch from a journal**, bounded to one reviewed manga and scope:

```powershell
node scripts/webp/rollback.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-chapters.jsonl
node scripts/webp/rollback.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-chapters.jsonl --backup webp-rollback-batch.json
```

Repeat explicitly per manga/scope as needed. A current reference equal to the old key is an idempotent no-op. A current reference equal to the journal destination is restored only if original bytes still match `originalHash`. Any conflicting/missing target or changed original aborts before saving the batch. SHA conflict or uncertain network response requires rereading the catalogue and rerunning dry-run; never delete objects in response. The tool backs up before the single SHA-protected save, then verifies references. Wait for the resulting site workflow and repeat Phase F, expecting restored JPG/PNG where appropriate. Keep reader manifest support deployed; reverting the code alone does not roll back migrated/new-upload data.

## K. Phase G — gate before full migration

Only allow expansion after all checks are green, staff blocker is resolved, the one-object live sample and its original URLs are verified on mobile/desktop, rollback has been exercised on a test branch/bucket, the exact deployed code is recorded, and measured statistics have been reviewed. Keep CMS/R2 edits paused and one operator/process; schedule around one GitHub commit/workflow trigger per migrated object. Increase limits gradually before removing them. Full per-manga commands already supported by the CLI are:

```powershell
node scripts/webp/migrate.mjs --dry-run --scope chapters --prefix nguoi-hau-trong-tu-kinh/
node scripts/webp/migrate.mjs --apply --scope chapters --prefix nguoi-hau-trong-tu-kinh/ --journal webp-full-chapters.jsonl
```

These commands are **not authorized to execute in this review**. Review covers separately; do not assume chapter success verifies covers. No whole-bucket migration default exists.

## L. Future original retirement — separate project/action

No originals are deleted now. Before designing/authorizing a separate deletion command, require successful full migration of all intended references, no old references in the authoritative/published catalogues or relevant generated assets/caches, a clean relevant 404/error observation window, an explicitly agreed rollback retention period that has elapsed, tested recoverable backups, and a decision about old direct URLs (redirect/alias policy or continued retention). No retention duration is guessed here.

Build a separate retirement inventory from verified journal pairs and current references; classify unreferenced originals conservatively, including third-party/historical URLs and cached clients. Require retirement dry-run output listing exact keys, current-reference checks, replacement content/hash checks and byte totals; review it before granting Delete. Only then may an explicitly separate, narrowly scoped apply action be authorized. No deletion/cleanup flag or retirement script is supplied by the current migration/rollback tools.
