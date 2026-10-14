# C1 — proposed Node root transport

Status: proposed architecture; no production enablement. Owners are
`canonical-native-runtime.js` in contracts, the canonical support/control
emitters, the Native compiler's final-ABI validator, and
`canonical-native-host.js`. The Node provider must select the realization
explicitly; portable and Fastly output must not accidentally inherit it.

## Proposed contract

Add a separately versioned `pulse_handle_roots_v1` import namespace, with a
complete-snapshot checkpoint, an extension-version export and a descriptor hash
bound to the emitted artifact. Keep the current base ABI distinguishable.
New artifacts must fail on old hosts through normal import validation; new
hosts must continue accepting old artifacts with retained lifetime. Unknown
versions, mismatched descriptors or missing owners reject compilation/admission.
Do not overload a scalar import, infer roots by scanning memory, or expose an
application flag. Any compiler/host version changes accompany implementation.

The proposed fixed-root call is
`checkpoint(pointer: i32, count: i32, epoch: i32) -> i32`. The pointer addresses
an aligned little-endian array of positive value IDs; zero represents an empty
slot. Snapshot slots come from the same structures that declare guest globals.
The laboratory module implements three fixed slots only. It is intentionally
not a replacement for a generated canonical program.

Production must additionally encode every dynamic owner, including both request
state arrays, in a descriptor-declared section with an explicit length. Every
declared section must occur exactly once; lengths and the aggregate byte range
must be validated before reading. A reused buffer's unused capacity is not part
of the snapshot. Buffer growth must occur before the safe point with all prior
owners intact. Descriptor validation and compiler proofs establish completeness;
a host bounds check alone cannot detect an omitted live guest value.

The host validates the complete snapshot before publication: version, exact
fixed-slot/section shape, alignment, range without overflow, positive increasing
epoch and membership of every nonzero ID. A bad snapshot latches a terminal
invariant error, preserves the existing map and original prior failure, and
cannot partially sweep or later recover. Epoch and handle-ID exhaustion fail
before signed-i32 wrap. IDs are never reused. Allocation failures cannot publish
an incomplete survivor map. The implementation must assign stable diagnostics
and classify them through the ordinary host/guest failure path; the laboratory
assertions are not proposed production error handling.

## Owners and safe points

| Owner | Rule |
| --- | --- |
| Locals, helper return, effect results, terminal result | Root every declared slot independently of ready flags or completion status |
| Request state | Include both dynamic arrays; replacement does not release aliases |
| Host pending payloads and prepared results | Actual JS references survive; register any integer handle held across reentry explicitly |
| Result settlement | `put(result)` and guest acceptance remain one no-collection transfer; retain a temporary host pin if implementation introduces any intervening checkpoint |
| Request context, tracing and redaction | Preserve existing JS references; do not clear them to improve a handle count |
| Opaque resources | Preserve invocation-lifetime wrappers and existing disposal; collection adds no destructor |
| Schema host-to-guest reentry | No checkpoint inside codecs or between managed input pinning and unpinning |

Reuse the reviewed complete-expression, loop-control and transferred-effect safe
points. Pure helpers defer to the outer caller expression. No collection inside
host imports, payload construction, dispatch, resolution, authenticated settlement
or foreign calls. Reject reentrant collection and incomplete owner descriptors.
Start with unlinked, unbudgeted HTTP plans whose owner families are audited;
events, package-owned emitters and unknown capabilities remain excluded.

Node containers hold actual JS values. Retaining a root object retains its JS
graph through ordinary JS GC, even if a child's old handle mapping is removed.
Property access may issue a new monotonically increasing ID; object identity is
still the underlying JS object. The unbudgeted heap has no scalar/identity index
to invalidate. Budgeted caching is a different proposal, C2. Avoid walking JS
properties in the collector: accessors/proxies could execute code and a graph
walk is unnecessary for this representation.

Use demand-driven checkpoints rather than rebuilding a map after every emitted
safe point. The host must communicate scheduling without hiding a new operation
in an existing import. Qualify a versioned `checkpoint_due` query or an equivalent
explicit handshake before adding it to the extension. The prototype forces every
snapshot and supplies no scheduling or performance evidence.

## Required implementation qualification

Run real generated artifacts against retained controls, including dynamic root
sections, caller operands, pure/async helpers, stage resets, Router recovery,
out-of-order siblings, ready-flag clearing, cancellation, late/duplicate results,
opaque wrappers and terminal encoding. Mutate each descriptor owner to prove
rejection. Check old/new host-artifact combinations, import signatures, version
and descriptor mismatches, missing roots, invalid IDs, overflow, failed snapshot
publication and JS-GC timing. Check local reset and intentionally retained graphs.

Measure live mapping count and JS weak reachability separately from retained
trace/context objects, guest linear capacity and process RSS. Pair short/long
production CPU/wall runs; exclude forced GC and diagnostics. Bound snapshot and
survivor-map scratch by live owners plus between-checkpoint allocations. The
current standalone prototype does not satisfy this implementation exit gate.
