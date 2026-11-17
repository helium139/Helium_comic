# Normal Firebase browser login — release smoke, no signBlob

This replaces the proposed custom-token test path. Runtime application code does
not change. CPU lab stays paused; PR #7 is not used. The user approved production
release subject to checks, staff maintenance and successful permission tests.

## Session handling

Run `node scripts/staff-browser-smoke.mjs` from the PR #9 worktree. Chrome opens a
dedicated off-the-record browser context at `https://heliumtg.com/login/`.
The user clicks **Đăng nhập với Google**, selects the expected existing account,
and dismisses the normal success alert. No password or token is requested in chat.
The script reads the normal Firebase SDK session only after explicit capture.
Only UID, role, team, version, expiry and probe status can be printed. Decoded JWT
metadata is not cryptographic verification; the real backend decides access.

Browser cookies/IndexedDB are in the off-the-record context, not a reusable login
profile. Tokens remain in the Node vault/browser memory, never a journal, file,
report, Git, screenshot, console/network trace or chat. The tool does not subscribe
to browser console/network events. Quit/SIGINT/SIGTERM closes contexts and clears
the vault; unexpected process death does not justify replaying any write.
Do not close this process while an old-token comparison is pending.

`capture admin` must match the manifest's existing Auth admin, not the owner's
profile-only admin. `open owner` uses a separate browser context. `open test` is
disabled unless an exact test UID has been entered in the ignored local file
`.local-cms-build/production-release/browser-test-identity.private.json` as
`{"testUid":"<confirmed dedicated test UID>"}`. It cannot equal either real admin.
No account is created or promoted by this tool.

## Before deployment / production writes

1. Verify source, exact release SHA/CI, routes/bindings, three-staff manifest and
   encrypted restore backups as in the release runbook.
2. User logs in as the existing admin; `capture admin` verifies the UID matches.
   Open the existing CMS/dashboard to confirm the current admin UI. No upload or
   real chapter/view is used as an authentication probe.
3. Optional `probe admin` sends exactly one deliberately invalid `/upload` request
   (JSON `{}`, no file/folder/manga). Baseline may reject during validation; a 400
   alone does not prove the new grant checks are deployed or operational.
4. Confirm which account is disposable for revoke/transfer tests. The two real
   admins are excluded. Verify a supported active destination team and free leader
   slot before any transfer; do not displace an existing leader or add a team as an
   implicit part of testing. If unavailable, that transfer case remains blocked.

## During maintenance / only after bootstrap and deployment

1. Close staff writes. Bootstrap the existing admin first, ACK Auth/profile/grant,
   then `refresh admin`. Confirm the new versioned admin works before relying on
   new guards. Preserve the original admin throughout.
2. Bootstrap the eligible leader; deploy guarded Functions, repair owner through
   the approved barrier, deploy Rules and guarded CMS in the release runbook order.
   Neither the normal-login tool nor a successful baseline probe replaces ACKs.
3. On the dedicated test account, after its versioned leader grant is active,
   `refresh test`, confirm grant/claims/profile match and prove the granted access.
   Then `freeze test`. The frozen token is immutable across subsequent refreshes.
4. Operator changes only the confirmed test account through `setUserAccess` with
   expectedVersion and one persisted requestId per operation, without changing
   ownership. While pending and after ACK, `probe test old` must be denied (403).
   One request, no automatic retry. Fresh login/refresh must also lack revoked
   privileges. Transfer to a supported free destination must deny the old team;
   a current fresh token must be tested against both team scopes.
5. Restore the test account with a NEW higher-version operation, never decrement
   version, delete grants, or restore JWT-only rules. The old frozen token remains
   denied after restoration. If any consistency/auth check fails, keep staff writes
   closed and recover through the guarded path.
6. The invalid-upload probe is only a non-writing guard probe. It does NOT prove
   correct ownership/publish behavior, operation audit, or cross-team denial after
   a valid file is supplied. Separately perform one bounded upload/publish against
   an explicitly reserved synthetic test manga/chapter, validate catalogue CAS
   and no real data/view changes, and check all intended guarded API surfaces.
7. Reopen only the approved two admins and leader testteam after all gates pass.

All grant changes, upload/publish and restore are explicit operator steps, not
automatic commands in this login helper. Native Auth logout/revokeRefreshTokens
alone is not a substitute for the canonical versioned grant change.
