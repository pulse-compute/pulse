# RA-01 — shared ownership and disposition contract

Status: **internal candidate, contract pass complete**. Human direction:
“Proceed with RA-01.” Base: `6b1caf2abbb022f8813eb2d4b961b530c27d91bf`
(`hex-integration`, RA-00 merged in #526).

This defines the contract to pressure in RA-02/03. It does not install a runtime
service, change the supported DSL, or extend `pulse.host-extension.v1`.
[contract.json](contract.json) is the machine-readable vocabulary/action matrix;
[model.cjs](model.cjs) is an offline trace oracle; [check.cjs](check.cjs) exercises
positive and rejected lifecycle traces. These files are internal evidence and
candidate design, not a public provider ABI or sandbox. No exact named Entry
Point covers this internal cross-owner design pass; root/docs instructions apply.

## Decision and authoring shape

Use **one execution-owned resource registry**, with stable operation attribution
and explicit, single-owner claims. Core effects and package services use that
same boundary. Keep invocation tickets and guest value tracing separate.

Authors continue to compose semantic operation values through direct `await`,
keyed `ctx.parallel` and the bounded effect builder. No resource token, close,
refund, child-slot count or provider context is added to application code.
Package authors describe resource requirements and use the selected provider's
service; provider maintainers implement host-call disposition adapters. Unsupported
contracts fail explicitly before dispatch. There is no silent host fallback.

The design has three independent lifetimes:

| Identity | Responsibility | End does not imply |
| --- | --- | --- |
| Effect invocation ticket | Authenticate one completion and continuation | Resource release |
| Resource claim | Authorize use/disposition of one scoped resource | Remote work stopped, memory freed or side effect rolled back |
| Guest value/reference | Preserve an authored result or alias | Authority to consume its underlying resource |

A resource can outlive the effect that produced it. Fetch results and opaque
terminal responses therefore move into an explicit execution-owned **result
scope** before that effect settles. The result scope remains subject to execution
cancellation and final response transfer. No detached/background application work
is enabled. Cleanup authority remains valid after ordinary effect tickets expire;
it permits only declared cleanup, never resumption or new business work.

## Identity, ownership and attribution

The provider issues an opaque `ResourceRef` scoped by execution, slot and
monotonically changing generation. A stale reference cannot address a reused
slot. Generation exhaustion must reject; wrapping is not permitted. This is a
semantic identity requirement, not a required runtime object layout.

Raw ABI handles, Web objects and memory addresses remain provider-private. Zero
may be a valid host handle; sentinels are adapter-specific. The provider's handle
**namespace** is distinct from semantic resource kind: a reader and writer may
share one body-handle namespace. Two active claims cannot independently own the
same namespace/payload. Different namespaces may reuse the same integer.
Object aliases must map to one underlying claim. Trusted adapters establish
these associations; declarations alone cannot prove them or contain hostile code.

Each claim records:

- Execution identity, opaque resource identity and resource kind.
- Current owner scope and immutable originating root operation attribution.
- Static capability-binding/use-site identity, selected service and implementation
  identity. These are resolved build metadata, not runtime keys or URLs.
- Current state, last disposition, external-access state and any side-effect
  acceptance observation. Missing evidence stays unknown.
- Declared cleanup action and prerequisite, active borrow/pin dependencies, and
  the captured host-call attempt that may complete it.

A child may receive ownership through an explicit internal handoff within the
same root. The former owner loses mutation authority; there is no extra hostcall,
release, reacquisition, accounting refund or effect admission. Result promotion
uses the same principle. Cross-root handoff is rejected in the first milestone.
Sibling aliases use scoped pins, not duplicate ownership. Pins prevent destructive
use or transfer until released. Borrowing does not grant close/commit authority.
The oracle conservatively fences every host action while pinned; richer shared
read/write modes are deferred to RA-04, not inferred from aliasing.

Incoming borrowed handles are registered as externally owned references, not
adopted into the owned ledger merely because an effect uses them. A provider must
explicitly transfer ownership to start a consuming forwarding path. The trace
oracle models pins on owned resources; it does not implement ingress registration.

## Host-call boundary and disposition

A resource operation follows one bounded sequence:

1. Validate provider/service authority, current owner, generations, pins and
   action prerequisites. RA-02 supplies admission/reservation decisions.
2. Fence **all** input claims and capture one attempt identity before dispatch.
   No second disposer or continuation may use them while the call is in flight.
3. Invoke the already-selected host operation through the existing driver.
4. Record a disposition for **each** input and adopt **all observed outputs**,
   including outputs returned on failure, before resuming guest execution.
5. Preserve operation status and side-effect acceptance separately; settle once
   using the existing effect/error machinery.

A preparation failure before host dispatch does not consume its inputs. Every
successful acquisition must be registered before the next fallible preparation
step. A later failed allocation cannot erase an earlier request/body claim.
Output slots and cleanup bookkeeping must be available before a call that can
produce resources; the capacity policy and emergency containment are RA-02/03.

| Disposition | Meaning | Continued authority |
| --- | --- | --- |
| `retained` | Provider evidence establishes the caller still owns the input | Ordinary use or a separately declared safe cleanup may remain possible |
| `released` | The declared release condition completed; no borrower/external user still needs this resource | None; does not measure allocator/RSS reclamation |
| `transferred` | An identified receiver accepted ownership and any declared continuing-access obligations | None for the former owner |
| `consumed` | Host invalidated the input claim; may replace it with outputs or continue internal work | None; not proof of release or capacity refund |
| `unknown` | Available evidence cannot establish input disposition | Quarantined; no reuse, retry, speculative disposal or fallback |

`released`, `transferred` and `consumed` are distinct terminal claim states.
`owned` and `busy` are live states. `unresolved` quarantines unknown disposition
or an unsuccessful terminal cleanup whose retained ownership is known. Preserve
that last known disposition; do not relabel known-retained as unknown.

The action matrix is the candidate vocabulary's outer envelope. A selected host
adapter must narrow it to qualified outcomes for its actual ABI/version. It
cannot choose a favorable disposition from a status code alone. In particular,
nonzero status does not prove retained ownership. The offline oracle requires a
fixture evidence marker for known failed-call outcomes; that marker is **not** a
production proof format. RA-10 must qualify the actual mappings.

Failed close/abandon/commit is not automatically retried, even when retained.
The claim is terminal or quarantined and the failure remains observable. A
failed send known to retain its input may permit a distinct safe close; this is
explicit cleanup, not request retry. A read failure known to retain its input
also permits safe cleanup. Unknown consumption prohibits both. No generic
“ensure closed” loop is introduced.

A multi-input call may have mixed dispositions. A pending fetch can consume one
pending handle and yield a response/body pair. A streaming send can transfer a
request/response while retaining a writer; the matrix represents that writer
input as `send-retain`, independently of the transferred input. This is one
hostcall with per-input contracts, not two scheduled operations.
Partial or malformed reports are contract violations. Production containment must
preserve the fenced inputs and every observed output as unresolved; it must not
pretend to undo the hostcall. The oracle rejects malformed traces atomically
because it has no host side effects; this is validation behavior, not rollback.

## External access, acceptance and cleanup

Resource disposition, external access and acceptance are separate dimensions:

| Dimension | Values | Example |
| --- | --- | --- |
| External access | `quiescent`, `active`, `unknown` | DMA may still read a buffer after its effect times out |
| Side-effect acceptance | `not-applicable`, `accepted`, `not-accepted`, `unknown` | A failed commit can have been accepted |

External access describes continued use that prevents release/reuse of **this
resource**, not all remote work caused by the operation. An origin may continue
working after a pending handle has been consumed. A body/lease can be quiescent
while the host retains unrelated internal allocations.

Cancellation is a request to stop work; it is not a quiescence proof. A buffer
with active/unknown access cannot be freed, recycled, handed to another child,
or treated as available just because a ticket expired. A qualified completion
may establish quiescence. A qualified disposal action may itself stop external
access safely; issuing that action does not establish release until its outcome
confirms quiescence. Failure preserves uncertainty. Alternatively, an explicit receiver can accept both
ownership and continued-access responsibility. Consumed claims with unresolved
external access retain that obligation; the oracle blocks their slot/payload
reuse. Exact byte/exclusivity accounting and safe reuse rules are RA-02/04 work.

Cleanup is a finite declared action or bounded phase, serviced by the existing
execution driver. It has its own authority after effect settlement but inherits
the execution's deadlines and constraints. There is no blocking drain, hidden
queue, retry scheduler or unbounded destructor. Disposal prerequisites belong to
the provider contract. For example, the cache spike may close a lookup only when
readiness is established; an unready lookup is recorded unresolved at finalization.

Cache writer **commit** and **abandon** are different actions. Only the explicit
successful write path may commit. Cancellation/error cleanup cannot substitute
close-as-commit for abandon. If cleanup of one resource fails, attempt independent
safe cleanup of others; preserve the primary operation error and record cleanup
failures separately. Successful siblings or earlier commits are never rolled back
by bookkeeping. Existing group failure precedence and Router recovery remain
owned by the current runtime, not this registry.

Stopping a root closes admission for new children/work. Already admitted work
still reports completion, and any late outputs enter cleanup-only ownership.
Parent settlement waits for admitted operation children. Effect settlement alone
does not close a result scope. Final execution closure prevents guest resumption;
known live claims and in-flight/unknown claims remain explicitly unresolved in
the observation. Trap/termination can bypass every guest hook. Host teardown is
a separate qualified lifecycle guarantee; this contract never manufactures a
release receipt from return, timeout, empty retirement counters or a trap.

JavaScript adapters follow the same facts but may lack Native-style disposal
proof. Calling `body.cancel()` without awaiting completion cannot establish
`released`; a locked body is not silently cancelled. The final transferred body
is excluded from local cancellation. Adapter `dispose` and body cancellation
remain separate obligations. RA-01 does not alter current JavaScript behavior.

## Provider/service shape and existing owners

The following are semantic operations, **not proposed public method names**:

| Operation | Required authority/result | Existing owner affected later |
| --- | --- | --- |
| Adopt an acquisition | Selected service, current scope, generation, resource kind and qualified payload identity | Provider preparation and output construction |
| Pin / end borrow | Bound resource and authorized borrower lifetime | Value/result wrappers and body readers |
| Handoff / promote result | Current owner, permitted receiving scope; preserve root attribution | Child service and terminal response paths |
| Begin host use | Current claims, declared action, captured attempt, admission decision | Provider effect dispatch |
| Complete host use | Captured attempt, per-input dispositions, outputs and independent acceptance | Provider result normalization |
| Stop / cleanup / finalize | Execution-owned cleanup authority; no new business work | Existing deadline and invocation-close hooks |

Canonical owners to change in subsequent units:

- `packages/runtime/src/host.d.ts`: a host-only service handle and execution/result
  lifetimes, if the contract is adopted; no raw provider resources in `ctx`.
- `wasm/packages/contracts/src/handler/canonical-runtime.js`: relationship to the
  existing single-use invocation policy, without replacing its ticket identity.
- `wasm/packages/contracts/src/provider/host-extension.js`: explicit provider
  admission of a separately versioned resource service. The current terminal-only
  service and artifact version are not silently widened or inferred from imports.
- Native provider preparation, fetch deadlines, value roots, body forwarding and
  invocation close; JavaScript response/effect lifecycle: realize the same facts
  through their existing owners. No generic collector destructor is assumed.

A package declares resource **kinds, actions, bounded demand and dependencies**.
The provider owns raw representation, host failure mapping, cleanup prerequisites
and lifecycle capabilities. A service implementing the wrong protocol/target or
missing a required lifecycle guarantee is rejected. Declarations remain trusted
build inputs, not a sandbox. Carrier, service wire types and exact implementation
identity encoding are RA-03 integration details, after RA-02 policy is reviewed.

Static resource demands must appear under capability bindings, including possible
conditional children. Runtime dispositions are separate observations linked by
binding/use-site and opaque scoped record identities. No raw handles, keys, body
content or memory addresses belong in standard reports. Report completeness,
sampling, bounded aggregation and schema/compare integration remain RA-08; the
oracle summary is only a candidate observation, not `pulse report` output.

## Bounded decisions and cost

RA-01 chooses explicit ownership, root-preserving handoff, per-input disposition,
quarantined uncertainty, separate result/cleanup lifetimes, and external-access
obligations. These are the minimum facts the RA-00 failures require.

It does **not** choose numeric limits, reservation strategy, refunds, fair sharing,
cleanup reserves, a universal byte/handle conversion, or an automatic concurrency
reduction. RA-02 must decide those policies without equating consumed claims with
freed capacity. Admission failures should identify the exhausted dimension and
binding, not require users to tune internal child slots blindly.

Before RA-03, review these concrete choices with RA-02: quarantine even a
known-retained failed commit/disposal; reject cross-root ownership moves; preserve
result scopes after effect settlement; and require explicit external-access
evidence before reuse. They deliberately favor visible failure over recovery
machinery. The offline model checks selected consequences of those choices, not that their
implementation cost or conservatism is optimal for every host.

Expected implementation cost is metadata per live claim/attempt, checks at host
boundaries, and provider-owned cleanup hooks. The trace oracle deliberately uses
ordinary JavaScript maps and retained history for inspection; it is not a proposed
runtime layout or a memory benchmark. RA-03 must bound storage and use the existing
driver; RA-09 must measure added/unused Wasm and runtime cost. No cost numbers or
zero-baggage claim are established here.

This contract fits the cache/fetch milestone and can express the lease/buffer
counterexample without assuming ESP32 APIs, DMA safety or a board's capacity.
RA-04 is still needed to show whether that extra machinery earns its cost.

## Evidence and completion boundary

Run the offline contract checks:

```sh
node docs/internal/host-extensions/resource-accounting/ra01/check.cjs /tmp/hex-ra01-receipt.json
```

[receipt.json](receipt.json) records test identities, input hashes, trace counts,
terminal status and summaries; full traces are retained in the indexed evidence
archive. [evidence-index.json](evidence-index.json) records archive/member hashes.
[validation.json](validation.json) records repository checks and their limits.
The final selection passed **82/82 scenarios**, including **100 action/status/
disposition combinations** within the matrix scenarios. Negative cases assert
that invalid transitions leave the prior model state unchanged. The
[source index](source-index.json) pins the current contracts used for this design.
RA-00's 26 Wasm checks and #524/#525 receipts are inherited evidence, not rerun or
newly qualified here. No production compiler/runtime changes, Wasm performance
measurement, JS execution parity, hosted/Viceroy qualification or hardware run
is claimed.

RA-01 ends with a reviewable candidate contract and checked invariants. RA-02
is the next decision: admission, reservation and refund policy. RA-03 begins
service implementation only after those choices have been pressured.
