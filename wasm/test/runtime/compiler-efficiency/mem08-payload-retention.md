# MEM08 — payload allocation and root attribution

Entry point: `runtime-effects`. Class: evidence. Base: merged GEN04,
`b1049ca685bef684a032506096f35066db799bec`. Fastly production source is read-only
comparison; the additional evidence owners are the opt-in suite registry and
suite-shape check. This pass follows MEM02 and the MEM05 proposal in PR #94.
MEM06 and MEM07 remain parked pending a worthwhile lifetime design.

## Question and scope

MEM05 made 63 obsolete result envelopes collectible at 64 reads while every
payload graph remained retained. MEM08 asks which allocations dominate those
graphs, which owners retain them, and whether a smaller host-specific change can
remove meaningful duplication before introducing a new lifetime policy.

One synthetic bounded sequential-read handler carries the first payload and a
mutable local/container alias through all iterations. It reads the next key and
an amount from each result, pauses at a final config effect, and returns an
independently calculated count, total, alias count and first tag. The literal
loop cap is 64; input chains independently select 1, 8 or 64 visits. Payloads
contain either a distinct flat 16 KiB ASCII string or 128 small numeric/boolean
records. A 256-byte, one-read case controls payload size independently of visit
count. Providers serve the same logical values on both targets.

This is request-local retention analysis. No production source is edited and
no new runtime, compiler, provider, ABI, budget or reclamation promise is added.

## Measurement method

### Node Native

The ordinary managed driver is compared against an in-memory copy of its module
with one observer call after controller construction. The observer deliberately
holds that controller through terminal handoff. It observes the full managed
path, including conditional-KV normalization, redactions, continuations, trace
and provider disposal. Both variants use identical production Wasm.

Each cell runs in a fresh child. Five explicit collections separated by event
loop turns precede V8 heap snapshots at the final suspension, terminal handoff,
and subsequent diagnostic root removals. Snapshots are parsed in the parent
after the child exits, preventing parsed snapshot strings from contaminating
later samples. Runtime payloads are identified by their marker and populated
tag; V8 object-literal allocation templates with `system / Hole` fields are
excluded.

The analyzer sums V8 `self_size` over payload data properties, array elements and
backing stores, and string backing edges. It excludes prototypes, shape metadata
and weak edges, and deduplicates node identities. This is a measured allocation
closure, not an exclusive dominator retained-size calculation. Independently,
distinct flat payload strings are counted across the whole snapshot, including
copies reachable solely from redaction storage. Total snapshot self bytes and
process memory are supplemental; no RSS saving is inferred from them.

After the controller has closed, the diagnostic removes the value table and
scalar index, collects, then removes the redaction set and collects again.
PS3 counters must remain identical. These deliberately invalidated closed
controllers are never resumed. A redaction control demonstrates that deleting
the string owner without a replacement would reveal the original synthetic
text. Whole-root ablation establishes causal ownership, not a safe production
release operation.

A separate diagnostic variant reuses the conditional result already normalized
by `executeConditionalKv` when the managed driver would otherwise normalize it
again. Raw controller result preparation remains exercised by the baseline.
The variant is a temporary loaded-module edit confined to this evidence task.
It must preserve response, complete trace hash, continuation states, cumulative
handle count and PS3 charges. Detachment, nested freezing, malformed accessor
rejection and tighter value limits are explicit controls.

### Fastly Native

The real provider-generated Wasm runs against the existing injected Fastly ABI
host. **This schema-free fixture selects the production `stub` runtime**, whose
collector is a no-op. The uninstrumented diagnostic recipe must reproduce those
production bytes exactly. A copy of the pinned stub runtime adds only read-only
accessors for `offset - startOffset`; this measures used arena bytes, including
unreachable allocations. Non-allocating readers and resume checkpoints expose
the roots, and clearing them after terminal return must leave arena use equal.

A separate **diagnostic runtime-selection experiment** compiles the same source
with `incremental`, allocator tracing and root readers, then adds resume
checkpoints, then explicit collection at those checkpoints. This collecting
runtime is already selected by production when schema codecs are active; it is
not the production recipe for this fixture. All variants compare responses,
hostcall trace hashes, acquired-body/pending-lookup counts and PS3 counters.

The tracer and layout readers are pinned to AssemblyScript 0.28.18. They count
TLSF allocation blocks including their headers; post-collection outstanding
blocks provide diagnostic guest live-allocation evidence. Static data, the
shadow stack, allocator metadata and reserved/free linear-memory pages are
outside that sum. Graph closures deduplicate value, string and collection
backing pointers; overlap with redaction strings is reported explicitly. Stub
arena use and incremental live blocks must not be labelled equivalent metrics.

Terminal collection is repeated to a fixed point. Closed-instance value-table
and redaction-root ablations identify allocation owners; they do not implement
tombstones or a valid future resume. The value table's backing capacity can
remain allocated after its length becomes zero. Failure/cancellation can leave
conservative stack roots, so successful fixed points are not generalized to
trapped execution.

The host runs entirely in a local process. These measurements do not establish
Viceroy, deployed, real-network-resource or linked-guest behavior. Repeated
request checks cover collection of the injected host's instance and buffer
owners, not an external Fastly process's reuse policy.

## Results and decision

The committed `mem08-payload-evidence.json` records source, fixture, harness,
artifact and toolchain identities; raw snapshots stay in the ignored result
directory. The tables below report bytes, not handle counts or process RSS.

### Node: duplicate text allocation is the smaller opportunity

| Fixture | Payload closure self bytes | All payload string self bytes | Payload string allocations |
| --- | ---: | ---: | ---: |
| 1 × 256-byte text | 352 | 544 | 2 |
| 1 × 16 KiB text | 16,480 | 32,800 | 2 |
| 8 × 16 KiB text | 132,008 | 262,400 | 16 |
| 64 × 16 KiB text | 1,056,232 | 2,099,200 | 128 |
| 64 × 16 KiB, diagnostic reuse | 1,056,232 | 1,049,600 | 64 |
| 64 × 128 small records | 873,960 | 0 | 0 |

The two byte columns overlap and must not be added. The table's closure has one
copy of each text; the redaction set retains another physical V8 string allocation
created by the first normalization. Clearing the table after terminal return
removes all 64 payload objects but leaves 64 strings. Clearing redactions removes
those remaining strings. The diagnostic reuse removes **1,049,600 bytes** of
payload string allocation at 64 reads while preserving the complete response,
trace, continuation states, handle count and PS3 counters. The object-heavy
closure remains 873,960 bytes with reuse; no equivalent object-retention saving
was demonstrated.

This is evidence for removing redundant normalization in the managed Node
conditional-KV path. It does not prove total process-memory savings, establish
a throughput improvement, or authorize deleting redaction roots. A production
change must preserve the raw-controller preparation path and prove exactly which
internal results are already detached, validated and frozen.

### Fastly: allocator choice dominates this fixture

| Fixture | Production stub arena used | Production memory capacity | Incremental post-GC live blocks | Incremental capacity |
| --- | ---: | ---: | ---: | ---: |
| 1 × 16 KiB text | 1,100,560 | 1,310,720 | 565,312 | 1,572,864 |
| 8 × 16 KiB text | 3,715,248 | 5,242,880 | 819,104 | 3,145,728 |
| 64 × 16 KiB text | 24,638,032 | 41,943,040 | 2,850,608 | 12,582,912 |
| 64 × 128 small records | 27,299,984 | 41,943,040 | 6,667,024 | 12,582,912 |

Arena use comes from the read-only stub probe; memory capacity comes from the
uninstrumented production execution. Incremental columns are a separate traced
diagnostic recipe. They are not a before/after production patch comparison.
All seven fixtures and all four diagnostic variants preserve full raw hostcall
traces, output, host resources and cumulative accounting.

At 64 text reads the incremental payload graph occupies 2,160,704 block bytes,
including 2,099,200 bytes of large text strings. Redaction shares those same
string pointers; it does not have Node's second text copy. Removing only the
terminal value table lowers live blocks from 2,850,608 to 2,644,128 bytes.
Removing redactions next lowers them to 535,552 bytes. For small records the
corresponding sequence is 6,667,024 → 797,968 → 788,480 bytes. Residual blocks
include persistent buffers and backing capacity; they are not all payloads.
Neither root removal changes the stub arena or PS3 counters.

With explicit collection at resume checkpoints, the diagnostic text-64 peak
falls from 5,411,968 to 3,251,264 outstanding block bytes and capacity falls from
12 MiB to 6 MiB. For objects-64 the peak falls from 10,482,480 to 7,020,992 bytes,
while capacity remains 12 MiB. These forced-collection results identify a
potential tradeoff, not a recommended collection schedule: latency and deployed
execution are unmeasured. The smallest case also shows that incremental memory
capacity can exceed stub capacity, so allocator choice has a workload tradeoff.

### Lifecycle controls

After 1, 4 and 16 completed Node requests, no tracked controller or normalized
payload graph survives forced collection, even while callers retain the complete
returned result/trace envelopes. Failure, cancellation and deadline controls
including late provider completion dispose once, leave zero test timers and
release tracked owners. The diagnostic reuse passes the same controls plus raw
provider mutation isolation, nested freezing, getter-free malformed-input
rejection and a tighter KV value limit.

Fastly repeats check instance and linear-memory buffer ownership after 1, 4 and
16 requests. Failure and timeout close acquired read bodies. The timeout leaves
one pending host lookup in both variants: the injected host has no cancellation
hostcall for that lookup. This is a bounded host-model limitation, not evidence
of an accumulating deployed resource leak. Cancellation parity is checked at
the host exception boundary.

### Follow-up order

1. **Node managed conditional-KV normalization:** implement one trusted internal
   handoff of the already-normalized result, with focused parity, detachment,
   immutability, malformed-value, redaction, limit and lifecycle coverage. Keep
   low-level controller preparation intact. Re-run this oracle to confirm the
   measured text-copy reduction. This is the first implementation candidate.
2. **Fastly schema-free allocator recipe:** separately investigate production
   allocator selection, generated artifact size, peak/cumulative allocations,
   latency and realistic provider execution. Compare collecting and stub recipes
   without making terminal root ablation part of production. This evidence alone
   is insufficient to switch the production allocator.
3. **MEM06/MEM07 remain parked.** General escape analysis or reclamation policy
   needs a worthwhile measured saving and a design covering carried payloads,
   aliases, redaction ownership and cumulative PS3 charges. MEM05's envelope
   release does not establish those conditions.

## Reproduction

```sh
node wasm/scripts/run-wasm-tests.cjs --task payload-retention-mem08 \
  --report .test-results/mem08-proof.json
```

The task relaunches Node with `--expose-gc`, runs isolated snapshot workers and
writes a terminal `measurements.json` under
`wasm/.test-results/compiler-efficiency/mem08/`. It is intentionally excluded
from default release profiles. Allow disk space for the raw V8 snapshots.

The first development run counted a V8 object-literal template as a payload at
eight iterations. Inspecting its snapshot showed `system / Hole` in its dynamic
fields. The analyzer now requires a populated runtime tag. This was an observer
correction; the failed run remains separate from acceptance evidence.

The second development run exited with an incomplete `running` report when a
synthetic cancellation signal was not connected to its inherited budget. That
run is not acceptance despite the outer runner's zero exit status. The fixture
now wires the signal into the budget and fails on event-loop exit before oracle
completion. Focused development also corrected a missing config binding and a
relative output path, and identified the stub/incremental recipe mismatch.
Comparing large unequal Wasm buffers during that mismatch exhausted the
development process; byte identity now uses SHA-256 comparison. Pairing controls
in separate processes preserves identical execution ordinals and their redacted
trace bytes instead of normalizing observable differences away.

The third full development replay failed raw Fastly trace equality because the
host's default wall-clock seconds changed between variants. Inspection identified
`clock_time_get.unixEpochSeconds` as the differing field. The final replay pins
`clockUnixSeconds` in the fixture; it still compares unmodified complete traces.


## Accepted validation

- `tsc -b tsconfig.workspace.json`: passed with the existing pinned workspace dependencies.
- `maintainer:check`: passed after final evidence edits.
- `unit`: terminal passed, all 34 selected tasks completed; report
  `wasm/.test-results/mem08-unit.json`, run `2026-09-25T21-55-26-546Z--62`.
- `payload-retention-mem08`: terminal passed, 1/1 selected task completed, seven
  fixtures per target, two Node diagnostic candidates, lifecycle and repeated
  request controls; report `wasm/.test-results/mem08-proof-final.json`, run
  `2026-09-25T22-11-50-853Z--5`, 198.394 seconds (not a performance benchmark).
- Raw accepted measurements:
  `wasm/.test-results/compiler-efficiency/mem08/2026-09-25T22-11-53-038Z/`.
  Its `evidence.json` is copied byte-for-byte to the committed evidence file.

The replay's base revision is recorded alongside the dirty working-tree listing
and SHA-256 identities of all three harness files and relevant production owners.
This identifies the tested uncommitted source, rather than attributing it to the
base commit alone. The unit run predates the evidence-only fixture clock fix;
the final full evidence replay covers that fix. Subsequent edits only add this
results narrative and copy the measured report. No deployment or external Fastly
reality lane was run.

## MEM09 replay update

After MEM09, the production Node driver performs one normalization. The replay
now records version `pulse.mem08-payload-retention.v2`: `node` measures production
and `legacy` reconstructs the old double-normalization handoff in memory. The
same exact trace, continuation, budget and lifecycle comparisons apply; the
text-64 assertion now requires 64 strings in production and 128 in the legacy
comparison. The committed v1 evidence above remains the historical MEM08 run.
See `mem09-normalization-reuse.md` for implementation validation.
