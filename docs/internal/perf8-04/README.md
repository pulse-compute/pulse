# PERF8-04: memory attribution inside the shared Node ABI runner

Human direction: investigate the roughly 40 MiB schema/effect process-RSS gap
observed in PERF8-03. Both Rust and Pulse already use Pulse's ABI and the same
Node host; this ticket adds attribution evidence, not another Rust backend.
Class: evidence; scope: evidence-only. No named Entry Point matches this
experiment; the ordinary root, Wasm and docs instruction chain applies.
Production runtime, compiler, ABI, dependencies and defaults are unchanged.

## Run and admission

Prepare the lockfile-pinned Pulse workspace and Rust toolchain as described in
[PERF8-03](../perf8-03/README.md). Commit source and choose new output paths:

```bash
node wasm/test/performance/memory-baseline.cjs --out wasm/.test-results/memory-first.json
node wasm/test/performance/memory-baseline.cjs --check wasm/.test-results/memory-first.json
node wasm/test/performance/check-memory.cjs wasm/.test-results/memory-first.json
node wasm/test/performance/memory-baseline.cjs --out wasm/.test-results/memory-repeat.json
```

Unset NODE_OPTIONS and Rust build overrides. Only the diagnostic forced-GC
workers receive `--expose-gc`. The report records source commit/tree, clean
working-tree state, environment, dependency/toolchain identities, build recipes,
Wasm hashes and ABI inventories. Both implementations consume an identical plan
and the existing host validates ABI version, imports/exports and plan hash.
Imports may differ by guest implementation; sharing an ABI does not mean identical
import lists. Preflight checks the existing minimal and schema/effect behavior
corpus, including invalid inputs, before any memory measurement. Rust UTF-16
string glue and serde codecs remain part of its guest artifact.

Reports require every expected worker, phase and checkpoint, valid nonnegative
memory values, matching artifact/ABI identity and summaries reconciled from raw
observations. Dirty/drifting source, dependency or Rust identity, behavior failure,
interrupted or incomplete workers cannot produce a passing report. Workers run
serially with a 180-second deadline and bounded process-tree stopping; terminal
reports/logs survive failure, temporary builds are removed in `finally`.

## Three observation boundaries

1. Twelve **unchanged reference workers** use PERF8-01's exact Native runtime
   worker: two fixtures, two implementations and three repetitions. These retain
   its first request, ten warmups, thirty measured calls, timing and five memory
   snapshots. They have no observer or forced GC.
2. Ninety-six **observed diagnostic workers** cover eight scenarios, both
   implementations, natural/forced GC and three repetitions. Dispatch uses the
   minimal fixture. Schema/effect and isolated codec paths each use small ASCII,
   4096-unit ASCII and escaped Unicode/emoji strings. Instantiation-only uses the
   schema artifact without calling its handler or codecs.
3. Twenty-four **unobserved scheduling controls** repeat the small complete
   schema/effect path with and without a macrotask yield after every request,
   under both GC modes and three repetitions. Neither wraps WebAssembly.

Each sweep records cumulative request counts **1, 11, 41, 128 and 256**. Every
request gets a fresh provider, module/instance and host lifecycle. Complete-path
responses and effect counts are checked on every call. The isolated codec path
calls the existing controller's codec wrappers: input and origin decode, output
encode and output decode, matching the complete path's four guest codec calls.
It bypasses routing, request dispatch and effects. Instantiation-only closes the
controller without starting it. These controls are not alternative production
execution modes. No timing ratios are computed from diagnostic workers.

The test-owned observer wraps `WebAssembly.Instance` and exported functions in
one worker process, delegates all operations, and records first-invocation phase
snapshots after instantiation, input allocation, codec calls, start, effect-result
settlement, resume, provider disposal and return (or explicit controller close).
It holds only WeakRefs to memories plus numeric observations in its registry.
The exported functions and instance wrappers die with the invocation.

WeakRef construction/dereferencing keeps its target alive for the current job.
Observed workers therefore yield after **every** invocation. Census happens after
a yield; GC also has a preceding yield, so the census cannot itself keep guests
alive through collection. This changes scheduling and adds observation overhead;
the unobserved scheduling controls and unchanged reference workers expose that
limitation. A natural sweep yields at checkpoints even without per-request yields.
The forced-GC pass takes a before snapshot, then three host collections separated
by macrotask yields, then an after snapshot. It is a separate experiment, never
mixed into the normal timing baseline. It does not call guest `__collect`, change
the guest allocator, or imply that production should force GC.

## Reading memory

| Observation | Meaning and limitation |
| --- | --- |
| RSS | Process-wide resident snapshot: Node/V8, host, code, allocator and guest. Not a peak, per-request bill, or guest-only number. |
| heapUsed / heapTotal | V8 heap measurements; not all process memory. |
| external / arrayBuffers | Node-reported external/backing-store counters; overlap with one another and with RSS. Do not add these columns. |
| per-instance initial / max observed bytes | Wasm linear-memory capacity after instantiation and at observed export boundaries. Not committed resident bytes or live guest-object size; not an exhaustive internal allocation peak. |
| live memories / live linear capacity | WeakRefs still observable at the checkpoint and sum of their capacities. Natural-GC liveness is collection-dependent, not proof of application reachability. |
| after disposal | Host request cleanup completed. Does not mean the JS engine already physically released the instance or its pages. |
| after forced GC | Collection intervention at a bounded checkpoint. Zero observed memories rules out retained observed memory objects in this run, not every possible host leak. RSS may remain due to code, V8 or allocator retention. |

Linear capacity may be similar while physical residency differs. Nothing here
attributes RSS by subtracting overlapping counters. High-water process counters
from the unchanged controls are retained but not used for attribution, including
because of the pre-exec history limitation recorded in PERF8-03.

All raw worker observations remain available. Three worker repetitions are three
independent process samples, not 256 independent experiments. Summaries provide
min/max/p50/p95 and retain every checkpoint; there are no regression thresholds,
confidence claims, leak verdicts, production-memory predictions or winner labels.
Longer loads, concurrency, real networks, ARC/Fastly and Catalog remain separate
workloads. Payload sensitivity here covers only the stated string shapes.

The implementing PR records the measured source, repeated campaign findings and
remaining attribution uncertainty. A small post-GC RSS residual cannot by itself
be assigned to compiler code, guest memory, host allocation or a leak.

## Implementing evidence (2026-10-10)

Two clean campaigns passed on Node 24.19.0 and Rust 1.99.0, measured at source
`231b5cbfc24c5a0c8354936d9bb7d763d1526f83`, tree
`f23eaea6c95564d498b01af6bf20425cc0343f09`. Source, environment, dependencies,
toolchain, protocol and all four artifacts agree exactly across campaigns. The
artifacts also match PERF8-03's final measured Wasm hashes. Subsequent README
changes only record results; they do not change the measured harness.

Each campaign completed 120 sweep workers (30,720 iterations), 12 unchanged
reference workers (492 requests), and 10 paired preflight cases (20 observations).
Every observed codec/full path checked its results; instantiation-only iterations
intentionally do not execute a handler. Elapsed campaign times were 143.66 and
152.06 seconds. Both report validators and all 18 negative admission checks passed.

The table shows each campaign's median of three independent workers, in MiB.
The sweep rows use the small schema/effect payload unless stated otherwise.

| Observation | Pulse first / repeat | Rust first / repeat |
| --- | --- | --- |
| Unchanged reference, after 41 requests | 92.42 / 103.83 | 62.95 / 62.61 |
| Unobserved sweep, natural GC, 41 requests | 100.69 / 100.39 | 61.32 / 60.52 |
| Unobserved sweep, after forced GC, 41 requests | 56.01 / 56.84 | 56.99 / 56.57 |
| Unobserved sweep, natural GC, 256 requests | 83.21 / 76.94 | 68.53 / 69.73 |
| Unobserved sweep, after forced GC, 256 requests | 62.32 / 63.11 | 66.06 / 66.87 |
| Instantiation only, natural GC, 41 iterations | 77.12 / 76.81 | 52.83 / 52.77 |
| Instantiation only, after forced GC, 41 iterations | 52.32 / 52.86 | 52.29 / 52.43 |
| Codec only, after forced GC, 256 iterations | 56.91 / 57.51 | 57.10 / 57.03 |
| Observed long ASCII, after forced GC, 256 requests | 80.37 / 84.06 | 81.03 / 82.71 |
| Observed escaped Unicode, after forced GC, 256 requests | 79.74 / 78.15 | 84.59 / 85.17 |

The roughly 40 MiB gap is reproducible in the unobserved 41-request sweep. It
largely disappears after host collection, and natural RSS is lower at 256 than
41 requests in that same Pulse sweep. This is evidence of initialization and
collection-timing sensitivity, not monotonic retention of 40 MiB of live guest
state. The natural per-request-yield control varies (Pulse 61.51 / 85.20 MiB at
41 requests); yielding alone is not a reliable remedy. Minimal unchanged
reference workers remain close: Pulse 56.92 / 56.03, Rust 55.94 / 56.08 MiB.

All 96 observed forced-GC workers across the two campaigns have **zero observed
live Wasm memories at 256 iterations**. Twenty-five of 480 intermediate/final
post-GC censuses retain one memory; this occurs in both implementations with
larger payloads at 11 or 41 iterations. No census retains more than one after
forced GC, and all are zero at 128 and 256. The experiment does not identify why
those transient objects survive the earlier fixed collection passes. It does
not prove general leak freedom or attribute the remaining process RSS.

For the small complete request, Pulse starts and stays at 1,245,184 bytes of
linear capacity; Rust starts at 1,114,112 and reaches 1,179,648 bytes. Larger
Unicode requests can reach 2,490,368 bytes for Pulse and 1,245,184 for Rust.
The small capacity difference cannot itself be equated with the 40 MiB process
RSS difference; resident page touching and multiple uncollected instances matter.

### Concrete initialization lead

Disassembling the hash-matched 39,479-byte Pulse schema artifact with installed
Binaryen 130 confirms that its Wasm start function `$35` calls the exported
`__new` function `$1` with **1,048,576 bytes and ArrayBuffer type ID 1**. The
allocator contains `memory.fill`, so this is a real initialized allocation before
any handler or codec request. The installed `json-as@1.5.0/lib/as-bs.ts` declares
`sc.arena = new ArrayBuffer(ARENA_SIZE)` at module scope; its default arena size
is `1 << 20`, even though its default `CACHE_ENABLED` is false. The zero-length
cache-entry allocation and the 1 MiB arena allocation both survive in this
optimized artifact. The disassembly and source hashes are retained in the
supplemental audit. No dependency files were patched.

This is a concrete per-instance cost that can accumulate while fresh instances
await collection, and it is consistent with the instantiation-only control. It
is **not yet a measured counterfactual assigning every RSS byte to that arena**.
The narrow optimization follow-up is to test conditional/lazy arena allocation
when string caching is disabled, then rerun behavior and memory evidence. Do not
change production GC or cache instances on the strength of this diagnostic run.

An earlier attempt logged completion but its persisted report retained `running`
status. It was rejected and retained as incomplete evidence. The two accepted
reruns were executed without concurrent filesystem inspection and independently
verified terminal status and full coverage. The cause of that first persistence
discrepancy is not established; no status was manually repaired.

Memory definitions follow Node's [process.memoryUsage documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).
The observer's yield rule follows ECMAScript's [WeakRef and kept-object semantics](https://tc39.es/ecma262/multipage/managing-memory.html#sec-weak-ref-objects).
