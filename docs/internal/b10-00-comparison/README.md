# B10-00 — complete compiler-concurrency comparison

Issue [#373](https://github.com/pulse-compute/pulse/issues/373), target `latest`,
evidence class. Measured October 18, 2026. This completes the missing local
comparison after #387, #388, #389's explicit deferral, #390's compiler-hint
correction and [the cleanup investigation](../b10-cleanup/README.md).

**Decision: use two workers / two compiler slots / 6144 MiB admission estimate
for the next hosted qualification.** Both local configurations passed the full
seal; 2/2 saved 26m11s (40.5%) overall. Retain the existing hosted 2/1 setting
until a complete hosted 2/2 qualification and human adoption review. This issue
changes no workflow, scheduler, coverage, timeout, recovery or release authority.
The local comparison is complete; hosted adoption remains a separate gate.

## Hosted follow-up

The `Seal checkpoint` workflow runs a fresh 2/2 seal when a ready, same-repository
PR into `latest` changes `.github/workflows/seal-checkpoint.yml`. It checks out
the exact PR merge SHA and uses the existing measurement wrapper with process-tree
observation, 6144 MiB admission, a fresh lifecycle-disabled dependency install,
and the pinned Fastly CLI. All release and installed gates run without recovery
or reused results. The 90-minute controller deadline accommodates hosted variance;
it is not a performance target. Every terminal attempt and measurement is uploaded.

Manual dispatch retains its existing worker choice and interrupted-recovery
experiment. Both modes have read-only repository permissions and no production
credentials. This is diagnostic qualification, not the `main` release gate or an
accepted publication artifact. The hosted 2/1 release default remains unchanged.
Review the complete terminal coverage, resource samples, cleanup and timing on
the actual candidate before proposing adoption. A passing local pair alone does
not establish a hosted result.

## Measured result

| Observation | 2 workers / 1 compiler | 2 workers / 2 compilers |
| --- | ---: | ---: |
| Terminal seal / process exit | Passed / 0 | Passed / 0 |
| Fresh release tasks, ordered complete | 190/190 passed | 190/190 passed |
| Fresh installed gates, ordered complete | 11/11 passed | 11/11 passed |
| Reused task results | 0 | 0 |
| Release stage | 53m44.824s | 31m53.496s |
| Installed-feature stage | 9m58.441s | 5m32.098s |
| Total measured wall | 64m42.187s | 38m30.660s |
| Sampled simultaneous summed process RSS peak | 2.052 GiB | 2.031 GiB |
| Sampled process CPU | 5,874.77 CPU seconds | 5,898.59 CPU seconds |
| Samples / maximum sample gap | 19,367 / 283 ms | 11,518 / 242 ms |
| Observer read errors / remaining observed processes | 0 / 0 | 0 / 0 |
| Task and controller cleanup | Passed | Passed |

Release-stage savings are **21m51.328s (40.7%)**; installed-stage savings are
4m26.343s (44.5%). Total savings are **26m11.527s (40.5%)**. These are observations
from one sequential local pair, not a hosted forecast or a variance estimate.
The exploratory sub-30-minute release-stage target was **not reached**.

Both attempts include source checks, build, real Fastly local execution,
dependency audit, workspace unit checks, isolated worker preparation, shared
packing, complete release and installed selections, output verification and
final cleanup. Both task reports contain exactly their ordered selections,
with every result executed, passed and cleaned. The measurement wrapper's
existing recovery-evidence validation passed. No partial or historical passes
are pooled into either result.

## Candidate and inputs

Both attempts used clean commit
`73fe181525b1d466e2a4dc16be23607823799068`, tree
`2fe181bb7cc55b57c39817b902e487277851df27`, the merged #396 `latest` candidate.
The report-only PR is not itself the measured candidate. This follows the
Beta.9 baseline `fda16de1` and the landed CI repairs; it is not a comparison
against a newly rerun Beta.9 seal.

| Slots | Run ID | Measurement |
| --- | --- | --- |
| 1 | `2026-10-18T18-43-20-827Z-AElqBE` | `b10-373-c1` |
| 2 | `2026-10-18T19-48-37-102Z-vSAzTr` | `b10-373-c2` |

The same independent clone at `/tmp/pulse-b10-373-73fe1815` and Linux x64 runner
served both attempts. The runner had an eight-CPU cgroup quota and 8 GiB hard
memory limit. Both used 6144 MiB scheduler admission, Node 24.18.0, npm 11.15.0,
pnpm 12.4.2, Fastly CLI 16.1.0 and its managed local engine (setup reported
Viceroy 0.21.1). Fastly was supplied through `PULSE_FASTLY_BIN`, not added to PATH.
No production dependency or tool update was made between trials.

Dependencies came from the prior validated frozen-lockfile, lifecycle-disabled
installation. Its graph and workspace outputs were copied, absolute workspace
links rebound, lockfile bytes checked, and the canonical workspace build run
before measurement. Both commands therefore used `--skip-install`. Setup,
tool hashes and full input identities are retained in [results.json](results.json).
The complete before-control, after-control and after-two-slot input snapshots
are identical. Candidate, lockfile, toolchain, selections, root inputs, both
worker inputs and independently produced shared-package filenames/hashes match.
Both terminal checks found the source clean and worker layouts/active lock absent.

One preparation command, `pnpm build`, selected pnpm 12's dependency-build
operation rather than the package script. It exited with `ERR_PNPM_IGNORED_BUILDS`
and added an unapproved esbuild `allowBuilds` placeholder. Its log/diff are
retained; only that accidental manifest change was restored. No dependency
build was approved or executed. `node scripts/pnpm-toolchain.cjs -- run build`
then passed, and clean input capture preceded both trials. This setup failure
is not a failed seal and is not omitted from provenance.

The trials were sequential, 2/1 then 2/2, with warm tool/OS caches and no
competing resource-heavy work launched by the operator. Independent installed
consumer/package and determinism obligations remained in the normal harness.
Full inherited-environment equality is **not** established: per-key hashes
differ for `NODE_OPTIONS`, `CODEX_TOOL_CALL_ID` and 25 proxy variables. Raw values
were not retained, so no assertion is made that proxy changes were cosmetic or
performance-neutral. Observer preload code differs only in its event-sink path,
verified by normalized content hashes. Warm-order effects and environment
variation limit causal precision; they do not change the complete passing
coverage or the observed times. No further local pair is required for the
bounded recommendation to qualify 2/2 on the actual hosted runner.

## Critical path, slowdown and resources

In the control release stage, sampled states showed an eligible compiler-limited
queue **and a free worker** for 2,704,689 ms (45m05s). At 2/2 this was zero.
Total sampled idle worker-slot time fell from 2,736,943 to 22,650 ms. This is
worker-slot time, not CPU time or exact causal wait accounting. Two compiler
tokens were active for 1,611,023 ms of the two-slot release stage. The remaining
compiler-limited samples mostly coincided with both workers occupied.

Compiler-designated whole-task occupancy was 3,068,353 → 3,176,456 ms in release
and 584,223 → 603,710 ms in installed acceptance. Other release occupancy was
439,606 → 421,423 ms. These overlapping elapsed totals include preparation,
execution, verification and cleanup. They are not asc-only compilation or CPU.
The current whole-task reservation explains why one compiler slot can leave a
worker idle even when no recognized asc process is running.

Across all 201 passing tasks, median elapsed ratio was **1.0249** and aggregate
elapsed ratio **1.0267** (2/2 divided by 2/1). The largest absolute slowdown was
the installed JWT workflow, +6.338 seconds. Selected examples:

| Task | 2/1 elapsed | 2/2 elapsed |
| --- | ---: | ---: |
| `jwt-rs256` | 312.842 s | 315.957 s |
| `clean-machine-acceptance` | 249.390 s | 249.781 s |
| `schema-codecs` | 114.877 s | 118.466 s |
| `fastly-native-platform-capabilities` | 117.505 s | 119.514 s |
| `fastly-handle-frames` | 82.316 s | 84.904 s |
| `jwt-installed-workflow` | 287.900 s | 294.238 s |

Sampled CPU increased 0.4%; average observed CPU demand over seal wall increased
from about 1.51 to 2.55 cores. The similar RSS peaks do not demonstrate that
concurrency reduces memory. The shared runner cgroup's cumulative `memory.events`
`max` counter rose from 38,507 between trials to 49,866 after 2/2; `oom` and
`oom_kill` remained zero. Its lifetime peak was already near the 8 GiB limit
before 2/2. These counters include prior/shared runner activity and cache, so
they cannot isolate Pulse's memory footprint. They rule out a claim of verified
cgroup headroom from the roughly 2 GiB process-RSS samples alone.

The existing 200 ms Linux observer follows the controller and observed
descendants, including detached processes and known surviving identities; the
sampler itself is excluded here. Short-lived processes, exit CPU tails and
unseen reparenting can be missed. Summed RSS double-counts shared pages and is
not unique physical or cgroup memory. Subsecond CPU peaks are noisy. No compiler
crash, OOM kill, task failure or cleanup failure was observed in either seal.

Both preload logs record 1,712 asc launches, 45 pack launches and 27 install
launches. Raw launch/end intervals and process samples are retained. AssemblyScript
may relaunch Node, so asc launch/process counts and overlapping interval totals
are not logical compilation counts. Neither the observer nor this analysis
changes qualification authority.

## Disposition and reproduction

For #390 Phase B and #382: **#373's local comparison is complete; recommend 2/2
for hosted qualification, with hosted adoption still gated.** The minimum
intervention is the existing compiler-slot option, with the same two workers,
memory admission and full selections. No scheduler rewrite, artifact cache,
host split or test deletion is needed to obtain the measured local saving.
Revert/retain 2/1 on qualification, cleanup or memory regressions. Human review
continues to own configuration adoption, merge and release.

The older [B10-00 attempts](../b10-00/README.md) and
[CI04 failed qualifications](../b10-ci04/README.md) remain independent failures.
Their statuses are not rewritten. The earlier log-close failure and filesystem
cleanup discrepancy did not recur in this pair. The environment's restoring-file
mechanism remains unexplained; this result does not manufacture a production
cleanup fix. #371 and combined-feature qualification remain separate obligations.

On a clean exact candidate with the recorded tool/dependency setup, run:

```sh
node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-373-c1 --skip-install \
  --timeout-minutes 100 --workers 2 --compiler-workers 1 \
  --memory-budget-mib 6144 --process-tree

node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-373-c2 --skip-install \
  --timeout-minutes 100 --workers 2 --compiler-workers 2 \
  --memory-budget-mib 6144 --process-tree
```

Run sequentially; verify terminal status and unchanged inputs between commands.
Do not use `--resume`. The explicit 100-minute deadline avoids the shorter
default. The shell must supply the recorded Node/pnpm paths and absolute
`PULSE_FASTLY_BIN`; Fastly itself must not be placed on PATH.

`Pulse-B10-373-concurrency-evidence.zip` retains both full attempt directories,
task logs, package/checkpoint evidence, observations, setup failure, input
barriers and analysis scripts. Its manifest binds each file by SHA-256;
[results.json](results.json) also binds the primary raw evidence and analyzer.
After extraction, reproduce comparison fields with
`B10_EVIDENCE_ROOT=/absolute/extracted-root python3 analysis/compare.py`.
Path mapping is only for offline analysis and grants no foreign-checkpoint or
release authority. No new instrumentation or production test implementation was
needed for this continuation.
