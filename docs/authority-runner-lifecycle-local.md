# Local runner lifecycle: root cause, minimal fix and evidence

No cloud API, credential access, deploy, endpoint toggle or plan/Billing change in
this work. Pilot stays at its last verified disabled state; no new assertion from
cloud was requested. PR#7 remains draft. Application/Worker business runtime,
Google transport and historical journals/reservations are unchanged.

## Reproduced root cause

On Nodev24.13.0, the frozen original inspection code plus the original async-IIFE
ordering was run as a child against a real127.0.0.1 HTTP server. Server sentHTTP200
with HTML larger than4096bytes and closed its connection. Exact old sequence:

1. Append issued.
2. Fetch headers, then await inspectResponse(response.clone()).
3. Reader reaches4096bytes and awaits reader.cancel().
4. That cancellation is on ONE branch of a teed stream; it cannot finish while
   the original branch is unread. Original branch is withheld until inspection
   returns: a circular wait.
5. The pending Promise does not retain Node's event loop. AbortSignal.timeout's
   timer does not retain it either. The async IIFE was not awaited by the module.
6. Node emits beforeExit/exit0 at phaseinspect-clone, with finished:false;
   response-saved and finally are absent. No timeout or signal killed this
   reproduction. The process that exits is the Node REQUEST RUNNER child, not
   the parent test HTTP server or a separate supervisor.

Initial direct reproduction recorded PID6832; the committed exit trace contains
its beforeExit/exit evidence. The regression uses the same frozen old helper,
executes it in a fresh child and asserts exit0/missing finally, rather than merely
mocking a rejected fetch or killing an otherwise healthy worker.

Separately reproduced supervisor error: while a real delayed request is in flight,
result.json does not yet exist. Treating this as0/unsent is wrong. In the fixed
reader, the issued journal makes that state in-flight/unknown until terminal or
confirmed owner exit. A saved snapshot is not a process-liveness signal.

Historical limit: the old cloud run did not retain response body or sufficient
process-exit diagnostics/PID. The source bug is proven and reproduces its exact
symptoms; we CANNOT prove that that particular cloud response was HTML/over4KiB or
recover the historical process's actual PID/exit cause. Earlier speculation about
propagation, an external process kill or timeout is not a verified cloud cause.

## Minimal fix and state semantics

- Tooling reader cancels a bounded stream without awaiting cancellation of a
  possibly teed branch. Bounded response/error redaction stays in place.
- Replacement local runner performs one request in ONE process and consumes the
  body ONCE, without clone/tee or an inspecting fetch wrapper. Module explicitly
  awaits request, journal and result persistence. No child supervisor in runner.
- An explicit ref'ed deadline covers headers AND body; aborted work is recorded
  as timeout/unknown. The timer is cleared only after completion or error.
- Each run directory is created exclusively. Existing run directories cannot be
  resumed/replayed, including timed-out POSTs. No request retry exists.
- Append-only journal is authoritative, with fsync on each record; issued carries
  outcome:unknown BEFORE networking. Header status is saved as soon as obtained.
  Terminal is committed before the atomic temp/fsync/rename result projection.
- Terminal states: response-saved, transport-error, timeout, interrupted-unknown.
  HTTP/parse/protocol errors still have response-saved when the response was read.
  This is not an application success/authorization claim.
- SIGINT/SIGTERM handling records interrupted-unknown. SIGKILL/Windows hard
  termination cannot execute finally or write AFTER death: the preexisting
  durable issued/unknown record remains. Reader derives interrupted-unknown when
  owner is dead. It never turns that record into unsent and never enables replay.
- Disk failure: before durable issuance means no network call; terminal journal
  failure leaves issued/unknown; projection failure leaves a recoverable terminal
  journal. CLI reports failure(exit74 for persistence errors), not success0.
  Total disk failure or hard kill cannot guarantee a new terminal write; the
  durable pre-request unknown state is the fail-safe evidence, not invented data.
- Historical multi-script cloud request entry points are retired with an early
  throw, before reading credentials or making API calls. Their source remains
  reviewable. No new cloud adapter is wired. The new CLI rejects nonliteral
  loopback hosts, HTTPS/cloud URLs and redirects; at most one HTTP request/run.

## Before / after local results

| Scenario | Before | Fixed local runner |
|---|---|---|
| >4KiB HTML,HTTP200 |Child exits0 at inspect-clone; no result/finally |response-saved;200/redacted bounded HTML; result durable before exit |
| JSON/HTML/302/401/403/404/500/503 |Not fully distinguished by old snapshot |response-saved with status/protocol diagnostics; redirect not followed |
| Delayed headers/body |Snapshot may say no response/0 |in-flight/unknown, then saved response or timeout |
| Lost connection/body |Missing result possible |transport-error persisted; known headers retained |
| Timed-out POST |Replay unsafe |One synthetic write only, timeout persisted; directory blocks retry |
| Hard process kill |No finally |issued/unknown persists; reader says interrupted-unknown |
| Graceful signal |No reliable terminal guarantee |interrupted-unknown persisted before exit |
| Disk failures |Snapshot/result could be mistaken for truth |No request before issued commit; exit74, journal recovery/unknown |
| Version/deployment metadata |Wrong ID comparison existed |Pure fixtures: normalized upload version matches version_id, never deployment object'sID; wrong runtime version/fingerprint detected |

30 lifecycle tests pass THREE consecutive runs (no skipped cases). Combined affected
lifecycle/response/controller/cleanup tests:56/56. Tests use a real localhost HTTP
server and child process exits, not local timings as cloud CPU. Graceful Windows
signal-handler test injects SIGTERM via test IPC; the hard-kill test actually
terminates the child. Disk ENOSPC/EIO are deterministic injected I/O faults; not a
claim that the machine's real disk was filled. JSON/error bodies contain synthetic
private markers and tests assert they do not enter persisted diagnostics.

Commands:

```
node --test scripts/test-authority-runner-lifecycle.mjs
node --test scripts/test-authority-runner-lifecycle.mjs scripts/test-authority-pilot-diagnostics.mjs scripts/test-authority-pilot-control.mjs scripts/test-authority-pilot-cleanup.mjs
```

## SQL accounting

New local/readiness request SQL:0reads/0writes; runner has no DB dependency and
reserves no D1 rows. Synthetic POST writes above are an in-memory localhost counter,
not D1. No historical reservation was increased, refunded, reset or reclassified
as measured usage. Existing historical892R/401W are retained upper-bound holds,
NOT SQL measured by this work. Prior metadata measurements are separate evidence,
not replaced by those reservation ceilings. Historical unknown outcomes remain
unknown. No attempt was made to refresh daily usage or investigate cloud events.

Stop at local results. Do not propose or run another cloud round from this change.
