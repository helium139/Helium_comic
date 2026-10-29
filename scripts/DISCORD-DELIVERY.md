# Chapter delivery

The previous workflow used the default single pending slot for `pages-release`.
New arrivals could replace a pending publish even with `cancel-in-progress: false`.
The notifier compared only `github.event.before` with the triggering catalogue,
so the next surviving run could not recover chapters from a replaced run. There
was no timestamp guard, cooldown, or delivery receipt. Retrying a partially
successful run resent its earlier successful messages; a 429 failed the queue.

The workflow now enables `queue: max` (up to 100 pending runs) and keeps deployment
serialization. Every notifier reconciles its deployed catalogue against the fixed
rollout baseline in `discord-delivery.mjs`, then subtracts confirmed deliveries.
Thus a later surviving run can recover chapters from a canceled pending run if
those chapters remain in its catalogue. Existing chapters at the rollout baseline
are historical and are not replayed. Do not change that baseline casually.

Event identity is the JSON tuple `[manga slug, string chapter ID, pretty chapter
path]`. Titles and timestamps do not affect identity. All new chapter IDs are
detected, duplicate catalogue entries collapse, and delivery is sequential in
slug order followed by numeric chapter ID order with a string tie-breaker.

Receipts live in `discord-delivery.json` on the dedicated
`discord-delivery-state` branch. The branch is created automatically on the first
run with outstanding chapters, using the workflow token's `contents: write`
permission. No new secret is required. This branch is separate from `main` and
the Pages deployment. Do not delete it: deleting it loses delivery history.
GitHub Contents API updates use the file SHA to reject conflicting writes.
All callers must retain the shared workflow concurrency group.

Each chapter first passes the existing exact-URL HTML/OG image readiness check.
Discord POSTs use `wait=true`; only successful responses are recorded, immediately
per chapter. Payload formatting, mention behavior, pretty URLs, cover selection,
and site generation are preserved. A failed chapter stops the queue visibly;
rerun the workflow or dispatch it manually after correcting the failure.
Confirmed earlier chapters are skipped on retry. Failed messages remain pending.
Firebase handoff includes already confirmed Discord chapters to recover a failed
handoff; its existing backend chapter deduplication handles repeated payloads.

HTTP 429 retries the same payload up to six total attempts, waiting for the larger
of `Retry-After` and JSON `retry_after` (seconds). Exhaustion fails without recording
success. Other HTTP failures remain retryable by a later workflow run. Response
bodies and webhook URLs are not included in delivery errors.

Discord and GitHub cannot commit atomically. A runner crash or ledger failure
after Discord accepts a message but before its receipt is persisted can cause a
duplicate on rerun. A transport error can also hide a successful Discord delivery;
the script avoids automatically reposting ambiguous transport failures. Strict
exactly-once delivery across these cases is not supported by Discord webhooks.

Local verification (no production requests):

```sh
node --test scripts/test-discord-delivery.mjs scripts/test-chapter-readiness.mjs scripts/test-push-notifications.mjs
```
