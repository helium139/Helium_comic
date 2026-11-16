# Push/health retirement — 16 November 2026

Project `helium-team-d7f80`: live inventory contained19 Functions before removal.
The four authorized DELETE operations completed successfully; live inventory now
contains15. All are in `us-central1`. Backend view A revisions were not deployed
or changed. No Auth, Firestore, profile, comment, popularity or ledger data deleted.

| Function | Trigger/caller | Data/authority | Decision |
|---|---|---|---|
| health | HTTP, no repository caller found | no DB | removed |
| registerPushToken | callable, former browser push module | authenticated user's pushTokens | removed |
| unregisterPushToken | callable, former browser push module | authenticated user's pushTokens | removed |
| notifyNewChapter | HTTP, former post-Pages workflow | followers + pushTokens, FCM, dedicated secret | removed |
| startChapterViewSession | callable, chapter reader | view config/session/rates, guest/Auth identity | keep A pending migration |
| recordChapterView | callable, chapter reader | ledger/dedup/rates/aggregates | keep A pending migration |
| getChapterViewAnalytics | callable, staff analytics | staff/team-scoped aggregates | migrate later |
| getMonthlyViewDashboard | callable, admin dashboard | scoped monthly aggregates | migrate later |
| getMonthlyViewReports | callable, report admin | report snapshots/history | migrate later |
| generateMonthlyViewReport | callable, report admin | ledger/aggregates, Drive/Sheets OAuth | migrate later |
| retryMonthlyViewReport | callable, report admin | report lease/audit, Drive/Sheets OAuth | migrate later |
| closeMonthlyViewReport | Scheduler HTTP, monthly00:10UTC | report close and Sheets | keep schedule pending migration |
| setUserAccess | callable, privileged admin | Auth custom claims + Firestore users | migrate with full team authority |
| listComments | callable, reader/admin | bounded comments queries | keep Google/Firestore |
| createComment | callable, signed-in reader | comments, validation/rates | keep |
| editComment | callable, owner | own comment | keep |
| deleteComment | callable, owner/staff | comment tombstones | keep |
| moderateComment | callable, staff/team | scoped moderation | keep |
| recordChapterPopularity | callable, reader | mangaStats/popularity | keep |

This is current inventory, not inferred from old request traffic. Scheduler still
contains the monthly close job and no job targeting the deleted health endpoint.

## Scope and browser transition

Removed chapter notification UI/CSS, permission prompts, foreground/background
FCM SDK, VAPID config and token registration. Auth sign-out no longer depends on
notification teardown. Shared Firebase app/config/Admin SDK remain for other features.
The dedicated notification badge is removed; shared PWA/app icons remain.

`notifications.js` is a compatibility tombstone for cached pages, and
`firebase-messaging-sw.js` is an updateable retirement worker. They contain no
Messaging SDK or notification handlers. Cleanup checks exact same-origin script
and known push scope, all lifecycle workers, and rechecks after async unsubscribe.
It preserves `/sw.js`, PWA/cache state, Firebase Auth and unknown replacement workers.
Offline clients are retired on next online visit/update; browser permission itself
can remain granted. No new notification permission is requested.

Pages build/readiness, clean-route generation, Discord delivery/receipts/retries
remain. Removed the Firebase handoff, payload file and unused delivery callback.
No CI or website caller targets the four removed endpoints.

## Secrets, IAM and token data

CHAPTER_NOTIFY_SECRET was bound only to notifyNewChapter across all19 Cloud Run
services. It has been deleted, including its resource-specific accessor binding.
All runtime/service-agent accounts are shared with retained features and remain.
No project-wide IAM role or service account was removed. Shared Firebase API keys,
Auth config, report OAuth credentials, view HMAC and DISCORD_WEBHOOK remain.
The two push-only GitHub secret names are CHAPTER_NOTIFY_SECRET/PUSH_FUNCTION_URL;
their removal is tracked separately from the code rollout.

Bounded Firestore inventory queried only pushTokens document names/updateTime and
a count capped at1001. Result: **0 documents**, no sample values, no deletes.
Existing rules explicitly deny client reads/writes of historic pushTokens and stay
in force. No users/profile scan and no event scan occurred. Recheck after retirement
to detect any in-flight writes; the prepared plan is capped at100 exact token-document
references with updateTime preconditions and excludes all other paths. Never print
raw token fields, document refs/UIDs or credentials into logs/Git. No data cleanup
is currently necessary; any future nonempty cleanup needs separate approval.

Private sanitized metadata/operation evidence are gitignored `docs/push-retirement-*.local.json`.
Local verification:133 tests passed covering push retirement, Auth, reading progress,
views, comments, report safety, CMS authorization/ownership and chapter/Discord delivery;
Functions entry point lint passed. Production login/comment writes are not exercised
using real users. The existing 15 Functions are not redeployed by this change.

The broader view/ledger/Sheets/multi-team migration remains active and is separate
from this removal release. The former$5/Free-only goal is superseded. No paid
Cloudflare subscription is enabled without review of its exact resources/costs.
