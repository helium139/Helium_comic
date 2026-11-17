# CMS export comparison — 2026-11-17

Result: **provided live CMS export matches the PR #9 baseline's executable code**.
No business-logic rebase of PR #9 is needed on the evidence supplied. This is not
a deployment or authorization change, and does not itself execute the CPU lab.

## Provenance

- User supplied: helium-cms; version prefix **385be4b3**; traffic **100%**;
  observation date **2026-11-17**. Full UUID/routing/bindings were not included.
- Raw attachment: 86,436 UTF8 bytes, SHA256
  `266e2fd39377f9835cc0d82a4f905b272040485333ee45de670c90136d92ec50`.
- Repository baseline: 4955c7ca; candidate application runtime: b486a029.
- Original export retained privately under .local-cms-build, excluded from Git.
  No exported module was imported, evaluated or called. No cloud API was called.

## Reproduction and exact remaining differences

Rebuilt baseline worker.js and imported modules from Git, with baseline jose6.2.12
lockfile installation. Local esbuild0.28.2: ESM/browser/ES2022, keepNames true,
define navigator.userAgent as the string Cloudflare-Workers. That define reproduces
the two observed constant-folded environment expressions in jose; without it,
the generic browser build retains dynamic navigator.userAgent expressions.

This establishes equivalent code under the exported Cloudflare build environment,
not the identity of the historical compiler/options or dependency files not in
the bundle. The included dependency implementation matches the rebuilt baseline.

| Comparison | Result |
|---|---|
| Executable AST | Equal, 214 top-level statements |
| Canonical AST SHA256 for BOTH | 3626042ae8f2fd6464859ef5a005e96ca45222ac6d2722908e1e81140d3f9b4e |
| AST differing paths | Zero |
| Exact text after LF + whole-line comment removal | Equal |
| Raw bytes | Different, explained below |

Non-executable differences:
1. Export has 1,876 CRLF line endings; rebuilt baseline uses LF.
2. Module path comments differ for local dependency resolution paths.
3. Export has a trailing sourceMappingURL=worker.js.map comment; map itself was
   not supplied. Debugger/source mapping is not an executable logic difference.

Live LF-only size is 84,560 bytes; rebuilt size is 84,717. Export has 19 whole-line
comments versus 18 rebuilt. Removing those comments and trimming outer whitespace
after LF normalization yields identical code text. There are no other text/code
differences after that comparison, including literals, checks, limits and exports.

The AST comparator preserves directives, literal values and regex patterns/flags;
it ignores positions/raw spelling only, and reports paths rather than source
literals. Tests verify that removed authorization calls, changed strings/regex and
strict directives ARE detected. Thus a permission-check removal is not normalized
away. The exported source was never executed during comparison.

Offline reproducible comparison after baseline build:
`node scripts/compare-cms-export.mjs <export.mjs> <rebuilt-baseline.mjs> <report.json>`

## Intentional PR #9 versus live differences

Live is the OLD baseline; it does not contain current-access/version checks.
The known old-JWT behavior has not been fixed in production by this comparison.

- worker.js: fresh authority check on all eight mutations and pre-catalogue-save
  checks in the three save paths.
- firebase-auth.js: return verified accessVersion.
- current-access.js + shared access policy: bounded fresh grant read, matching
  state/role/team/version and fail-closed behavior.
- Existing upload/publish/edit/cleanup implementations and CMS dependencies/config
  are otherwise unchanged. Bootstrap/Google adapter/Rules changes are separate
  parts of PR #9, not code already running in this export.

## Decision

The SOURCE comparison gate for proceeding to the prepared isolated CPU lab is met.
Keep all previously proposed resources, caps, cold-state rules, stop conditions
and cleanup unchanged. No benchmark round or cloud resource has been started.
Do not use this result as proof of Free CPU headroom, real Google transport, route
coverage, binding correctness or full deployment-ID verification. Those checks
remain in their appropriate lab/release gates. No bootstrap, maintenance, claims,
Rules, Worker production deployment or Billing setting changed.
