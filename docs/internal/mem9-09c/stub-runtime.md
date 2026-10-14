# C3 — proposed schema-free Fastly runtime selection

Status: proposed realization change; production selection remains unchanged.
Current Fastly compilation uses `incremental` for active schemas and `stub`
otherwise, except for linked artifacts. Node also uses a stub guest without
schemas, but its generic values live in the host JS heap; C1 must not confuse
that guest allocator with Fastly's managed value objects.

The isolated allocator probe drops its previous 4 KiB buffer and calls GC from
a separate host call. After 512 allocations, stub uses 512 distinct buffer
addresses and 4 MiB capacity. Incremental uses four addresses and 64 KiB in this
probe. Retaining every buffer grows the incremental case too. These numbers
establish allocator mechanics only, not a realistic application footprint or
latency improvement.

## Proposed implementation

Decouple `collectorAvailable` from `schemaActive` in the private realization
selection. For an audited, unlinked, unbudgeted canonical Fastly plan, select an
incremental managed runtime and then enable the complete root/checkpoint policy.
Codec presence still controls codec generation and the independently opt-in JSON
arena; do not manufacture a schema or enable a JSON cache just to obtain GC.

Keep explicit exclusions for unknown owners, events, package-owned emitters,
budgeted and linked plans until their own audits pass. The final provider writer
owns selection and rejects a contradictory caller/intermediate policy. Do not
remove roots on a stub artifact and advertise physical reclamation, replace the
stub with a custom unreviewed allocator, recycle IDs, or increase memory limits.

Before choosing this default for eligible plans, build paired production
artifacts from identical source: current stub retained control, incremental
retained control, and incremental traced candidate. This separates runtime cost
from map/tracing cost. Qualify tiny responses, warmed caches, fixed string/field
churn, numeric-region workloads, large legitimately live graphs and helper/effect
lifetimes. Repeat with both arena settings where applicable without inferring
codec enablement from an ignored arena option.

Report startup/artifact size, short/long CPU and wall distributions, managed
bytes after separate diagnostic GC, peak managed allocation, collector scratch
and linear capacity. Preserve exact output/host traces and the original allocation
gate. Forced-GC allocator results cannot replace those production measurements.
The human review decision is whether the qualified private runtime-selection
change is acceptable; this proposal does not flip it.
