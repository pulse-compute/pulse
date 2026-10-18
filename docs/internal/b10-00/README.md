# B10-00 — compiler concurrency measurement

Issue: #373. Target: `latest`. This diagnostic changes no release selection,
scheduler admission, workflow default, checkpoint authority or product contract.

The Beta.9 hosted reference is [run 38865225416](https://github.com/pulse-compute/pulse/actions/runs/38865225416),
candidate `8ee88d27e605f712fdf1e56fb2439ded352f73fd`, tree
`bc5cbd64519fdd047e16c5143f1c70b1e21d5933`. Released `main` and the initial
Beta.10 `latest` baseline `fda16de1` have that same tree. The reference release
stage passed 190 tasks in 65m40s, followed by 11 installed gates in 10m09s.

## Diagnostic

`release-seal-measure.cjs --process-tree` adds a separate Linux `/proc` sampler
at a nominal 200 ms interval. It tracks the controller and observed descendants,
including detached groups and previously observed reparented processes, using
PID plus process start time. PID namespaces are resolved against the sampler's
namespace. The sampler does not signal the workload or decide qualification.

Each phase retains `process-samples.jsonl`, `process-summary.json`, and an
`observer-result.json`. Samples include simultaneous summed RSS, sampled CPU
counters, process identities, recognized asc processes and current runner state.
The existing preload also records launch/end intervals for recognized compiler,
pack and install calls without retaining arguments or environment values.

These observations have explicit limits:

- Short processes, exit CPU tails and unseen reparenting can be missed. Values
  are sampled lower bounds; maximum sample gap is retained.
- Summed RSS counts shared pages in each process; it is neither unique physical
  memory nor cgroup usage. It does not sum lifetime RSS peaks.
- `compilerLimited` records queued tasks at a sampled compiler-slot limit with
  other scheduling hints satisfied. Those tasks may also lack a free worker.
  It is not exclusively compiler-caused delay. Current phases and admissions
  are sampled from atomic runner reports, not exact scheduling events.
- The preload misses native/custom-promisified calls and consumers clearing
  `NODE_OPTIONS`. Interrupted launches may lack an end record. Its elapsed
  totals are not CPU time. The process sampler observes independently.
- Observer failures are retained separately. A passing seal does not imply a
  complete resource observation; both outcomes must be inspected.

## Controlled trial

Restore release-owned tools and lockfile dependencies. Commit the diagnostic
and keep that exact clean revision and input bytes fixed for both fresh trials.
Use the same checkout/runner, 2 workers and 6144 MiB admission estimate; vary
only compiler slots. No checkpoint resume. Record warm/cold state and preserve
failures. Avoid competing resource-heavy work on this runner.

```sh
node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-00-c1 \
  --skip-install --timeout-minutes 100 \
  --workers 2 --compiler-workers 1 --memory-budget-mib 6144 --process-tree

node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-00-c2 \
  --skip-install --timeout-minutes 100 \
  --workers 2 --compiler-workers 2 --memory-budget-mib 6144 --process-tree
```

`--skip-install` requires separately recorded setup provenance. The explicit
deadline avoids inheriting the 55-minute default, shorter than the baseline.
The helper retains the existing complete seal/evidence verification. Compare
terminal status, coverage, source/input identities, task slowdown, memory/CPU,
cleanup and observation quality before recommending a setting. Local results
are not hosted speedup claims. Repeat or alternate only if variance affects the
decision. Three/four-worker simulations do not authorize those configurations.

## Focused checks

```sh
node wasm/test/release/assert-release-seal-measure.cjs
node wasm/test/release/assert-release-resource-observer.cjs
```

Checks cover real subprocess error/promise behavior, redacted interval records,
PID reuse, detached/reparented ownership, simultaneous RSS, CPU, scheduling
observations and terminal process cleanup. They add no aggregate release task.

## Results — 2026-10-18

**Recommendation: retain two workers and one compiler slot.** The baseline
completed, but the two-slot attempt failed a task-log cleanup deadline. It does
not establish a safe faster configuration or a sub-30-minute qualification.
Issue #373 remains open for the missing successful comparison after the
cleanup boundary is understood and repaired.

Both fresh attempts measured commit `74bf891ffe54865cca4869bf7c45d86ff172f34f`,
tree `c79155d6e115d58f13c362d4784a081248dd2df7`, based on `latest`
`fda16de1b3520c65cc62574878727e753ade850c`. Later report-only commits are not
covered by that seal. Machine-readable observations are in [results.json](results.json).

| Observation | 2 workers / 1 compiler | 2 workers / 2 compilers |
| --- | ---: | ---: |
| Terminal result | Passed | Failed |
| Release coverage | 190/190 passed | 167 passed, 1 failed, 22 not run |
| Installed acceptance | 11/11 passed | Not run |
| Release elapsed | 49m32s | 28m52s **until failure** |
| Installed elapsed | 9m46s | Not run |
| Total measured wall | 60m12s | 29m54s **until failure** |
| Sampled simultaneous summed RSS peak | 2.17 GiB | 2.26 GiB |
| Sampled process CPU | 5,567.8 CPU seconds | 4,642.0 CPU seconds |
| Samples / maximum gap | 18,020 / 210 ms | 8,940 / 214 ms |
| Observer read errors / remaining observed processes | 0 / 0 | 0 / 0 |
| Final controller cleanup | Passed | Passed |

The second column of elapsed measurements is a truncated workload, not a
speedup. The failed task cannot be waived because final controller cleanup
passed. Both terminal checks found the active lock and worker directory absent,
a clean source checkout and no remaining observed descendants.

Run identities:

- One slot: `2026-10-18T04-49-50-564Z-G7pCEX`, measurement `b10-00-c1-fresh`.
- Two slots: `2026-10-18T05-51-43-232Z-xvi6Jv`, measurement `b10-00-c2-fresh`.

### Provenance and comparability

The sequential trials used the same fresh checkout, Linux x64 runner with an
8-CPU cgroup quota and 8 GiB memory limit, a 6144 MiB scheduler admission budget,
Node 24.18.0, npm 11.15.0, pnpm 12.4.2, Fastly CLI 16.1.0 and its managed local
engine. Frozen lockfile dependencies were installed with lifecycle scripts
disabled and workspace outputs built before measurement. Tool and OS caches
were warm; this is not a cold-machine comparison. Clean-machine acceptance
still constructed its independent installation with a private npm cache and
the exact-candidate loopback registry. There was no competing heavy workload.

The commands above used output names ending in `-fresh`; only the compiler
limit and fresh output paths were intentionally changed. No checkpoint resume
or historical passing-result reuse was used: the baseline executed all 201
tasks. Candidate, lockfile, toolchain, selection, root input and both worker
input identities matched. Independently constructed shared package filenames
and hashes also matched. Complete inherited-environment equality was not
established: full environment digests differ, including a fresh preload path
in `NODE_OPTIONS`; a normalized comparison was unavailable because the kernel
denied controller environment reads. No environment values were retained by
the diagnostic, and this report does not claim the preload path was the only
environment difference.

### Critical path and contention

In the passing release stage, compiler-designated whole-task occupancy was
2,838,997 ms and other task occupancy 530,291 ms. These include execution,
waiting and cleanup; they are neither compiler CPU nor non-overlapping wall
time. The sampled scheduler had a compiler-limited eligible queue and a free
worker for 2,372,572 ms (39m33s). This supports investigating compiler admission
as a substantial source of idle worker time; sampled report states are not
exact causal wait intervals.

Among the 167 tasks passing in both attempts, median elapsed ratio was 1.074
and aggregate elapsed ratio 1.078 (two slots / one slot). Examples: `jwt-rs256`
303,092 → 309,209 ms; `schema-codecs` 108,734 → 116,005 ms;
`clean-machine-acceptance` 241,024 → 244,653 ms. This subset shows task slowdown
under overlapping work, but excludes the failed and unrun work and cannot
predict complete release wall time. A single sequential pair does not resolve
order effects or variance. No OOM or compiler assertion failure was observed;
that does not establish two-slot reliability or memory headroom on hosted CI.

AssemblyScript 0.28.18's CLI can relaunch Node with `--enable-source-maps`.
Consequently one logical compilation can produce two recognized asc processes
and nested launch intervals. Raw asc counts (1,712 and 1,580) are launch counts,
not logical compilation counts. Summed `observedCompilerElapsedMs` overlaps
these intervals and must not be used as serial compiler occupancy. Whole-tree
CPU uses each process's own counters; RSS includes both real processes. The
archive retains the CLI source hash and a parent/child observation.

### Failure and bounded reproduction

`docs-example-03-fetch-composition` printed its successful example result, then
failed with `task cleanup failed: task log close exceeded its deadline`.
The existing `finishLog` in `wasm/scripts/run-wasm-tests.cjs` races stream closure
against a one-second timer. The controller also performs synchronous worker
cleanup/input verification; nearby samples show overlapping task cleanup.

The retained diagnostic extracts the exact measured `finishLog` function.
With bytes already written, its zero-blocking control closed successfully;
three 1,200 ms event-loop stalls each produced the same deadline error even
though the stream closed and its bytes were complete. This demonstrates a
vulnerability to controller stalls, not the exact cause of the observed run.
The archive includes the function hash, reproduction and results. No timeout,
cleanup requirement or qualification result was changed.

The smallest next intervention is to make log-close supervision reliable under
controller stalls while retaining bounded cleanup, write-error reporting and
failure evidence. Add a focused regression, then run fresh complete one- and
two-slot trials on the repaired exact candidate. Do not combine these partial
passes into a new qualification. Until then, expected complete wall-clock
benefit is **unestablished**; retain the existing setting.

### Earlier attempts and validation

Three preliminary failures remain separately preserved in the evidence archive:

1. The original preload's exit logger encountered an intentional filesystem
   write guard in `cli-report-retained-evidence`. The diagnostic now captures
   and owns its append sink before workload mocks; the existing guard remains.
2. On the corrected candidate, an original-checkout attempt failed
   `clean-machine-acceptance` input verification on leftover JWT fixture paths.
3. Another original-checkout attempt failed worker recreation before release
   execution. Small filesystem/worktree probes passed; the cause remains
   unresolved. Both final trials therefore used the same fresh clone of the
   corrected candidate, without a harness change or weakened check.

These attempts are not pooled with the passing baseline. Focused measurement
and process-observer checks passed, including real promise/error behavior,
write-guard isolation, PID namespace/reuse, detached process ownership and
cleanup. The affected retained-evidence task passed its focused retry. The
passing full seal includes source checks, real Fastly local execution, workspace
checks and complete release/installed selections. Hosted checks on the measured
commit passed maintainer scope, repository fast-tier validation and documentation
preview; the full portable tier was not selected by normal routing.

The observer is opt-in and Linux-specific; the existing portable launch observer
still works without it. Sampling and preload overhead were present in both
trials and were not separately quantified. Maintenance cost is the small `/proc`
sampler and its focused tests, with no additional registered release task.
Raw attempt reports, task logs, observations, analysis scripts, tool/setup
provenance and failed attempts are retained in
`Pulse-B10-00-concurrency-evidence.zip`; `manifest.json` binds each archived file
by SHA-256. The archive preserves original attempt paths and identities; its
analysis path mapping conveys no checkpoint or release authority.
