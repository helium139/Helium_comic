# Admin comments and manga pagination

The Comments sidebar link opens `/admin/comments/`. The page awaits the existing
custom-claim-consistent staff guard, loads the static catalogue and teams once,
and scopes selectors with the existing staff helpers. Admins can select All Teams
or a team and then a manga. Leaders have fixed own-team scope and no All Teams
selector/options. A foreign manga query parameter is rejected before comment reads.

Comments are loaded for one selected manga, using existing `listComments` and
`moderateComment` callables only. Each response must affirm canModerate before
comments/actions render, so server ownership/claim changes fail closed. The backend
continues to authorize each moderation action and append its audit event. All
backend, rules, indexes, public comment UI, upload, and accounting files are unchanged.

Cards show manga title, commenter, date, reply count, moderation status, and safe
text or hidden/deleted placeholders. Hide/Restore/Delete require confirmation.
Roots have cursor Load more; replies load only on expansion and have independent
Load more. Stale asynchronous responses are ignored after selecting another manga.
Text uses textContent; hidden/deleted text is never rendered, even if present in a
malformed client fixture.

The status filter applies to **loaded pages**, not a server-wide query. Nonmatching
roots remain as thread-context shells so staff can expand them to find matching
replies. Staff can load older root/reply pages explicitly. This avoids an unbounded
scan or a new moderation/listing backend. No all-manga comment fanout is performed.

Both dashboard table and Manga Manager cards now use `admin/pagination.mjs`:
10 items per page after staff authorization, team filtering, search, and existing
sorting. Previous/page numbers/Next preserve scope/search. Search/team changes
reset to page1, and deleted-item refreshes clamp to the last valid page. Empty
results show0–0 with navigation disabled. Dashboard statistics count the whole
selected scope, and changing manga pages does not refetch/reset view analytics.
No additional catalogue network requests or Firestore catalogue reads occur.

The Comments page is a source page at `admin/comments/index.html`; existing generated
manga/chapter entry pages are synchronized from their source templates. The clean
URL generator will continue regenerating those templates with the new navigation.
No deployment, commit, or push was performed. Publish through the normal frontend
workflow when approved; no Firebase deployment/manual Console steps are needed.

## Changed files

- New `admin/comments/index.html`, `admin/comments.js`, `admin/pagination.mjs`
- `admin/index.html`, `admin/dashboard.js`, `admin/manga.html`, `admin/manga.js`
- `admin/chapter.html`, `admin/manga/index.html`, `admin/chapter/index.html`
- `admin/admin.css`
- New `scripts/test-admin-comments.mjs`, `scripts/test-admin-pagination.mjs`
- `scripts/test-dashboard.mjs`, `scripts/test-staff-access.mjs`, `scripts/test-team-compatibility.mjs`
- `.github/workflows/site-update.yml`, this document

## Verification

UI tests cover page size/final pages, disabled navigation, search/team resets,
leader-only pagination, admin moderation controls, team selectors, foreign manga
URL/selector rejection, safe placeholders, lazy replies, root pagination, status
filter contexts, and stale-response suppression. Existing editor/cover/chapter
and accounting suites are included in regression runs.

```sh
node --test scripts/test-admin-comments.mjs scripts/test-admin-pagination.mjs scripts/test-dashboard.mjs scripts/test-staff-access.mjs scripts/test-team-compatibility.mjs scripts/test-comments.mjs scripts/test-view-dashboard.mjs scripts/test-chapter-views.mjs scripts/test-view-service.mjs scripts/test-cms-auth.mjs scripts/test-worker-authorization.mjs scripts/test-reading-progress.mjs scripts/test-chapter-popularity.mjs
npm --prefix functions run lint
npx --yes firebase-tools@15 emulators:exec --only firestore --project demo-helium-views --config firebase.emulator.json "node --test scripts/test-comment-firestore.mjs"
```

The existing comment backend emulator suite passed12 tests with no failures/skips,
including admin/own-team moderation, forged-team denial, and audit/rules protection.
Functions lint, frontend syntax checks, and git diff whitespace checks passed.
Browser rendering/live Firebase calls still need a normal staging smoke test.
