# Fetch outcome/timing viability spike

Evidence for #563, #564 and the existing-deadline portion of #565. This is an
opt-in experiment, not an implementation of the proposed public API.

## Decision

**Raw-response outcomes and timing look viable at a modest incremental cost.
Projected outcomes/timing need an explicit lowering and settlement design before
implementation.** Do not call the entire proposed contract proven by this spike.

The easy part is the envelope. The important work is placing that envelope after
the selected projection, classifying only eligible failures, and recording each
member's completion without including sibling/continuation delay. The existing
deadline poll/select loop can be reused; a second scheduler is not justified by
this evidence. New provider phase controls remain a separate scope decision.

## What was actually measured

Baseline production tree `8a80a75471ff457986ba882192c8cbcc8ed3d76c`, merged into
`latest` as `b7895f37ef97528dcaa70f500fb1c5c38afb1ddf` (#575).

`probe.cjs` generates real Fastly Native AssemblyScript from ordinary canonical
handlers, then applies checked, experiment-only source overlays. It compiles
emitted Wasm with the repository's pinned AssemblyScript/optimization recipe and
executes it through the existing injected ABI host. No production file, public
type, admission rule, package export or normal test selection is changed.

The cost matrix has 32 cells: widths 1, 8, 16 and 32; disabled, collect-only,
timing-only and both; with and without an existing `timeoutMs`. Width 1 uses
direct await; wider cells use keyed parallel groups. All variants have a constant
HTTP reply and a result observer, avoiding response serialization as a cost
confounder. Observer implementations necessarily understand their result shape;
artifact deltas include those observers and are indicative, not a final size
promise. Each emitted artifact/source hash is retained in `evidence.json`.

The disabled cell contains no optional timing/envelope implementation. It still
contains the common evidence observer and is not a byte-identical shipping
artifact. The prototype wraps real effect results, and the existing driver
settles those handles; exports inspect them after invocation completion. It does
not implement TypeScript access/inference for the proposed result type.

## Footprint and work

Additional final Wasm bytes, relative to the corresponding disabled control:

| Width | Collect only, no timeout | Both, no timeout | Both, existing timeout |
| --- | ---: | ---: | ---: |
| 1 | 678 | 1,222 | 1,146 |
| 8 | 673 | 1,240 | 1,150 |
| 16 | 671 | 1,214 | 1,147 |
| 32 | 677 | 1,237 | 1,167 |

Code growth is predominantly fixed, not proportional to group width. The
success-path collect envelope adds four retained value-table entries per member.
Both options add `5N + 1` entries in this immediate-success corpus (the shared
zero elapsed value affects that count). These are value counts, not byte counts
or a bound for every error/value shape.

The timing prototype reserves two i64 timestamp slots per static fetch site and
one shared i64 scratch slot: `16N + 8` payload bytes, or **520 bytes at width 32**,
plus AssemblyScript array headers and the outcome values. Reused-site lifetime
and dynamically bounded collections are not qualified here.

For immediate responses at width 32:

| Case | Monotonic clock calls | Request polls |
| --- | ---: | ---: |
| Existing ordinary fetch, no timeout | 0 | 0 (blocking waits) |
| Both options, no timeout | 97 | 32 |
| Existing fetch with timeout | 97 | 32 |
| Both options with timeout | 161 | 32 |

Collection alone adds no clock or poll calls. The straightforward timed prototype
adds two samples per member to the existing deadline path. Timing without a
fetch timeout must also observe independent completion: this prototype activates
the existing poll/select path. Therefore its cost is not merely two clock calls.
Reusing already-observed completion samples is a possible optimization, not a
measured saving in this experiment.

Eight staggered reverse-completion cells observe each member independently.
At width 32, readiness at separate logical milliseconds produces **560 polls**,
versus 32 for immediate completion. The existing deadline control produces the
same poll count. This exposes the current scan-per-wakeup behavior: bounded by
the collection limit, but potentially quadratic across staggered readiness. A
new scheduler is unnecessary for this proof; a production timing implementation
should retain this as an explicit cost case.

### Memory and CPU caveats

The minimal, nonnumeric handler grows from **640 KiB to 1,280 KiB** of Wasm linear
memory when timing is enabled. A numeric-response control already uses 1,280 KiB
and shows **no additional page growth** at either width 1 or 32. This is consistent
with existing lazy numeric-cache initialization and heap-growth granularity;
it is not 640 KiB of per-member timestamp storage. The spike does not measure
allocated/retained heap bytes precisely, and absence of another memory page is
not proof of zero allocation.

Execution samples bracket the guest/JavaScript ABI execution between init and
response handoff, excluding module compilation/instantiation and post-run
observation. Each cell has three warmups and 15 retained samples. The samples
include injected-host work and show enough variance/order effects that **no
production CPU percentage or latency claim is justified**. Exact artifact size,
value counts, and hostcall counts are the stronger evidence. Actual Fastly and
Node-provider CPU/latency remain to be measured if those become selection gates.

## Semantic findings

Passing focused controls:

- Raw responses retain their opaque fetch handles; the metadata-only handlers
  perform no body reads, including when fixtures have slow bodies.
- Reverse completion reports 100 ms and 10 ms per member, not two 100 ms results.
- An already-dispatched transport failure and an individual timeout can be
  collected while preserving a successful sibling and its completion time.
- Timing without collection still rejects transport failure.
- Enclosing cancellation and request-deadline termination remain failures;
  collection does not turn them into normal outcomes.
- Dispatch counts and exposed pending/request resource counts match controls.
  This is not complete body/response ownership or cleanup qualification.

**Failed viability cell, intentionally retained:** the naive settlement wrapper
breaks a grouped `.text()` operation with value error stage 42. Current lowering
can leave `host_fetch_text` in resumed continuation expressions, after the raw
fetch result has been settled. Replacing that raw handle with an outcome before
the projection violates the existing fetch-value contract. The unmodified text
control passes. This is a defect in the proposed overlay, not a reported defect
in existing Pulse behavior.

Consequently, projected timing cannot be attached blindly at today's raw-fetch
settlement boundary. The selected operation/projection and result policy must
reach a common final settlement boundary, while raw operations still settle at
headers. Serial body acquisition can also include sibling delay; this experiment
does not claim to have measured or eliminated that delay. JSON/schema failures
must remain distinct from collectable transport failures.

## Complexity and next implementation order

1. **Clarify #565's existing boundaries.** Preserve the current member header
   deadline and earlier enclosing-request deadline. A projected duration ending
   later must not silently extend/redefine `timeoutMs`.
2. **Design the projection-aware completion seam for #563/#564.** Carry literal
   result policy and selected projection through lowering; retain the existing
   driver/ticket lifecycle and raw response ownership. This is the main complexity
   finding, and must precede claiming full projected timing support.
3. **Implement outcome classification and wrapping.** Cover direct/keyed/bounded
   forms, mixed collected/ordinary members, send/pre-dispatch failures, schema
   failures, cancellation, repeated sites, redaction, cleanup and type inference.
   The prototype only converts already-dispatched member failures; its error
   strings are probe labels, not a finished canonical error taxonomy.
4. **Add opt-in monotonic capture at the settled boundaries.** Prove no optional
   work when disabled, valid zero/null availability rules, independent completion,
   clock faults and supported Node/Fastly Native/JavaScript realizations.
5. **Qualify the selected behavior with real provider resets/stalls.** This spike
   uses injected ABI fixtures only. Do not treat fixture delays or the noisy
   execution microbenchmark as live/provider-reality evidence.

Treat new connect/first-byte/between-byte settings from #565 separately. Their
provider mapping, static/dynamic backend identity/reuse, unsupported-target
behavior and real-host qualification are unmeasured here and should not become
hidden prerequisites for the basic outcome/timing feature.

JavaScript already has settled-member joining, and Fastly Native already has
per-member deadline completion slots. Source inspection supports reuse of that
machinery; it does not establish cross-target parity or a small final diff.
Overall: **favorable raw-path footprint, moderate cross-layer implementation
complexity, unresolved projected-completion placement.**

## Reproduce and interpret

From the repository root with restored pinned dependencies:

```sh
node wasm/test/runtime/fetch-outcomes-spike/probe.cjs /tmp/pulse-fetch-outcomes
```

`report.json` retains measurements and the explicit failed viability cell. A
completed report means the investigation ran to completion, not that every
proposed feature is viable or implemented. Compiler logs and exact generated
sources/Wasm remain in the selected output directory. Identical generated sources
may reuse their previously compiled artifacts; hashes remain in the report.
This harness is deliberately absent from the ordinary test registry.

The original unsupported `.value` authoring attempt and the subsequent projected
wrapper failure were retained locally. The final harness uses admitted ordinary
handlers plus explicit post-generation overlays, and records the projection
failure instead of weakening it into a passing result.
