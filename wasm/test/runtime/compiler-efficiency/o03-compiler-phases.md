# O-03 — Compiler phase CPU, wall time, and RSS

Evidence only, September 26, 2026 (America/Denver), on `latest` at `c63f45840aa6f69a3ddc0ed8a51a9b9327c43cc7`. This extends the [O-01 baseline](./o01-baseline.md) with the same generic schema/effect fixture. The [preserved ledger](./o03-evidence.json) records six serial pairs: three fresh compiler processes per mode for each of Node Native and Fastly Native. Control/profile order alternates. All twelve replayed builds match their production Wasm **byte for byte**. Isolated source generation also matches production source bytes in all six runs.

## Reproduce

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-phases-o03 --report .test-results/o03-phases.json
```

The task writes `wasm/.test-results/compiler-efficiency/o03/measurements.json` with portable command paths, plus `measurements.raw.json` with the exact local paths. Production compiler argv and the three json-as environment flags are captured from the real compile call, not reconstructed from presumed defaults. The ledger pins source/fixture/lockfile/probe/ASC hashes, source revision, working-tree state, compiler PID, and artifact identities. The recorded run is development evidence identified by those script hashes.

The preserved ledger uses the harness in PR revision `82bd9ffa71ea7c60a923a633ef1590b9043bd7de`. A subsequent documentation-gate fix embeds the temporary usage-report path directly in its generated hook, removing an unnecessary environment variable. The historical measurements remain intact; the corrected harness is verified by rerunning the registered task.

The fixture still generates 35,864 B of Node AS / 44,172 B Wasm and 162,506 B of Fastly AS / 115,076 B Wasm. Both use the default optimization recipe and incremental runtime, with a 4,096-page maximum. Dependency installation populated the frozen offline graph but reported ignored esbuild build scripts; the focused task and required checks passed with that installed graph.

## Findings

**The highest resident footprint occurs at emission/finalization, after Binaryen optimization has raised the retained process footprint.** The final emission boundary is about 345 MiB for Node and 348 MiB for Fastly in the profiled median. This is a process state at that phase, not memory exclusively allocated or owned by emission. Earlier compiler objects and allocator arenas can remain resident.

Binaryen's default optimization dominates CPU and wall time: about 940 ms Node / 2,526 ms Fastly median wall time. RSS rises from roughly 277/271 MiB after lowering to 344/347 MiB after optimization. Parsing also grows the resident footprint substantially. Retention is small on this fixture: **seven selected names, five safe-prefix `no-inline` passes**, roughly 3/5 ms total. The trailing `merge-similar-functions` pass costs roughly 3/7 ms. These measurements do not establish retention cost on a dense or sparse large-helper corpus; O-12 still owns that investigation.

Medians of three profiled processes per target (CPU is user + system):

| Phase | Node wall / CPU | Fastly wall / CPU | Node RSS at end | Fastly RSS at end |
| --- | ---: | ---: | ---: | ---: |
| Isolated source generation | 5.8 / 6.3 ms | 15.2 / 16.4 ms | 42.6 MiB | 92.1 MiB |
| ASC parsing | 149.9 / 425.5 ms | 148.5 / 432.9 ms | 222.4 MiB | 226.1 MiB |
| ASC initialization | 16.8 / 25.8 ms | 17.7 / 26.3 ms | 227.8 MiB | 228.3 MiB |
| ASC lowering to Binaryen IR | 130.1 / 333.5 ms | 209.2 / 439.5 ms | 277.2 MiB | 271.3 MiB |
| Retention grouping + passes | 3.0 / 3.4 ms | 5.1 / 7.2 ms | 277.5 MiB | 272.2 MiB |
| Default Binaryen optimization | 939.7 / 2,107.2 ms | 2,525.7 / 3,759.0 ms | 343.9 MiB | 347.1 MiB |
| Binaryen post-passes | 2.8 / 3.6 ms | 6.5 / 11.6 ms | 343.9 MiB | 347.2 MiB |
| Binary emission | 19.0 / 63.1 ms | 39.7 / 106.6 ms | 344.8 MiB | 348.2 MiB |
| Finalization / output / disposal | 2.2 / 7.6 ms | 5.7 / 20.0 ms | 344.8 MiB | 348.2 MiB |

Source generation runs in a separate process, from the captured plan, with dependency loading and plan construction excluded from its interval. Its RSS cannot be added to compiler-child RSS. ASC transform totals, compiler load, validation, and nested retention/post-pass details are in the ledger. Do not sum overlapping rows or independent medians.

### Control and observation cost

| Target | Control child peak RSS, median (range) | Profile through ASC return, median (range) | Control / profile parent wall, median |
| --- | ---: | ---: | ---: |
| Node | 313.4 MiB (311.0–315.7) | 344.8 MiB (323.0–345.2) | 1,735 / 1,823 ms |
| Fastly | 336.1 MiB (309.9–346.5) | 348.2 MiB (344.4–348.4) | 3,449 / 3,575 ms |

Controls use the original ASC CLI and retention transform with an exit resource-usage hook. The profile uses the same pinned ASC API and a subclass that calls the original retention implementation. No product or dependency source is edited. Profiling adds per-interval observations and a sampling thread; the paired figures expose that overhead. There is no optimization candidate or speedup claim.

## Measurement boundaries

- ASC's `Stats` intervals separate parse, initialization, lowering, transform, validation, optimization, and emission. Parse time excludes parser work performed inside json-as transforms; that work remains in transform time. CPU is process-wide and can exceed wall time because compiler threads run concurrently.
- A worker thread samples **the same process's RSS** every 5 ms while the main thread is blocked in ASC/Binaryen. Each sample is assigned only to actual phase intervals. Observed maximum sampling gaps were 7.2 ms Node / 13.3 ms Fastly. Sampled peaks are lower bounds; intervals with no samples have a `null` peak and a zero sample count. Boundary RSS is recorded separately.
- `resourceUsage().maxRSS × 1024` supplies Linux child lifetime high-water bytes even where the old P02 `/proc` descendant sampler observed nothing. A rising high-water mark localizes a new peak to an interval; an unchanged mark does not reveal that interval's peak. The control is recorded at exit; the profile is recorded through ASC return, before report formatting and sampler teardown.
- Retention name selection, total retention, each safe-prefix pass, and trailing Binaryen passes are measured explicitly. Grouping/setup wall time is the retention total minus pass intervals. The default Binaryen interval ends at the first trailing post-pass call. Nested intervals are not additive.
- This is the bounded O-01 generic fixture, not a large-application scalability result. It identifies emission/finalization as the highest observed resident phase and optimization as the dominant compute phase on this fixture. It does not identify which earlier objects could safely be released, or justify changing the optimizer, retention policy, or allocator.
