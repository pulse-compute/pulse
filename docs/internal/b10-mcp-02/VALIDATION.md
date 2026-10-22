# B10-MCP-02 validation

Development evidence, 2026-10-19, Node 24.19.0. The final proof base is
`47d32866d80fd068957d57688a7226896b06073a`; its tree is
`7e3ea0fe12a3e4e94f7268c12f7c7f3ad10e80ff`. The retained
[evidence.json](./evidence.json) binds the 51 changed product/test/documentation sources outside this
self-referential evidence directory (excluding unrelated untracked hidden test fixtures), the lockfile, generated handler, admitted
resource catalogue, three data files, canonical plan and both Wasm artifacts.
All listed source hashes were checked against the final checkout. The branch
then fast-forwarded to `40438c3d6ac2d3d54724c113e876196ff74890c4`, which changes
only architecture/contributor overview documentation and its two installed
mirrors. None is a corpus or compiler input; all 51 proof source hashes remain
identical. Documentation checks are repeated after that documentation-only update.

The lockfile-matched dependency trees restored for 00 were reused. An attempted
`pnpm build` invoked pnpm's dependency/build-policy workflow and stopped on
unapproved esbuild scripts; those scripts were not approved or executed. Its
workspace-policy template change was removed. `npm run build` ran the exact
repository TypeScript build successfully. A fresh clean dependency installation
or complete release seal is not claimed.

## Final focused proof

Command:

```sh
node wasm/scripts/run-wasm-tests.cjs --task context-native-proof --task native-context-primitives --task canonical-native-plan --task bounded-app-logic --task bounded-loop-helpers --task binary-resource-execution --task cli-diagnostics --no-report
```

Passed all seven selected tasks, terminal summary and exit 0, 249.09 seconds.
The context proof was rerun separately after cleaning unrelated copied test
scratch files from its source inventory: passed, exit 0, 77.01 seconds. That
last run owns the retained receipt. Its source hashes all match this checkout.

The final corpus has 245 records, 2,456 terms and 14,410 nonzeros. The growth
fixture has 512 records, 4,096 terms and 168,967 nonzeros, including 160 complete
1,024-entry rows. Both fit all simultaneous byte budgets. The 24,576-byte growth
text reconstructs across five bounded UTF-16-offset pages with escaped controls,
quotes, backslashes and supplementary Unicode. Scores, order, filters, offsets,
metadata and excerpts agree with the independent oracle in all 153 three-lane
parity executions. Node/Fastly Native deadline probes fail terminally without
partial success. Primitive tests include four-target parity, malformed/range
rejection, fresh zeroes, signed zero, nonfinite writes, stale access, source
escapes, forged ownership/initialization and workspace-only Fastly deadlines.

The slowest measured final Fastly invocation was 803.8 ms; the largest guest
committed memory was 26,738,688 bytes. Process peak RSS was 636,088,320 bytes,
including compilation, fixture data and host allocations. The largest Node
value-handle count was 629,660. These are local experiment measurements, not
Fastly deployment limits or an installed-consumer memory qualification.

## Repository checks

- `npm run build`: passed on the final checkout.
- `npm run maintainer:sync`, `npm run docs:sync`: passed; generated corpus and
  installed mirrors are synchronized with the newly merged documentation.
- `npm run maintainer:check`, `npm run docs:check`,
  `node scripts/documentation-release.cjs`: passed on the final checkout.
- Scope declaration/check: architecture change with all affected boundaries
  declared; human merge/release review remains required.
- The 35-task unit selection from `api-surface` through the end of the profile
  passed on the preceding base with the same product implementation.
- Native numeric regions, budgets, handle ownership/frames, helper/projection
  and loop checks passed in the broader development run. The supplementary continuation was deliberately interrupted after 66 terminal
  passing task receipts, including the remaining Native selection, all seven
  JavaScript tasks, and the resource/effect-collection/HS256/ES256 conformance
  tasks reached. It exited 130 while the RS256 task was closing; no terminal
  task or aggregate pass is claimed for that task or the unexecuted remainder.
- Focused schema presence/optional-property parity passed. The complete owned
  schema codec script also passed under `timeout 600s node
  wasm/test/contracts/assert-schema-codecs.cjs` (exit 0); this is diagnostic
  semantic evidence and does not erase the registered task timeout. It includes
  200 nested-JSON and 452 open-object cross-target executions.
- All six selected Fastly package/application/JavaScript/Native-shell/effect/
  platform tasks passed in one final-checkout run. Optional transport replay
  still reports its explicit Viceroy skip; these are injected-ABI claims.

Exact terminal task rows, log digests and failure/interruption tails are retained
in [validation-results.json](./validation-results.json). There are 153 distinct
registered tasks with passing receipts across these separate development runs;
this count is not a same-candidate aggregate claim. No validation process remains
running. The full Native/JavaScript/conformance/CLI/release gates still require
an uninterrupted passing run in the qualification environment.

## Retained failures and incomplete gates

The requested full `unit`, `native`, `javascript`, `conformance`, and `cli`
selection did not produce an aggregate pass. Subsequent bounded development
runs are separate evidence and are not pooled into a clean-candidate seal.

| Attempt | Observed result and disposition |
| --- | --- |
| Initial suite/control-plane run | New tasks lacked release-shard enrollment; corrected in the existing shard owner, then maintenance and release-feature checks passed |
| Numeric-region regression | Unnecessary expansion of the 256-iteration optimization cutoff selected an intentionally excluded case; reverted, and the complete numeric-region and numeric-budget tasks passed |
| `report-capsule-contract` | Registered 30-second task timed out on two changed-tree attempts and on unchanged base `7a0de3e…`; no passing task claim |
| `cli-report-retained-evidence` | Registered 60-second task timed out; no passing claim |
| `release-seal-lifecycle` | First run missed its subprocess PID fixture; unchanged-base run and changed-tree retry both passed |
| `release-recovery-runner` | Registered 90-second task timed out; no passing claim |
| `docs-executable-contracts` | Registered 240-second task timed out after multiple passing example commands; the task remains incomplete |
| Supplementary Native/JavaScript/conformance continuation | Deliberately interrupted after the focused schema/provider proof completed; 66 terminal passes retained, remainder unqualified |
| `schema-codecs` | Registered 180-second task timed out after passing JSON-admission, text-decoding and ScalarRecord groups; the same owned script passed separately under a 600-second diagnostic deadline, without changing the registered gate |

Early focused harness failures (BOM-stripping `Response.text`, an oracle that
incorrectly included full content in metadata, and an out-of-range fake clock
budget) were corrected before the passing final proof. Actual implementation
failures discovered during development were missing workspace-only Fastly
bindings/deadline wiring and schema string double escaping; both have passing
focused regressions. General loop limits and test timeouts were not raised.

Production deterministic rebuild/check, packed source-free acceptance, the
mandatory vector freshness/seal gate, real Fastly CLI/Viceroy and MCP client
interoperability remain B10-MCP-03/07/09/10. This unit establishes the isolated
Native feasibility prerequisite; it does not close the integrated B10-08/09 work.
