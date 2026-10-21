# 10A error-boundary repair

Follow-up to issue #458 / PR #478. User direction: “Fix error boundary.”

## Scope and implementation

Entry point: `provider-fastly`. The repair stays in the existing provider-owned
Native response and effect-settlement paths. Existing provider fixtures, the
canonical acceptance guide and its generated mirror supply regression coverage
and documentation. Protected paths are declared as `provider-registry` and
`runtime-target-fluidity`; this defect repair preserves their contracts. Human
review/merge authority is unchanged.

The shared terminal responder is now generated independently of optional JWT
evidence. After specialized response handlers have had their existing opportunity,
a generic failure sends one HTTP 500 with `Internal Server Error`. Original
failure code, stage and effect remain available to diagnostics; no internal
failure detail enters that generic response. The legacy internal function name
is retained because the existing body, header, transport and deadline owners
instrument that hook. It is not a public JWT dependency.

Fatal effect settlement also enters the shared responder. This removes the
separate silent fatal return and its redundant per-feature patches. Recoverable
Router errors still enter their admitted error lane, and deadline/transport/body
response precedence remains in their existing owners. JWT evidence builds retain
400 responses and evidence headers for actual JWT rejections; unrelated failures
remain 500 even in those builds. The normal invocation wrapper still closes
pending work after the driver returns. No new hostcall, fallback, public field,
dependency, resource limit or release policy is introduced.

The new compiled regression runs 16 cases: bounds failures with/without JWT
evidence, fresh-request recovery, fatal configuration failures with/without a
Router error handler, suppressed later secret access, actual JWT missing/malformed
token rejection, and a bounds failure in an artifact that also contains JWT.
It is enrolled in the existing `fastly-native-platform-capabilities` task.
Configuration/header tests now require exactly one HTTP 500 instead of asserting
that a failed request sent no response. Deadline source assertions follow the
shared response hook; their actual expired-group 504/recovery checks remain.

## Earlier attempts

The original 10A failed receipts remain unchanged. This repair does not turn
those historical outcomes into passes. During repair development:

- The first new fixture used unsupported `String(...)`; it was changed to the
  supported JSON projection without changing the compiler.
- A healthy fixture used deadline-aware KV without the corresponding mock
  authority; it now uses a simple later secret read to prove suppression.
- Added JWT routes initially omitted `async`, then the explicit secret-store
  binding; both fixture errors were corrected.
- Two existing tests asserted the previous silent-response behavior or its old
  source shape. They now assert the intended error response and shared deadline
  hook, while preserving runtime suppression/diagnostic checks.
- The separately selected historical `jwt-native-reality` gate stopped before
  execution because its prerequisite `jwt-d4/jwt-phase-d-seal.json` was absent.
  No predecessor was fabricated and no full JWT release seal is claimed.
  The scoped real compiled JWT rejection cases and cross-target application-error
  suite are the regression evidence for this repair.

Development receipts identify their actual source revision; early regressions
began on `e43700d` with uncommitted repair changes. Some later fixture-only fixes
were tested at `85f67dc` with a tracked test diff. They are development regression
evidence, not an immutable release seal. The final exact-installed real-host run
below is separately bound to a clean published implementation checkpoint.

## Clean implementation checkpoint

- Branch: `codex/b10-mcp-10a`, targeting `latest`; PR #478.
- Base: `76fa603093217b4685ea78e947501a98626e645d` (merged 09B).
- Product repair commit: `85f67dc43cb965949037e2039cf6c0b65c4efddb`.
- Tested implementation head, including final regression fixtures:
  `2ae120583ebdf154a8ff2e2a07f4519032d375b3`.
- Tested tree: `bea1ffb01e705a79b1d299e341bbb41cf2e50dcd`.
- Clean checkout before and after actual installed qualification. Package bytes,
  revision, tree and working diff were verified unchanged by the harness.
- The following evidence commit adds only this repair handoff, historical-status
  pointers and raw development receipts; it does not change product/test code.

## Final actual Fastly CLI/Viceroy result

**Passed: 1,445 / 1,445 exchanges in 200.99 seconds.** Fastly CLI 16.1.0 and
Viceroy 0.21.1; exact binary hashes/version outputs are in the qualification
receipt. The existing 10A assertions were not weakened or changed by this repair.
The parent installed acceptance is terminal `passed`, with
`providerRealityValidated: true`, `installed.unchanged: true`; the detailed
receipt has `coverageComplete: true`, `installedUnchanged: true`, no failures.

| Variant | Exchanges | Wasm bytes | Delta from blocked run | Median / max HTTP ms |
| --- | ---: | ---: | ---: | ---: |
| shipped | 605 | 1,046,697 | +221 | 4.34 / 51.49 |
| growth | 811 | 2,146,474 | +225 | 4.31 / 62.74 |
| deadline | 6 | 1,046,695 | +221 | 2.59 / 4.43 |
| resources | 23 | 1,142,081 | +213 | 1.29 / 7.31 |

Workspace and resource bounds failures each return HTTP 500 with exactly
`Internal Server Error`. The allocation-pressure case still returns HTTP 500
with Viceroy's `unreachable` trap detail. Healthy requests after all three failures
pass. Deadline expiry remains 504; no backend loopback or JavaScript fallback
participates. All five tools, independent complete read/search/citation
expectations, growth, protocol admission and repeated requests passed.

The compiled module ceilings remain 256 MiB. Rounded Viceroy completed-request
heap logs, module initial/max memory and HTTP latency are observations, not peak
live allocation measurements. Unknown peak/live/retained/RSS values remain null.
All four serving CLI processes terminated and output pipes closed; their exit
code 1 reflects deliberate server shutdown. Descendant process observation
remains unavailable. This is actual local provider acceptance, not deployed
service qualification or retained-instance execution.

## Completed checks and receipt interpretation

- Full unit profile: **68/68 passed**, 486.75 seconds (`unit.*`).
- Provider suite: **4/4 passed**: Native platform capabilities, Fastly package,
  Fastly apps and JavaScript runtime (`provider-r4.*`). Includes the 16 new
  terminal-boundary cases, actual compiled request deadlines, transport recovery,
  configuration/secret/KV/GRIP behavior and logging.
- Five regression tasks passed: Native HTTP shell, Native HTTP effects, request
  headers, callable lifetime and cross-target application errors. The same
  six-task report correctly remains failed because the historical external JWT
  gate could not load its prerequisite (`regressions.*`). The five passes are
  individually recorded; this is not a six-task pass.
- Authored-call / unused-Wasm regression passed (`no-call.*`). Existing no-call
  byte-identity checks were not relaxed. The shipped artifact's 221-byte increase
  is the measured generic failure-response repair cost.
- Standard real packaging rebuilt and verified all 20 packages and their exact
  installed bytes. It includes TypeScript build and fresh context/docs checks.
- Maintainer checks, scope classification, documentation sync/check and direct
  documentation-release passed (`maintainer-final.log`, `scope-final.log`,
  `docs*`). Final `git diff --check` passed.

`repair-receipts/index.json` lists byte lengths and SHA-256 for every retained
file, including uncompressed hashes for losslessly compressed `.gz` receipts.
Use `gzip -dc <file.gz>` to inspect those raw logs/reports. The final
`qualification.json` is directly readable; `installed-acceptance.json.gz` binds
source/manifest/package/artifact identities and preserves complete build output.
`artifacts/<variant>/` contains build manifests, config and compressed host logs.
Earlier failed development reports and logs remain failed and are retained beside
the passing runs. A stale copied fixture directory from concurrent development
checks was moved outside the repository before clean actual qualification.

Full local Wasm artifacts remain at:
`/workspace/scratch/d3826bbd4bf5/pulse-10a/wasm/.test-results/mcp-installed-a0j0iP/fastly-local/`.
Each variant has `bin/main.wasm`; its hash is in the qualification receipt. Binary
Wasm is not committed. Temporary installed consumers were cleaned by the harness.

## Handoff

The 10A error-response blocker is resolved by the fresh complete local run.
PR #478 is ready for human review; no local check remains running and the
published checkout is clean. Hosted checks are independently visible on the PR;
there was no merge, deployment, activation, publication or final release seal.

Next action: review/merge PR #478, then continue 10B (#459). Final release reuse
still requires a fresh run bound to the selected immutable integrated candidate.
