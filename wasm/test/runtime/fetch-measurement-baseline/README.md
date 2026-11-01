# Fetch measurement baseline

Opt-in evidence probe for the shipped fetch collection/timing API. It changes no
runtime, generated source, ordinary test selection, or accounting contract.

From the repository root, with lockfile-pinned dependencies restored:

```sh
node --expose-gc wasm/test/runtime/fetch-measurement-baseline/probe.cjs /absolute/fresh/output
```

`--quick` selects widths 1/8 and shorter repetitions for harness smoke coverage.
The full pass selects concurrency 1/8/16 and stress width 32, with options off,
collection, timing, and both. Raw opaque and `.text()` projected fetches return
the same constant text response. One failure scenario fails the first member;
collection intentionally changes that response from failure to success.

The production compiler emits Fastly Wasm and generic Native Wasm without source
overlays. The existing Fastly fixture host measures process CPU and wall time
between its post-init callback and response-handoff callback. This excludes
compile/instantiate, result extraction, and post-handoff guest work, and includes
instrumented JS host callbacks. It is controlled execution evidence, not hosted
Fastly CPU, network latency, or a throughput claim. Seven randomized paired rounds
of twelve invocations follow forty warmups per scenario. An extra disabled block
estimates noise. Raw blocks and paired bootstrap intervals are retained; intervals
do not establish machine-independent performance. Failure modes do different work
and their differences must not be described as equivalent-work speedups.

Each main artifact runs 64 fresh Fastly invocations and 64 real Node adapter
invocations alternating success/failure. The Node transport uses controlled Web
Responses and streams, without sockets. The report records Wasm capacity, fixture
transport and residual handles, completion-time value counts, process memory and
active resources. WeakRef observations after two GC/event-loop turns distinguish
collected bodies from bodies explicitly ended/cancelled. Neither counters nor
RSS certify a leak or exact allocation accounting. HTTP `_start` is never replayed
on its single-use instance. Existing resource-accounting admission is copied as-is.

Supplementary raw controls use existing deadlines and staggered completion to
expose polling behavior. Numeric-response controls at the smallest/largest widths
test whether the linear-memory step reflects activation of the numeric cache.
These controls are observations, not new lifecycle or accounting guarantees.

`report.json` records terminal status, candidate revision/tree/dirty state, harness
hash, toolchain, measurements, and limitations. Per-artifact source, manifests and
Wasm retain reproducibility identities. `passed` means semantic assertions and
the selected measurements completed; there is no performance acceptance threshold.
Keep interrupted/failed output directories and retry into a fresh directory.

This probe complements the existing fetch outcome/timing semantic regressions.
It does not replace final installed-candidate release qualification.
