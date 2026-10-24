# Resource ownership — investigation 2

Status: **completed internal experiment; no production contract change**.
Date: 2026-10-24. Base: `b421aa58b7df07cc5bcb060248026c660eaf5ae3`
(`hex-integration`). This independent branch follows
[nonterminal investigation #523](https://github.com/pulse-compute/pulse/pull/523),
[authoring shapes](../DESIGN-01-authoring-shapes.md) and
[execution costs](../DESIGN-02-execution-costs.md).

Human direction: “Proceed with investigating Resource Ownership,” without release
pressure. No single named Entry Point covers the cross-owner internal experiment;
the ordinary root/docs instructions apply. Classification: evidence. All writes
are internal evidence. Production compiler, provider and runtime are read-only.
This pass does not implement or approve a public cache package, merge, release,
resource contract, or deferred-child composition.

## Finding

**Bounded resource-owning operations can compose through the existing effect
machinery, but resource disposal is not one generic close operation.**
The compiled prototype starts independent cache operations, waits through the
existing request deadline, consumes bounded bodies, releases known resources,
and resumes the original continuation. Direct await, keyed parallel and bounded
collections all execute for reads and writes. No new scheduler or child-effect
runtime was required for this narrow proof.

Ownership adds substantive policy work beyond immediate observations:

- Commit, abandon, close and transfer must be distinct, with per-resource rules.
- A timeout can reject the result after a write committed.
- A failed consuming call can leave ownership uncertain; retrying disposal may
  double-consume, while doing nothing can leave a resource until host teardown.
- Closing an unfinished cache lookup may block. Bounded request cancellation
  does not automatically imply bounded cleanup.
- A Wasm trap bypasses the guest teardown path. Host instance/request reclamation
  is a separate required guarantee, not something this fixture proves.
- Admitting all pending roots can exhaust the handle budget before a root can
  acquire the additional body it needs to finish.

These are bounded design questions, but not mere naming changes. Successful
execution does not settle the resource-service interface or engine semantics.

## Authored shape and intentional fixture limits

The ephemeral `@hex-spike/cache` facade exposes only two investigation primitives:

```ts
const found = await cache.getText(ctx, 'alpha')
const stored = await cache.putText(ctx, 'alpha', 'payload')

const values = await ctx.parallel({
  a: cache.getText(ctx, 'alpha'),
  b: cache.getText(ctx, 'beta'),
})

const writes = ctx.effects({ max: 4 })
for (const item of inputs) {
  writes.add(cache.putText(ctx, 'alpha', 'payload'))
}
const receipts = await ctx.parallel(writes)
```

Keyed writes and collected reads also execute. The receipt retains every authored
fixture. Input keys and values are literals; repeated collection entries operate
on the same literal key. Dynamic keys are explicitly rejected by this fixture.
It does not prove per-item capture, aliases/shadowing, schema codecs, named logical
cache bindings or the full `cache.get<T>/put<T>` shape from pass 1. Result values
still travel through the generic `json`/Native `unknown` path identified in #523.

Read results are `{ status: 'hit', value: string }` or `{ status: 'miss' }`.
Only usable, non-stale data is accepted; absence/staleness becomes a policy miss.
A read/host failure is an error, not a miss. Write success is
`{ status: 'stored' }` after body finalization. The experiment fixes TTL at
60 seconds, keys/values at 64 bytes, and read text at printable ASCII. These are
small test bounds, not proposed product limits or general text/JSON behavior.
The facade's JavaScript methods throw “not implemented for this host.”

## Ownership transitions

| Resource | Acquire / use | Normal completion | Failure or request termination |
| --- | --- | --- | --- |
| Nontransactional cache lookup | `fastly_cache.lookup`; own returned cache handle; wait for readiness | Inspect state; acquire readable body if usable; close ready cache handle | Check readiness without waiting; close only if ready. Otherwise record unresolved ownership |
| Cache read body | `fastly_cache.get_body`; own returned body; bounded wait/read steps | Copy value, close body, then close lookup before delivering result | Close known-owned reader; attempt cache cleanup even if reader cleanup fails |
| Cache write body | `fastly_cache.insert`; own returned streaming writer; bounded wait/write steps | Explicit body close finalizes write; detach ownership before that consuming call | Abandon incomplete writer. Never substitute successful close as generic cleanup |
| Invocation | Existing effect ticket and static slot | Existing authenticated settlement resumes continuation | Reject foreign/duplicate completion; request close prevents new work |
| Uncertain consumption | Consuming call returns failure | No success result or automatic retry | Record unresolved outcome and stop using that handle; host lifecycle guarantee remains necessary |

Raw handles do not enter authored values. The provider adapter tracks cache/body
ownership per invocation; handle zero is tested as valid and `-1` is the sentinel.
It detaches a handle before a consuming call and retains a separate unresolved
count if consumption cannot be established. **Zero locally owned handles is not
proof of zero host resources.** The independent injected-host ledger records
remaining resources separately and deliberately tests both consumed and retained
failure outcomes.

There are four checked source replacements: completion-setter authority,
authenticated settlement, resource resolution through the existing waiter, and
request-close cleanup. Existing pending modes, request waits, monotonic budget,
invocation tickets and group/collection continuations are reused. These replacements
are generator coupling that a stable service must replace with explicit hooks.

The experiment uses an in-process adapter and restores production module exports
in `finally`. Package contribution source owns the lookup/insert ABI entry points;
the prototype provider service contains the cache-specific read/write state and
disposal logic. This proves the execution seam, **not a finished generic package
resource-service API**. A production design must decide which state transitions
belong to package code and which resource operations belong to provider services.

Shared body imports remain provider-baseline authority. The first exploratory
build rejected attempts to redeclare them as extension imports. The corrected
adapter declares only imports extending that ceiling, leaving existing import
policy checks intact. Future service evidence must attribute shared host authority
as well as newly contributed imports; import-count growth alone understates use.

## What the ABI sources establish

Pinned primary source identities are retained in [upstream.json](upstream.json).
The ABI definitions distinguish normal lookup/insert from collapsing transactions,
define cache and body readiness handles, and distinguish successful body close
from unsuccessful abandonment. The Viceroy implementation's ordinary cache close
awaits the entry task; busy-handle close instead drops the pending operation.
The SDK documentation also distinguishes cancelling a transaction obligation
from closing the transaction itself.

Sources:

- [Cache ABI](https://github.com/fastly/Viceroy/blob/aabb3697e08c30339f93a9bb15bbb46a5028619f/wasm_abi/compute-at-edge-abi/cache.witx),
  [async handle types](https://github.com/fastly/Viceroy/blob/aabb3697e08c30339f93a9bb15bbb46a5028619f/wasm_abi/compute-at-edge-abi/typenames.witx),
  and [body ABI](https://github.com/fastly/Viceroy/blob/aabb3697e08c30339f93a9bb15bbb46a5028619f/wasm_abi/compute-at-edge-abi/compute-at-edge.witx).
- [Viceroy cache implementation](https://github.com/fastly/Viceroy/blob/aabb3697e08c30339f93a9bb15bbb46a5028619f/src/wiggle_abi/cache.rs)
  and [body implementation](https://github.com/fastly/Viceroy/blob/aabb3697e08c30339f93a9bb15bbb46a5028619f/src/wiggle_abi/body_impl.rs).
- [Fastly Go core cache SDK](https://github.com/fastly/compute-sdk-go/blob/d6bf71b04516ed72d6018cab6fff701a865f86e5/cache/core/core.go).

The transaction busy-wait transition also deserves independent qualification:
the inspected adapter consumes a pending entry, while the wiggle compatibility
implementation leaves a stub and returns a distinct entry. This pass deliberately
uses nontransactional lookup/insert; it does not generalize one busy-handle
cleanup rule across these implementations. It also does not use the transactional
API merely to acquire a convenient cancellation primitive, since that would
change request-collapsing semantics.

These are source findings, not a run of Viceroy or a hosted Fastly acceptance
receipt. Injected failure outcomes intentionally explore ambiguity; they are not
assertions that a particular platform exhibits both outcomes.

## Cancellation, errors and group behavior

Successful operation cleanup completes before result delivery. Failure cleanup
runs from the existing request-close path, which may occur after the error
response has been sent. Secondary disposal errors therefore need their own
evidence channel; they cannot reliably be converted into a different response.
The prototype counters preserve them and leave the original failure primary.

The tested plain-handler path treats provider failures as hard failures. All
roots in a keyed group start before resolution; a failure stops subsequent
resolution and teardown retires the already-admitted resources it can safely
retire. The tests show both an earlier write retained after its sibling fails,
and two admitted writers abandoned when the first write fails. This does not
change or qualify Router recoverable-error settlement. It does not establish
atomicity or rollback: insertion can expose a stream before finalization, and
abandonment may leave concurrent readers seeing an incomplete body.

Expiry before writer finalization abandons it. Expiry immediately after successful
finalization yields a timeout while the host ledger still records the committed
write. A failed finalization is attempted once: either the host consumed the
writer or it did not, and the guest reports uncertainty in both injected cases.

For an expired, unready ordinary lookup, the prototype avoids a possibly blocking
close, records one unresolved resource, and makes no successful-cleanup claim.
A trap leaves the guest registry and two host resources intact because guest
teardown never runs. A deployable contract must require verified host reclamation,
provide a bounded cancellation path, or reject that resource family. Declarations
alone cannot create the missing lifecycle guarantee.

## Limits and reservation pressure

The experiment caps live owned handles at 8, read calls at 10 per root, write
calls at 4 per root, and bytes at 64 per value. Existing request deadlines and
the cumulative invocation limit remain active. These local limits do not measure
runtime allocation or bound all host memory, pending tasks or previously
materialized results.

A read has two different demands: one pending lookup handle, then a second body
handle during consumption. Admission checks current usage rather than reserving
the worst-case demand:

- Seven concurrent reads can progress with a peak of eight handles.
- Eight admitted lookups fill the limit, then the first body acquisition is
  rejected before its host call. Cleanup retires the ready lookups.
- A ninth lookup is rejected before acquisition, with a peak of eight.

This is useful pressure on the contract. Reserving each root's maximum demand
would reject earlier and avoid this completion-stage failure, but reduces
concurrency when many lookups miss. Incremental admission uses capacity more
fully but allows failure after host work has started. A batch-wide reservation,
a reserved progress slot, or an explicit admission policy should be evaluated;
this spike does not silently alter `ctx.parallel` to schedule around the limit.

The existing driver waits for effects in slot order, including bounded body
consumption. Independent roots start together, but a later ready root can wait
behind an earlier one. This is reuse of the existing execution strategy, not a
new fairness or throughput guarantee. It leaves the separate child-composition
question open.

## Measured artifacts and evidence

All builds use the same 1,000 ms request-budget setting. The baseline returns
text; used artifacts include different authored work and result materialization,
so deltas are not isolated service costs. Test exports remain in instrumented
artifacts; the plain read separately measures their small contribution.

| Fixture | Slots | Wasm bytes | Delta from baseline |
| --- | ---: | ---: | ---: |
| baseline | 0 | 24,457 | +0 |
| absent | 0 | 24,457 | +0 |
| unused | 0 | 24,457 | +0 |
| read | 1 | 27,654 | +3,197 |
| read-plain | 1 | 27,444 | +2,987 |
| write | 1 | 27,264 | +2,807 |
| keyed-read | 2 | 28,184 | +3,727 |
| keyed-write | 2 | 27,863 | +3,406 |
| collection-getText-2-4 | 4 | 29,038 | +4,581 |
| collection-putText-2-4 | 4 | 28,650 | +4,193 |
| collection-getText-0-4 | 4 | 28,877 | +4,420 |
| collection-getText-7-8 | 8 | 30,069 | +5,612 |
| collection-getText-8-8 | 8 | 30,084 | +5,627 |
| collection-getText-9-16 | 16 | 31,988 | +7,531 |
| mixed-time | 2 | 29,120 | +4,663 |

Absent adapter output is byte-identical to production baseline. Imported-unused
output has equal size and no cache imports. The embedded plan identity can change;
no whole-artifact identity or runtime-speed claim is made for an unused import.

[receipt.json](receipt.json) retains terminal status, source/input hashes, all
cases and host traces. The final run completed **44/44 checks**. The selection covers the three forms, partial I/O,
freshness miss, byte/step/handle bounds, acquisition/read/write/disposal failure,
partial commit, deadlines, completion authority and trap limitations. Cases
expecting unresolved resources pass only when that uncertainty is recorded;
“all checks passed” does not mean every resource was reclaimed.

Capability-binding sidecar rows identify cache read/write, contribution and use
site, target, source, continuation and resource kinds. They explicitly say
`standardPulseReport: false` and do not invent a named store. Static rows record
selected authority; test traces separately record runtime acquisitions, disposals,
commits and unresolved resources. Runtime keys and content in these traces are
synthetic fixture data, not a proposed production reporting payload.

The normal report's repeated-use-site limitation from #523, typed result layout,
logical binding identity, schema/version policy and service implementation
identity remain open. A production report should distinguish selected capability,
owned resource family, terminal disposition and unknown outcome without exposing
sensitive values or treating host handles as stable identities.

Reproduce with the existing repository toolchain:

```sh
node docs/internal/host-extensions/ownership/run.cjs /tmp/hex-resource-ownership-new
```

Use a fresh output directory. [evidence-index.json](evidence-index.json) indexes
retained script snapshots, receipts, exploratory failures, logs and compressed
Wasm/generated-source/plan/manifest artifacts. [validation.json](validation.json)
records repository checks and unrun lanes. The script is not a new release gate.

Not qualified here: real cache persistence/concurrency, Viceroy or hosted behavior,
JavaScript parity, schema codecs, dynamic captures, named bindings, fetch mixing,
Router recovery, terminal GRIP coexistence, request collapsing, streaming cache
results exposed to authors, external installed consumers, or complete regressions.
No production source or supported package surface changed.

## Recommended next decision

Keep operation values separate from resource handles in the DSL. Treat ownership
as a provider-mediated lifecycle with explicit typed resource actions, bounds and
outcomes. Preserve the existing effect ticket and continuation boundary.

Before implementing that contract, resolve three points:

1. Which package/provider service interface can express these phases without
   teaching the provider every package operation or duplicating its scheduler?
2. Which resource families have bounded disposal, which require verified host
   reclamation, and how are uncertain outcomes recorded?
3. Is resource capacity reserved at root admission or admitted incrementally,
   and what partial-work behavior should authors be able to rely on?

The separate bounded-composition spike can then examine child effects and loader
captures. Nothing here authorizes that implementation or forces the unresolved
ownership choices to be settled before their evidence is available.
