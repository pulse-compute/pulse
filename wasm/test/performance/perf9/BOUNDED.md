# PERF9-02 — bounded-size characterization

This is the final selected forwarding follow-up in #313. It preserves the
[PERF9-01C baseline](RESULTS.md) and compares three fresh, named artifacts:
Pulse default, Pulse `--experimental-native-bounded-size`, and unchanged Rust.
It changes no product code, defaults, ordinary CI selection, release gate or
deployment. This is characterization, not an optimization project.

The completed campaign and frozen replay are in [bounded-size results](BOUNDED-RESULTS.md).

## Run and retain

Use the same clean checkout, pinned workspace dependencies, Rust 1.90.0 with
`wasm32-unknown-unknown`, and Viceroy 0.21.1 as [PERF9-01A](README.md#reproduce).
Linux procfs and Python 3 are additionally required for counters and isolated
build-process observations. Run alone, with no competing build/test workload:

```sh
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/test/performance/perf9/bounded.cjs
node wasm/test/performance/perf9/bounded.cjs --check /absolute/path/to/bounded.json
```

The runner retains `wasm/.test-results/perf9-02-*/bounded.json`, every build,
raw block, failure, Wasm artifact and separate guest profile. It shares the
original checkout measurement lock. Inspect an orphaned lock for a live owner
before removing it; never retry selected blocks. A failed attempt remains
failed, and a force-killed `running` receipt is not valid evidence. All three
members of a completed block are recorded before unexpected outcomes reject it.

No routine CI task is added. `--self-test` checks the three-arm balance without
building or measuring. `--check` verifies complete coverage, retained build
receipts/artifacts, source identity, byte/error outcomes, resource arithmetic,
pairwise summaries and retained profiles. Absolute raw artifact paths are
retained; preserve the complete attempt when moving it. Checks are development
evidence, not release qualification.

## Three artifacts and three cases

The forwarding source, shared Rust reference and semantic oracles are unchanged.
Default Pulse and Rust must reproduce the frozen baseline Wasm hashes. Each arm
gets three fresh builds in a Latin-square order, so each occupies each build
position once. All three default-artifact builds per arm must be byte-identical.
The recorded AssemblyScript recipes must show O3/shrink2 without convergence
for bounded-size, ordinary flags for default, and no JSON cache-arena elision.
This flag is distinct from converging `--experimental-native-size`.

All arms run the existing default, unequal-cap and earlier-total ABI corpus,
the unchanged differential oracle against Rust, and the default artifact's
19 real Viceroy wire cases. Bounded copying, 16 KiB scratch, actual-byte caps,
header filtering, deadlines and host handoff remain identical.

Only 1 KiB/c4, 1 MiB/c1 and 1 MiB/c4 are timed. The parent protocol's payloads,
origin, sockets, closed-loop lanes, eight excluded warmups, 30 independent blocks
of 16 requests per arm, CPU/RSS sampling and 20 ms settle are unchanged. Seed
90213 shuffles cells and five copies of all six arm permutations per cell.
Every arm occupies each position ten times; every pair has 15/15 precedence.
This produces 4,320 measured requests plus 72 warmups. Three-arm block structure
is explicitly different from the old two-arm campaign; old samples are never pooled.

For bounded-minus-default, default-minus-Rust and bounded-minus-Rust, use the
same whole-block 4,000-resample percentile bootstrap of mean block-p50s. Retain
absolute milliseconds and relative percentages. Process CPU/attempt differences
also receive a paired-block bootstrap in absolute milliseconds; this does not
improve the underlying 10 ms counter resolution. Intervals are exploratory,
unadjusted for comparisons, and can retain time correlation. Wide or zero-crossing
intervals are inconclusive, not equivalence. No speed threshold determines pass.

## Distinct measurement domains

| Observation | Boundary |
| --- | --- |
| Fresh build wall time | One normal project build after worker imports/tool identity; includes compiler/linking/writing, not only code generation. Three observations, no significance claim. |
| Pulse compiler peak RSS | Maximum individual ASC process high-water, including its source-map re-exec, observed with the existing test-only exit recorder; not a sum or entire build-tree peak. |
| Rust compiler/build peak RSS | Linux waited Cargo/rustc descendant maximum individual RSS from an isolated Python wrapper; includes Cargo. Different process composition from ASC, not a pure language-memory ratio. |
| Build worker/tree observations | Retained separately; not substituted for compiler-only values. |
| Guest linear memory | Exact-artifact injected ABI measurement; no Viceroy process-memory attribution. |
| Process CPU/RSS | Same Viceroy counters as PERF9-01B, with startup excluded from CPU windows; no guest/host split. Lifetime HWM and sampled RSS remain separate observations. |
| Latency/throughput | Unprofiled closed-loop HTTP completion and per-block rates; no saturation or live Fastly claim. |

## CPU attribution feasibility

The pinned Viceroy binary advertises `guest`, `perfmap`, `jitdump` and `vtune`.
[Its exact source](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/execute.rs)
passes native profiling strategy to Wasmtime and drives guest sampling through
epoch increments from a sleeping thread. Its pinned Wasmtime dependency is
39.0.2. This supports function-location diagnostics; it does not supply an
unbiased all-thread guest/host/kernel CPU denominator.

The feasibility receipt records binary help/hash and two read-only Linux
`perf_event_open` probes. A successful software task-clock counter is not itself
symbolized sampling. No host changes, privilege changes or Viceroy fork are
introduced. If usable native profiling is absent, attribution remains explicitly
unavailable: no guest CPU milliseconds, guest/host CPU percentages, guessed host
subtraction, or wall-minus-CPU network estimate.

After unprofiled servers stop, new servers run `--profile=guest,...,50us` for
32 sequential 1 MiB requests per arm. Profiled request times never enter timing
tables. Raw per-request profiles, sample counts, empty stacks and function names
are retained as diagnostics. A guest sample count is not converted to CPU time
or divided by the process CPU counter. Host/runtime, kernel and unknown CPU
shares remain unavailable without a valid all-thread sample population.

The optional #289 scalar-table diagnostic is deferred. This experiment neither
alters the measured guest to export counters nor infers retention from RSS or
profile counts. A memory-runtime fix remains outside this ticket.
