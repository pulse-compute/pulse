# O-11 — qualify shared error-driver settlement

O-11 measures the O-10 factoring under the unchanged default profile. It adds
an opt-in, serial qualification task and a recorded ledger; it changes no product
source, compiler flag, retention rule or supported behavior. Entry point: none;
the ordinary root/Wasm instruction chain applies. Class: evidence; scope:
evidence-only. Additional owners are the test registry and external-task exclusion.

## Recorded result

The registered run completed in 244 seconds. The ledger verdict is **`regression-observed`**, not a performance qualification pass. All identity, exact behavior and final-boundary gates passed: 42 HTTP scenarios, 14 priority probes and four ticket-probe suites match the frozen O-09 oracle. The shared helper remains reachable through the driver at 1/8/32 sites. The diverse control is byte-identical.

| Control | Generated source bytes | Raw Wasm bytes | GNU gzip bytes | Driver + helper bytes | Final functions |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 site + error | 126,217 → 126,497 | 69,121 → 69,201 | 25,367 → 25,393 | 1,612 → 1,444 | 141 → 143 |
| 8 sites + error | 152,610 → 146,093 | 73,695 → 71,407 | 26,294 → 26,068 | 3,825 → 1,690 | 146 → 146 |
| 32 sites + error | 244,047 → 214,094 | 88,732 → 78,350 | 29,032 → 28,225 | 12,519 → 2,315 | 148 → 148 |
| 16 diverse schemas, no error | 175,134 → 175,134 | 123,408 → 123,408 | 40,737 → 40,737 | 1,244 → 1,244 | 239 → 239 |

Compiler medians below are from three fresh build pairs. RSS is MiB; CPU and wall time are milliseconds. All raw observations and paired intervals are retained in [o11-evidence.json](o11-evidence.json).

| Control | Compiler wall ms | User CPU ms | System CPU ms | Compiler peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 1 site + error | 3,636.5 → 3,738.4 | 6,074.4 → 6,325.4 | 424.7 → 516.4 | 310.9 → 320.6 |
| 8 sites + error | 3,746.8 → 3,549.3 | 6,463.9 → 6,195.3 | 454.3 → 413.6 | 322.7 → 303.0 |
| 32 sites + error | 4,544.1 → 4,870.7 | 7,051.2 → 7,784.5 | 611.9 → 619.8 | 302.9 → 318.2 |
| 16 diverse schemas, no error | 7,775.6 → 7,687.8 | 10,951.4 → 10,906.9 | 481.5 → 511.5 | 318.2 → 339.7 |

Runtime medians are milliseconds, from 20 fresh paired processes per control. `_start` includes mock imports. The warmed-module value is each process’s median of ten subsequent fresh instances.

| Control | Module construction ms | First instantiation ms | First `_start` ms | Warmed-module `_start` ms |
| --- | ---: | ---: | ---: | ---: |
| 1 site + error | 0.665 → 0.664 | 1.531 → 1.661 | 2.828 → 2.813 | 0.319 → 0.312 |
| 8 sites + error | 0.663 → 0.652 | 1.516 → 1.578 | 3.479 → 3.443 | 0.612 → 0.616 |
| 32 sites + error | 0.840 → 0.783 | 1.565 → 1.775 | 5.303 → 5.200 | 1.843 → 1.866 |
| 16 diverse schemas, no error | 0.792 → 0.903 | 1.540 → 1.592 | 2.651 → 2.599 | 0.318 → 0.310 |

At 32 sites the raw module is 11.7% smaller and gzip is 2.8% smaller. Compiler wall median is **7.2% higher**, user CPU 10.4% higher and compiler peak RSS 5.0% higher; their paired intervals are inconclusive. First instantiation and first/warmed `_start` are also inconclusive. The eight-site sample has lower compile medians and passes the declared non-regression thresholds; the one-site case retains its small size increase and has mixed/inconclusive timing results.

The unchanged diverse control reports system CPU +6.2% (roughly 30 ms), with its paired interval above the 5% threshold. That is the only metric classified as a regression, and it blocks an overall pass. Identical compiler inputs and artifacts make it a warning about measurement variability, not evidence that factoring changed that control. Its RSS and several runtime intervals are also inconclusive. These exploratory, per-metric intervals have no multiple-comparison adjustment. No timing rerun or sample selection was used to obtain a more favorable verdict.

Guest capacity is unchanged in every pair: 2,490,368 bytes for the 1/8-site cases, 4,980,736 for 32 sites and 2,621,440 for the diverse control. Host peak RSS is approximately unchanged. This establishes no allocation or live-memory improvement. The ledger’s `hostcalls` field counts recorded hostcall-trace entries; it is not a full imported-callback profiler.

**Decision:** retain the structural size finding, but do not claim a build-time, RSS or request-speed improvement. A performance acceptance decision needs a separately predeclared, better-powered run on a controlled host; do not change default compiler settings on the strength of this run.

## Frozen comparison and protocol

Baseline: merged O-09, `5142725930ef8c481ad16b5b7ca2e8ebaab4ee6f`.
Candidate: merged O-10, `2e08f1eaabcadbf400fc776fb64f55354b6d62e0`.
The harness verifies that only the two factoring owners differ in production,
that the working production closure matches the candidate, and that the frozen
fixtures, host, behavior oracle, optimizer owners and lockfile are unchanged.
Baseline workers load those two original owners from Git in fresh processes.
Every baseline artifact must reproduce O-08's source and Wasm hashes exactly.
Every repeated build must reproduce its variant's source and Wasm hashes.
AssemblyScript, json-as and Binaryen package-content digests are captured before
measurement. No dependencies are installed by this task.

The fixture set is O-08's 1/8/32 config-effect sites with an error route, plus
its 16-diverse-schema, one-effect, no-error-route negative control. Both variants
of that control must have identical generated-source and production-Wasm hashes.
The fixtures are generic and do not estimate savings in a deployed application.

The protocol is embedded in the harness and saved before measurement:

- Three build pairs per fixture, alternating baseline/candidate order, each in
  a fresh process. Builds and runtime sampling are serial; do not run other
  builds alongside this task.
- The actual ASC command is supervised by a one-child Python process. Linux
  `RUSAGE_CHILDREN` gives that compiler's user/system CPU and peak RSS, including
  the default optimization inside ASC. Wall time surrounds that child. The
  supervisor forwards streams and exit status; compiler arguments are unchanged.
  Compiler-worker wall time and its own peak RSS are recorded separately.
- One names-only companion per variant, outside the measured build samples.
  Every non-custom section must match the production binary byte-for-byte before
  O-08's inspector attributes bodies or call edges. The reachable driver must
  directly call exactly one surviving shared helper once per static effect site.
- Twenty fresh-process runtime pairs per fixture, alternating order and cycling
  through the three build artifacts. `new WebAssembly.Module` is timed before
  any validation, inspection or previous module construction in that process.
  The constructor validates the binary. Test-owned host hooks reuse that module
  and time instantiation and the first `_start` separately. `_start` includes
  synchronous mock callbacks and any lazy compilation.
- Each runtime process also measures ten subsequent invocations with fresh
  instances of the same module. Their median is a warmed-module measurement,
  not steady-state execution in a reused instance. Exact response and full trace
  parity with the unmodified host is checked outside timing. Each invocation
  checks the expected body and config-get count. Paired semantic hashes must
  match, including in the diverse control.
- Medians, median absolute deviations and 4,000 fixed-seed paired bootstrap
  resamples retain all observations. The material regression threshold is 5%
  of baseline median, with a 0.1 ms minimum for runtime timings. A paired-delta
  interval wholly above that threshold reports regression; an upper bound at
  or below it passes; otherwise the result is inconclusive. Three build pairs
  produce exploratory intervals, not a powered performance guarantee. No
  automatic rerun, sample dropping or default-profile tuning follows a result.

Runtime RSS is the Node/mock host process after the timed invocations; it is
not guest memory. Guest capacity is linear-memory buffer capacity after a
request, not allocation volume, peak guest use or live bytes. Imported callback
time is included in `_start`; it is not separately attributed or subtracted.
Local Node/V8 timing does not establish Fastly cold-start or request latency.

The unchanged O-09 suite is a separate correctness gate within this task. Its
fresh candidate responses, trace/event hashes, ticket checks and priority probes
must match the checked-in pre-factoring ledger exactly. The recorded baseline
behavior is reused; the baseline size/build/runtime fixtures are freshly built.

## Reproduction and evidence

Restore lockfile-pinned dependencies and workspace outputs, and ensure both
recorded revisions are available in Git history. This external task requires
Linux, Python 3, GNU gzip and the pinned workspace toolchain. It is deliberately
excluded from the release profile and normal CI timing gates.

```bash
node wasm/scripts/run-wasm-tests.cjs --task fastly-driver-qualification-o11 \
  --report .test-results/o11-qualification.json
# Explicitly refresh the checked-in ledger after reviewing a new complete run:
node wasm/test/runtime/compiler-efficiency/o11-driver-qualification.cjs --record
```

Timestamped running/completed/failed reports, all sampled artifacts, names
companions, call graphs and the O-09 log remain under
`wasm/.test-results/compiler-efficiency/o11/`. O-09's detailed scenario evidence
retains its own timestamped directory. A completed report means every required
sample and correctness/identity gate finished; the separate `qualification`
field can still report a regression or inconclusive performance. Such a result
is evidence to review, not a harness crash or a promise of improvement.

The initial development attempt passed O-09 parity but failed before any build
sample: a test-owned baseline module placed in Node's cache lacked its `loaded`
flag, triggering Node's circular-require handling on frozen exports. Its failed
report is retained. The corrected loader reproduces the frozen baseline hash;
the smoke runtime proves timer-hook parity. Neither changed the behavior oracle
or measurement protocol.

Validation: the registered O-11 task completed all samples and passed its correctness/identity gates; the complete unit profile passed all 34 tasks. The TypeScript workspace build, maintenance check and deterministic scope check pass. This is focused development evidence, not a full release replay or deployed-host qualification.
