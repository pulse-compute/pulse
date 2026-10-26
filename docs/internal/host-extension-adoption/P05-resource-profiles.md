# P05 — Resource profiles and admission planning

Status: **shared planning contract implemented; runtime admission is not installed**.
Date: 2026-10-25. Base: `latest` at
`4f50e7c14b4def4a689322cff03a850bcc35482b`, after P09A #547.
Branch: `adoption/p05-resource-profiles`; PR target: `latest`.

Human direction: “Proceed,” following P09A and the remaining P05/P11A gates.
This implements the early profile/admission layer in the [plan](README.md), under
[P01's direction](P01-adoption-decision.md). No exact named Entry Point covers
this shared metadata contract. Root/Wasm and root/docs instructions apply.
Owners: shared handler/provider contracts, maintained contract tests and their
registration, canonical documentation with regenerated mirrors/context.
Classification: architecture / architecture-change. Effect/continuation and
provider/target boundaries remain subject to human architecture review.

P05 supplies the reviewable calculation contract for P11A and P04/P07. It does
not dispatch host operations, change configuration or replace enforcement. The
compiler/profile producer must still prove reachability, quantities and allocation
strategy when integrated; accepting hand-authored metadata is not that proof.
There is no shipped cache profile, child graph, new support tier or evidence
migration. P04 remains gated by P11A and foundation qualification.

## Dimensions and ownership

`resourceAdmission` is available through the existing internal
`@pulse-compute/wasm-contracts/provider/toolchain` subpath. No export-map change,
application API, registration mechanism or public diagnostic is added.
The owner is [resource-admission.js](../../../wasm/packages/contracts/src/handler/resource-admission.js).

| Dimension | Meaning | Lifetime / reconciliation |
| --- | --- | --- |
| `handles` | Every possible reserved provider handle claim, including unobserved outputs. | Sum work, cleanup and exit; retire only on qualified disposition. A returned status does not prove input consumption. |
| `backingBytes` | Cumulative payload-backing allowance for the declared allocation strategy. | Retain for the invocation, including aliases, intermediate copies and uncertain outcomes. Close, settlement and lost references do not refund it. |
| `records` | One logical slot per reserved handle, one per allocation family, plus declared service metadata. | Slot capacity, not ledger bytes. A family retains its entire cumulative allowance. Actual banks/layout and reuse belong to P04/P11A. |
| `cleanupSteps` | Bounded attempts available only to cleanup/exit. | Work cannot spend them. Reserve before acquisition; no retry of an unknown disposal outcome. |
| `effects` | Cumulative execution-owned effects required by selected operations. | Use the existing effect budget and invocation owner. Never reset between cohorts. P06 must prove children before assigning composed counts. |

Realization is an exact symbolic implementation identity, not only a provider
name. Profiles for different allocation/ABI implementations cannot be mixed.
Fastly request, response, body and pending request are separate real namespaces,
even if numeric values coincide. Two body handles remain separate claims in one
namespace. Node value-heap IDs are not Fastly handles and must not be substituted
or counted twice.

Runtime resource identity must be `(execution, namespace, slot, generation)`;
provider handle zero is valid. Generation exhaustion rejects before reuse, never
wraps. Completion tickets, cleanup authority, resource identity and HTTP response
authority remain distinct. The planner stores aggregate namespace counts, not raw
handles, credentials or resource tickets. P04 owns runtime authentication and
representation; P05 chooses no numeric handle encoding.

## Exact data contract

`createPlan(input)` consumes this exact shape:

```js
{
  version: 'pulse.resource-admission.v1',
  realization: 'provider.driver.allocation-v1',
  selected: [{ site: 'selected-site', count: 1, profile }],
  exit: reservation,
  occupied: { handles: 0, backingBytes: 0, records: 0, cleanupSteps: 0, effects: 0 },
  limits: { handles: 8, backingBytes: 4096, records: 16, cleanupSteps: 8, effects: 1024 }
}
```

These numbers illustrate shape, not defaults. A profile has exactly `version`
(`pulse.resource-profile.v1`), `owner`, `operation`, `realization`, `effects`,
`work`, `cleanup`, and `exclusions`. Owner/operation identify trusted selected
implementations; they grant no lowerer or host authority. `count` is a proven
upper bound on invocations of that site in this admission unit, not static syntax
count or a parallel-width limit. Different sites can use the same operation.
All selected instances reserve together. Conditional alternatives are summed;
there is no unproved branch-disjointness or phase-maximum optimization.

Every reservation (`work`, `cleanup`, `exit`) has exactly:

```js
{
  handles: [{ namespace: 'http.body', count: 1 }],
  allocations: [{ id: 'encoding', kind: 'fixed', bytes: 64, copies: 2 }],
  records: 1,
  cleanupSteps: 0
}
```

`records` counts additional service metadata beyond automatically counted handle
and allocation-family records. `work.cleanupSteps` must be zero. Cleanup and exit
can reserve handles, backing and metadata while unresolved work remains live.
`exit` is charged once per supplied admission plan. Later units must reuse the
invocation's already-held exit reserve reflected in `occupied`, supplying an empty
new `exit`, or explicitly reserve it for the first time. This requires one
serialized runtime owner, not independent callers.

`fixed` charges `bytes × copies`; both fields are mandatory. `chunked-text` has
`id`, `kind`, `maxBytes` and `chunkBytes` and models the reader below. No callbacks,
arbitrary expressions, dynamic allocation or implicit infinite bounds are accepted.
Identifiers use the lifecycle planner's bounded symbolic alphabet. Records have
exact fields; arrays must be dense data lists; accessors, extra fields, symbols
and custom prototypes reject. This validates trusted metadata, not a JS sandbox.

All quantities are nonnegative safe integers. Selected counts, effects per
operation, handle counts, copies and reader bounds must be positive. Every
intermediate addition/multiplication is checked without truncation, saturation
or wraparound. Smaller runtime machine representations must enforce their own
range before allocation. Invalid input throws `PULSEWASM_RESOURCE_PROFILE_INVALID`;
insufficient valid capacity returns a denied plan listing every shortage. Missing
dimensions are invalid, never unlimited or zero.

For every dimension:

`required = Σ count × (work + cleanup) + exit`

`total = occupied + required`

Output is copied, deeply frozen JSON data: sorted selections and allocation
families, work/cleanup/exit partitions, namespace totals, exclusions, totals and
all shortages. Admission requires every dimension to fit. The planner never
mutates counters, partially admits a cohort or performs acquisition.
`admitted: true` is **not a reservation token**. P04 must atomically authenticate
the invocation, check current capacity/deadline and reserve the whole plan before
P07 dispatches. Otherwise two successful calculations could oversubscribe capacity.

`occupied` includes retained backing, unresolved claims, consumed cumulative
effects and capacity held by earlier cohorts/aliases. Only the runtime owner may
construct it; the planner cannot detect omitted claims. On shortage nothing
acquires. A later dispatch failure stops new business work, preserves the primary
error and spends only protected cleanup under the original remaining deadline.
Reserved steps prove neither remaining time nor safe host operations. Unknown
resources remain charged; there is no cancellation, rollback or refund guarantee.

## Allocation inventory and first derivation

The current Fastly core reader in
[`native-http-effects.js`](../../../packages/provider-fastly/src/build/native-http-effects.js)
allocates a fresh 65,536-byte buffer and four-byte result slot per read, decodes
each successful chunk and concatenates the accumulated UTF-16 string. One-byte
positive reads are possible. A finite payload bound `B` allows at most `B`
positive reads plus one EOF, oversize or failure observation. With chunk capacity
`C`, the conservative cumulative payload-backing model is:

`(C + 4)(B + 1) + 2B + B(B + 1)`

The terms are read buffers/result slots, decoded chunks and copied UTF-16 prefixes.
No reclamation is assumed. Invalid/oversize reads stop before decoding, but their
buffer/slot must still be reserved. This model assumes ABI-conforming returned
lengths and at least one byte of progress on every continuing read; the provider
must enforce/qualify those preconditions.

At `B = C = 65,536`, the model requires **8,590,458,884 bytes for one body's
cumulative backing allowance**, before request encoding or other overhead. This
is not measured peak memory, RSS or a production limit. Copying the research's
small allowance would be wrong. Tests enumerate every small positive read
partition against an independent allocation oracle, including terminal allocation.

P07 should bring a bounded allocation strategy for review. For example, one
`B + 1` byte input buffer and at most `2B` decoded bytes can be expressed as two
fixed allocations; it remains a proposal until implemented and qualified. P11A
must use the **same reader and ownership behavior** in accounting-on/off controls,
so reader savings are not misreported as accounting cost. No width-8 cap or new
memory default is chosen to conceal the existing strategy's cost.

Additional inputs cannot be inferred from a body bound:

- Request URL/method/header/body encodings, projection buffers, metadata and
  repeated reads need bounds from the compiler/provider owner.
- Core fetch can hold request, request-body, pending, response and response-body
  claims. Reserve outputs before the ABI call, including overlap with fenced
  inputs. Consumption-on-error assumptions cannot reduce this envelope.
- Opaque forwarding avoids decoding but retains handles and alias/transfer
  claims; it needs a separate qualified profile.
- Node fetch has a different host allocation/stream strategy and cannot inherit
  the Fastly formula. Cache profiles depend on P08's operation/failure contract.

The heterogeneous test profiles use small synthetic payloads and cleanup scratch
to prove arithmetic/denial, not production fetch/cache admission. No complete
provider profile or compiler reachability proof is claimed.

## Budget reconciliation and exclusions

| Existing owner | P05/P04/P07 rule |
| --- | --- |
| Canonical invocation policy and driver `maxEffects` (default 1024) | Keep the cumulative execution counter and ticket owner. Map profile effects to that counter; child counts require P06 proof. |
| `CANONICAL_NATIVE_READ_LOOP_MEMORY`: 64 MiB logical charge, 1,048,576 values, 32-byte values, 8-byte edges | Preserve value/edge/retention enforcement. Future unified byte ownership must attribute overlapping backing exactly once without removing the distinct value-count constraint. |
| Node `NativeValueBudget` and Fastly value instrumentation | Preserve cumulative alias/mutation charges, live result roots, latched failures and primary errors. P05 adds no second live budget. |
| Wasm page ceiling (4096 pages for bounded-memory policy), structured-body limits and value-transfer ceiling | Preserve independent physical guest ceiling and per-operation format/size limits. These are not interchangeable with backing allowance. |
| Request budget, fetch timeouts and continuation delivery | Keep original deadline and scheduler. Cleanup capacity supplies neither more time nor host quiescence. |
| Provider handles and Node value heap | Enumerate distinct resource namespaces. Replacing a duplicate counter requires matching lifetimes and enforcement evidence; a heap index is not a host resource handle. |

Every plan excludes allocator metadata, general application values, engine/linear
memory capacity, host/network buffers, ledger storage bytes and response
serialization. Profiles can add exclusions but cannot remove these. An exclusion
is not zero consumption. Records reserve logical slots; P11A/P04 must derive bank
bytes and initialization cost from the chosen layout. This does not bound total
process memory or platform capacity. Existing guards stay until a replacement
preserves their boundary and distinct dimensions on actual runtime paths.

## Evidence and next gate

The maintained `resource-admission` task covers heterogeneous envelopes, five
independent shortages, occupied retained claims, protected reserves, multiplicities
1/8/16/32, strict data validation, overflow, ordering, immutability and the allocation
oracle. `lifecycle-contract-installed` reuses its one real pack/offline install to
replay both contracts outside the checkout and verify their loaded source closure.
No test imports research/evidence code. Exact run identities/results belong in
the PR; no hosted execution or promotion qualification is implied.

P05 completes this shared profile/calculation contract and allocation/budget
record. P11A is next for the ownership-equivalent baseline and cost threshold
review. P04 still requires that work and foundation P10/P13/P14. P07 owns complete
compiler-selected operation profiles and pre-dispatch integration; P06 owns child
graphs, P08 cache contracts and P09B JavaScript RA parity.
