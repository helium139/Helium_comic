# Isolated fixture tooling

Do not run against CMS or real Firebase. Current cloud experiment is COMPLETE and
its workers.dev endpoint is disabled. Read docs/authority-pilot-cloud-results.md.
No repeat workload, extra resource or Paid upgrade is implied by these commands.

Local reproduction (fresh PRIVATE_DIR OUTSIDE tracked files):

    npm ci --prefix worker --ignore-scripts
    node scripts/authority-pilot/prepare-live.mjs PRIVATE_DIR
    node scripts/authority-pilot/validate-live-local.mjs PRIVATE_DIR

prepare-live generates synthetic RSA and gate credentials; do not commit that
directory. It refuses an existing cloud-ledger.json to prevent deployed-key drift.
The builder is lockfile-pinned; actual run bundle SHA is in the cloud result.

cloud-admin.cjs is explicit-mode control-plane tooling, never invoked by CI. It
requires dedicated process CLOUDFLARE_API_TOKEN and explicit CLOUDFLARE_ACCOUNT_ID.
No credential is loaded from global Wrangler config. Exact pilot name is fixed;
recorded account mismatch or an already-issued create/upload fails closed.
Current provision mode MUST NOT be rerun. The control-plane history and synthetic
keys for the completed run remain in the ignored private directory. No public
resource in this package is a reusable production authority endpoint.

run-live requires the recorded dedicated URL, fixture keys and absent pre-send
journal. No automatic retry after unknown response. Controller supports mock
failure headers and OPTIONS; full per-request trace data must come from Cloudflare,
not performance.now. analyze-live rejects other script names and duplicate CPU
samples. report-live requires durable workers.dev disabled proof before publishing
sanitized measurements, retaining full budget reservation for aborted SQL without
metadata. Raw provider logs, keys and journals stay private.

The fixture globally blocks outbound fetch and injects all Google requests into
the D1-backed mock. Actual Google transport/IAM testing is separately unapproved.
It has fixed data bounds,64read/32write reservations, <=12SET attempts and expiry;
unmetered third-party HTTP cannot be globally hard-capped by a Worker itself. Its
unguessable gate key, no production domain and endpoint shutdown bound exposure.
No actual foreign/unauthenticated requests were part of this experiment.

Budget/audit SQL and mock persistence add CPU. The measured NO-GO applies to this
instrumented package; do not infer a production role-sync invoice or universal
Free impossibility from it. Lease5minutes remains an undecided candidate policy.
