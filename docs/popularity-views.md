# Manga popularity views (non-accounting)

`mangaStats.views` is a **legacy/popularity-only** public counter. Existing counts
are retained and incremented; they must never be used for payroll or accounting.
It remains completely separate from `validViews`, analyticsScopes,
chapterViewEvents, sessions, and deduplication. The Phase 3 functions, accounting
modules, rules, activation, and aggregate consumers are unchanged.

The reader calls `recordChapterPopularity` after valid chapter metadata and the
first image successfully load. There is one attempt per chapter per page lifecycle;
bfcache restores do not add another attempt. A new page load may count again.
There is no ten-second requirement for popularity. The detail page only reads
historical/popularity stats and never submits a popularity increment.

The independent guest-capable callable validates manga/chapter against the trusted
published catalogue and atomically merges only `views: FieldValue.increment(1)`
into mangaStats. It never replaces the document or writes likes/follows. Existing
browser rules still forbid direct view writes. Client failures are swallowed so
reading and valid-view accounting continue. The public view count has a popularity
label in its tooltip. Client-side image success is not a server-verifiable human
read; refreshes, scripted calls, and retries can inflate this popularity metric.
These limitations are precisely why it cannot be a compensation metric.

App Check reuses existing client initialization. The independent backend parameter
`ENFORCE_POPULARITY_APP_CHECK` defaults false and can be enabled after validation;
existing comment/view enforcement settings are untouched. No secrets/indexes/rules
changes or data migration are required.

Deploy only the new function from the repository root, then publish the frontend
through the normal workflow (neither step was executed by this change):

```sh
firebase deploy --project helium-team-d7f80 --only functions:recordChapterPopularity
```

Verification: Functions lint and popularity/reader/history/valid-view/dashboard/push
regression tests. New tests verify failed image loads do not submit, repeat callbacks
submit once, guests work, invalid chapters fail, likes/follows are preserved, and
writes target only mangaStats.views. CI includes the new suite.
