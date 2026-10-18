# B10-CI04 — compiler admission audit

Issue [#390](https://github.com/pulse-compute/pulse/issues/390). Target `latest`.
Class: hardening. Review baseline `9dd16775642ea3ac16fb355d7d459e8735625521`,
tree `ccdd499d9bb08aa909fff0e1fbd589e2b0d12229`, clean after #387, #388 and
#389's explicit memo deferral. No named Entry Point matches; ordinary root,
Wasm and documentation instructions apply.

The audit corrects nine missing whole-task compiler reservations. The existing
190 release tasks and 11 installed gates, task bodies, invocations, priorities,
ordering costs, dependencies, resource locks and exclusivity are unchanged.
The registry remains coverage authority. Compiler tokens remain held through
task completion and cleanup; they do not count actual asc processes. Direct
Binaryen construction also consumes the conservative compiler resource.

[ledger.json](ledger.json) binds all 201 before/after hints, selected invocations,
current source/helper hashes and review rationales. [review.json](review.json)
records the nine positive call-path findings. The old B10-02 target map missed
some transitive Native report fixtures; a unit evidence category is not an
absence-of-compilation proof. Conversely, `multifile-source-indexes` returns
under `--indexes-only` before its Native branch; crypto unit tasks execute
prebuilt Wasm; plan-only helpers and JavaScript builds keep their existing hints.
All pre-existing conservative compiler reservations remain. This is a source
review with explicit helper boundaries, not a complete JavaScript call graph.

## Measurement and configuration gate

Retain the hosted **two workers / one compiler / 6144 MiB admission estimate**.
No workflow or option default changes are proposed. #373 owns the complete
same-candidate concurrency comparison; #390 owns this hint correction and the
setting disposition. A local bounded comparison is not hosted qualification.

`diagnose.cjs ROOT NEW_OUT` runs the nine corrected tasks plus the already hinted
`cli-report-capture-proof` through the existing scheduler in two isolated workers
at one compiler slot. It checks exact candidate and dependency/build inputs at
experiment barriers, uses normal task cleanup, hashes task logs, reconciles
worker outputs, and removes the worker layout. It deliberately uses no recovery
configuration or checkpoints: a focused selection cannot impersonate a complete
seal. Per-task worker input scans from the full seal are absent in this diagnostic.
Worker setup/removal is outside its task-stage timing. Compare separate clean
control and patched candidates with the identical driver, tools and inputs.

The first development driver attempt was rejected before any task ran because
it supplied an incomplete production recovery context. That failed attempt is
retained; the corrected diagnostic uses the ordinary focused runner interface.
No production validator or selection restriction was changed.

Full comparison acceptance remains: fresh complete 190+11 trials at 2/1 and 2/2
on one exact patched candidate, no checkpoint reuse, matched tools, inputs,
runner and cache conditions, sufficient deadline, terminal success and cleanup,
verified outputs, task slowdowns and whole-process-tree CPU/RSS. Hosted evidence
and a fresh complete qualification at any proposed setting precede adoption.
Keep #373 open until accepted. If incomplete, carry it into #382 explicitly as
deferred with 2/1 retained; never pool passes or reinterpret the failed B10-00
2/2 attempt as a speedup. Old B10-02 projections use old hints and are not a
forecast for this scheduler. No sub-30-minute claim.

## Reproduction and rollback

Capture `node scripts/qualification-audit.cjs` on the clean baseline, then run
`node docs/internal/b10-ci04/audit.cjs CONTROL_INVENTORY_JSON` on this change.
The audit refuses selection, invocation and non-compiler scheduling drift.
Regenerate the ledger from that output; do not hand-edit it.

Run `node wasm/test/release/assert-release-parallel.cjs` for admission regression:
all nine production task identities reserve the single slot, ordinary work still
overlaps, and existing priority, isolation, dependency, lock, cancellation,
cleanup and recovery probes remain. Run the unit profile and maintainer/docs
checks before review. Bounded and full measurement results are recorded below.

Roll back an unjustified hint independently in `scripts/release-parallel.cjs`,
with its rationale and regression update. Any future setting increase reverts
to 2/1 on qualification, cleanup or memory regressions. This patch grants no
merge, release, provider or evidence-reuse authority. Human review owns those
decisions; #371 and composed-feature qualification remain independent obligations.

## Bounded results

Both independent observations passed all ten selected real tasks and cleanup.
Control: clean `9dd16775642ea3ac16fb355d7d459e8735625521`; corrected: clean
`a09d96582e5c238cfc9675041658af344af2c634`, tree
`bfff4ac987e6ef9414ea3813a1e26248175ffe44`. Later report/audit-only commits are
not these measured candidates. Exact driver, Node and dependency/build input
identities match in [results.json](results.json). No package/installed acceptance
is claimed by this subset. Runs were sequential, control then corrected, with
warm caches, Node 24.18.0, eight CPU quota and 8 GiB memory limit; one pair.

| Observation | Existing hints | Corrected hints |
| --- | ---: | ---: |
| Task stage | 55.861 s | 95.577 s |
| Compiler-designated whole-task occupancy | 7.743 s | 95.568 s |
| Sampled process CPU, corrected observer scope | 166.51 s | 154.24 s |
| Peak simultaneous summed process RSS | 1,655,348 KiB | 1,014,636 KiB |
| Maximum recognized asc processes | 4 | 2 |
| Samples / maximum sample gap | 298 / 205 ms | 498 / 205 ms |

The conservative correction adds **39.717 seconds** in this compiler-heavy
subset at unchanged 2/1. It removes overlap previously hidden behind unit labels;
it is not a performance optimization by itself. Individual task times generally
decrease while wall time grows. This cost cannot be extrapolated to the full
mixed release queue, which has ordinary work to fill the second worker.
AssemblyScript relaunches explain why even one compiler task can have two
recognized asc processes. Neither peak is a logical compilation count.

The raw sampler includes its own process when observing its parent, despite its
scope label. `analyze.py` preserves raw hashes and derives the table by excluding
the sole observer child left at the terminal barrier and subtracting initial
controller CPU counters. No workload descendants remained. CPU misses short-lived
processes and exit tails; summed RSS counts shared pages more than once. Samples
also cover final barrier checks; elapsed stage time excludes those checks.
These figures are not a memory guarantee or hosted headroom measurement.

Using **only the ten corrected measured task durations**, the existing B10-02
simulator projects 95.568 s at 2/1 and 50.361 s at 2/2. This omits contention and
controller overhead and models this subset only. No new full-release projection
is available until #373 provides complete corrected inputs; the old full-release
forecast is deliberately not carried forward. Reproduce with
`PYTHONDONTWRITEBYTECODE=1 python3 docs/internal/b10-ci04/analyze.py ROOT` while the
raw directories `.pulse-seal/b10-ci04-control-2` and `b10-ci04-corrected` are present.
Raw logs and terminal reports are bound by hashes in the result.

The first new admission-test assertion incorrectly assumed which overlapping
subprocess would log its start first. The retained failed development run led to
an interval-overlap assertion; the production scheduler did not change. The
corrected regression and maintainer/docs checks passed before measurement.

## Fresh qualification attempt and final disposition

**Retain 2/1; the complete concurrency comparison remains open in #373.**
The fresh 2/1 attempt on published candidate
[`3d3ce18f307e6db4367caa63b9b28b74e88f544a`](https://github.com/pulse-compute/pulse/commit/3d3ce18f307e6db4367caa63b9b28b74e88f544a)
(tree `9c3d65a7cd35a649327208b217771ccf5db27bf4`) failed worker admission after
66 passing release tasks. The remaining 124 release tasks and all 11 installed
gates did not run. No 2/2 trial was launched: a successful same-candidate control
was not available. [qualification.json](qualification.json) binds each separate
attempt, terminal report, selected coverage, logs, cleanup and sampled resources.
These are failed qualification attempts, not a successful partial seal.

| Attempt | Result | Meaning |
| --- | --- | --- |
| `2026-10-18T17-19-27-006Z-aFNy9s` / `b10-ci04-c1` | 25 passed, 1 failed, 1 interrupted, 163 not run | Incorrect local Fastly discovery environment; never pooled |
| `2026-10-18T17-26-02-813Z-ThOgDa` / `b10-ci04-c1-fresh` | Blocked before steps; measurement invalid | Prior lock required process-identity verification across executor namespaces |
| `2026-10-18T17-26-53-165Z-bH5y2d` / `b10-ci04-c1-r2` | 66 passed; next admission failed | Unresolved worker output cleanliness; comparison deferred |

The first attempt put Fastly on PATH. `kv-conditional-gates` deliberately supplies
an absent `PULSE_FASTLY_BIN`, but discovery fell back to the real CLI on PATH;
its subprocess did not return the expected exit code before the fixture deadline.
The hosted workflow supplies only `PULSE_FASTLY_BIN`. Matching that setup passed
the unchanged focused gate and the later full attempt's gate. No test or provider
discovery rule was changed. The first failed attempt's lock remained despite its
terminal cleanup pass. Before archiving it, all 1,170 observed PID/start-time
identities, including the controller, were verified absent; its bytes and the
verification record are retained. The restart used no checkpoints.

In the latest attempt, `fastly-native-platform-capabilities` reported passed
cleanup and listed `.fetch-deadline-proof-cdWM3l/.pulse/config.ts` and
`.fetch-deadline-proof-cdWM3l/src/index.ts` among removed outputs. A subsequent
worker admission still observed those same untracked paths and correctly failed.
The owning fixture is `wasm/test/provider/assert-fastly-fetch-deadlines.cjs`,
invoked by that task. The evidence does not establish whether a writer, filesystem
visibility or another cleanup mechanism caused the discrepancy. Final controller
cleanup passed, the worker layout and active lock were absent, the source stayed
clean, and no observed workload descendants remained. This does not waive the
admission failure or make prior task passes a qualification.

That latest failed attempt ran for 966.328 s, with the release stage lasting
912.355 s **until failure**. Sampled process CPU was 1,859.74 s, simultaneous
summed RSS peaked at 2,133,184 KiB, with 4,818 samples, maximum gap 325 ms and no
read errors. These truncated-workload figures establish neither complete benefit
nor a safe higher setting. Its source/build/Fastly reality, production audit,
workspace unit, worker preparation and shared package stages passed; installed
acceptance did not run.

For #382, explicitly carry **#373 incomplete, 2/1 retained**. The next bounded
investigation should reproduce the worker cleanup/admission discrepancy, preserving
full input checks and failure evidence, then restart complete fresh paired trials
on an exact repaired candidate. Do not turn repeated partial passes into proof,
raise concurrency to hide the corrected hints' cost, or claim a full-release
projection from the ten-task experiment. Original B10-00 failures remain failed.
The issue's valid no-increase disposition applies; no workflow change is made.
