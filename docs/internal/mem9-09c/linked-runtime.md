# C4 — proposed linked Fastly tracing

Status: proposed extension; linked production artifacts retain their existing
handle behavior. This is not the stub-runtime proposal. Fastly's existing
`fixed-memory-runtime.as.ts` imports AssemblyScript `itcms`, reclaims and coalesces
blocks, and invokes collection before reporting exhaustion. It emits no growth
operation and uses the existing primary heap range.

| Region | Current byte interval |
| --- | --- |
| Rust stack | [0, 65,536) |
| Stack/static guard | [65,536, 131,072) |
| Rust static data | [131,072, 262,144) |
| Primary static data | [262,144, 524,288) |
| Invocation frame | [524,288, 540,928) |
| Primary dynamic heap | [540,928, 2,097,152) |

The isolated fixed-allocator probe reuses two buffer addresses across 512
released-buffer iterations, staying at 2 MiB. Retaining every 4 KiB buffer traps
after 373 completed allocations. That proves the allocator can reclaim storage
after roots disappear, and that retained roots can still exhaust it. It does not
prove a traced foreign-call lifetime or enough scratch for a survivor map.

## Proposed implementation

Keep the existing allocator, memory identity, page count and region boundaries.
Audit each selected guest's declared frame contract and provenance before
allowing the ordinary traced handle table in the primary module. Start with the
existing first-party crypto guest only; an unknown guest unit declines tracing.
The current final writer must continue overriding caller attempts to force the
private policy until this extension passes review and qualification.

The frame contains offsets, lengths, status and copied crypto bytes, not Pulse
value handles or arbitrary AssemblyScript references. Preserve synchronous
call/return ordering and existing copy/wipe operations. No handle checkpoint
may run during foreign execution, between a borrowed pointer and its consumer,
or while constructing/settling an effect. A future guest with callbacks,
reentrancy or escaping primary pointers requires a new owner contract.

Audit managed primary references that survive any allocator-triggered GC while
building trace worklists and the survivor map. Old and new maps coexist until
publication; allocate work state in registered managed roots. Measure fragmentation,
coalescing and old/new map peak within the unchanged dynamic heap. If the existing
survivor-map algorithm cannot fit, stop for a separately reviewed collector
strategy; do not silently resize the fixed memory or sweep partially on failure.

## Qualification

The current real linked ES256 artifact is a retained baseline: two independently
verified signatures, ordinary provider ABI execution, final-artifact audit and
2 MiB capacity. Caller options cannot bypass its `linked-runtime` exclusion.
It does not enable or qualify tracing.

A future candidate must run repeated ES256/RS256 signing and verification,
helpers/stages, schema-linked feasibility cells, exact response/digest checks,
malformed/truncated frames, aborts and recovery, cancellation and late results,
foreign-owned sentinel preservation and header/body resource handoff. Rebuild
and audit the exact final linked artifact for regions, imports, features,
memory identity, no growth and package provenance. Source reproduction needs
the pinned Rust toolchain; installed and Viceroy/deployed lanes remain explicit.

Measure long fixed-working-set retention through the point where the retained
control exhausts, plus legitimately live graphs approaching capacity. Compare
short/long production cost and peak tracing scratch; isolated forced-GC probes
cannot provide either. Node's linked crypto ownership and guest runtime are a
separate realization, not an implication of Fastly results. Budgeted linked
activation additionally depends on C2's contract decision.
