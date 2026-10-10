# PERF8-01: reproducible benchmark suite

Human direction: implement PERF8-01 for beta.8 after BLD8-01. No named Entry Point
matches this test-owned measurement harness; the ordinary root/Wasm/docs chain
applies. Class: evidence; scope: evidence-only. There are no production-source,
compiler-default, execution-semantic, dependency or CI/seal changes.

## Run

Use a clean checkout with lockfile-pinned dependencies installed with lifecycle
scripts disabled and the workspace prepared as for the existing
[PS-08 suite](../ps08/README.md). From the repository root:

```bash
node wasm/test/performance/check-report.cjs
node wasm/test/performance/check-perf8.cjs
node wasm/test/performance/baseline.cjs --suite beta8 --out wasm/.test-results/performance/beta8.json
node wasm/test/performance/check-perf8.cjs wasm/.test-results/performance/beta8.json
```

Choose a new output filename for every run. The original `--out` invocation and
v1 `--compare` remain available for PS-08. The beta.8 suite writes
`pulse.performance-baseline.v2` and `pulse.performance-protocol.v2`; it cannot be
silently compared by the legacy v1 comparator. PERF8-02 owns v2 baseline
comparison, environment/variation analysis, production-log analysis and any
eventual justified thresholds. This ticket introduces no performance gate.

## Fixed matrix

| Fixture | Targets | Purpose |
| --- | --- | --- |
| minimal-request | Node JavaScript, Node Native | Basic dispatch and JSON response |
| schema-effect | Node JavaScript, Node Native | Schema decode, fixture fetch and schema encode |
| multi-route | Node JavaScript, Node Native | Mounted routing, parameter extraction, status and missing-path behavior |
| large-router-compile | Node Native | Compile-only: 64 static routes, 16 input and 16 output schema declarations |

The larger fixture is generated deterministically from fixed counts and is not
Catalog or a model of its middleware graph. It uses current default compilation,
not Catalog's optimized profile. Effective flags and optimization remain in the
evidence. No new targets, Rust comparison or live services are involved.

All seven cells and all 76 request cases pass correctness checks **before** the
measurement campaign starts. The larger fixture checks every one of its 64 paths
but records runtime timing as unavailable with a compile-only reason. Each cell
then has three fresh build workers and empty outputs. The six runtime cells have
three fresh runtime workers, one first request, ten warmup requests and thirty
measured requests per worker. Every measured response is checked outside its
timer. Work is serial, with a 180-second worker deadline and bounded process-tree
cancellation inherited from PS-08. OS and filesystem caches are not flushed.

## Observation boundaries

| Evidence | Meaning |
| --- | --- |
| `buildMs` | CLI imports, resolution and `buildProject`; excludes worker startup, fixture setup, post-build capsule replay and cleanup |
| `retainedBuildMs` | BLD8 total from build entry through inventory capture; excludes prior resolution and final report serialization/publication |
| `retainedCompilationMs` | BLD8 compiler invocation time; nested inside build elapsed time, not additive overhead |
| `compilerPeakRssBytes` | Native: maximum individual ASC-process high-water RSS, including its re-exec; JS: build-worker high-water RSS. Neither is a sum or a full concurrent process-tree peak |
| `artifactBytes` | Executable Wasm, or emitted JavaScript/modules/codecs. Installed dependencies and report files excluded; artifact kinds stay distinct |
| `coldLoadMs`, `firstRequestMs`, `warmRequestMs` | Existing PS-08 host-invocation boundaries; no HTTP transport. Native instantiation remains within each request |
| `firstRequestCpuUserUs`, `firstRequestCpuSystemUs` | Process CPU deltas around the first request, in microseconds |
| `warmRequestCpuUserUs`, `warmRequestCpuSystemUs` | Per-request process CPU deltas after warmup, in microseconds. Output assertions excluded; measurement overhead and process-wide GC/scheduling are not subtracted |
| `runtimePeakRssBytes` | Runtime worker's process high-water RSS after all requests, including imports, host and guest; not a per-request or guest-only peak |
| `runtimeSamples[].memory` | `process.memoryUsage()` before/after load, after first request, after warmup and after measured requests: RSS, V8 heap total/used, external and array-buffer bytes; no forced GC |
| `cleanupMs`, `requestCleanupMs` | Fixture deletion timed separately; mandatory request disposal remains inside invocation and has no separate public timer |

Runtime memory snapshots are observations, not leak detection or Wasm linear
memory attribution. A smaller end snapshot does not establish a lower peak.
Native and JavaScript compiler RSS have different process boundaries. CPU time
and elapsed time have different units and meanings; they are never combined.

Every v2 cell retains all build samples, runtime samples and memory snapshots,
alongside summaries. Native build samples include validated BLD8 capsule identity,
selected context, producer, actual flags, toolchain, total/stage/compiler timings
and reuse/cache observations. JavaScript has no Native build capsule and says so.
Capsule replay happens after the build timer. Resolve/build output paths agree;
ASC resource logs and measurement receipts live outside application inputs.

The existing source, fixture, protocol, dependency and environment identities are
retained. Source and dependencies are checked again at completion. Validation
reconciles summaries with raw measurements, rejects missing/duplicate cells,
incomplete correctness coverage, inconsistent build metadata, dirty source and
failed/interrupted reports. Zero CPU is a valid observation; unavailable RSS or
compile-only runtime measurements never become zero.

Reports are atomically updated after preflight and completed cells; failed or
interrupted runs remain labeled, with partial coverage and worker logs. Scratch
projects are removed in `finally`. A new report cannot overwrite an old run.

## Development validation

The cheap report checks are manual and introduce no registered task or CI gate.
They cover the seven-cell matrix, raw/summary reconciliation, CPU and memory
observations, retained metadata and rejection cases. The real campaign is run
from a clean committed source; its outcome is recorded in the implementing PR.
Raw local benchmark logs are not added to the package or release payload.
