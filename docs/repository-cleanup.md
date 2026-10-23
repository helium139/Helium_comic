# Repository cleanup inventory

Audit before edits: 785 tracked files. Reviewed tracked paths, JavaScript imports and
HTML entrypoints, all three package manifests, the Worker entrypoint/wrangler config,
GitHub Actions, generated-route builder and maintenance documentation. Reference
searches use tracked source, tests, HTML, workflow and documentation (not dependencies).

| Class | Files / decision |
| --- | --- |
| A: production | assets/js, assets/css, admin, worker/source, functions/lib, public HTML/service workers: retain responsibility-based modules. Consolidate only repeated image fallback in manga-card.js. |
| B: build/deploy | scripts/build-clean-urls.py, generate-og-images.py, generate-app-icons.py, discord-notify.mjs, wait-for-chapter.mjs, config files and generated routes: retain; workflows and refreshable URLs depend on them. |
| C: CI | .github/workflows/site-update.yml, package manifests/locks, catalogue validation, Python OG tests, Firestore emulator configuration: retain. Add recently introduced regressions missing from workflow. |
| D: regressions | authorization/ownership, image conversion/mixed extensions/promotion, views/accounting, comments, reports, notifications, reading progress and admin/page tests: retain. These test distinct boundaries. |
| E: operational/manual | scripts/webp/migrate.mjs, rollback.mjs, cleanup-originals.mjs and docs: retain; documented maintenance and recovery workflows still use them. Local ignored webp journals and .env.webp: untouched. |
| F: obsolete | admin/utils/builder.js and logger.js: no imports, HTML references, workflow/package/doc references, or external symbol references. Remove. WebP test-diagnostics.mjs: merge into test-migration.mjs, retaining every assertion. |
| G: dead code | script.js isNewChapter: no callers after shared card extraction. console.table catalogue dump and comicpage.js chapter URL console.log: debugging only. Old .swiper*, .slide-title selectors: no generated runtime markup or constructor remains. Remove. |

No test-directory migration: VM extraction tests and fixtures use source-relative paths;
moving everything would add churn without improving these narrow modules. No runtime
module mega-merges: pure URL, FIFO, catalogue, auth and backend helpers are imported
independently by different consumers. No dependency removals: jose, Firebase, AWS SDK,
Sharp, lint and rules-test dependencies have active runtime/test/maintenance consumers.

Single sources retained: adminPick/pickOrder in catalogue; isRawCaughtUp boolean;
teamId ownership with legacy team display labels; private trusted aggregates separate
from public mangaStats popularity. These are compatibility/security distinctions,
not duplicate state to delete. Optional-editor DOM guards protect older HTML and tests.

Generated pages, OG images, firestore.rules.backup (local/untracked), account caches,
and recovery journals are not deleted. No live data, secrets, R2 paths or URLs changed.

## Completed changes and verification

Deleted `admin/utils/builder.js`, `admin/utils/logger.js`, and
`scripts/webp/test-diagnostics.mjs`. The diagnostics tests were appended to
`test-migration.mjs`; no regression assertions were removed. No files renamed.
Added only this inventory/report, for a net reduction of two tracked files
(785 to 783 after adding the report).

`installCoverFallback` in `assets/js/manga-card.js` now serves completed, team,
ranking and featured-carousel renderers; the ranking adapter keeps its exported
API. Existing scopes and featured-background cleanup remain intact. Removed
unused homepage `isNewChapter`, catalogue console dump, chapter-link debug logging,
and unused Swiper CSS. Left external Swiper includes in legacy/generated pages
alone to avoid unrelated generated-file churn; no live Swiper markup/constructor
was found. Operational CLI output and error reporting were retained.

No dependencies changed. Only the WebP package test command changed to reflect the
merged diagnostics suite; its lockfile dependency graph is unchanged. CI now also
covers chapter promotion, original cleanup, Admin's Picks, completed/team pages,
rankings, push notifications and reading progress. Existing emulator/lint/security
steps are retained. The ranking test now checks the existing English status labels;
the follow VM test supplies the actual imported rawBadge implementation instead of
failing because its import-stripping harness omitted that dependency.

Verification with cached Node **24.22.0** (CI uses Node 24):

- All 31 retained JavaScript test files pass under `node --test scripts/test-*.mjs scripts/webp/test-*.mjs`.
- Six Firestore integration assertions in four test files explicitly skip without
  `FIRESTORE_EMULATOR_HOST`. These are **not** locally verified integration passes;
  the existing CI emulator command is unchanged.
- All 13 Python OG tests pass.
- Firebase Functions ESLint passes.
- All 123 retained JavaScript files parse; all static relative module imports resolve.
- Catalogue validation passes for 34 manga / 2 teams.
- `git diff --check` passes.

No browser visual or live service/deployment verification performed. No catalogue,
chapter, image, Worker authorization, Firebase configuration, secrets, public routes,
or accounting data changed. No push or deploy performed.
