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
