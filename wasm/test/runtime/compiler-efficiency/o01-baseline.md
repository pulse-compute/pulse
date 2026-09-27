# O-01 — Native size and memory baseline contract

Evidence-only baseline, September 26, 2026. The machine-readable identities and sampling contract are in [`o01-baseline.json`](./o01-baseline.json). This record pins `latest` at `0a8233317bdbd4ece266daa0946d129ce03ce89b` (tree `95f11662df214f887aad6dc4da18075bba66b027`). It does not change a product default or infer a performance improvement.

## Fixture and reproduction

Reuse the repository-owned `wasm/test/fixtures/projects/compiler-efficiency-memory` fixture and the existing `compiler-efficiency-p02` task. It issues 0, 1, 16 and 64 bounded 4,096-byte S3 pages through schema-enabled Native Node and the injected Fastly ABI host. It checks exact responses (`0:-1` through `64:63`) and counts effects. The fixture source hash, individual file hashes, lockfile hash, runner hash, generated AssemblyScript hashes and Wasm hashes are sealed in the JSON record. No private consumer code or source names are part of the fixture.

Run from the pinned source and lockfile:

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p02 --report .test-results/compiler-efficiency/o01/p02.json
```

A direct invocation of `node wasm/test/runtime/compiler-efficiency/p02-memory-trace.cjs` passed on this checkout with four request cases. The original raw report is preserved as [`o01-p02-evidence.json`](./o01-p02-evidence.json); the task also writes ignored output at `wasm/.test-results/compiler-efficiency/s01/measurements.json`. The preserved copy has SHA-256 `0d7bcfcb36d3001e069d582d3e3ebce5b32af915b2066167d67615b5158e7aaf` (verify this hash against the JSON record before reusing the file). The runner command above is the policy-owned replay; its terminal result is a separate gate.

| Target | Generated AS | Final Wasm | ASC time, one build |
| --- | ---: | ---: | ---: |
| Node Native | 35,864 B (`6dcdc86d...`) | 44,172 B (`b5f017ab...`) | 1,873 ms |
| Fastly Native | 162,506 B (`5faee9ca...`) | 115,076 B (`fa695a33...`) | 3,701 ms |

The exact 64-page response has 128 Node effect operations and 64 Fastly outbound requests. Node's charged budget is 2,694,224 bytes and 14,783 values at that case; its estimated rooted host-value graph is 2,217,182 bytes. Fastly's charged budget is 1,735,058 bytes and 6,185 values; final Wasm capacity is 14,417,920 bytes (220 pages). These quantities are different measures, not interchangeable live-memory estimates.

## Compiler recipe and dependency closure

The schema-enabled non-guest path selects AssemblyScript's **incremental** allocator on both targets. Source inspection shows `--runtime incremental --noAssert --optimize`, Pulse's pre-optimization retention transform and post-optimization `merge-similar-functions`. The ordinary recipe is O3/shrink0; neither experimental size mode is selected. The P02 report does not capture exact compiler argv or optimizer/allocator manifests, so these flag facts are **source-derived**. O-03 should capture the actual child command before attributing phase cost.

Lockfile SHA-256 is `4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`. Node is v24.19.0 on Linux x64; AssemblyScript is 0.28.18. `corepack pnpm 12.6.0 install --offline --frozen-lockfile` populated packages, but returned `ERR_PNPM_IGNORED_BUILDS` for two esbuild versions. The direct P02 run passed with those installed packages. This is not a claim of a clean dependency restore or full release seal.

## Metric meanings and next sampling gate

- **Compiler child peak RSS:** maximum resident set of the actual compiler child, sampled or reported with PID and method. The direct run's `/proc` sampler observed **zero** worker bytes and no compiler descendants in this environment; record this metric as unavailable. O-03 must repair attribution rather than write `0 MiB` as a measured peak.
- **Host process RSS:** process-wide resident memory at named checkpoints. It includes runtime, fixture and V8 overhead; it is not guest live memory.
- **Guest capacity:** Wasm linear-memory pages × 65,536. It is a high-water capacity, not allocated volume or retained/live bytes. Node P02 exposes initial capacity only; Fastly P02 exposes final capacity.
- **Cumulative allocation / live or retained roots:** O-02 will measure these directly or label estimates with their coverage. P02's charged budget is cumulative policy accounting, and its Node root estimate covers the ValueHeap handle-map graph only. Neither substitutes for full allocation/liveness tracing.
- **Size:** compare generated AS bytes/function counts, raw Wasm, GNU `gzip -n -9`, optimized function bodies and code/data sections independently. A source reduction can leave final Wasm unchanged.
- **Time:** distinguish source generation, ASC/optimization, cold module construction, instantiation and request execution. The injected Fastly `_start` interval includes imported host callbacks and is not deployed request latency.

For future candidate comparisons, plan at least **three independent builds per mode** and **five serial alternating fresh request processes per mode** with identical revisions, fixtures, flags and machine conditions. Increase repetitions if baseline spread overlaps the proposed threshold. Provisional material-change gates, to lock using observed variance before tuning: at least 10% reduction in one predeclared primary memory or compiler-cost metric, or 5% raw Wasm reduction; report gzip separately. Require exact semantic parity and no more than 5% median runtime regression beyond noise in the same harness. These percentages are decision targets, not passing results from this one baseline run.

O-02 owns guest allocation/liveness; O-03 owns compiler phase/RSS. This record does not qualify Viceroy, deployed Fastly or a new product performance default.
