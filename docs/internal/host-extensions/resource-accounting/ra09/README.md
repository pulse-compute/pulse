# RA-09: matched Native costs and unused paths

This internal checkpoint measures the complete RA-07 composed handler and the
incremental RA-08 observer cost in local Node/WebAssembly. It separates compilation,
instantiation, handler execution, diagnostic capture, report projection and JSON
serialization. It also measures the updated shared ledger without hostcalls and
checks absent/unused package paths. Production code and admission are unchanged.

The owner requested RA-09 after RA-08 merged at
`3025aea5374c51af6047b74d6f1015ea6a34bc99`. This is a bounded measurement checkpoint,
not Fastly latency, ESP32 qualification or a production overhead promise. The
canonical parent plan and experimental child graph retain their RA-07 meanings.

## Matched application design

[build.cjs](build.cjs) generates one application per width: 1, 8, 16 or 32 parents.
Every application has four variants: observer off, counters only, every-fourth
transition sampling with capacity 256, and every transition with capacity 256.
The common application, shared accounting, ownership guards, cleanup, host imports,
compiler version, flags and module basename are unchanged. Matching the basename
avoids the module-name-dependent optimized layout difference found during RA-08.
All generated sources, plans, policies and Wasm bytes are retained.

The scenarios are cache hit, miss followed by fetch and insert, writer failure
requiring cleanup, and a pending-fetch timeout. The timeout is an injected clock
advance, not a real wait. [check.cjs](check.cjs) compares every variant against the
unobserved control, including complete host traces, output, errors, response authority,
remaining resources and ledger accounting. It also compares the quiet timing host
against the original independent host. Qualification failure prevents measurement.

[host.cjs](host.cjs) uses the same host implementation. Quiet mode removes trace
storage and per-acquisition guest-query assertions; resource validation, call
counters and host actions remain. Full tracing is still used for qualification.
The execution timer surrounds `_start()` only. The instantiation timer surrounds
`new WebAssembly.Instance()` only. Module compilation, import-closure setup,
post-run accounting queries, result validation and report generation are outside
both timers. Imports, simulated host work, response serialization and any garbage
collection occurring inside `_start()` remain in execution time. This is not pure
Wasm instruction time.

[measure.cjs](measure.cjs) caches compiled modules but creates a fresh instance for
every request, preserving the prototype's one-request-per-instance lifetime. Each
case gets three warmup rounds and twelve recorded rounds. Each recorded round
rotates variant order; all four positions occur equally often. Batch size is
`max(2, floor(64 / width))` requests, with 64 requests for unused-path controls.
An explicit collection runs before each batch, outside the timers. No sample is
discarded. Raw phase timings, whole-batch wall/CPU timings and execution checksums
or outcomes are retained. Whole-batch CPU includes harness work and post-run checks;
it is not guest CPU time.

Each reported application sample is the mean cost per request in one batch.
Median/p10/p90 summarize those twelve batch means, not request latency percentiles.
Observer comparisons pair variants within the same round. A deterministic 2,000-draw
bootstrap gives a within-run resampling interval for the median paired difference.
An interval crossing zero is explicitly inconclusive. Negative differences are
not production speedup evidence. Host scheduling, JIT/tiering and frequency changes
are uncontrolled; these intervals do not describe deployment variability.

## Measurements

The final qualification passed **74 checks**. The completed measurement run took
38.16 seconds and covered 17 application groups, 12 ledger cases and 12 reporting
cases. All figures below are local medians with the limitations described above.

| Parents | Hit execution (µs) | Miss execution (µs) | Miss instantiation (µs) | Miss final memory, observer off (MiB) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 178.4 | 265.2 | 390.1 | 1.25 |
| 8 | 423.2 | 1067.4 | 492.8 | 2.50 |
| 16 | 830.7 | 2030.1 | 533.9 | 5.00 |
| 32 | 1794.7 | 3966.1 | 631.7 | 10.00 |

All 24 hit/miss observer comparisons have paired intervals crossing zero. For
example, 32-parent event recording has a median paired miss difference of +213 µs,
with a within-run interval of approximately −26 to +376 µs. This does not establish
zero or negligible overhead. Across all 48 observer comparisons, 42 are inconclusive
and six failure/timeout comparisons show positive local differences. The raw data
retains these results without discarding or rerunning unfavorable samples. The
intervals are descriptive and are not adjusted across comparisons.

| Parents | Three-child ledger cycle (µs) | Cycle with cleanup (µs) | Ledger raw banks (bytes) |
| --- | ---: | ---: | ---: |
| 1 | 0.31 | 0.46 | 872 |
| 8 | 5.41 | 6.84 | 5,632 |
| 16 | 20.06 | 24.45 | 11,072 |
| 32 | 65.98 | 87.21 | 21,952 |

The ledger measurements grow faster than linearly in this range; fixed-bank scans
remain visible even though storage is linear. No universal scaling curve is fitted.

At width 32, the observer-off miss starts at 640 KiB and ends at 10 MiB; observed
variants start at 768 KiB and end at 6 MiB. The pinned AssemblyScript stub normally
doubles memory on growth. Different starting capacities cross different growth
thresholds, so this reversal is **not an observer memory-saving result**. The actual
page counts, raw-bank bytes and logical backing charges must remain separate.

The event-observed width-32 reporting path separately takes median 780 µs for
scalar diagnostic capture, 7,264 µs for projection/validation, and 282 µs for JSON
serialization (135,048 serialized bytes). This proof reporting path is substantial
and is outside handler execution; it must not be hidden inside an observer-only
overhead estimate.

All absent/production/unused artifacts are 24,457 bytes. The absent artifact is
byte-identical to production; the unused import differs in embedded plan identity
with zero size delta and unchanged imports. The observer is selected out.

The complete handler measurements include accounting and ownership. There is no
matched ownership-preserving, accounting-free composed implementation in this
workstream. Comparing against the older composition prototype would change fetch
cleanup and failure semantics. Accordingly, this checkpoint does **not** isolate
the full incremental accounting cost. Observer-on/off differences isolate the
instrumented observer variants within the stated local harness only.

## Ledger and memory boundaries

The standalone ledger uses the RA-07 bank layout and reservation profile. Its
synthetic cycles exercise one child, three children, or three children plus protected
cleanup work after stop. Each case runs 1,000 warmup cycles and twelve timed batches
of 3,000 cycles inside Wasm, without a JavaScript crossing per event. Checksums,
zero remaining records and unchanged linear memory are verified after every batch.
The small synthetic backing charges do not allocate application body buffers.
These are kernel lifecycle costs, not complete handler overhead.

The ledger's raw banks are `680 × width + 192` bytes. The observer adds
`128 × width + 256 + eventBank` bytes, where the event bank is one byte in count-only
mode or `256 × 28` bytes for the two event modes. These figures exclude allocation
headers, other adapter tables, globals and application state. Actual Wasm linear
memory is recorded immediately after instantiation and after each request.
Linear-memory pages never shrink here, so the final size captures growth in this
one-request fixture; it is not RSS or memory retained by the host.

The reserved backing allowance remains separate from measured memory. A miss
charges 262,785 bytes per parent through exit. It does not follow that precisely
that amount was allocated or physically reclaimed. No process RSS, host memory,
network latency or hardware power measurement was performed.

Diagnostic capture is measured separately through the RA-08 scalar export reader.
Projection includes its current source-file reads, hashing, validation and object
construction. JSON serialization is another separate timer. These are costs of
the proof's post-run reporting path, not a shipping telemetry protocol or added
handler latency. Sample truncation remains visible in the underlying reports.

The separate [compile.cjs](compile.cjs) pass records one sequential compiler wall
sample per artifact and requires reproduction of exactly the qualified Wasm bytes.
It includes compiler startup, optimization and file preparation. These single
samples describe this recipe; they are not a compiler-regression estimate. They
run after application measurement so compiler work does not contaminate that run.

## Unused path

The absent-package path must compile to exactly the same bytes as unmodified
production generation, using the same module basename and compiler recipe.
Importing an unused package changes the embedded plan identity, so whole-Wasm
identity is not assumed. Its source must otherwise match, its byte count and imports
must match, and neither accounting nor observer implementation may be present.
The same plain response is executed for production, absent and unused controls.
Equal bytes establish the absent-path inclusion property; noisy timing differences
between those identical artifacts do not establish an overhead or speedup.

## Evidence and reproduction

With the repository's pinned dependencies:

```sh
node docs/internal/host-extensions/resource-accounting/ra09/check.cjs /tmp/hex-ra09-fresh
node --expose-gc docs/internal/host-extensions/resource-accounting/ra09/measure.cjs /tmp/hex-ra09-fresh
node docs/internal/host-extensions/resource-accounting/ra09/compile.cjs /tmp/hex-ra09-fresh /tmp/hex-ra09-compile-fresh
```

Use a fresh directory and retain failed attempts. The measurement command verifies
the successful qualification receipt, exact source inputs and every artifact digest.
It checkpoints after each group, rejects incomplete coverage, and has a 120-second
measurement-work limit checked between bounded batches. A partial run remains failed.

[evidence.json](evidence.json) identifies the tested sources, artifacts and archive.
[measurements.json](measurements.json) retains application, ledger and report
timings and comparisons; the evidence index includes all 23 compiler wall samples.
[evidence.tar.gz](evidence.tar.gz) contains qualification receipts, generated sources,
Wasm, full oracle traces, resource sidecars, logs and exact input snapshots for every
attempt. The first measurement attempt stopped on `json: undefined` versus its
omitted persisted-JSON field. The retry normalizes to the saved JSON representation;
application and compiled source behavior were unchanged.

The next planned unit is RA-10 host lifecycle qualification. Real-host consumption,
readiness, disposal and teardown remain open. Adoption still needs structural
integration, a production profile, portable evidence/report contracts and an
ownership-preserving counterfactual before claiming full accounting overhead.
