# B10-01 — expensive phase and preparation attribution

Issue #374. Target `latest`; base `57e8a25c` includes B10-00. This evidence
investigation changes no selection, compiler behavior, scheduler default,
installed-consumer independence or qualification authority.

## Diagnostic

`wasm/test/support/phase-observer.cjs` is a standalone, opt-in test preload.
Set `PULSEWASM_TEST_PHASE_DIR` to a fresh existing directory and preload it with
Node `--require` / `NODE_OPTIONS` when running the selected tests. The installed
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
ends, drops and observation errors remain visible.

```sh
node scripts/qualification-phases.cjs /explicit/trace/directory > phases.json
node wasm/test/release/assert-phase-observer.cjs
node wasm/test/release/assert-qualification-phases.cjs
```

The analyzer never executes tasks, follows reported artifact paths or grants
reuse authority. Exclusive spans subtract the union of direct child intervals;
process totals can overlap across processes and asynchronous siblings. They are
not CPU or predicted wall savings. Nested counters must not be added to phase
totals. ESM loading, internal lexical calls and unwrapped assertions can remain
unattributed. Expected rejected compilations are retained alongside successful
returns; terminal task status comes from the existing runner.

Matching entry/argv/compiler/output digests are deliberately narrower than
complete input equivalence. Imported/generated transitive files, transformations,
provider realization, environment, independent construction and installed
boundaries must be reviewed before suggesting immutable artifact reuse.
