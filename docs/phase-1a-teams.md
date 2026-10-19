# Phase 1A: team metadata compatibility

`assets/data/teams.json` is the canonical metadata source. Stable team IDs must
be explicitly assigned and must not change when names change. The legacy string
`HeliumTG` has an explicit compatibility mapping to `heliumtg`; unknown legacy
strings fail validation rather than generating new IDs.

`assets/js/teams.js` owns normalization, lookup, legacy ownership resolution and
catalogue validation. A present but unknown `teamId` never falls back to `team`.
The public page uses `team` only when `teamId` is absent. Lookup failures are
reported without interrupting unrelated public page rendering.

All 33 existing manga retain their legacy `team` and gain `teamId: "heliumtg"`.
No other catalogue metadata, IDs, chapter arrays or routes were changed. The admin
editor sends both `teamId` and the legacy display name for the unchanged Worker.
Legacy Worker responses without IDs remain readable using the shared resolver.
Whether the deployed Worker persists the new field requires integration checking.

Both new-profile creation paths call `createDefaultProfile` with fixed
`role: "user"`, a server timestamp, existing profile fields and empty likes,
follows and history arrays. No role/team input is accepted. Existing profiles
are not migrated. The legacy history array remains for compatibility; actual
reading progress continues to use the existing history subcollection.

`requireStaff()` resolves `{ uid, role, teamId }` for admins and leaders. Leaders
must have a known active team. `requireAdmin()` remains admin-only and is used
by every existing management page. Both editors await it before initialization.
No leader dashboard/navigation or publishing capability is enabled. These are
frontend gates, not backend security controls.

Phase 1B must inspect the external CMS Worker and Firebase backend/rules, enforce
trusted role/team provisioning, verify ID tokens and scope every mutation/upload
(including folder paths and image renames), and verify ownership persistence.
No production backend authorization changes are included in Phase 1A.

Local checks:

```sh
node scripts/validate-catalogue.mjs
node --test scripts/test-team-compatibility.mjs scripts/test-firebase-session.mjs scripts/test-reading-progress.mjs scripts/test-push-notifications.mjs scripts/test-chapter-readiness.mjs
python3 scripts/test-og-images.py
git diff --check
```

The publishing workflow validates the catalogue before generating/deploying the
site. Compatibility tests use mocks and local data; they do not publish content,
contact production Firebase, send Discord messages or establish production
backend security. Browser testing of the existing admin save flow remains a
separate integration check.
