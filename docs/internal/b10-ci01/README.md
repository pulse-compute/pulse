# B10-CI01 — bounded task-log completion

Issue [#387](https://github.com/pulse-compute/pulse/issues/387). Target: `latest`.
Work class: hardening. No compiler-setting, scheduler-admission, worker-verification
or checkpoint-authority change.

The finalizer now supervises **write drain and file closure separately**. A stream
can have complete bytes while its `finish` transition, the start of asynchronous
closure, or the close callback is delayed by synchronous controller work. The
old single timer could destroy that stream and fail an otherwise complete task.

Each phase has a one-second budget. The drain-to-close transition is granted
only by `finish`, once; an overdue timer receives one I/O turn before it fails.
There is no recurring retry or timer-lateness reset. Success requires
`writableFinished`, `closed` and no stream error. Write/close errors, premature
closure, blocked writes and a non-closing stream fail. Early log errors are
captured from stream creation and reported as failed task cleanup; cancellation
arriving during finalization remains an interrupted result.

This changes the responsive-loop worst-case allowance from one second for the
combined operation to at most one second to drain plus one second to close,
with the single I/O turn at a deadline. Synchronous stalls can add wall time,
as with any in-process timer. It is not an unconditional timeout increase or a
claim to make arbitrary controller stalls harmless. Process escalation and the
separate 30-second cleanup-command deadline remain unchanged. Verification
offloading is still [#388](https://github.com/pulse-compute/pulse/issues/388).

## Clean comparison

[results.json](results.json) retains exact identities, complete diagnostic outcomes,
log bytes/hashes, observer results, unit coverage and preliminary failures.

- Control: `f4f130e49db68abccfc2781cd66ce827311dd624`, tree
  `7673689323386162c96ecc1dad12b119f5ca3595`, clean current `latest` at start.
- Changed local measurement: `7cd8669c89c6dbd7b39acbcf253acb2b71c0f770`, tree
  `1574e7acadfb1ad7dede24dfe2a4f12805d764df`, clean.
- Published implementation: `88238f7147214ab3598e0f38c6770ae2b8d51792` has that
  **identical implementation tree**. Original local measurement identities are
  preserved; later report-only changes are not represented as measured code.

Both runs used the same diagnostic driver, Node 24.18.0 executable bytes and
lockfile identity, warm tools/filesystem, and built-in-only subprocess fixtures.
The control ran first, then the changed candidate, without competing heavy work.
There were two diagnostic task directories, one compiler token, no compiler
workload, no recovery reuse and no release qualification. The existing scheduler
and process observer were used; task logs were real file streams.

| Observation | Control | Changed |
| --- | --- | --- |
| Unstalled primitive | Passed, 1 ms | Passed, 1 ms |
| Three 1,200 ms stalls after complete writes | Three false deadline failures | Three passes with complete bytes and closure |
| Two overlapping tasks, no injected stall | Both pass; 332 ms | Both pass; 343 ms |
| Two overlapping tasks, 1,200 ms stall at each log finalization | One failed, sibling interrupted; 2,729 ms | Both pass, both logs closed; 2,728 ms |

The original concurrent failure had complete expected bytes but no successful
closure proof for both streams at return. Its failed/interrupted statuses remain
in the report. The changed run has exact complete log bytes, successful cleanup,
no active tasks and no reported remaining task-group members. The independent
process sampler's final sample contains the diagnostic controller and sampler.

The sampled peak summed RSS was 262,156 / 367,300 KiB; sampled CPU was
6,730 / 6,690 ms. These small, single-pair diagnostics deliberately burn CPU in
controller stalls. The unchanged observer includes its own sampler in these
totals **despite its scope label**. Maximum sample gap was 202 ms; short-lived
children and exit CPU can be missed, and RSS double-counts shared pages. These
figures establish no memory admission or speedup recommendation. No release
wall-time saving is claimed.

To reproduce, use one copy of [diagnose.cjs](diagnose.cjs) against each clean
checkout, with the same pinned Node and a new output directory for each run:

```sh
node docs/internal/b10-ci01/diagnose.cjs /path/to/control /tmp/ci01-control
node docs/internal/b10-ci01/diagnose.cjs /path/to/changed /tmp/ci01-changed
```

The driver records diagnostic completion separately from the fixture outcomes.
A completed control diagnostic is expected to contain failing workload results.

## Validation and limits

The complete `unit` profile passed all **65/65 tasks in 310.342 seconds**, exit
zero, with complete ordered terminal coverage on the clean implementation commit
above. The runner reported passed cleanup for all tasks. One pre-existing S3
`.text-state-*` fixture residue remained in the checkout, as previously observed
in B10-01; its two source hashes were recorded and that owned directory was
removed. This is not represented as a clean complete release seal.

The aggregate console capture and nested recovery-task log stopped before their
final markers; their completeness is not claimed. A fresh standalone
`release-recovery-runner` run on the same committed implementation passed in
50.381 seconds with its final assertion and runner markers. An additional real
subprocess log preserved all **262,144 expected bytes**, with a passing closed-log
result. These checks resolve the focused assertion/byte-integrity question;
they do not turn incomplete console captures into complete evidence.

The `test-orchestration` task now covers complete real log bytes and closure after
three controller stalls, already-closed and prematurely closed streams, stuck
writes/close, real early open/write errors, close errors and cancellation during
closure. The recovery runner includes overlapping actual log streams, failed
log receipts and fresh re-execution. Existing lifecycle/recovery checks retain
bounded cleanup failure, task-root retention, interruption, child termination,
worker-input reconciliation and candidate-bound checkpoint rejection.

Preliminary dirty development attempts are recorded separately. The first
one-I/O-turn-only repair passed initial cases but later failed a stall regression;
it was replaced by the two-phase repair. Two new test assertions initially
misunderstood the failure-receipt envelope and were corrected to preserve failure
evidence and require re-execution. Neither attempt is relabeled a passing final
candidate. Original B10-00 failure evidence is unchanged.

Maintainer synchronization/checks, documentation synchronization/checks and local
documentation-release validation passed with no generated changes. The scope
classifier requires human review because the runner path is unclassified; the
PR declares the existing direction to implement #387. No policy rule is changed.

This removes a reproduced reliability barrier. It does not complete
[#373](https://github.com/pulse-compute/pulse/issues/373)'s compiler comparison.
Keep two workers / one compiler until the resource audit and the remaining
selected implementation/deferral decisions stabilize a candidate for fresh
complete trials. No merge, release or sub-30-minute qualification is claimed.
