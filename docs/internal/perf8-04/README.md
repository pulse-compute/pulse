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
