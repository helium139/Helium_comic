# Phase 1B frontend staff access

Public navigation, the admin guard, and scoped editors now accept both admin and
team_leader. Authorization on the Worker is unchanged and remains authoritative.
No Firestore rules, view code, analytics, comments or notification logic changed.

## Identity contract

`staff-access.js` reads `user.getIdTokenResult()` and resolves `{ uid, role,
teamId }` using the custom role/team claims. The profile supplies a consistency
check, not authority: a staff role mismatch or leader team mismatch fails closed.
A leader must have matching teamId in both profile and token and an active entry
in canonical teams.json. An admin has unrestricted team scope and may have no team.

An ordinary reader or missing profile role defaults to user, never to staff.
Profile-only staff assignments cannot enable access. If the token is missing the
corresponding claims, navigation shows refresh/sign-in guidance and the guard
shows a useful error instead of starting page initialization. Missing leader team
assignment also produces an explicit error. Unknown/inactive teams are denied.

To apply recently provisioned custom claims, force-refresh the SDK token with
`await auth.currentUser.getIdToken(true)` or sign out and sign back in, then reload
the page. A refresh cannot create claims that have not been provisioned by the
trusted backend. If profile/token values still disagree, fix the trusted assignment.
Tokens are not manually persisted or decoded. The frontend does not verify JWT
signatures; the existing Worker verifies the token independently per mutation.

## Navigation and page entry

`auth.js` delegates the staff link to `staff-navigation.js`. Only claim-consistent
staff get one Admin / Dashboard link. Ordinary users and guests have none. Links
are cleared on account changes/logout, and late async callbacks cannot reintroduce
an earlier account's link. Existing notification logout handling is preserved.

All three page modules await `requireStaff()` before loading catalogues or
initializing editors. `requireAdmin` remains an alias for compatibility and now
means entry to the shared staff admin area. Guests go to /login/; ordinary users
go home. Staff configuration/token errors remain visible in the admin content.
Later auth changes revalidate access and reload the dashboard when staff scope
changes, rather than reusing the previous scope.

## Scope and editing

Admins retain all manga and team choices. Leaders see only manga whose explicit
teamId exactly equals their claim teamId. Legacy display-name ownership never
expands leader scope. The public catalogue and /mangas endpoint remain public;
frontend filtering is for staff UX, not confidentiality of published content.

The dashboard links to `/admin/manga/?manga={slug}`; the old inline editor referenced
missing DOM elements and has been replaced by these scoped editor links. No cards,
statistics, analytics, or team selector were added.

The manga editor scopes initial and refreshed lists. It validates requested manga
before editor initialization, exposes only the leader's locked team choice, and
locks adminPick/pickOrder. Leader payloads derive teamId from resolved staff context
and preserve editorial values even if disabled controls are changed in DevTools.
Mutation handlers also check current manga scope. The Worker still independently
checks ownership and protected fields.

The chapter editor scopes the parent dropdown and validates query-string parents
before binding upload/edit controls. Own-team chapter zero and edit URLs for
completed manga work. A requested own manga is preselected for new chapters.
Upload/save paths assert parent scope before sending mutations. Foreign-team and
missing parents show permission denied before their content initializes.

Changing JS objects or bypassing these frontend checks cannot bypass the Worker's
existing verification and ownership checks. Existing public rendering is otherwise
unchanged; generic stored-content HTML hardening is outside this access change.

## Tests and operational limits

Run:

```sh
node --test scripts/test-staff-access.mjs scripts/test-team-compatibility.mjs scripts/test-cms-auth.mjs scripts/test-worker-authorization.mjs scripts/test-firebase-session.mjs scripts/test-reading-progress.mjs scripts/test-push-notifications.mjs scripts/test-chapter-readiness.mjs
node scripts/validate-catalogue.mjs
git diff --check
```

Tests use role/token fixtures and mocked DOM/SDK/network calls. They cover actual
navigation wiring, both staff roles, ordinary/guest denial, profile-only stale
claims, missing team claims, scoped lists, direct foreign-team URLs, disabled and
tampered controls, chapter zero, and guarded page initialization. They do not log
into production accounts or mutate production content. Verify the deployed test
user's real custom claims and exercise the deployed frontend/Worker together
before rollout. No commit, push or deployment is part of this change.
