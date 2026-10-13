# MEM9-01 — scalar lifetime and handle ownership

Status: **investigation complete; implementation design proposed for human review**.
Related: [#289](https://github.com/pulse-compute/pulse/issues/289).
Human direction: implement MEM9-01, the design/reproduction step before MEM9-02.
Class: evidence; scope: evidence-only. No production behavior, public contract,
compiler flag, allocation limit or CI/release selection changes here.

## Decision proposed for MEM9-02

Use **proven numeric regions around existing bounded pure loops**, with native
`f64` temporaries and immutable boxing at region exits. Start with the Fastly
Native realization and the demonstrated schema-allocation workload. Keep all
existing generic handles valid until terminal disposal. Do not implement freeing
inside `__pulse_drop`, mutate cached boxes, or recycle handle IDs.

This addresses the measured source of retention without requiring a new general
ownership ABI. It is a bounded first implementation, not a claim that arbitrary
scalar/collection retention is solved. In particular, generic expressions,
numeric values repeatedly exported inside loops, strings, effectful/read loops
and helper bodies outside the proven region remain on the existing handle path.
MEM9-02 must itemize those residuals; completing it does not automatically close
all of #289. No optimization implementation or memory improvement is claimed
by this design ticket.

## Reproduction on current latest

The new diagnostic campaign uses the unchanged
[`assert-fastly-schema-allocation.cjs`](../../../wasm/test/provider/assert-fastly-schema-allocation.cjs)
fixture. Its accumulator starts at 70,000 and performs 524,288 additions. The
ordinary control runs through normal compilation/admission and the original
128 MiB assertion. The second control selects the shipped
`elideJsonCacheArena: true` compile option; it is independent of bounded-size.

Separate observed artifacts add count exports and one numeric ITCMS collection
callback, after checking the pinned collector source hash. Reduced artifacts
change only the outer loop cap to a diagnostic parameter. Installed standard
library and production files are untouched. Full GC is invoked **after** response
validation to observe retained managed bytes; it is not inserted into request
execution. No table-clearing intervention is used.

| Outer iterations | Additions | Retained handles, both settings | Numeric handles, both | Managed bytes after full GC, default | Managed bytes after full GC, arena elided |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 67 | 5 | 3,726,080 | 2,677,504 |
| 1 | 2,048 | 2,369 | 2,307 | 3,999,776 | 2,951,200 |
| 64 | 131,072 | 131,393 | 131,331 | 19,482,672 | 18,434,096 |
| 128 | 262,144 | 262,465 | 262,403 | 35,211,312 | 34,162,736 |
| 256 | 524,288 | 524,609 | 524,547 | 66,668,592 | 65,620,016 |

These rows use one-character input. After the first iteration fills the small
integer cache for counters, each additional addition contributes one retained
numeric handle. The default/elided managed-byte difference is exactly 1 MiB;
the handle counts are identical. Full collection does not remove these roots.
The historical PERF8-06 root-release diagnostic attributed 58,761,200 bytes to
released roots; this ticket does not repeat that destructive intervention or
treat its historical bytes as this run's measurement. The new observed small
case is 112 managed bytes above the historical instrumented count; diagnostic
artifacts differ. Do not infer a product regression from that difference.

| Unchanged full workload | Default capacity | Arena-elided capacity |
| --- | --- | --- |
| Escaped input | 110 MiB | 148 MiB |
| Unicode input | 110 MiB | 74 MiB |
| One-character input | 110 MiB | 74 MiB |

Observed and control capacity and raw response hashes match in all three shapes.
The reduced 256-iteration artifact matches the full small case's handle count
and capacity. Responses, exact encoded JSON strings and digest fields pass the
unchanged semantic oracle in both settings. Raw response digests are also equal
across the two arena settings. The original default allocation gate **passes**;
the elided gate **fails at 155,189,248 bytes**. The diagnostic campaign passes
because it accurately reproduces this known failure, not because that gate was
waived. MEM9-02 must make the unchanged gate pass in both settings.

There are 22 cases: six ordinary controls, six observed full cases and ten
reduced cases. Each of the 16 diagnostic cases also passes nine existing-behavior
probes: local assignment/alias, collection snapshots, object spread/overwrite,
cached handle reuse, signed zero, NaN comparison, infinities, fractions and
short-circuit borrowed results. They run after retention measurements and do
not change the reported root counts. These probes establish current semantics;
they do not prove a proposed optimizer or continuation/cancellation fix.

## Current ownership model and why drop cannot free

The Fastly table is an `Array<__PulseFastlyValue>`. A handle is a positive,
one-based integer index. `__pulse_fastly_put` appends a strong reference and never
removes it. AssemblyScript sees those object references as GC roots. The many
`i32` handles stored elsewhere are opaque integers to the collector; clearing
the table would make their values unavailable even if the integers remain live.

`host_value_number` caches nonnegative integers below 65,536, excluding negative
zero. Larger numbers, fractions, NaN, infinities and negative values can allocate
fresh boxes. The counter cache does not help the accumulator starting at 70,000.
Four singleton handles, character handles and a bounded literal cache also
share immutable values. Cached numeric boxes must never become mutable slots.

| Producer/storage | Actual ownership today | Consequence for a future release operation |
| --- | --- | --- |
| Scalar constructors | Return either shared cached or newly appended handles | Caller cannot infer uniqueness from the return type |
| Local reads and assignments | Copy `i32` handles; no retain/release protocol | Overwriting one local does not prove the old value is dead |
| Assignment/update expression result | May be the newly assigned local, or the old postfix value | Discarding the expression is not discarding every alias |
| Property/element reads | Return handles already held by collections | Treat them as borrowed references |
| Array/object insertion and spread | Store/copy child handles without refcounts | Releasing a local can invalidate a reachable child |
| Object overwrite | Replaces a child handle; the old box remains in the table | No proof that other collections/aliases stopped using it |
| `&&`, `||`, `??`, conditional expressions | Can return an operand handle | Results need not be fresh allocations |
| `ctx.state` | Guest key/value arrays store handles | Values must survive subsequent middleware and effects |
| Pure helper parameters/results | Borrow arguments; scalar result can alias an input | Clearing helper slots is not a handle release |
| Effectful helper and shared-stage slots | Globals carry locals/results across dispatch and suspension | Resetting invocation slots does not establish exclusivity |
| Pending/ready effects | Provider payload/ready arrays and guest effect-result globals hold handles | Clear ready/pending flags only after the existing transfer; no premature release |
| Event payload, terminal result, Router error | Dedicated globals/slots retain handles through their consumers | Preserve error routing, serialization and host handoff |

The concrete bad fix is `total += 1`: the expression stores its new handle in
the local and returns that same handle; `pureLines` then calls `__pulse_drop` on
it. Replacing the current no-op with a free would invalidate **the current total**.
It would still fail to reclaim all old overwritten handles. Similarly, helper
local resets and effect-ready flag clearing are not balanced ownership operations.

## Cross-target and collector boundaries

| Target/path | Representation and lifetime | MEM9-02 initial treatment |
| --- | --- | --- |
| Fastly Native, schema-active ordinary artifact | Guest table of boxed values; incremental AssemblyScript GC | Eligible for proven numeric-region emission |
| Fastly Native without schema codecs | Same handle table; ordinary non-linked compilation selects stub runtime | Do not claim GC behavior matches the schema case; qualify independently before enabling there |
| Guest-linked fixed-memory realization | Separate fixed-memory runtime/allocator | Exclude initially; cannot inherit incremental-GC conclusions |
| Portable/Node Native | `ValueHeap.values` strongly retains host JavaScript values in a Map; guest stores integer handles | Similar retention mechanism, different allocation domain; keep emission unchanged initially |
| JavaScript target | Executes ordinary source values using JavaScript lifetime/GC | Unchanged; semantic reference only |

Node's optional 8,192-entry scalar index evicts cache mappings, **not** retained
value handles. It is enabled only for budgeted executions; unbudgeted puts create
new handles. Node collections hold actual JavaScript values, whereas Fastly
collections hold handle integers. A provider-local refcount scheme cannot simply
be copied between them. Source inspection establishes these distinctions; this
ticket does not claim fresh Node memory, host RSS or cross-request leak evidence.

The canonical read-loop policy is explicit: execution-wide, retain-until-terminal,
no per-iteration refunds. Both Fastly instrumentation and the Node host use
cumulative accounting. **Exclude the entire budgeted plan** from initial numeric
lowering: bounded storage-read loops, response-output and request-body-transform
paths. Do not silently change charging, latched-failure behavior or admissible
work by omitting boxed operations there. Extending the fix to those paths needs
a separately reviewed accounting design and boundary tests, not an incidental
optimization. The unchanged allocation fixture has none of these capabilities.

## Numeric-region algorithm for MEM9-02

1. Work from the validated canonical plan, before source rendering. Identify a
   maximal synchronous region containing numeric local initializers followed by
   existing literal-capped `pure-loop` nodes, optionally with numeric local copies
   and branches. Use stable local IDs and actual reads/writes; never match the
   workload name, value 70,000, generated function names or source text.
2. Start with finite numeric literals and independently proven numeric arithmetic
   over region locals. Compute definite initialization and numeric kinds to a
   fixed point through nested loops, branches, break and continue. A local's
   `valueKind` annotation is not a sufficient proof: inspect every reaching
   assignment. Verify deserialized plans independently. Unknown/coercive inputs
   use the existing boxed path, with a recorded internal reason.
3. Require no generic/host operation **inside** the region: no property or element
   access, collection mutation, schema work, string/template conversion, helper
   call, logging, state access, effect, response, or package operation. Initially
   reject regions containing compound short-circuit assignments or nested
   assignment/update expressions whose evaluation order has not been proven.
   Such rejection declines the optimization, not the already-supported program.
4. Store numerical values in private `f64` slots. Scalar aliases copy the number;
   do not reuse any box as mutable storage. Use `i32` only for the existing bounded
   iteration machinery, not for authored numeric arithmetic. Preserve arithmetic
   operation order and rounding; do not reassociate, replace repeated addition
   with multiplication, or assume integers remain in a safe range. NaN, signed
   zero and infinities produced by operations must survive unchanged.
5. Carry numerical state between existing control blocks without changing their
   IDs, guard weights, iteration caps or effect sites. Private `f64` globals may
   be needed because generated dispatch helpers split blocks; they are scoped by
   a proven region, definitely initialized at entry and never exposed as handles.
   Preserve original loop-test order, final counter semantics and all existing
   error/deadline observation points. No new execution allowance is granted.
6. Before **every** exit into generic code, box each live-out numeric value via
   the existing constructor into its original canonical local slot. Keep values
   already exported before a later numeric region immutable. A region must start
   with supported numeric initializers; do not add a new host unbox import to
   read arbitrary incoming handles. Unsupported live-ins decline optimization.
   Fresh boxing is necessary whenever an observable snapshot must be retained.
7. End the region before an effect/pure-helper call, state/collection write,
   serializer, response or error-routing consumer. Only existing handles cross
   suspension/resumption and host handoff. Cancellation still disposes the
   request instance through the current lifecycle; it does not run a new sweep.
   Do not promote numeric slots across an await in this first implementation.
8. For the existing fixture, the numeric region begins at `total = 70000`, covers
   the two nested pure loops, and ends before construction of `first`. The number
   of newly retained numeric handles should then be bounded by region inputs/
   outputs and retained snapshots, rather than by the 524,288 additions. This is
   an implementation target, not a result measured by MEM9-01.

Selection must be explicit and private to the Fastly realization; default
portable/Node emission remains byte-identical for this first slice. Put numeric
analysis/emission in canonical compiler/runtime owners and pass an internal
validated emission policy through the provider boundary. Do not make the provider
rewrite scalar expression strings or become a second compiler. The artifact's
generator/source identity and report recipes must capture the selected strategy;
no new public flag or authoring contract is needed for the proposed first slice.

This is not a general constant-memory guarantee: code deliberately retaining N
numeric snapshots requires O(N) live values. Unsupported generic temporary churn
continues to be retained, and collector capacity need not shrink after objects
become unreachable.

## Alternatives considered

| Approach | Decision |
| --- | --- |
| Make `__pulse_drop` free or mutate its argument | Reject: mixed borrowed/shared/new results and live assignment aliases |
| Clear table per loop, effect or request phase | Reject: opaque handles in collections/state/pending effects remain live |
| Expand scalar caches | Reject as fix: arbitrary numeric sequences still grow; larger caches add roots |
| Full GC in the loop | Reject: strong table roots remain, and CPU/latency cost is unmeasured |
| General reference counting | Defer: requires retain/release contracts for every constructor, borrower, container edge, cache and continuation; cycles and stale-ID reuse also need design |
| Trace/sweep handle table at safe points | Defer: must enumerate all guest/provider roots and temporary stacks, trace container graphs, address stub/fixed runtimes and prevent stale handle reuse |
| Proven numeric regions | Recommend first: eliminates the demonstrated allocations while keeping handle/continuation contracts intact |

## Owners and MEM9-02 acceptance

Canonical analysis belongs with `wasm/packages/compiler/src/` plan validation or
the canonical runtime emitter's private validated analysis. Emission belongs in
`wasm/packages/runtime-core-as/src/compiler/canonical-native-{expressions,control,support}.js`
and its orchestrator. Fastly selection/boxing belongs in
`packages/provider-fastly/src/build/native-platform-capabilities.js`. The canonical
runtime must not import provider implementations. The Node heap, Native ABI,
read-loop policy and JavaScript runtime remain unchanged in the first slice.

The implementation PR must declare any touched provider/runtime boundaries and
update the current contract's internal-lowering description; this internal
proposal is not an approved present-tense architecture change. Existing explicit
MEM9-01 direction authorizes this design and evidence, not a merged runtime change.

| Gate | Required evidence before calling MEM9-02 complete |
| --- | --- |
| Mechanism | Same 0/1/64/128/256 sweep; original 524,288-addition source; retained numeric handles stop growing with loop iterations for the eligible region; no destructively cleared table |
| Exact semantics | Raw response bytes and digest parity against controls; escaped/Unicode/small payloads; alias copies, before/after-loop collection snapshots, object spreads and serializer consumers |
| Numeric behavior | +0/−0 via reciprocal, NaN comparisons/truthiness, infinities, fractional arithmetic, 2^53 boundaries, divide/remainder by zero, postfix/prefix and coercion rejection; no integer truncation |
| Control flow | Nested loops, branches, zero iterations, break/continue, overwritten/live-out locals, repeated region entry and error exits; independent admission rejects spoofed kinds/unsafe live-ins |
| Effects/lifetime | Box before effect payload and after resume before a new region; retain aliases through sequential and parallel completion, out-of-order results, failure, deadline, cancellation and fresh-instance recovery; unchanged continuation IDs and ownership |
| Exclusions | Collection writes and mixed/string inputs inside loops keep boxed behavior; pure/effectful helpers, read-loop/output/body-transform and fixed-memory plans remain excluded unless independently qualified |
| Budget | Existing cumulative charging, latched errors and read-loop caps unchanged; no iteration refund or new maximum |
| Allocation gate | Run the unchanged 128 MiB schema-allocation assertion with default and arena-elided builds; both must pass; independent arena option remains usable |
| Memory domains | Record post-full-GC managed bytes and table roots diagnostically, separately from guest linear capacity and host RSS; no cross-request conclusion from within-request roots |
| Cost | Separate uninstrumented short/long sweeps (1/11/41/128/256 requests) with fresh instances, CPU/latency distributions and process RSS; balanced controls, no forced-GC timing or unconditional runtime full GC |
| Regression | Run complete unit/native/javascript/conformance profiles required by compiler instructions, plus selected provider/schema/allocation, continuation and request-budget tasks from the registry; retain failures and terminal coverage |

Useful existing task IDs include `bounded-read-loops`, `bounded-loop-helpers`,
`pure-helper-vocabulary`, `continuation-registry`, `canonical-native-wasm`, and
`request-budget-transport`. The unchanged allocation gate can also be run directly
as the source fixture above. New focused numeric-region tests should live beside
their compiler/provider owners; the MEM9-01 campaign is an explicit diagnostic,
not a new routine CI or release task.

Stop and narrow the implementation if sound live-out boxing or accounting
preservation requires changing the host ABI, weakening failure behavior or
widening accepted source. Do not convert an unknown proof into a silent JavaScript
fallback. Generic handle reclamation remains a separate design if this bounded
fix leaves material workloads unresolved.

## Reproduce and review evidence

Use the lockfile-pinned built workspace, Node 24.19.0, AssemblyScript 0.28.18 and
json-as 1.5.0. Start from a clean committed checkout with `NODE_OPTIONS` and
`JSON_CACHE` unset. Python, Rust and Viceroy are not required for the diagnostic.

```sh
node wasm/test/performance/mem9.cjs --out /tmp/pulse-mem9-attempt1
node wasm/test/performance/mem9.cjs --check /tmp/pulse-mem9-attempt1/report.json
node wasm/test/performance/mem9-checks.cjs /tmp/pulse-mem9-attempt1/report.json
```

The runner captures the ordinary fixture's compilation in an isolated worker,
selects the actual arena option, and retains the generated source, validated plan,
compiler recipe, ordinary/diagnostic Wasm and raw worker receipts. It checks
terminal coverage, source hashes, artifacts, byte-equivalent controls and the
linear retained-root slope. It does not modify the ordinary fixture or lower a
replacement arithmetic loop. Artifact hashes differ from historical PERF8-06
because this is a new source baseline; historical raw evidence remains unchanged.

Clean measured source: `4fab25702ecd3b6c72e8f268fbb7903f6038db4c`, tree
`9bc1aa5bde15cc62d426e83f5a0559096f98477c`. Subsequent changes add only the design,
checks and evidence index. `evidence.json` pins the report and saved raw bundle.
The bundle contains all attempts, including failures; see the replay script for
verification after relocation. Source/receipt verification is not a repeat of
the original request execution and does not qualify a deployed service.

The handoff includes `Pulse-MEM9-01-evidence.zip`. Verify its SHA-256 against
`evidence.json`, extract it into a new directory, then run:

```sh
node wasm/test/performance/mem9-replay.cjs /path/to/extracted-bundle
node wasm/test/performance/mem9-checks.cjs /path/to/extracted-bundle/mem9-01-attempt3/report.json
```

Replay verifies every archived file and the frozen report before relocating its
campaign directory in memory. Raw report/receipt bytes remain unchanged. No
absolute original paths are created or used as fallback evidence.

| Attempt | Terminal result |
| --- | --- |
| `mem9-01-attempt1` | Failed before compiling: test wrapper attempted to replace a frozen provider export. Corrected to a worker-local module wrapper; product source unchanged. |
| `mem9-01-attempt2` | Both workers completed 22 cases; aggregate failed because it compared raw response hashes to differently ordered expected JSON object keys. Semantic checks passed. Corrected expected-field digest validation while retaining raw byte comparisons across controls/settings. |
| `mem9-01-attempt3` | Passed all 22 cases and ownership probes; retained the expected elided allocation-gate failure separately. Sole completed MEM9-01 campaign. |

This completes MEM9-01. MEM9-02 is still required to implement and qualify the
proposed reduction. #289 remains open.
