# Test cleanup after WebP verification

The WebP change was merged separately in PR #12. The existing inclusive chapter
JPEG threshold is 2 MiB (2,097,152 input bytes). Encoding must preserve the full
page dimensions; unsafe dimensions or invalid encoded output preserve the original.
WebP remains lossy at the existing quality setting, not a lossless pixel copy.

## Removed one-time checks

Removed `scripts/test-push-retirement.mjs` as a separate retirement audit suite.
These two completed-release assertions no longer run:

- `no UI, prompts, FCM or retired calls; Discord publishing stays`
- `only four exports retired; Auth/views/comments/reports preserved`

The other four tests were moved, not deleted, to
`scripts/test-service-worker-retirement.mjs`. They protect active browser cleanup:
exact script/scope matching, rechecking replacement workers after unsubscribe,
unsupported browsers not blocking login, and self-unregistration without deleting
PWA caches. No runtime push, PWA or authentication code was changed by this cleanup.

## Tests retained

Image conversion, chapter staging/promotion/edit/retry, CMS authorization,
Firestore Rules, view dedup/accounting and report reconciliation remain regression
coverage. WebP migration/restore/cleanup tests protect still-available destructive
maintenance tools; they are not discarded merely because the first migration ended.
Workers streaming/performance tests protect Free-plan memory/subrequest behavior.
The paused Cloudflare view migration is not established as stable, so its tests
were not deleted as a completed feature.

## Avoid repeating regression suites on content-only publishing

Update Site skips the 14 regression/test-dependency setup steps only when the full
push diff contains exclusively `assets/data/data.json` and/or
`assets/data/version.js`. Team registry, source, tests, workflows or mixed changes
still run the complete existing checks. Manual runs, missing/invalid history and
empty comparisons default to running tests. No reset of cloud pilot counters or
cloud workload is involved.

PR regression checks use the same two-file content exception. Catalogue ownership
validation, site generation, Pages publishing and chapter-delivery readiness stay
in the release path; public content is still validated before publishing. This is
not a claim that every legacy test is disposable or that deployment is test-free.

Local verification: four retained service-worker scenarios passed; the actual Bash
workflow policy passed six temporary-Git-fixture cases: content only, team registry,
code, mixed changes, manual run, and unknown base. WebP/chapter verification before
cleanup passed 54 tests. GitHub CI must pass before merging this cleanup separately.
