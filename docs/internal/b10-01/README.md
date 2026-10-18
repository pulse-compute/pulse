# B10-01 — expensive phase and preparation attribution

Issue #374. Target `latest`; base `57e8a25c` includes B10-00. This evidence
investigation changes no selection, compiler behavior, scheduler default,
installed-consumer independence or qualification authority.

## Diagnostic

`wasm/test/support/phase-observer.cjs` is a standalone, opt-in test preload.
Set `PULSEWASM_TEST_PHASE_DIR` to a fresh existing directory and preload it with
Node `--require` / `NODE_OPTIONS` when running the selected tests. Keep the source
revision clean and fixed; retained raw observations bind that revision, not later
report or analyzer changes. The installed
JWT workflow copies the helper beside its existing compiler metrics helper and
explicitly preloads that copy, preserving its cleared `NODE_OPTIONS` boundary.
Without the variable, wrappers return the original function and install no hooks.

Observation covers selected exported test/compiler boundaries, existing spine
adapters, synchronous compiler launches, Wasm construction and execution.
Nested filesystem, hashing and assertion counters measure subsets of those
spans. Only digests of compile entry bytes, normalized argument vectors and
Wasm outputs are retained; no source, arguments, environment values or errors
are recorded. Diagnostic files use an owned descriptor independent of workload
filesystem mocks. Observation is capped at 100,000 spans per process; missing
ends, drops and observation errors remain visible. The terminal record remains
emittable after the cap; the workload still executes after observation stops.

```sh
node scripts/qualification-phases.cjs /explicit/trace/directory > phases.json
node wasm/test/release/assert-phase-observer.cjs
node wasm/test/release/assert-qualification-phases.cjs
```

The analyzer never executes tasks, follows reported artifact paths or grants
reuse authority. Exclusive spans subtract the union of direct child intervals;
process totals can overlap across processes and asynchronous siblings. They are
not CPU or predicted wall savings. Compiler relaunches are excluded from repeated
compile groups only with observed process ancestry, enclosing intervals and
matching entry/options/compiler/output digests; raw intervals remain available. Nested counters must not be added to phase
totals. ESM loading, internal lexical calls and unwrapped assertions can remain
unattributed. Module evaluation includes module top-level work, not just source
reading. Expected rejected compilations are retained alongside successful
returns; terminal task status comes from the existing runner.

Matching entry/argv/compiler/output digests are deliberately narrower than
complete input equivalence. Imported/generated transitive files, transformations,
provider realization, environment, independent construction and installed
boundaries must be reviewed before suggesting immutable artifact reuse.

## Results — 2026-10-18

**Prioritize guest-tool orchestration and worker verification barriers.** The
four selected tasks passed on one clean candidate. The largest JWT cost is
Binaryen subprocess work; schema codecs is predominantly actual AssemblyScript
compilation. This investigation removes no assertions and implements no cache,
concurrency change or scheduler change. B10-04 should use the ledger below when
selecting implementation work.

### Candidate and evidence boundary

Measured commit: `804c69afe743a3f31d2033aa8cf1b121f2dafb21`; tree
`6fc0ccd355feddf06cda36e0e13baec201a9d8de`. Base `latest`:
`57e8a25cd857f960e4c5f607ef720cd5ba95ce82` (B10-00 merged). The diagnostic,
test-only environment catalog and generated references were committed before
measurement. Later report/analyzer changes and the diagnostic's capped-output
terminal-record fix are not the measured candidate; focused checks cover those
changes. No measured process reached the cap.

The fresh run used `/tmp/pulse-b10-01-trials`, Node 24.18.0, npm 11.15.0,
pnpm 12.4.2, the frozen lockfile, lifecycle-disabled offline installation and
built workspace outputs. The Linux runner had an 8-CPU quota and 8 GiB limit.
Dependencies, build outputs and tool/OS caches were warm. Each installed
consumer still used its task-owned npm cache and exact-candidate packages.
One shared package set was freshly constructed in this checkout; consumers
used the existing verified private-copy path. Independent deterministic package
construction remains required by the complete release selection, outside this
four-task diagnostic.

The runner executed the ordered selection `jwt-rs256`,
`jwt-installed-workflow`, `clean-machine-acceptance`, `schema-codecs` with no
checkpoint reuse and a 30-minute outer deadline. It exited 0 after **929,078 ms**;
all four task results and cleanup records passed. The source checkout remained
clean. The subsequent worker probes removed their worktrees; only the primary
fresh checkout remained registered. These are development diagnostics, **not a
release seal**, hosted performance comparison or new provider-reality proof.
The raw run retains its original identity and paths.

[results.json](results.json) contains the compact cost ledger, phase unions,
repeated-input/output groups, input identities and bounded probe results. The
archive `Pulse-B10-01-phase-evidence.zip` contains the raw reports, logs, traces,
reproduction/analysis scripts, the exact measured observer, and a per-file
SHA-256 manifest. Its two checkout labels preserve separate attempt boundaries.

### Cost attribution

Seconds, rounded. Categories use unions of observed intervals across processes,
with compiler/tool intervals taking precedence over enclosing phases. They do
not add overlapping parent/child elapsed times. The raw analyzer also exposes
inclusive/exclusive **process** totals, which must not be mistaken for task wall
time or CPU. Named verification spans are partial; nested hashing/read/assertion
counters provide additional detail without being added to this table.

| Task | Wall | asc | Binaryen tools | Frontend / lowering | Other realization | Execution / Wasm construction | Module evaluation / top-level work | Package preparation | Named verification | Residual |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Workspace JWT | 296.36 | 86.14 | 185.39 | 3.32 | 11.41 | 2.59 | 0.85 | 0 | 0.03 | 6.63 |
| Installed JWT | 290.82 | 74.82 | 133.81 | 10.94 | 9.55 | 0.84 | 41.50 | 0.06 | 0.23 | 19.08 |
| Clean machine | 235.46 | 131.75 | 0 observed | 8.57 | 0.92 | 9.44 | 50.26 | 28.74 | 0.08 | 5.70 |
| Schema codecs | 106.23 | 101.54 | 0 observed | 0.89 | 0.13 | 2.22 | 0.49 | 0 | 0.01 | 0.95 |

Residual includes command/process orchestration, asynchronous install/startup
work not wrapped by a named phase, unwrapped assertions, cleanup and observation
gaps. Module evaluation includes execution of module top-level code; it is not
pure file-loading time. For example, installed JWT's npm command is retained in
its existing command report but is not a named install span in this table.
The clean-machine corpus wrapper is likewise not classified as pure execution:
its nested compiler, preparation and verification work is attributed separately.

Workspace JWT made **51 outer asc calls and 626 Binaryen calls**; installed JWT
made **48 outer asc calls and 450 Binaryen calls**. The existing JWT compile
metrics agree with the outer asc counts. Workspace JWT's Binaryen totals are
297 `wasm-opt`, 249 `wasm-dis`, 64 `wasm-merge` and 16 `wasm-as` calls. Their
185.39 seconds represent about 63% of that task. Execution is not its dominant
cost. The existing three RSA-width fixtures remain distinct, including all
signing-only, verification-only, combined and rejected-composition checks.

The installed JWT proof retains 66 commands, all 12 algorithm/target cells and
120 harness cases. Its 20 composition cells include 12 successful builds and
8 expected ineligible combinations. Before/after verification covers 993
installed package files and reports unchanged bytes. The six Native cells
compare independently produced test/build Wasm hashes; those are meaningful
independent-construction checks, not permission to share the tested artifact.
The roughly 0.23 seconds in `verifyInstalled` is not a worthwhile removal target.

Clean-machine acceptance retains seven corpus replays: S3 28.64 s, request
deadlines 12.49 s, multifile identity 48.31 s, HTTP input 14.93 s, read loops
12.42 s, read-loop adoption 18.86 s and conditional KV 7.03 s. These durations
contain preparation and execution, so they must not be added to the phase table.
Independent initialization, installation, CLI/provider workflows and deterministic
source-package checks also remain. Its 95 observed outer asc calls dominate
more than half its elapsed time. Schema codecs made 29 outer asc calls; no
repeated entry/options/compiler/output tuple was observed. Open/closed nested
JSON, admission, value/text decoding, optional/scalar properties and provider
realizations remain distinct proofs.

### Repeated construction ledger

An asc group matches generated entry bytes, path-normalized argument-vector
hash, asc script hash and output Wasm hash. Candidate source, dependency/build
identities and tools are retained separately. Transitive generated/imported
inputs and full effective environment were not captured per compilation, so
these groups **do not establish complete compile-input equivalence**.
Nested asc relaunches are excluded from these groups; their raw intervals remain.

| Construction or verification | Observed cost / repetition | Property proved and disposition | Smallest plausible intervention; remaining risk |
| --- | --- | --- | --- |
| Immutable packaged guest inspection | Three independent inspections of the exact same 36,378-byte input: 574.64, 547.98, 522.63 ms; identical complete inspection hashes | **Potentially shareable immutable preparation.** Confirms valid/MVP bytes, imports, exports, memory, tables, data and instruction facts; package provenance/ownership assertions still run | Investigate a bounded per-command memo of successful inspection facts keyed by current input bytes, inspector/options and current tool identity. Continue byte checks and preserve each manifest/policy assertion. Do not reuse composed/final audits or cross installed commands. Eligible repetition count in the full workload is still unmeasured |
| Binaryen process startup and tool execution | 1,076 calls / 319.20 s across the JWT pair; `--version` startup proxies 140–160 ms | **Unresolved orchestration opportunity.** Independent disassembly, feature checks, merging and post-link optimization are different responsibilities | Prototype one bounded same-version batch/warm-tool path and compare all outputs/errors/cleanup. Version-call latency cannot simply be subtracted from tool time. Persistent state, memory, cancellation and independent oracle behavior need proof; no full-task saving forecast |
| Workspace JWT repeated asc tuples | 9 groups, 32 matched calls; 23 repetitions beyond the first, 43.97 s summed repeated interval cost | **Unresolved reuse; preserve independent workflows.** Different source forms, targets, widths, crypto eligibility and combined-feature execution matter | Map every tuple to its exact workflow and transitive inputs before reuse. 43.97 s is a hypothetical preparation-cost ceiling for those matching calls, not removable wall time or a proposed deletion |
| Installed JWT repeated asc tuples | 11 groups, 28 matched calls; 17 repetitions / 28.34 s | **Required independent proof at test/build and installed-consumer boundaries.** Matching Native test/build bytes is an explicit oracle | Keep independent CLI launches/construction and installation. Any lower-level memo must remain within one command and leave this oracle independent; do not reuse a workspace pass |
| Clean-machine repeated asc tuples | 20 groups, 64 matched calls; 44 repetitions / 52.97 s | **Required independent proof or unresolved.** Includes installed corpora, initialized projects and deterministic reconstruction | Keep named independent installs/rebuilds. Similar entry/output hashes do not prove identical configuration, host realization or acceptance responsibility |
| Full schema construction | 29 outer calls / 101.54 s; no matching tuple group | **Distinct preparation under current evidence.** Typed schema, bounds, open/closed forms and target paths differ | Retain the full corpus and existing smoke/full selector. No demonstrated duplicate-artifact saving; avoid filename-based consolidation |
| Shared packages / installed bytes | Installed JWT verified copy about 0.06 s; installed before/after byte checks about 0.23 s | **Existing safe preparation reuse plus required independent evidence.** Private copies, package-byte integrity and clean-consumer resolution | Keep shared packaging and the separate deterministic construction. No new package cache or skipped byte verification is justified |
| Worker input verification barriers | Uninstrumented empty-worker rounds 4.27–4.35 s; median 4.317 s, including five full input scans and source checks | **Required verification, with a scheduling opportunity.** Detects source/dependency/build mutations before admission and through cleanup reconciliation | Move complete verification off the controller event loop while retaining exclusive worker ownership and waiting for verified results before reuse/checkpoint acceptance. Do not replace hashes with timestamps or stale receipts. Cancellation, cleanup races and I/O contention require measurement |

The immutable guest probe binds input SHA-256
`b1d09f10fddf7587cb9e87f959fa908457e076e207db078fc101390c70e4aecf`,
Binaryen 130.0.0 tool bytes, inspector source and restricted environment identity.
All three full inspection objects hash to
`d01cdb26f4b70c43ab85f7a73bf97a8503ca86909a9631223461e725ab989728`.
The input bytes remain unchanged. Twenty extra read/hash checks have a median
0.083 ms (including comparison with the expected digest). This establishes the
same primitive input/result and a roughly **0.55-second cost per eligible repeated
inspection** in this environment. It does not establish a cache contract or
claim that every linking inspection can be reused. All three inspections were
actually executed; no qualification assertion was replaced by this diagnostic.

### Worker barriers and wall-clock opportunity

`verifyWorker` calls `inputIdentity`; `cleanupWorker` calls it both before and
after removing owned outputs. The task runner verifies before execution, invokes
cleanup in a child process, then repeats cleanup reconciliation in the controller.
That is five complete input scans per executed worker task. The bounded probe
executes this exact call sequence three times against an otherwise empty owned
worker, with both registered workspaces present and every byte check retained.

The uninstrumented median round is **4.317 s**; the instrumented median is
**4.335 s**. Control pre-task plus controller reconciliation cost has a median
**2.580 s**. Input identities match across repeats; both probes finish with clean
source and removed workspaces. This single ordered microcomparison does not
establish global instrumentation overhead or hosted variance.

For scale only, 201 repetitions at those medians would be 14.46 minutes of
barrier occupancy, of which 8.64 minutes is the synchronous controller portion.
These are **linear projections, not measured release wall savings**: child work
can overlap, caches/contention differ, and some barriers remain on the critical
path even after asynchronous execution. Offloading preserves total verification
work and may reduce blocked-controller time, but its actual wall benefit must
be measured. This also makes the B10-00 event-loop/log-close reliability finding
relevant; this ticket neither repairs it nor establishes its exact root cause.

### Failures, limitations and validation

A preliminary package setup rejected the new diagnostic variable because it
was not yet in the canonical environment catalog. The catalog and generated
references were corrected before the measured candidate. The failure is retained.

In the original checkout, workspace JWT returned a passing task result, but the
following installed task correctly rejected leftover JWT fixture paths as a dirty
candidate. Some original trace files also lacked terminal records. The cause is
unresolved. That attempt remains failed; hashes of the owned leftovers were
retained before removing them, without archiving generated private test keys.
The fresh clone then executed the entire four-task selection again on the same
candidate. No failing task, cleanliness check or cleanup requirement was waived.

Five fresh auxiliary child traces lack terminal records (one under workspace
JWT, four under clean-machine acceptance). They remain explicit observation gaps.
The main task traces are terminal, and all existing task/installed reports pass;
missing observations are not filled with invented durations. Asc interval
coverage is checked against existing JWT metrics where available. Per-phase
unions and named assertion/verification counters are therefore observations with
limits, not exhaustive CPU attribution. No hosted or full-seal performance win
is claimed from these runs.

Focused checks cover disabled behavior, receiver and sync/async error semantics,
Wasm construction, write/close guards, trace cap terminal retention, overlapping
spans, nested compiler relaunches and incomplete/invalid evidence. The final unit profile passed all 65 selected tasks in 297.26 seconds. It left
one owned S3 fixture directory; its hashes were retained before explicit removal.
That cleanup observation is separate from the clean four-task measurement.
Maintenance and documentation checks are recorded in the PR. Hosted checks on
the measured diagnostic commit passed scope, fast-tier repository validation,
Node support-floor execution and documentation preview; the full portable tier
was not selected by normal routing.

### Reproduction

Use a fresh clean checkout of the measured commit with its frozen dependencies,
built package outputs and pinned Node/npm/pnpm/Fastly tools. Keep that checkout
fixed until the task runner and probes terminate. The archive's `run-tasks.py`
records versions, candidate/tree, lockfile and shared-pack receipt digests, and
runs the complete four-task selection with an outer deadline; its tool paths
must be adjusted for the local machine. It refuses a dirty candidate and fresh
trace/output directories must not already exist.

```sh
mkdir -p .pulse-seal/b10-01
node scripts/release-shared-pack.cjs --out .pulse-seal/b10-01/packages
python3 /path/to/archive/tools/run-tasks.py
node scripts/qualification-phases.cjs .pulse-seal/b10-01/task-traces > phases.json
```

Run the bounded inspection and empty-worker probes only after the workloads
finish, from that same checkout. The archived probe sources record their actual
inputs and call sequences; the worker probe defaults to its observed output
name, so pass `worker-probe-control.json` explicitly for the uninstrumented run.
Create a separate existing trace directory and set the diagnostic preload only
for the observed worker run. Never pool unrelated candidate, installation or
host results, or use these diagnostics to bypass qualification. The archive
includes the final analyzer and summarizer as well as the measured observer;
the report's phase unions are derived with that final analysis code.
