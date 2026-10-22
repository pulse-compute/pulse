# B10-02 — Host responsibilities and scheduling layouts

Date: 2026-10-18. Issue: [#375](https://github.com/pulse-compute/pulse/issues/375).
Classification: evidence / evidence-only. Target: `latest`.

**Recommendation: retain the mixed worker pool.** With the same two-worker,
two-compiler budget, this fixed-duration model puts dedicated host lanes at
43m57s for release plus installed tasks, versus 33m24s for the mixed pool.
Whole cross-target tasks concentrate work on the Fastly-capable lane. Removing
the release/installed barrier saves only 3.9 seconds in that mixed-pool model.
Neither result justifies a controller rewrite or separate host workflows.

Keep the operational setting at two workers / one compiler until the B10-00
cleanup failure is repaired and a complete controlled concurrency comparison
succeeds. These projections do not establish a safe concurrency setting,
qualify this candidate, or promise a sub-30-minute release-test stage.

## Evidence identity and limits

| Evidence | Identity / meaning |
| --- | --- |
| Source inspected | `b5aa67295fca1af35361b4cdcee50562290e8ebf`, tree `6cf8937c391d6015064035c0d270cac7f1871c52`; clean `latest` after B10-01 / #384 |
| Inventory | Existing `scripts/qualification-audit.cjs`; captured before this report was added; exact owner hashes in `inventory.json` |
| Timing candidate | B10-00 `74bf891ffe54865cca4869bf7c45d86ff172f34f`, tree `c79155d6e115d58f13c362d4784a081248dd2df7` |
| Timing attempt | `2026-10-18T04-49-50-564Z-G7pCEX`; local Linux, eight CPUs, 8 GiB, 6144 MiB admission budget; two isolated workers, one compiler |
| Completed observation | 190/190 release tasks and 11/11 installed gates passed, cleanup passed, no checkpoint reuse; controller stage times 49m32s and 9m46s |
| Timing inputs | One complete attempt only. Original runner-report SHA-256, ordered selections, terminal status, cleanup and command signatures in `timing-input.json` |
| Current-candidate measurement | None. This is source inspection and simulation, not a new seal |

The source closure comparison finds 199/201 task/helper closures unchanged
between the timing candidate and inspected candidate. The two changed closures
are `clean-machine-acceptance` and `jwt-installed-workflow`: B10-01 added
diagnostic observation through their wrappers and `phase-observer.cjs`.
The registry, scheduling policy and recovery semantics are unchanged. The
model keeps the older complete durations; it does not substitute the newer
partial measurements. Exact drift paths and 334 inspected source hashes are
in `results.json`.

The Beta.9 hosted 65m40s release-test baseline is useful historical context,
but is not this local model's input or a directly comparable speedup baseline.
The unsuccessful B10-00 two-compiler attempt stopped at 167 passed, one failed
and 22 not run. Its truncated duration is not a successful faster seal. The
B10-01 task probes are a separate candidate and experiment; their phase costs
must not be subtracted from these task durations.

## Complete task map

[matrix.md](matrix.md) contains all **190 release tasks and 11 installed gates**,
with source links pinned to the inspected candidate. `review.json` records
explicit target/method classifications and review notes. `results.json` adds
invocations, helper source paths, tool dependencies, prerequisites, preparation
owners, current scheduling hints, historical durations and evidence roles.
The raw generated `analysis.json` additionally retains operation, write and
cleanup source anchors and every simulated timeline.

| Responsibility group | Tasks | Observed task occupancy |
| --- | ---: | ---: |
| Shared contracts, compiler/lowering, package or evidence work | 70 | 8.78 min |
| Node responsibilities only | 64 | 13.61 min |
| Fastly responsibilities only | 17 | 9.05 min |
| Both Node and Fastly responsibilities | 50 | 34.29 min |
| Total | 201 | 65.73 min |

Occupancy overlaps across workers; it is neither elapsed stage time nor CPU
time. A mixed responsibility can include planning, build, rejection or reference
execution; these are not 50 interchangeable four-mode runtime tests. Every
scenario schedules each original task exactly once and keeps its internal
cross-target work atomic.

Methods in the matrix have deliberately different meanings:

| Method | Evidence responsibility |
| --- | --- |
| `plan`, `rejection-only`, `build` | Inspect/lower/reject or construct output; no corresponding host execution claim |
| `reference-interpreter` | Execute a lowering/runtime reference; not a compiled Wasm guest |
| Node Native `wasm-unit`, `local-http` | Compiled guest execution, sometimes through the real local Node HTTP launcher |
| JavaScript `in-process`, `injected` | JavaScript runtime/adapter with fixture host bindings; Fastly provider emulation is not the Compute engine |
| Fastly Native `abi-fixture` | Compiled guest under the repository's ABI fixture, not deployed Fastly |
| `js-compute-build` | Construct the JavaScript Compute artifact; does not establish engine execution |
| `viceroy` | Real local Compute engine path; still not a deployed POP |
| `abi-fixture; optional-viceroy` | ABI evidence always; engine branch depends on `PULSE_VICEROY_BIN`, so a task pass alone does not prove that branch ran |

The authoritative distinction is the per-task body, selected arguments and
notes, rather than a name or a method label alone. Examples that materially
change the proposed lane split:

- `assets-javascript-runtime` selects six Vitest files, including JWT provider
  runtime work with injected Fastly JavaScript. It is not Node-only.
- `cli-init-workflow`, `cli-project-workflow` and `cli-dev-workflow` contain
  Fastly Native work. The latter two also exercise Node JavaScript, but do not
  establish Fastly JavaScript execution.
- `schema-kv-parity` and `time-consumer` execute CLI tests internally. The former
  includes Native ABI execution; the latter includes all four target cells.
- `grip-cross-target-conformance` combines Node Wasm/JavaScript, Fastly JavaScript
  reference execution and Fastly Native construction. Its Fastly Native cell
  is not equivalent to a real engine run.
- `deployment-candidates` constructs Fastly Native and JavaScript artifacts;
  `fastly-cli-gate-surface` uses fake command binaries. Neither supplies fresh
  local-engine or deployed proof.
- `fastly-entities-native-workflow` does start the local engine;
  `fastly-incoming-body-forwarding` has an environment-conditional engine path.
  `entities-inspection` and `kv-conditional-gates` also inspect recorded evidence,
  which must not be counted as new host execution.
- `multifile-source-indexes` exits through `--indexes-only`, and the shared docs
  executable body branches on its selected example. The matrix follows those
  invocations instead of assigning every possible branch to each task.

The analyzer follows literal relative test/helper imports, every selected
Vitest file, and explicit extra sources for copied installed fixtures and the
seven clean-machine corpora. Manual inspection follows CLI and provider
boundaries. This is a source-reviewed inventory, not a complete executable
JavaScript call graph. Regex source anchors and tool hints are navigation aids;
they do not prove every branch executes or that no other dependency exists.

## Preparation, isolation and authority

The current [release controller](../../../scripts/validate-release.cjs) owns
source checks, build, Fastly reality, dependency audit, workspace unit checks,
isolated worker preparation and shared package construction before the release
tasks. Installed acceptance follows the completed release stage. Cleanup and
final evidence validation remain controller-owned, including failure paths.
Common prerequisites in each matrix row describe these stage barriers, not a
claim that every body reads the shared pack.

| Boundary / owner | Mutable work and dependencies | Independence that must survive |
| --- | --- | --- |
| Worker layout — `release-parallel.cjs` | Private verified checkouts, task temp roots, logs, built inputs and tracked cleanup ownership; source/dependency/build reconciliation before reuse | A free worker is not proof that another job's checkout or output can be reused |
| Task preparation — bodies and helper closures | Generated source, Wasm, project output, fixtures, loopback servers and child process groups belong to the task transaction | Keep host bindings, cleanup failures and composed assertions attached to that transaction |
| Shared pack — `release-shared-pack.cjs` | Verified immutable same-candidate package bytes; private copies where required | Package identity can be shared through the existing verifier; passing consumer results cannot |
| Installed consumers — acceptance runner and bodies | Fresh roots, private caches, local tarballs or loopback registry, installed package resolution | Workspace-installed tasks and all 11 gates remain distinct acceptance boundaries; no substitution of workspace imports |
| Determinism — `release-artifact-determinism` | First construction may use the verified shared pack; the second uses `fresh: true`; independent docs artifact construction also remains | Preserve independent production, hash comparisons and failure reporting; identical input names are not a reuse license |
| Evidence/recovery — checkpoints, recovery and evidence bundle scripts | Candidate/tree/dependency identity, complete outputs, selected task coverage, latest terminal attempt and cleanup receipts | Only verified, unexpired same-candidate recovery has authority; copied reports from another candidate/job do not acquire it |

The workspace package helper owns a newly created build output only when it
was absent; otherwise it consumes the established workspace build. A future
shared-preparation change must preserve this ownership reconciliation.
Installed toolchain helpers resolve product modules from the private consumer.
For example, the shared Fastly ABI test helper may receive compiled bytes and
inputs; that does not permit substituting workspace product packages for an
installed consumer.

The release registry has no selected `after` edges, named resource locks or
exclusive tasks. This is **not** proof that sockets, processes, filesystems,
tool caches or environment are independent. Host execution may need Fastly CLI,
Viceroy, AssemblyScript/Binaryen, js-compute/esbuild or a Rust/prebuilt guest
path. The per-task tool hints identify those review points; environment-selected
branches still need confirmation in a real run. Extra workflow jobs would also
duplicate checkout/dependency/build/package preparation and require explicit
candidate-bound aggregation. Neither cost nor that authority design is modeled.

Separate gates remain separate: the controller's fresh Fastly reality stage,
local K4 versus deployed cross-location conditional-KV evidence, and experimental
workspace transforms versus installed acceptance. `boundaries.json` names their
owners. No local ABI or Viceroy result is promoted into deployed proof.

Composed fixtures stay intact, including four-mode conformance, schema/runtime
interactions, application errors and installed CLI workflows. Issue
[#371](https://github.com/pulse-compute/pulse/issues/371) remains a separate open
Fastly Native schema `textResult` / error-instrumentation defect. Keeping those
fixtures does not claim they already detect its exact combination. A provider
repair needs its own composed regression; isolated compiler and provider passes
are not substitutes.

## Controlled scheduling projections

The model mirrors the existing runner's completion barrier for priorities,
descending cost/stable registry ordering, compiler slots, resource locks,
`after` edges and exclusive tasks. Durations are the observed whole-task
occupancies. A compiler hint reserves a slot for the whole task; it does not
measure individual compiler processes. Admission and coverage are checked for
every generated timeline.

The current hints underdescribe at least some Native work: for example,
`cli-report-resource-inventory`, `s3-body-read` and `shared-stage-o19` execute
Native code while designated non-compiler. Other tasks build Native outputs
without that hint. This model preserves the current hints. A hint audit is
necessary before interpreting a compiler limit as a limit on actual compiler
processes or recommending safe memory use.

Two host lanes assign shared/Node work to one worker and Fastly/mixed work to
the other. Three host lanes assign shared/Node, Fastly and mixed work to separate
workers. Cross-target tasks are never split. Comparisons use the same worker
and compiler budgets; a third lane is not compared as a free improvement over
two workers.

| Layout | Workers / compiler slots | Release projection | Installed projection | Combined task-stage projection |
| --- | --- | ---: | ---: | ---: |
| Current mixed pool | 2 / 1 | 47m38s | 9m34s | 57m13s |
| Fixed host lanes | 2 / 1 | 47m56s | 9m34s | 57m30s |
| Mixed pool | 2 / 2 | 28m13s | 5m11s | 33m24s |
| Fixed host lanes | 2 / 2 | 36m35s | 7m22s | 43m57s |
| Mixed pool | 3 / 2 | 24m00s | 5m11s | 29m11s |
| Fixed host lanes | 3 / 2 | 27m33s | 7m22s | 34m55s |
| Mixed pool, every task 7.8% slower | 2 / 2 | 30m25s | 5m35s | 36m00s |
| Mixed pool, every task 25% slower | 2 / 2 | 35m17s | 6m28s | 41m45s |

Rounded components need not add to the rounded total. All rows above are
projections, including “current.” The observed controller stages total
59m18.57s, about 2m06s longer than the current-setting model. The model omits
controller/worker transition delays and does not reproduce contention, runtime
variance, memory, preparation changes or failure/cleanup timing. Its calibration
error is not an overhead constant to add to every alternative.

The 7.8% sensitivity borrows the aggregate elapsed ratio from the 167 tasks that
completed in both B10-00 attempts. That incomplete selected subset is not a
universal slowdown estimate. Applying it uniformly is a sensitivity check only;
even this simple check moves the projected two-compiler release stage above
30 minutes. The 25% case is an illustrative stress assumption.

Removing the release/installed barrier in the same mixed pool gives 57m13s
at 2/1 (no modeled saving) and 33m20s at 2/2 (3.9 seconds saved). This
counterfactual retains task priorities across the combined queue, including
the installed early gate; it is not a proposed controller implementation.
The small saving provides little reason to assume the extra evidence aggregation
and failure attribution complexity.

## Minimal interventions and remaining decisions

| Intervention | Expected benefit from this evidence | Reliability / maintenance cost and next proof |
| --- | --- | --- |
| Retain mixed scheduling and add this responsibility map to planning | Avoids a projected 10m33s regression versus fixed host lanes at 2/2; no claimed runtime saving from this report | No new controller or authority surface; refresh classifications when task invocations change |
| Repair the B10-00 cleanup failure, audit compiler hints, then repeat 1-vs-2 compiler trials | Largest modeled opportunity: mixed 2/1 to 2/2 reduces combined task occupancy wall time by 23m49s before contention | Requires complete same-candidate trials with process-tree CPU/RSS, cleanup, output coverage and unchanged acceptance. Prior sampled RSS is a lower bound, not a safe admission guarantee |
| Keep host labels for attribution; defer dedicated jobs | Clear ownership and future provider boundary evidence | No current evidence of a faster host split. Three-worker setups require memory/preparation measurements, not just another nominal lane |
| Investigate immutable preparation using B10-01 phase evidence | Plausible recurring preparation savings; not quantified here | Input closure, installed independence, host realization and independent deterministic construction must be proved before reuse |
| Retain the installed-stage barrier | Forfeits at most 3.9 seconds in the tested 2/2 fixed-duration comparison | Avoids a new aggregation design for negligible modeled benefit; reconsider only if the workload or stage preparation changes |

This is not a new CI ticket decomposition or permission to weaken gates.
No scheduler, registry, checkpoint, package, provider or public documentation
contract changes. Fastly's eventual independent release cycle remains outside
Beta.10. CI9-03's already consolidated site preview remains in place; independent
docs determinism construction is a different proof and is not proposed as a
second copy of that saving.

## Reproduction and review

Use a checkout containing the inspected candidate and B10-00 history. Analysis
outputs may be generated outside the repository:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 docs/internal/b10-02/test_analysis.py
PYTHONDONTWRITEBYTECODE=1 python3 docs/internal/b10-02/analyze.py \
  --root . --inventory docs/internal/b10-02/inventory.json --out /tmp/b10-02-analysis
cmp docs/internal/b10-02/results.json /tmp/b10-02-analysis/results.json
cmp docs/internal/b10-02/matrix.md /tmp/b10-02-analysis/matrix.md
```

The analyzer verifies all 201 identities, successful historical terminal/cleanup
states, inventory owner hashes and unchanged inspected source bytes against the
pinned candidate. It refuses missing explicit source files. It produces ten
coverage-conserving scenarios and checks worker/compiler admission, dependencies,
resource locks and exclusive execution. Six small independent scheduling tests
cover priority completion barriers, whole-task compiler reservation, resource
and dependency ordering, exclusivity, atomic mixed tasks and invalid inputs.

Canonical analysis inputs are `review.json`, `boundaries.json`, the captured
`inventory.json` and `timing-input.json`; regenerate `matrix.md` and `results.json`
with `analyze.py`. Full timelines, source anchors, original B10-00 runner/seal
reports and validation logs are retained in the accompanying evidence archive.
None of these diagnostic files is a release checkpoint or acceptance receipt.

Validation completed for this evidence change: all six model tests; all ten
timeline/coverage checks; byte-for-byte regeneration of both checked-in outputs;
original runner-report hash, selection and per-task timing/status/cleanup/signature
comparison; `maintainer:sync`, `docs:sync`, `maintainer:check`, `docs:check` and
`documentation-release.cjs`. No product execution, installed acceptance or new
full seal was run for this report-only change.
