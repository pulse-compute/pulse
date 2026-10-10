# Bounded effect collections: proposal and scheduling foundation

Status: proposed architecture, 2026-10-09. The internal scheduling core and its
tests are implemented; authoring, compiler lowering, Native execution and
provider integration are not. This repository-only proposal is not a release
support claim. Human direction authorizes exploration and PR preparation;
merge and the eventual public contract remain human decisions.

## Problem and recommended direction

Uptime receives a runtime-sized list of monitors. It should check several at a
time, handle each completion promptly and persist that monitor's result before
reusing its lane. A slow domain must not delay processing already completed
checks. A timeout for one domain is a monitor result, not necessarily failure
of the whole run. The invocation still owns all work and cannot return while
checks or result handlers remain live.

Add a **bounded collection control-flow form** alongside ordinary effects and
fixed `ctx.parallel` joins. Compile one static item-operation template and one
static result-handler template, then run them through a fixed lane window.
Keep fetch and KV as ordinary provider-mediated effects with their existing
authority, ticket identity, effect accounting and deadline. Do not introduce
a provider-owned bulk-fetch operation or compile the monitor list into routes.

The smallest first implementation is the internal, synchronous collection
window at `wasm/packages/host-runtime/src/runtime/effect-collection-window.js`.
It makes the scheduling semantics testable before choosing public syntax or
changing the Native protocol. It has no timers, Promises, user callbacks,
payload retention, network access, package export or runtime integration.

| Direction | Impact and later constraint |
| --- | --- |
| Extend fixed `ctx.parallel` with a runtime record | Changes keyed join/result semantics; still holds a whole-group barrier unless the continuation model changes |
| General async callbacks / Promise machinery | Introduces a much broader Native language and lifecycle problem than uptime requires |
| Provider bulk-fetch effect | Moves application control/result handling behind provider authority and makes later KV/other collections awkward |
| Bounded collection with static templates | Adds a distinct control-flow boundary; preserves ordinary effect identity and accommodates other admitted operations later |

## Proposed authoring constraints

The name and final signature remain open until a Native vertical proof exists.
The semantic inputs are a detached, schema-bounded finite array, literal item
and concurrency limits, a statically resolved item operation, and a statically
resolved result handler. Start with named source helpers and explicit arguments;
avoid arbitrary closures, callback graphs, computed handlers and ambient async.
Captured inputs must be explicitly detached immutable values. Do not pass raw
provider handles or SDK objects into either template.

The initial item operation should be a bounded fetch/read operation. Result
handling can use admitted ordinary effects, including persistence. Keep nested
collections and writes inside item-operation templates out of the first slice.
Generalization requires an explicit contract rather than accidental acceptance.
HTTP response ownership remains with the outer handler. Collection completion
returns a small summary, not an automatically accumulated array of responses;
applications can explicitly collect bounded results if needed later.

## Window semantics implemented in this PR

1. Validate the item count against the supplied item bound before admitting work.
2. Claim indexes in input order, up to the concurrency window.
3. Settle each item exactly once. Queue completion notifications in observed
   settlement order, independent of input order.
4. Let one result handler take a ready item. Other checks may remain in flight
   and their completions may queue while that handler awaits persistence.
5. Release the lane only after its result handler finishes. Claim the next item
   in that lane. Handling therefore contributes to concurrency/backpressure.
6. Complete only when every admitted item has finished handling. Termination
   invalidates all remaining leases and drops scheduler references.

Leases are private object-identity tokens, not guest authority and not effect
invocation tickets. A foreign, copied, duplicate or stale token cannot advance
the window. Each real effect still has its own execution-owned invocation
ticket; a lane reused for another monitor cannot accept its old settlements.
Checks and result-handler effects all consume the existing cumulative budget.

The driver supplies the owning execution's guard. A deadline/cancellation failure
at claim, settlement, handling admission or completion closes the window before
propagating the original failure. Driver termination must also close it explicitly,
cancel or abandon provider operations according to existing contracts, dispose
owned result/body handles, and observe late rejected host promises. No terminal
event may resume the guest or dispatch the next monitor. The window itself does
not own those provider resources and cannot promise rollback.

The proof's internal envelope is at most 1,024 input items and 64 lanes. These are
implementation safety limits, not proposed author limits or an effect-budget
refund. Examples use 64 items and two to four lanes. The final compiler contract
must select literal limits and reject oversized input before first dispatch.

## Completion, failures and mutation

The result handler is serial in the owning guest, preventing concurrent mutation
of shared application state. Completion order is observed provider settlement
order, not a reproducible wall-clock ordering promise. If several checks settle
while persistence is pending, the queue never exceeds the occupied lane count.
A slow result store can deliberately stop refill; it does not require admitting
more checks or retaining an unbounded backlog.

The vertical implementation needs a schema-bounded, tagged per-item outcome.
HTTP status responses, including 404/500, are ordinary check results. Selected
recoverable network/timeout failures must be normalized as per-item outcomes.
Cancellation, deadline expiry, effect-budget exhaustion, authority/configuration
errors and runtime/ABI violations remain terminal. Never turn every exception
into a monitor failure or retain raw exceptions, secrets or response bodies in
collection summaries. Exact normalization is an acceptance prerequisite.

A result handler failure terminates the collection. A dispatched write may have
committed; do not automatically retry it or claim rollback. Other completed or
in-flight checks may be left unrecorded. Idempotency and rerun reconciliation
belong to the application. The fixture driver uses a fake timeout outcome only
to prove scheduling, not to implement production failure normalization.

## Native and provider integration boundaries

Current Native execution has one program counter and waits for every member of
the declared continuation group before resume. Editing its `Promise.allSettled`
alone cannot produce per-item continuations. The guest planner, generator and
provider execution loops need an explicit collection boundary.

The planned Native representation must have static operation/result sites,
per-lane locals and a suspended result-handler frame. Runtime list cardinality
must not expand the artifact's effect/continuation table. A fixed literal lane
count may specialize lane frames; measure code size before selecting cloning
versus a shared frame template. Do not promise sharing until the final artifact
demonstrates it. Keep unrelated programs' ABI and dispatcher behavior unchanged;
prefer a versioned optional extension required only by collection artifacts.

Use existing execution-owned invocation identities per logical effect dispatch.
Distinguish item index, lane slot, static site ID and invocation ticket. A pending
operation from one lane cannot overwrite another lane's result or a reused slot.
Only the runtime drives continuations; authors cannot resume them.

The window retains O(concurrency) scheduler metadata and no result values.
That is **not an end-to-end memory bound**: the input snapshot is O(item count),
and present Native value heaps can retain values until invocation teardown.
Prove payload/body budgets and lane/frame/result release or cumulative retained
memory containment before claiming bounded collection memory.

Fastly Native dynamic destination handling is a separate provider concern. Its
current fetch implementation requires static backend bindings; setting the
JavaScript dynamic-backend option does not implement Native registration.
First prove collections against statically bound fixture destinations. Then
qualify explicit Native outbound policy, TLS, destination validation, resource
limits and registration for the uptime list. No arbitrary destination authority
is implied by a collection construct, and no JavaScript fallback is allowed.

## Delivery slices and proof gates

| Slice | Concrete result and acceptance |
| --- | --- |
| COLL-00, this PR | Internal window plus completion-order, backpressure, stale lease, lifecycle, and invocation-composition tests; no public syntax |
| COLL-01 | Narrow authoring/IR/plan contract with static helpers and literal limits; negative diagnostics; deterministic site tables across different runtime list lengths |
| COLL-02 | Native/JavaScript vertical proof with fixed destinations: per-item handling before a slow sibling, one recoverable failure, awaited result persistence, no late resume |
| COLL-03 | Exact provider artifacts, Native Fastly destination policy, body/result limits and memory/size measurements; uptime-shaped fixture |
| COLL-04 | Ordinary build/test/inspect and installed-package parity; publish support only after the exact runtime/provider acceptance gates pass |

COLL-01 and COLL-02 should remain one reviewable vertical change if separate
commits would expose an unusable public API. Fastly dynamic destinations can be
separate from the provider-neutral collection foundation. This work is not an
automatic beta.8 scope expansion; release selection remains a separate decision.

Before selecting syntax, prove a KV-sourced list, at most four in-flight checks,
prompt handling of fast completions, one normalized timeout, serialized awaited
result writes, a shared invocation deadline, cumulative effect accounting,
empty/oversized inputs, body disposal, cancellation/late settlement, and exact
Native artifact behavior. Inspect compiler grouping and measure artifact bytes
for 1, 16 and 64 runtime items; source and static templates must stay unchanged.

## Current verification

Run `node wasm/scripts/run-wasm-tests.cjs --task effect-collection-window --no-report`.
The focused task and existing `continuation-registry` unit/release task exercise
100 deterministic schedules plus a controlled
asynchronous fixture with slow checks and slow persistence. It composes item
leases with the existing effect-invocation registry. These are scheduler tests;
they do not claim compiled Wasm, real network, Fastly backend registration or
application completion support. Existing fixed `ctx.parallel` and PS1 read-loop
contracts remain unchanged.
