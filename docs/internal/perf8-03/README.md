# PERF8-03: Pulse and Rust Wasm fixture comparison

Human direction: compare behavior, build/runtime times and RSS against Rust
implementations of the PERF8 fixtures. Class: evidence; scope: evidence-only.
No named Entry Point matches this test-owned experiment; the ordinary root,
Wasm and docs instructions apply. There is no production Rust backend, public
ABI change, product dependency, CI task, regression gate or standalone server.

## Scope and first gate

The first gate is the minimal dispatch fixture implemented in Rust and executed
by the **unchanged Pulse Node canonical Native host** with the same plan, provider
and request lifecycle. Once that gate passes, the harness admits schema/effect,
mounted routing and the 64-route/32-schema compile-only fixture. The hand-written
Rust handlers use the existing host value, routing and effect imports. Rust
schema codecs use serde/serde_json through the host's existing UTF-16 string ABI.
That glue is part of the Rust executable and runtime measurement.

This isolates guest implementation differences inside Pulse's host architecture.
It does not compare Pulse with an independent Rust web framework, prove a general
Rust lowering implementation, or quantify pure AssemblyScript-versus-Rust code
execution. Shared host parsing, validation, value heaps, routing, effect dispatch,
tracing and lifecycle costs remain in both columns. The plan and host are required
support, reported separately from executable bytes. An untimed Pulse preflight
build provides the plan; Rust has no independent plan producer or Report pipeline.
Copied schema plan metadata describes the shared Pulse contract, not the Rust
codec implementation: serde versions are retained under Rust dependency identity.

## Run

Use Linux, Python 3 with `os.wait4`, Node and the prepared Pulse workspace used by
[PERF8-01](../perf8-01/README.md). Install an official Rust toolchain with the
`wasm32-unknown-unknown` target; place `rustc` and `cargo` on PATH. The implementing
experiment records the exact installed version and binary/target-library hashes.
Rustup is an optional installation convenience, not a harness dependency.

Fetch the **test-only**, locked Rust dependencies before measuring:

```bash
cargo fetch --locked --manifest-path wasm/test/performance/rust/Cargo.toml --target wasm32-unknown-unknown
node wasm/test/performance/rust-baseline.cjs --out wasm/.test-results/rust-first.json
node wasm/test/performance/rust-baseline.cjs --check wasm/.test-results/rust-first.json
node wasm/test/performance/rust-baseline.cjs --out wasm/.test-results/rust-repeat.json
node wasm/test/performance/check-rust-comparison.cjs wasm/.test-results/rust-first.json
```

Choose new output paths and commit the working tree first. Rust build overrides
such as RUSTFLAGS, RUSTC wrappers, CARGO_BUILD/PROFILE/TARGET settings must be unset.
The harness records rustc/Cargo versions and binaries, target standard-library
hash, Cargo manifest/lock hash, Pulse dependency identities, host environment,
source commit/tree and the measurement protocol. Offline locked Cargo builds
use fresh target directories, one job, release optimization level 3, thin LTO,
one codegen unit, aborting panics and stripped symbols. Pulse uses the unchanged
PERF8 default optimized Native build, including retained reporting; neither side
uses a size-specialized experimental mode. The lockfile pins Rust transitive
crate versions and checksums. These crates are not production dependencies.

## Behavior admission

All fixture responses are checked before measurement: status, response class,
headers, parsed JSON or exact text, effect counts and normalized lifecycle/effect
trace order. Wrong-method and unmatched-route requests check default 404 behavior. Supplemental cases cover another route parameter, long/Unicode/
escaped strings, malformed JSON, missing/wrong input fields, fractional upstream
numbers and invalid upstream data. Rejections must have the same error code and
effect count. The report retains both results and whether response body bytes
match; equivalent numeric JSON spelling is not silently called byte parity.

The large fixture checks all 64 routes and additional valid/invalid input, but
runtime timing remains unavailable. Rust declares 16 input and 16 output types,
matching the workload; optimization may merge equivalent code on either side.
These synthetic cases are bounded coverage, not proof of full application,
all-JSON, cancellation, streaming or provider conformance.

Measurements start only after all four behavior pairs pass. Each measured
artifact must exactly match its preflight hash and all three builds must agree.
Dirty source, changed dependency/toolchain identity, failed behavior or incomplete
workers prevents a successful terminal report. Reports are updated atomically,
retain failed/interrupted status and logs, and clean up temporary projects in
`finally`. Workers have a 180-second deadline with bounded process-tree stopping.

## Measurement boundaries

| Metric | Interpretation |
| --- | --- |
| Build elapsed | Pulse's existing CLI import/resolve/build timer, including report production; Rust Python receipt startup plus Cargo build, including fresh crate dependency compilation. Fixture generation, shared-plan preflight and artifact copying are outside the Rust timer. These are workflow costs, not equivalent compiler-only work. |
| Compiler RSS | Pulse maximum individual ASC process high-water RSS; Rust Linux wait4 high-water RSS for Cargo/descendants. Neither is summed concurrent process-tree memory. Boundaries differ, so the report deliberately provides no compiler-RSS ratio. |
| Executable bytes | Wasm only; Rust ABI glue/codecs included. Plan bytes and hash reported separately. Shared host/provider dependencies and Pulse report sidecars excluded from both artifact columns. |
| Runtime | Exact PERF8-01 Node Native runtime worker for both artifacts: artifact/plan load, fresh validation/module compilation/instantiation per request, host/provider execution, response materialization and disposal. No HTTP network. |
| CPU | Process user/system microseconds around each request; never combined with elapsed milliseconds. |
| Runtime RSS | Process high-water RSS including startup, harness imports, host and guest; not guest-only or per-request memory. |
| Memory snapshots | Same five PERF8 phases with RSS, V8 heap, external and arrayBuffers; no forced GC. Raw values retained; no leak inference. |

Within each fixture, build samples alternate Pulse/Rust and reverse order on the
second sample; runtime workers do the same. Three fresh builds and three runtime
workers per implementation, with ten warmups and thirty measured requests per
worker. Every timed response is validated outside its timer. The report includes
raw observations, min/max/mean/p50/p95 and three warm worker medians; 90 warm
requests are not 90 independent workers. Compile-only cells have no runtime data.

Two independent full campaigns are requested to expose repeat variation. OS
caches and host load are uncontrolled. The same-source variation found in
[PERF8-02](../perf8-02/README.md) still applies. Rust-minus-Pulse medians and
percentages are descriptive observations; no confidence, significance, winner,
production-performance or regression-threshold claim follows from them. Zero
baselines yield null percentages; missing values never become zero.

## Evidence ownership

Raw local results remain outside the package/release payload. The implementing
PR records terminal coverage, exact measured source/tree, toolchains, failed
attempts and limitations. ARC production-log analysis remains separate in
PERF8-02 and still requires a sanitized export.
