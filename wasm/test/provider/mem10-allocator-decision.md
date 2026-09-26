# MEM10 — Fastly allocator decision evidence

This ticket compares production stub and incremental allocator recipes without
changing production selection. It follows MEM08's retention attribution and
MEM09's Node normalization change. MEM06/MEM07 remain parked.

## Decision

**Retain production allocator selection: stub for schema-free unlinked builds,
incremental for schema builds. Do not switch all bounded read loops to
incremental.** The collecting recipe is a useful memory/latency tradeoff, but
it is not a general efficiency win in this corpus. A loop in the plan does not
tell us whether a request will execute one iteration or 64.

Both 64-row cases reduced linear-memory capacity from 40 MiB to 12 MiB (70%).
Across the mean of the two per-launch HTTP medians, incremental cost 37.6%
more time for text rows and 96.5% more for object rows. The one-row cases
increased capacity from 1.25 MiB to 1.5 MiB. The loop artifact grew 52.7%.
That is too large a regression to hide behind an automatic default change.

Do not reverse the existing schema choice on this evidence either. The
near-bound ASCII case benefits from collection (8.5 to 5 MiB), while this
bounded successful-request corpus does not establish a safe stub policy for
all schema workloads, limits or failure paths.

The next scoped candidate is **Fastly read-path transient allocation work**:
attribute temporary byte/string/parser allocations in these same text and
object loops, then optimize one measured source of duplicate work under the
current allocator. Preserve carried values, aliases, redaction ownership,
resource closure and cumulative charges. Require this corpus to show both
capacity and latency improvements before rollout. This is a targeted
allocation investigation, not general escape analysis; MEM06/MEM07 remain
parked. A collecting recipe should be reconsidered only for a concrete
memory-constrained workload with an explicit latency budget and deployed
validation. No new public allocator option is introduced here.

## Recorded results

Base: `0b78efe5ec23582e89705bde239df48c5724eacd`. All six build cells reproduced across three
builds; all three production defaults matched the control bytes. All ten
request cases passed injected-host parity and direct Viceroy replay: 40
server launches, 800 measured HTTP requests and 120 warmups. Injected checks
also ran 460 fresh invocations. Read-body/pending-lookup counts returned to
zero, and available cumulative budget counters matched between recipes.

Capacity is measured through the injected host, not through Viceroy. Each
latency cell below is the range of the two **per-launch medians**, in ms.
It is not a confidence interval.

| Case | Stub capacity MiB | Incremental capacity MiB | Stub local HTTP ms | Incremental local HTTP ms |
| --- | ---: | ---: | ---: | ---: |
| small-config | 0.625 | 0.75 | 0.47–0.58 | 0.52–0.56 |
| text-1-small | 1.25 | 1.5 | 0.56–0.64 | 0.63–0.75 |
| text-1 | 1.25 | 1.5 | 1.30–1.33 | 1.58–1.61 |
| text-8 | 5 | 3 | 6.62–6.74 | 8.69–9.44 |
| text-64 | 40 | 12 | 49.93–53.47 | 69.34–72.98 |
| objects-64 | 40 | 12 | 33.23–36.66 | 65.18–72.16 |
| schema-small | 2.125 | 2.5 | 0.81–0.86 | 0.93–1.00 |
| schema-near-bound-ascii | 8.5 | 5 | 10.47–10.67 | 14.10–15.85 |
| schema-escaped-unicode | 4.25 | 5 | 4.78–5.02 | 6.59–6.63 |
| schema-nested-128 | 4.25 | 5 | 2.08–2.28 | 3.51–3.67 |

| Family | Stub Wasm bytes | Incremental Wasm bytes | Stub build median ms | Incremental build median ms |
| --- | ---: | ---: | ---: | ---: |
| small | 28,168 | 40,426 | 1,355 | 1,630 |
| loop | 45,037 | 68,771 | 1,760 | 2,356 |
| schema | 86,452 | 124,592 | 2,889 | 3,826 |

Here `buildMs` is the production compiler’s reported duration from launching
AssemblyScript through final artifact inspection; it excludes canonical plan
construction and generated-source construction. Raw AssemblyScript durations
are also retained in the JSON. Incremental increased this measured build
window by about 20% (small), 34% (loop) and 32% (schema).

Spawn-to-listen was 77.6–88.9 ms across the run, dominated by the readiness
poll interval; there is no defensible fine-grained startup advantage here.
For text-64, first requests were 48.6–61.8 ms with stub versus 76.1–83.4 ms
with incremental. For objects-64, they were 35.0–35.4 versus 65.1–81.1 ms.
These local cold-request observations reinforce the latency tradeoff; they
do not measure deployed cold starts. P95s and every sample are in
`mem10-allocator-evidence.json`.

## Scope and method

The opt-in `fastly-allocator-mem10` task covers an unlinked small config request,
the MEM08 bounded conditional-KV read loop (one small row, 1/8/64 text rows and
64 object rows), and bounded schema decode/encode (small, near-bound ASCII,
escaped Unicode and 128 nested records). The schema family uses the normal
canonical build option allowing an HTTP/schema plan without a platform effect.

The harness loads the production compiler in memory and replaces exactly one
allocator-selection expression. All other code generation, optimizer settings,
JSON transforms, memory caps, start handling and artifact validation stay in the
production pipeline. Generated source must be identical between recipes. Each
current default must reproduce the unmodified production Wasm byte for byte.
Three builds per recipe must also be byte-identical. There are no RTrace hooks,
diagnostic guest exports, explicit collections, root removals or altered guest
initializers. Guest-linked fixed-memory recipes are excluded.

Injected-host runs use a fresh instance and fixture authority each time. They
check response status/body, exact host trace, read-body closure, pending lookup
closure and cumulative accounting where the production artifact exports it.
The wall clock is pinned for trace parity. Linear-memory capacity is read after
the request. This is the guest's grown address-space capacity, **not live
allocation, cumulative allocation, physical RSS or deployed memory usage**.
MEM08 remains the separate instrumented root/allocation attribution evidence.

Direct Viceroy runs use the exact same Wasm bytes, local config and read-only
seeded KV. Each case has two independent server launches per recipe; order is
reversed on the second round. Each server receives three warmup requests and
20 recorded requests. Every response must match the injected-host response.
Raw timing samples are retained. Build cost is measured in three alternating
rounds. Build time excludes the initial production-control build; the OS cache
is not flushed. No test suite runs concurrently with the measurements.

Viceroy timings are local end-to-end HTTP costs, including provider emulation,
transport, request setup and guest execution. First-request time is recorded
separately. Spawn-to-listen includes engine startup/compilation and 75 ms polling
resolution; it cannot support fine-grained startup claims. Small-request
sub-millisecond differences and two-launch timing variation are not service
latency guarantees. Injected-host total execution includes validation/module
construction, host setup, instantiation and `_start`; it is supplementary.

This is **injected-host and direct local Viceroy evidence**. It is not deployed
Pulse acceptance, a conditional-write/CAS check, or a revision to the K4
acceptance policy. Node and guest-linked Fastly ownership are unchanged.

## Reproduction

Use the repository's lockfile-pinned workspace dependencies and a real Viceroy
binary. The recorded run used Viceroy 0.21.1, AssemblyScript 0.28.18 and json-as
1.5.0; the evidence records the binary, generated source and Wasm hashes.

```sh
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
  node wasm/scripts/run-wasm-tests.cjs --task fastly-allocator-mem10 --no-report
```

The task fails if direct Viceroy is unavailable. It writes progress checkpoints,
`evidence.json`, the six compiled artifacts and temporary local configs under
`wasm/.test-results/mem10/` (override with `MEM10_OUT`). A report is complete
only when `complete: true`. The committed JSON is the completed run copied
without removing timing samples. This benchmark is excluded from portable
release profiles and has a bounded 20-minute task timeout.

The Linux amd64 Viceroy archive was downloaded from the official
[0.21.1 release](https://github.com/fastly/Viceroy/releases/tag/v0.21.1).
Its SHA-256 matched the release asset digest:
`54a5b46ab05ce1492f4df136728b2eb81b350cb42da5d9f2eec66558ddc1e233`.
