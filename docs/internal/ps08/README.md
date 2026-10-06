# PS-08: small manual performance baseline

Human direction: implement PS-08 from the next-stream plan. No named Entry Point
matches this test-owned measurement harness; the root/Wasm instructions apply.
Owners: `wasm/test/performance/` and this repository-only note. Class: evidence;
scope: evidence-only. Product sources, compiler defaults and test profiles are
unchanged. The harness adds no dependencies, registered tasks or CI/seal gates.

## Run and compare

Use a clean checkout with the lockfile-pinned workspace dependencies installed
with lifecycle scripts disabled, and run `pnpm build` once. No seal, package
construction, live service or credentials are needed. From the repository root:

```bash
node wasm/test/performance/baseline.cjs --out wasm/.test-results/performance/baseline.json
```

This is one serial campaign on Node JavaScript and Node Native for three small
fixtures: a minimal JSON request, schema decoding/encoding around one fixture
fetch, and a mounted application with multiple routes. All six fixture/target
cells, including every route case, must pass **before timing starts**. The
measured multi-route request is `/api/users/42`; its other routes are semantic
checks. Fetch is supplied by the existing Node fixture adapters with no network.

There are three fresh build processes per cell, three independent runtime
processes, ten warmup requests per runtime process and thirty warm samples per
process. That is three cold observations and ninety warm observations per cell.
Runs are awaited serially. Repeat the same command with a new output filename:

```bash
node wasm/test/performance/baseline.cjs --out wasm/.test-results/performance/repeat.json
node wasm/test/performance/baseline.cjs --compare wasm/.test-results/performance/baseline.json wasm/.test-results/performance/repeat.json
```

The comparison pairs cells by fixture **and target**, permits source/tree changes,
and rejects different schemas, failed/interrupted/dirty reports, duplicate or
missing cells, fixture bytes, harness/protocol, optimization/compiler settings,
artifact definitions, dependencies, Node options/toolchain, hardware/OS or sample
counts. Changed dependencies/settings require a separately labeled baseline;
there is no override that silently combines them. Output gives per-cell median
changes, with unavailable metrics preserved. It sets no speed or release gate.

The cheap comparison contract check is also manual:

```bash
node wasm/test/performance/check-report.cjs
```

## Measurement boundaries

| Metric | Included / excluded |
| --- | --- |
| `buildMs` | CLI imports, project resolution and actual `buildProject` in a fresh worker; fixture setup, worker startup and post-campaign deletion excluded |
| `compilerPeakRssBytes` | Native: maximum individual ASC-process high-water RSS, including its source-map re-exec, from `resourceUsage().maxRSS`; JavaScript: compiler/build worker high-water RSS, including imports and packaging. These are different compiler implementations; RSS is not summed |
| `artifactBytes` | Native executable Wasm; JavaScript emitted application modules, loader and schema codecs. Excludes inspection files and separately installed dependencies; artifact kinds remain explicitly labeled |
| `coldLoadMs` | Runtime/adapter imports and artifact reads, plus JavaScript application/codec imports. Native Wasm validation, compilation and instantiation remain in each request |
| `firstRequestMs` | First complete provider-host request, including request construction, body materialization and mandatory request disposal |
| `warmRequestMs` | Same complete request after warmup; expected output checked outside each timer. Warm Native requests still instantiate through the existing host API |
| `cleanupMs` | Per-cell fixture/output directory deletion after all samples; separate from timed build/load/request |
| `requestCleanupMs` | Explicitly unavailable: the provider invocation includes mandatory disposal and exposes no independent public timing hook |

The test-owned ASC preload appends observations for every process. ASC's small
launcher exits after its compiler child, so overwriting one resource file would
incorrectly report the launcher alone. Capturing both avoids that attribution
error without adding product hooks or polling `/proc`. A missing/zero resource
observation is unavailable, never a zero-byte result.

The report uses `pulse.performance-baseline.v1`. It records Git revision/tree and
clean state, lockfile/installed-lockfile hashes, resolved TypeScript/AssemblyScript/
json-as versions and manifest hashes, Node version/component versions/binary hash,
Node options, CPU/core availability, OS/architecture, host RAM and available
cgroup CPU/memory limits. Each cell records fixture digest, provider/target,
strict/reporting/WAT and actual optimization/ASC flags/JSON environment, artifact
kind/hash, sample counts and min/max/mean/p50/p95. Cold samples and per-process
warm summaries are retained. Percentiles use nearest rank; small samples do not
establish significance.

“Cold” means a new process and empty build output, or a new process loading an
existing artifact. Dependencies are already installed; OS/filesystem caches are
uncontrolled and never claimed cold. These measurements describe workspace Node
host invocations; HTTP server startup, wire transport and deployment are outside
this baseline. Source and dependency identities are checked again at completion.

Reports are atomically updated after semantic checks and completed cells. Failure
or interruption preserves a terminal report and worker log, with partial coverage
ineligible for comparison. Existing process supervision applies a finite timeout
and bounded child-tree cancellation. Disposable project/output directories are
removed in `finally`; reports/logs remain. Output filenames cannot be reused.

## Initial results and validation

[Baseline](baseline.json) and [repeat](repeat.json) are compact, versioned JSON
snapshots from the clean, recoverable harness commit
[`64e2f7cd1270`](https://github.com/pulse-compute/pulse/commit/64e2f7cd127009aa0e1c3bdea1596f1525baa0c3)
(tree `ced8ceb8e13336bcf528a3693fec2205d6485d84`). The subsequent result/documentation commit
changes no measured code. Reports passed all six cells in **32.17 s** and
**30.23 s**, including preflight checks and disposable cleanup.
Machine: AMD EPYC 9V74 80-Core Processor,
8 available CPUs, 8 GiB cgroup memory cap; Node v24.19.0.
Full OS, dependency and compiler identities are in each report.

First campaign medians (warm p95 also shown):

| Fixture | Target | Build ms | Compiler RSS MiB | Artifact bytes | Warm p50 / p95 ms |
| --- | --- | ---: | ---: | ---: | ---: |

| minimal-request | node-javascript | 440.2 | 127.3 | 379 | 0.249 / 0.493 |
| minimal-request | node-native | 1382.1 | 257.5 | 808 | 0.429 / 1.294 |
| schema-effect | node-javascript | 491.2 | 127.4 | 14,035 | 0.620 / 1.784 |
| schema-effect | node-native | 2484.6 | 316.8 | 39,479 | 1.533 / 2.522 |
| multi-route | node-javascript | 475.3 | 127.5 | 742 | 0.204 / 0.391 |
| multi-route | node-native | 1371.1 | 261.9 | 2,933 | 0.527 / 0.903 |

The real reports compare successfully:

```bash
node wasm/test/performance/baseline.cjs --compare docs/internal/ps08/baseline.json docs/internal/ps08/repeat.json
```

The unchanged-code repeat moved build medians by −14.6% to −0.1% and warm medians
by −13.5% to +20.3%. These are observed run-to-run variation, not an optimization
win or a statistical confidence bound. Re-run a control from the measured source
on the same environment before judging later compiler changes; reports from
different hardware/dependencies/settings are deliberately incompatible. The ninety
warm observations share three processes and are not ninety independent trials.

Validation:

- All twelve campaign preflight cells passed; each campaign checked six cases per
  target (one minimal, one schema/effect and four multi-route outputs). Every timed
  request was also checked outside its timer.
- Complete unit profile passed **45/45 tasks in 72.02 s** on the latest base with
  the PS-08 working patch. Comparison checks reject target/settings/protocol,
  dependency/environment, incomplete evidence and metric-shape mismatches.
- A modified Native optimization setting in a real report was rejected with a
  nonzero CLI exit. An interrupted campaign terminated within the ten-second
  check bound, retained an `interrupted` partial report/log and was rejected by
  comparison. The report retained completion and explicit cleanup timing.
- Maintainer/documentation synchronization and checks, release documentation
  validation, whitespace and scope declaration passed. A first documentation
  validation attempt found a test-only environment name using the public Pulse
  prefix; it was renamed to `PS08_COMPILER_RSS_FILE` and revalidated.
- The initial baseline launch refused a unit-created untracked temporary config
  before measuring anything. That residue was retained under ignored test results;
  both completed campaigns identify a clean source tree.

These are focused development measurements. No full seal was run for PS-08 and
no performance threshold or parallel-default promotion is introduced.
