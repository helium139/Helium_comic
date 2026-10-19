# Phase 2A + 2B: scoped dashboard and catalogue statistics

The admin homepage uses the existing claim-consistent `requireStaff()` guard and
canonical teams.json reader. No Worker authorization, Firestore rules, publishing
API, notification, comment or reader-view implementation changed.

## Scopes and lists

Admins start at All Teams and may select any canonical team, including an inactive
team for historical content inspection. Selecting a team updates the cards and
manga table in memory. Leaders have a fixed scope equal to currentStaff.teamId;
the hidden, disabled selector has no options or change handler. The model also
forces the leader scope, regardless of a supplied/requested scope value.

The table shows title/cover, canonical team display name, chapter count, status,
last dated chapter/update in UTC, and the existing manga editor link. The last
update is the latest valid createAt timestamp rather than the last array element,
because chapter IDs and publication dates may be out of chronological order.
Empty catalogues/teams show zero counts and a clear empty state. Unknown ownership
in an administrator's displayed catalogue fails loudly rather than assigning a team.

Frontend filtering is UX, not authorization or confidentiality. The catalogue is
public. Existing claim checks and backend ownership/path checks remain authoritative;
editor URL protection remains unchanged.

## Cards

- Total Manga: number of catalogue entries in the current scope.
- Chapters This Month: number of scoped chapter records dated within the UTC month.
- Comments: Available in Phase 4, since no efficient scoped aggregate is maintained.
- Total Views: Not active yet.
- Views This Month: Not active yet.

No mangaStats values are loaded or relabelled as valid/payment views. No comment
threads or raw events are fetched to populate the dashboard. Unavailable metrics
are visibly unavailable, not shown as zero.

## Historical date contract

All 451 chapters inspected currently have createAt with an explicit UTC Z suffix.
This field remains editable legacy catalogue metadata and is only a temporary
historical/dashboard source. Future authoritative firstPublishedAt data will
replace it. No chapter records or dates were migrated or modified.

Month start is inclusive 00:00:00 UTC on day 1. Next month start is exclusive.
UTC offsets are respected; date-only YYYY-MM-DD values are interpreted as UTC.
Timezone-less date-times, impossible calendar dates, and missing/invalid dates
are excluded and reported as a scoped warning. Calendar logic is independent of
the browser's timezone. The month is recalculated at rendering time; reload after
a month boundary or catalogue publication to refresh the visible data.

The count represents every catalogue chapter whose date falls within that full
calendar month, including later dates within the month. It does not prove actual
publication time. A publication date edit can change historical counts until an
authoritative publication registry is implemented.

## Performance and UI

After the guard resolves, the page loads the catalogue once and gets team metadata
through the shared reader/cache. Scope changes require no network requests.
Statistics use in-memory catalogue arrays, with no per-manga Firebase reads,
additional Firestore queries/listeners, or backend aggregate writes.

The page reuses the existing sidebar, dashboard-grid and stat-card styling, with
CSS scoped to dashboard-page so editor layouts are unaffected. It includes mobile
viewport metadata, responsive cards, a horizontally scrollable table, keyboard
focus styling, accessible labels, and live scope/result text. Dynamic content is
rendered using DOM text properties rather than interpolated HTML.

## Validation

```sh
node --test scripts/test-dashboard.mjs scripts/test-staff-access.mjs scripts/test-team-compatibility.mjs scripts/test-cms-auth.mjs scripts/test-worker-authorization.mjs scripts/test-firebase-session.mjs scripts/test-reading-progress.mjs scripts/test-push-notifications.mjs scripts/test-chapter-readiness.mjs
node scripts/validate-catalogue.mjs
git diff --check
```

Seven focused dashboard tests cover UTC boundaries, offsets/year rollover, invalid
and missing dates, empty teams/chapters, latest-update selection, immutable input,
admin filter changes and request counts, fixed leader scope, foreign-link absence,
access/load failures, and placeholders without Firestore reads. Existing staff,
editor, cover-staging, Worker authorization, notification, history/progress and
chapter-readiness suites remain regression coverage. The workflow runs the new
suite before publishing.

Tests are local and use a mocked DOM/network plus pure date/scope calculations.
No browser executable is installed in this workspace, so actual responsive browser
layout and production account/network behavior were not exercised. No production
requests, commits, pushes or deployments were performed.
