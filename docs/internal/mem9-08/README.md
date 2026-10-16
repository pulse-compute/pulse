# MEM9-08 — temporary and handle ownership design

Status: **design complete; proposed direction requires human review before MEM9-09**.
Related: [#289](https://github.com/pulse-compute/pulse/issues/289),
[integration PR #349](https://github.com/pulse-compute/pulse/pull/349).
Human direction: implement MEM9-08, the ownership design step in the integration
workstream. This document does not approve its own architecture or implement it.
Class: architecture; scope: architecture-change, analysis only. No production,
ABI, allocation limit, release gate, or public support change is made here.

Source baseline: integration commit
`0ec9023d5ac0b267e10d8a2ecfbc7033188763f3`, tree
`93423e51b4f12f71b28f9424a72d020436b1729c`, after MEM9-07 merged in
[#350](https://github.com/pulse-compute/pulse/pull/350). The
[source inventory](ownership.json) pins the inspected owners and distinguishes
value handles from resource IDs and managed references. It is a review inventory,
not an executable collector schema or proof that every emitted path is covered.

## Proposed decision

Use **compiler-described roots and tracing at proven safe points** to remove
unreachable generic handle mappings. Keep values immutable where currently
immutable, handle IDs stable, and `__pulse_drop` a no-op. Let the selected managed
runtime reclaim objects after their last strong reference disappears.

Start MEM9-09 with a deliberately bounded vertical: canonical, unlinked,
unbudgeted Fastly Native with the existing incremental AssemblyScript collector,
synchronous entry code, and audited schema/request/response value operations.
Exclude helpers, shared stages, application error lanes, async effects, opaque
resource capabilities and package-owned/linked emitters from that first slice.
These are whole-plan eligibility exclusions, not reasons to skip a root while
collecting the rest of a plan. Unsupported plans retain their current emission;
there is no JavaScript fallback or new user-facing flag.

That vertical must reclaim fixed-working-set string replacement, overwritten
object fields and generic numeric temporaries outside proven numeric regions.
It must also preserve intentionally retained snapshots and collection cycles.
Later increments cover the remaining owners before broad enablement. Numeric
regions remain useful allocation avoidance and must continue to qualify.

| Alternative | Decision and reason |
| --- | --- |
| Free in `__pulse_drop` or on local overwrite | Reject: assignment results, postfix values, collection fields and aliases can still own the same handle. |
| General reference counting | Defer: every borrowed/fresh result, container edge, cache and continuation transfer needs a protocol; cycles require another mechanism. It is not a small extension to `drop`. |
| Clear the table or recycle IDs each iteration | Reject: surviving aliases become invalid or silently reference another value. |
| Append-only table with null tombstones | Insufficient: object roots disappear, but table metadata still grows with lifetime allocations. |
| Mutate cached scalar boxes | Reject: caches share immutable values across aliases. |
| Force full GC after each iteration | Reject: GC cannot discover integer-handle ownership while the table retains every object, and unconditional collection is an unqualified cost. |
| Tracing with explicit safe points | Recommend: follows actual reachable graphs, handles cycles and avoids a per-expression retain/release ABI. Requires complete roots and an audited empty-temporary boundary. |

## What remains after numeric regions

[MEM9-03](../mem9-03/README.md) measured linear retention for fixed-length string
replacement and single-field overwrite, as well as generic numeric paths.
Those measurements describe its historical source, not this integration head.
MEM9-04 through MEM9-07 subsequently extended numeric qualification; they did
not establish general release of dead string/container/scalar handles.
[MEM9-07](../mem9-07/README.md) qualifies unlinked Fastly read-loop numeric
accounting only; Node budgeted, output/body-transform and linked budgeted
qualification remain outstanding. No new memory or timing measurement is claimed
by MEM9-08.

A loop retaining N snapshots has O(N) legitimate live data. A growing string may
legitimately retain its rope graph. The objective is to remove unreachable handle
roots and bound collector bookkeeping by the reachable graph plus allocation
between safe points, not to make every supported program use constant memory.

## Ownership model

A **handle** is an opaque positive integer identifying a value mapping. Zero is
an absent-slot sentinel where the existing API permits it; it is not a value.
A **root owner** is storage that can use a handle after the next safe point.
A **borrow** copies a handle without creating a unique ownership claim. A
**transfer** stores a handle in its next root owner before the previous owner can
be cleared. Tracing does not count borrows or eagerly release an overwritten
edge; the next complete trace determines whether another path still reaches it.

| Current owner | Proposed root/edge rule |
| --- | --- |
| Canonical `__pulse_local_*` slots | Visit every nonzero current slot, including aliases. Initial implementation does not depend on liveness/type inference to omit slots. |
| `__pulse_state_keys` / `__pulse_state_values` | Visit both arrays. Replaced values die only if no other owner reaches them. |
| Result, event payload and helper-result globals | Visit independently of execution status until consumption/transfer. Terminal status alone does not end result lifetime. |
| `__pulse_effect_result_*`, shared-stage result accessors | Visit nonzero slots independently of ready/pending flags. Resume clears flags before consuming results today. |
| Fastly payload/ready arrays | Visit every stored handle until the existing lifecycle actually clears or transfers it. Pending host resource IDs and mode flags are not handles. |
| Singleton, integer, character and literal caches | Treat every resident cache entry as a root; preserve reuse, immutability and eviction policy. Cache occupancy is expected retained memory. |
| Fastly collection `valuesStorage` | Trace child handles of every reachable container, including shared children and cycles. Keys are managed strings. |
| Fastly rope `textLeft` / `textRight` | Direct managed object edges, not integer handles. Follow the object graph without flattening; a child object's survival does not itself require its old handle mapping. |
| Request header snapshot; forwarding marker/result | Persistent handle roots when emitted. Forwarding's request/body/pending IDs are distinct resources. First slice excludes forwarding. |
| Router errors | Error objects flow through ordinary expression/local/result ownership. Application schema/failure counters are modes, not handles. No collection during error construction or settlement. |
| Synchronous provider/parser/codec temporaries | Borrowed/fresh handles on native stacks. Collection prohibited until the entire operation returns and its result is rooted or discarded. |
| Host-resource wrappers | No new destructor or close operation. Later resource-enabled slices pin wrappers for request lifetime until separate resource-lifetime evidence permits a narrower policy. |

Keeping all current local slots is conservative: an out-of-scope slot can retain
its last graph until reset. It avoids use-after-free but is not exact semantic
liveness. Record that residual explicitly; future local clearing needs its own
control-flow proof. Pinning resource wrappers likewise does not solve unbounded
resource-wrapper churn.

Fastly also retains managed strings/bytes for request data, headers and security
redactions. Do not clear those as part of handle collection. Invocation tickets,
program counters, schema modes and provider resource IDs must never be mistaken
for values merely because their representation is `i32`.

### Safe points and transfer ordering

The compiler must establish that no live **unregistered integer handle** exists
in a Wasm/AssemblyScript temporary or caller frame at each checkpoint. All values
needed afterward must be in declared roots. A source statement boundary alone
does not prove this condition.

1. Generate checkpoints from validated canonical control flow, not source-text
   replacement. Complete the expression, store its result/assignment and finish
   existing error guards before checkpointing. Do not execute a collector after
   a latched failure; preserve the original failure and settlement path.
2. Cover loop latches and each reachable break, continue and exit edge. Inspect
   emitted temporary variables and enclosing loop conditions. A crossing
   temporary must be registered explicitly or make that checkpoint ineligible.
   This applies to nested loops, not only dispatcher block boundaries.
3. Place numeric-region checkpoints only after required generic outputs are
   boxed into root slots. Internal `f64` temporaries are not handle roots.
4. Never collect inside constructors, parsers, schemas, serializers, host calls,
   foreign guest calls, or effect payload construction/settlement. Allocation
   may set a request-to-collect flag; it must not recursively invoke collection.
5. Pure helpers can run inside a caller expression with earlier arguments or
   operands still on the caller stack. Do not checkpoint inside them without an
   explicit shadow-root frame protocol. First slice excludes helper plans;
   a later helper slice may defer collection until the outer expression returns,
   documenting its larger between-checkpoint allocation bound.
6. Later suspension coverage must root all sibling payloads before dispatch,
   preserve provider/guest result ownership through authenticated settlement,
   and transfer results before clearing storage. Ready-flag changes are not
   ownership changes. Cancellation, late completion and error recovery retain
   their existing invocation-ticket checks and resource teardown ordering.
7. Terminal responses remain rooted through encoding and provider handoff. Do
   not add collection between producing a result handle and storing its owner,
   or between returning a borrowed provider result and guest acceptance.

Owner enumeration must be emitted from the same compiler structures that declare
slots. Provider value fields and persistent slots need an explicit reviewed
catalog and positive/negative coverage tests. Unknown node kinds, capability
owners or runtime policies disable collection for the plan. Numerical-region
eligibility is not ownership proof. Diagnostic mutation tests must demonstrate
that a deliberately missing owner/checkpoint proof is rejected before execution.

## Handle table and collector mechanics

Propose an internal sparse live map keyed by monotonically increasing positive
IDs for eligible Fastly plans. IDs are never recycled within an invocation.
Lookup verifies membership; a removed handle fails through the existing value
error path rather than aliasing a future allocation. Detect positive-ID exhaustion
before integer wrap. MEM9-09 must qualify that failure path and diagnostic mapping;
this proposal does not add a public allocation cap or alter budget limits.

Deleting map entries is insufficient if the chosen AssemblyScript map retains
capacity proportional to all historical insertions. MEM9-09 must inspect the
pinned implementation and rebuild a survivor map at safe points as needed. Its
capacity, deletion metadata, worklists and mark storage must track live/peak
working-set demand, not cumulative allocation count. Do not add a production
dependency. Map lookup/metadata cost versus today's dense array is a required
measurement, including short requests where no collection occurs.

At an eligible checkpoint, the proposed algorithm is:

```text
if no collection is due or execution has failed: return
enumerate declared roots and pinned cache/resource handles
mark handle IDs; validate each mapping before visiting its value
walk value objects once; trace stored handle edges and direct rope edges
if a root/edge is invalid: report invariant failure; do not sweep
construct a survivor map containing all marked handle IDs
publish that map only after marking and survivor construction finish
release old collector work state; reset the scheduling counters
```

Use iterative worklists so cyclic or deep graphs cannot overflow the call stack.
Handle visitation and object visitation are distinct: two IDs may refer to one
object, and a rope can retain an object without retaining its old ID. Each marked
ID must survive even if its object was already visited. Private mark sets/epochs
must have explicit reset/wrap behavior. There is no mutator or host reentry during
the pass. A failed pass cannot partially delete the current table; allocation
failure may terminate execution under existing runtime rules, without unsafe
recovery or a changed application error.

Traversal must use a nonallocating view of stored edges. Reading today's lazy
`values` getter can allocate an empty backing array; reading `text` can flatten a
rope. Neither is a tracing operation. The visitor must cover all relevant fields
without invoking those getters, charging user allocations, mutating values, or
calling provider effects. A reachable cycle survives; an unreachable cycle loses
all table roots and becomes eligible for the selected runtime's ordinary GC.

Collection is synchronous; there is no write barrier in this first design.
Allocation only requests a later pass. Begin qualification with an internal
handle-count trigger of `max(1024, live handles after the previous pass)` new
handles since that pass. This is a tuning candidate, not a compatibility promise.
Compare alternate intervals and short/long workload cost before choosing a
production value. A single large allocation can exceed a handle-count heuristic;
existing size/memory limits still apply. Byte-aware scheduling is follow-up work
unless measurements show it is necessary for the first slice's acceptance.

Let L be the graph reachable from declared roots (including conservative slots
and pinned caches), and A the allocations since the last safe point. Table and
collector storage must be O(L + A), with survivor-map construction temporarily
holding old and new storage. Managed heap capacity may reflect a previous peak
and GC timing; WebAssembly memory need not shrink. A long operation without an
inner safe point can have large A. Report that bound; do not promise constant
physical memory or implement an unreviewed preemptive collector.

## Runtime and accounting boundaries

| Path | MEM9-09 initial treatment | Requirement before extension |
| --- | --- | --- |
| Unlinked Fastly, incremental GC, unbudgeted synchronous canonical plan | Eligible only with complete emitted owner/checkpoint proof and audited capabilities | First vertical below, both JSON arena settings |
| Fastly stub allocator | Retain current path | Root removal alone does not reclaim physical allocations; qualify an allocator/runtime strategy separately |
| Guest-linked fixed-memory artifact | Retain current path | Linker/allocator and foreign-frame ownership proof; do not inherit incremental-GC results |
| Node/portable Native | Retain current `ValueHeap` | Explicit guest-root transport and host lifetime design, ABI validation and independent JS-heap qualification |
| Any budgeted plan | Retain current path, including MEM9-07 numeric policy | Review the retain-until-terminal contract before physical reclamation; exact accounting/cancellation qualification |
| JavaScript target | Unchanged | Ordinary JS references/GC; semantic reference, not evidence for Native roots |

Node's `ValueHeap.values` retains actual JS values; containers hold values rather
than integer child handles. Its scalar cache and weak identity index can return
existing IDs. Removing a heap entry while leaving a cache mapping is unsafe even
if that cache is weak. A Node design must specify coherent cache invalidation or
pinning and guest/host handoff. Do not copy Fastly's child-handle visitor, scan
linear memory for integers, or smuggle root transport into an existing scalar
import. If new root transport is needed, use a separately reviewed, versioned
ABI extension and normal import/host compatibility validation.

The canonical read-loop memory contract explicitly says execution-wide
`retain-until-terminal`. Fastly and Node also account for budgeted output/body
transform workloads. General reclamation is a new contract decision even if
physical storage and logical charges could be separated. A future proposal must
preserve cumulative allocation order, original cache behavior, no refunds,
maximum values/bytes, latched failure and the same rejected operation. Collector
metadata must not silently consume or bypass application charges. MEM9-07's
precharged boxes do not authorize a general release mechanism.

## MEM9-09 execution plan

Each increment starts from the reviewed integration branch and records its own
eligibility and exclusions. These are implementation boundaries, not additional
GitHub issues or a claim that all increments fit one PR.

| Increment | Deliverable and exit condition |
| --- | --- |
| 09A — first vertical | Compiler root/checkpoint descriptors, fail-closed whole-plan eligibility, sparse table and tracer for the initial synchronous Fastly slice. Fixed-string/field-overwrite/generic-number churn reclaims dead mappings; live graphs/aliases survive; map capacity is bounded by working-set demand. |
| 09B — frames and effects | Add one audited owner family at a time: helper/stage frames, Router error lanes, async sibling payloads/results, cancellation and resource wrappers. No enablement before positive lifecycle and negative missing-owner coverage. |
| 09C — remaining runtimes/accounting | Separate reviewed proposals and qualification for Node root transport, budget contract, stub and linked allocator paths. These must not be implied by 09A/B results. |
| Integration qualification | Reconcile latest once, freeze a clean candidate, run full compliance and the complete accepted lifetime/cost matrix. Review residuals against #289 before requesting closure. |

Implementation owners are the canonical Native support/control/expression
emitters, Fastly value/provider emitters and their focused tests. Node host and
canonical ABI/budget owners become write scope only for their reviewed extension.
Update current architecture contracts and hidden-policy classifications when the
approved implementation actually changes them; this proposal intentionally stays
outside current public/installed documentation.

## Required acceptance evidence

Test the real generated artifact with collection enabled and a matched retained
control, not only a model of the proposed algorithm. Use diagnostic forced-safe-
point runs to expose lifetime defects separately from ordinary scheduling/cost
runs. No test may enable collection in an unsupported runtime by bypassing gates.

| Area | Required cases / oracle |
| --- | --- |
| Aliases and expressions | Assignment result, postfix old value, self-assignment, multiple locals, short circuit/coercion and discarded expressions. Exact observable output matches retained control. |
| Containers | Overwrite, spread, shared child, nested array/object, self/mutual cycles and detached cycles; reachable snapshots stay valid, unreachable cycles lose mappings. Use source-supported cases or a clearly labeled runtime-only probe. |
| Strings and caches | Fixed-length replacement, concat/trim/index, empty-concat borrowed return, retained ropes, large strings; singleton/integer/character/literal cache identity and immutability, signed zero, NaN/infinities. No flattening during trace. |
| Control flow | Nested loops, all break/continue/return edges, coercive live-ins and numeric-region exits. Unsupported or unregistered crossing temporaries disable eligibility. |
| Later frame/effect slices | Helper used as a later expression argument, borrowed helper return, caller-local survival, stage resets, parallel out-of-order results, resume flag clearing, cancellation, late/duplicate completion, deadline failure and Router recovery. |
| Provider lifetime | Header snapshot and terminal response survive serialization/handoff; opaque resources remain excluded until wrapper ownership and teardown are qualified. |
| Collector failure | Invalid/stale ID, duplicate object under distinct IDs, epoch/ID boundary, incomplete owner descriptor and failure before publication. No ID reuse or partial sweep. |
| Runtime exclusions | Node, budgeted, stub, linked, package-owned and unaudited capability plans select the existing path, with an internal reason and no silent target fallback. |
| Retention | Warm caches, then increasing iterations of constant-size live data: retained mappings and collector/map capacity plateau within the declared between-safe-point bound. Live N-snapshot data scales with N. Report conservative slot and rope retention separately. |
| Existing regressions | Original 524,288-addition fixture and unchanged 128 MiB gate with both arena settings; numeric-region policies; MEM9-07 exact charges, exhaustion stage and failure latching; existing continuation/provider semantics. |
| Cost | Paired equivalent short/long artifacts, randomized execution order, warmup and repeated samples. Report CPU/wall/latency distribution and confidence intervals, artifact size and collector peak scratch. Review any regression; no invented universal percentage gate. |

Record input, compiler/runtime dependency identity, source commit/tree, complete
task IDs and terminal results. Count live mappings, pinned-cache mappings and
collector capacity separately from managed bytes after diagnostic GC, linear
memory capacity and host RSS. Diagnostic exports/full GC must not contaminate
timing samples. Ordinary execution uses the existing collector policy; a lower
mapping count alone is not proof of a physical-memory or performance improvement.

## Review and completion boundary

The human architecture decision is whether to accept safe-point tracing, the
sparse monotonic-ID table, conservative root set and the first-slice exclusions.
Protected conceptual boundaries are `runtime-target-fluidity`,
`effect-capability-model` and `continuation-runtime`. No provider discovery or
authority change is proposed. Root `AGENTS.md` reserves architecture approval
and merge authority for humans; this is the concrete proposal for that review.

MEM9-08 completes with this source-grounded design and documentation checks in
[checks.json](checks.json). It does not fix general retention, approve MEM9-09,
close #289, or satisfy final compliance. A successful 09A is a measured partial
fix. Closing #289 requires an explicit owner-reviewed coverage/residual decision
after the approved increments and final integrated qualification; untested Node,
budgeted, stub or linked general retention must remain visible rather than being
silently declared solved.
