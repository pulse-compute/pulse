# B10-CI02 — complete worker verification off the controller loop

Issue [#388](https://github.com/pulse-compute/pulse/issues/388), targeting `latest`.
Work class: hardening. Builds on the merged B10-CI01 log-close repair.

## Decision and implementation

Retain the offload. It substantially improves controller responsiveness and
shortens the measured concurrent development workload. It costs additional
process startup, CPU and memory, and makes an isolated empty task slower. It is
not a release-stage speedup forecast or a compiler-concurrency recommendation.

The canonical synchronous `verifyWorker` and `cleanupWorker` implementations
remain the source of truth. A fresh invocation of the existing supervised
`runCommand` helper executes each pre-admission verification and independent
post-cleanup reconciliation. Startup worker input verification is also offloaded.
The existing first cleanup process remains in place. **All five per-task full-byte
input scans remain:** one before admission, two in first cleanup, and two in
independent reconciliation. Reused checkpoints still require fresh admission.

Each invocation returns the exact request (fresh identifier, operation, candidate,
checkout/layout and input bindings) with its result. Acceptance requires a zero
exit, terminal child closure, no interruption/timeout/supervision error, and the
matching result. This is private invocation plumbing, not a new persisted proof
format, proof pool or alternative evidence authority. The verifier is trusted
candidate code; this does not claim to authenticate a compromised verifier.

The worker, compiler token and resource locks remain owned until the operation
and task cleanup settle. The controller observes actual output removal through
its independently invoked canonical cleanup, after the first cleanup exits;
that first receipt alone cannot qualify a task. Mutation, missing/mismatched
results, crashes, timeout or failed tracking prevent admission/reconciliation.
Failed cleanup retains the worker path and cannot become a reusable pass.

Admission cancellation terminates the supervised process group before returning.
Cancellation arriving with the terminal result cannot start a task or replay a
checkpoint. Cleanup remains obligatory after cancellation and runs under its own
bounded deadline; the task remains interrupted. New verifiers use the existing
30-second cleanup budget and default 10-second TERM / 1-second KILL escalation.
Results are bounded to 1 MiB, diagnostics to 16,000 characters. No timestamps,
identity cache, scan removal or change to checkpoint validation is introduced.
Short synchronous layout/metadata and checkpoint operations still exist.

## Clean comparison

[results.json](results.json) records identities, timings, task/log outcomes,
input hashes, resource observations and validation. One unchanged
[diagnose.cjs](diagnose.cjs) was used sequentially against both clean checkouts:

- Control: `48c7fa71845d4e98d10c8118b39f41fdaf1d7368`, tree
  `2164f0f11a3e047b2c17b7572ed85797ba3b3641`.
- Changed: `ff6eeeca95b58e4f5e8809102ebccefb5f7027d7`, tree
  `5f605d5c44dfd80829a3b950fa6a24f5c30b155a`.

Both used Node 24.18.0 with identical executable/lockfile bytes and copied
lockfile-pinned dependency/build inputs, warm filesystem/tools, two isolated
workers and one compiler token. No competing heavy work ran during measurement.
Later report-only changes are not represented as measured implementation.

| Observation | Control | Changed |
| --- | --- | --- |
| Original five-scan synchronous empty probe, median of 3 | 4.487 s | 4.817 s |
| Actual empty task with all five scans, median of 3 | 4.582 s | 5.291 s |
| Empty-task maximum timer lateness | 1,693–1,773 ms | 5.2–6.4 ms |
| Concurrent workload, two repetitions | 43.188 / 42.885 s | 36.039 / 36.767 s |
| Concurrent maximum timer lateness | 2,954 / 2,788 ms | 19.1 / 16.3 ms |
| Concurrent controller event-loop active time | 30.685 / 30.162 s | 0.443 / 0.483 s |
| First concurrent run: observed input scans | 55, 33 on controller | 55, 0 on controller |
| First concurrent run: summed scan occupancy | 48.452 s | 53.067 s |
| Concurrent child process launches | 33 each | 55 each |
| Concurrent peak summed RSS, sampler excluded | 758,744 / 761,484 KiB | 842,780 / 817,332 KiB |
| Concurrent sampled CPU, sampler excluded | 66.23 / 64.64 s | 69.17 / 72.19 s |

Each concurrent repetition completed all 11 diagnostic tasks, successful cleanup,
zero checkpoint reuse, and no reported remaining task-group members. Its task map
substitutes real canonical lowering, JavaScript effects, continuation-registry and
API-surface checks into the production worker/recovery fixture. Those names and
reports are explicitly diagnostic: they do **not** establish installed-feature
acceptance, heavy AssemblyScript contention, a full release profile or a seal.

The local saving is 6.1–7.1 seconds per concurrent repetition (15.4% on their
means). The empty-task median instead increases 0.710 seconds (15.5%). Even the
unchanged synchronous probe is 7.4% slower on the changed run, so the entire
empty-task difference cannot be attributed to process startup. Scan occupancy
increases while wall time decreases: overlap removes controller serialization,
not the underlying verification work. Neither occupancy nor event-loop active
time is CPU time or directly removable release wall time.

The existing Linux process observer samples every 200 ms. Its raw totals include
the sampler despite its scope label; the table explicitly subtracts sampler
identities and the controller's pre-window CPU baseline from raw snapshots.
CPU is a sampled lower bound, and summed RSS double-counts shared pages. Kernel
`fsRead` block counters were zero for the diagnostic children under warm cache;
this is not zero read demand or a cold-disk throughput result. Full-scan durations
and summed occupancy expose contention, but cold storage remains unmeasured.

Some existing phase-observer streams lack their terminal tails: the second
concurrent runs contain only 48/55 and 54/55 completed scan spans, respectively;
the changed controller stream also cuts during the third original probe. Those
partial totals are retained and labeled observed, never promoted to complete
occupancy. The first concurrent pair and all actual empty-task rounds have all
expected scan spans. Independent terminal task reports, timer observations,
process summaries and clean final candidate identities completed. This limit
resembles previously retained diagnostic-capture gaps; its cause is unresolved.

Reproduce with the same pinned Node and new output directories:

```sh
node docs/internal/b10-ci02/diagnose.cjs /path/to/control /tmp/ci02-control
node docs/internal/b10-ci02/diagnose.cjs /path/to/changed /tmp/ci02-changed
```

## Validation and remaining work

The full `unit` profile passed **65/65 tasks in 322.765 seconds**, exit zero,
with complete ordered terminal coverage on the clean changed implementation
above. All reported task cleanups passed. Its recovery runner passed in 57.727
seconds; its log includes both new verification/ownership assertions and the
final recovery marker. The three focused development tasks also passed earlier
in 61.91 seconds. The outer unit console capture cuts during an earlier task;
it is not claimed complete. The terminal report and focused per-task logs are
retained independently.

One already-observed S3 `.text-state-*` fixture directory remained after the unit
run; its two files were hashed and that task-owned directory was removed after
terminal completion. This remains development evidence, not a clean release seal.

The initial hosted documentation check rejected an unnecessary diagnostic-only
environment variable. The final driver derives its metrics directory from the
existing phase-observer directory; a subprocess smoke verified this path. The
measured driver checksum and exact implementation commit remain preserved. This
report and that directory-discovery correction do not alter production verifier
code or claim a second performance measurement.

Maintainer synchronization/checks, documentation synchronization/checks and
local documentation-release validation passed without generated changes. The
scope classifier requires human review for the unclassified verifier/runner
paths; implementation direction is the explicit request to implement #388.

Focused regressions cover altered bytes with preserved size/mtime, mutations
after actual output removal, forged/missing/stale invocation results, verifier
crashes, timeout/TERM/KILL and owned descendants, failed tracking, interrupted
admission, held worker slots, late output after the first cleanup receipt,
changed inputs before checkpoint replay, and recovery execution/reuse.

A preliminary test gate incorrectly waited for two tasks across the existing
single-task priority barrier. The runner correctly failed its unfinished-assertion
guard; the fixture now lets that priority task finish before holding the next
pair. The failed attempt remains identified in results; no scheduling rule was
changed to accommodate the test.

The bounded process wrapper adds maintenance cost but reuses the current scheduler,
canonical checks, cleanup and process supervisor. Keep two workers / one compiler.
[#390](https://github.com/pulse-compute/pulse/issues/390)'s resource audit and
[#373](https://github.com/pulse-compute/pulse/issues/373)'s full matched trials
remain necessary before a release configuration or stage-time claim. If hosted
resource demand or lifecycle behavior regresses, revert this offload while
retaining CI01; do not weaken admission to recover speed. No merge, publication
or release qualification is performed here.
