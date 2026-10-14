# MEM9-09C — remaining runtime and accounting proposals

Human direction: “Proceed with 09C.” Base: `codex/mem9-integration` at
`99bdf3e595c2b63e16db924125850d90c97efb3d`, after #355 merged.
Related: #289 and integration PR #349. Classification: architecture;
protected decisions: runtime target realization, effect/continuation ownership,
versioned Native ABI and allocation accounting.

This delivers the **proposal and boundary-evidence phase** specified by
[MEM9-08](../mem9-08/README.md#runtime-and-accounting-boundaries). It does not
enable reclamation on Node, budgeted, stub or linked production paths. The
recorded plan requires separately reviewed extensions before those owners enter
implementation scope. No single Entry Point covers this cross-owner design;
ordinary root, Wasm and documentation instructions apply. Changes are confined
to internal proposals and executable evidence. Production ABI, policy, runtime
selection, limits and generated artifacts remain unchanged.

## Decisions prepared for review

| Proposal | Recommended direction | Review/implementation state |
| --- | --- | --- |
| [C1 — Node roots](node-roots.md) | Versioned complete root snapshots; collect host mappings only at compiler-proven safe points; start unbudgeted and unlinked | Standalone transport prototype qualified; canonical integration and JS-heap/cost qualification pending |
| [C2 — allocation accounting](budget-accounting.md) | A new explicit reclamation contract preserving original cumulative charges, cache semantics and failure order | Cache hazards reproduced; v1 retain-until-terminal remains authoritative |
| [C3 — schema-free Fastly](stub-runtime.md) | Select a reclaiming runtime for audited plans independently of codec presence | Allocator mechanism demonstrated; provider selection and full artifact cost qualification pending |
| [C4 — linked Fastly](linked-runtime.md) | Retain the existing fixed allocator and qualify tracing against foreign-frame ownership and the unchanged 2 MiB layout | Real retained artifact and isolated allocator evidence; collector scratch/foreign-frame qualification pending |

These are separate decisions. C1 does not approve C2, a runtime switch does not
approve linked tracing, and none of these results extends MEM9-09A/B eligibility.
Recommended implementation order is C1, then C3; C2 and C4 retain independent
acceptance gates. Neither #289 nor the integration workstream closes here.

## Source-grounded findings

Node's unbudgeted `ValueHeap` holds JS values in a strong `Map`; it does **not**
use the scalar/identity caches found on its budgeted path. Its containers hold JS
values, not child handle IDs. Removing a child mapping can preserve the actual
child through a live container; copying Fastly's handle-edge walker would be
incorrect. Host traces, contexts and pending effect payloads can independently
retain JS objects after a mapping disappears.

Budgeted Node adds an 8,192-entry rotating scalar index and a non-rotating weak
identity index admitting at most 8,192 objects. Deleting a mapping without fixing
its index produces a stale ID. Clearing the index instead changes future charges.
The measured scalar example changes from 60 bytes/two values to 120 bytes/four
values after delete, clear and reinsertion. Neither operation is a valid fix.

Fastly's schema-free stub runtime does not reclaim physical allocations after
root removal. The linked Fastly runtime is different: it already imports `itcms`
and supplies a coalescing fixed-range allocator. It can reclaim managed objects,
but its retained handle table keeps them reachable and its 2 MiB memory has to
accommodate collector scratch without moving foreign-frame boundaries.

## Executable evidence

`node wasm/test/runtime/mem9-09c-boundaries.cjs` is a standalone development
probe, outside the registered release profiles. It runs current production artifacts and separately labeled
laboratory probes; it never overrides a production ownership gate to enable
collection in an unsupported plan.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Real Node fixed-working-set artifact | Current mapping retention and exact numeric response; issued artifact hash | JS heap/RSS reduction or new Node implementation |
| Standalone Wasm root snapshot import | Bounds, complete fixed-slot snapshots, epoch/stale-ID rejection, atomic publication, aliases/cycles and monotonic re-acquisition; current host/compiler reject the new import | Compiler owner completeness, dynamic state arrays, effects, resources, production cost or installed ABI compatibility |
| Actual `ValueHeap`/`NativeValueBudget` probes | Stale scalar/object cache IDs, recharging after invalidation, cache rotation and latched failure | Permission to change the v1 contract |
| Same buffer churn under stub/incremental/fixed allocators | Storage reuse after roots disappear; retained-root exhaustion within fixed memory | Handle-tracing eligibility, foreign guest safety or production CPU/latency |
| Real linked ES256 artifact | Current exclusion survives caller overrides; final no-grow audit, two independently verified signatures and 2 MiB capacity | Tracing in a linked artifact or deployed-provider qualification |

The allocator probe forces GC between calls to isolate the mechanism; it is
explicitly excluded from timing claims. Pointer reuse is not a host-memory metric.
The transport prototype never calls getters, serializers, providers or the guest
while validating and publishing its snapshot. It is not a new public API.

Frozen-source results, owner hashes and terminal validation will be recorded
after qualification. Development construction failures are retained separately.

## Work remaining after this review package

Implement each approved extension in its canonical owners, update current
contracts and compatibility validators, and satisfy its positive/negative,
lifetime and paired cost matrix. Then reconcile `latest`, freeze one clean
integrated candidate and run the complete release/installed/provider selection
required by #349. Historical and prototype passes cannot substitute for that
qualification. Merge, publication and deployment remain human-owned.
