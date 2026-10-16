# C2 — proposed allocation accounting extension

Status: proposed contract change. The current
`pulse.native-read-loop-memory.v1` explicitly requires execution-wide
`retain-until-terminal`; MEM9-07 precharged numeric boxes did not authorize
general reclamation. This PR keeps v1 and all existing limits intact.

Owners: `canonical-native-runtime.js`, `native-value-budget.js` in the Node host
and Fastly provider, `ValueHeap`, Fastly cache/value emission, and output/body
transform accounting. Trace records, sparse array capacity, object edges and
lazy rope flattening are charged owners too. Allocation budgets are distinct
from request-duration and fetch deadlines, which 09B already supports.

## Proposed v2 decision

Separate **cumulative logical allocation charges** from physical reachability.
A versioned contract could permit safe-point reclamation while preserving the
original charge at every application allocation, read, write and cache admission.
No refund, per-iteration reset, higher limit, changed cache capacity or reordered
failed operation is allowed. Existing artifacts continue to use v1 behavior.
Review this semantic change explicitly before implementing a v2 selector.

Node's budgeted scalar cache rotates at 8,192 entries. Its weak identity cache
admits at most 8,192 objects and does not rotate. Deleting `heap.values[id]`
alone leaves either cache returning a nonexistent ID. Clearing a cache entry
instead causes another value/index charge and can move the rejection boundary.
The executable probe demonstrates both failures against the actual classes.

Proposed preservation strategy: pin every currently cached scalar ID and every
admitted identity ID. Add an enumerable identity-owner index alongside the weak
index, with the same 8,192 admissions; do not reset `identityCount` or admit a
replacement after collection. Scalar eviction removes only that index's pin;
other owners still keep the value live. This retains at most the cache's existing
admitted objects, which v1's strong heap already retains. Account for the new
index's physical storage separately and qualify its cost; do not silently charge
it as an extra application allocation. A weak cache by itself is not a complete
root descriptor.

`NativeValueBudget.objects` remains a weak historical seen-set for graph charging.
It is not a root set, cannot enumerate owners, and must not be cleared by a
collection. Preserve charge-before-write ordering for arrays, keys and values;
preserve cached-read checks against a latched failure. Host trace retention stays
charged and may remain the dominant physical owner even after handle removal.

Fastly needs the same semantic separation in its own representation. All resident
singleton/integer/character/literal caches remain roots. General map insertion
must retain the original put charge; MEM9-07's already-charged numeric materialization
path remains explicit and cannot become a generic bypass. Existing array-based
instrumentation must be adapted in its canonical owner, with emitted-source
coverage and exact counter comparison, before selecting a sparse table on a
budgeted plan.

Collector work is runtime bookkeeping, not an application allocation operation.
A v2 contract must state that distinction and still bound its physical scratch
within the existing memory limit. It must not allocate arbitrary uncharged
scratch or exhaust physical memory earlier without reporting that tradeoff.
No claim of exact failure parity is valid until both application counters and
collector peak memory have been measured near the existing limits.

## Qualification and release boundary

Require a matched retained control at every allocation boundary: exact bytes,
values, original error code/stage, rejected operation, cancellation and invocation
cleanup. Include cache hits, full-cache rotation, uncached objects, identity-cache
saturation, shared/cyclic graphs, sparse growth, ropes, schemas, effect payloads,
ready results, output buffers and body transforms. Sweep limits just below/at/above
the first failure; verify cached access cannot revive a failed execution.

Qualify Node and Fastly independently, including schema-free/incremental and
linked variants only when their allocator proposals are separately accepted.
Retain all existing maxima and charge order. Run positive lifetime and paired
cost evidence without diagnostic GC in timing samples. The current tests prove
why naive reclamation is invalid; they do not prove a v2 implementation or
authorize changing the v1 contract.
