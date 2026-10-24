# Bounded composition investigation

Status: investigation complete; 47/47 checks passed; no supported API or production changes.
Base: `fccb92a437847e96c81b91be79ba07a1413c3f11` (`hex-integration`, #524).
Human direction: proceed with the bounded composition spike, with no new scheduler.
No single named Entry Point covers this cross-owner internal experiment. Ordinary
root/docs instructions apply. Writes are confined to internal evidence; compiler,
runtime, provider, and public contracts remain read-only.

## Question and scope

Can a package expose one operation that conditionally starts managed child work,
while the existing executor owns dispatch, deadlines, completion and cleanup?
The executable case is a fixed cache lookup → fetch text → cache insert recipe.
A fresh hit skips the last two children. A proven miss selects the declared
loader; a cache failure never becomes a miss. This is intentional conditional
work, not recovery from an error.

The experimental spelling is deliberately narrower than the proposed DSL:

```ts
const value = await cache.getOrSetText(ctx, 'alpha', 'https://origin.example/value')

const values = await ctx.parallel({
  first: cache.getOrSetText(ctx, 'alpha', 'https://origin.example/value'),
  second: cache.getOrSetText(ctx, 'beta', 'https://origin.example/other'),
})

const effects = ctx.effects({ max: 4 })
for (const item of inputs) {
  effects.add(cache.getOrSetText(ctx, 'alpha', 'https://origin.example/value'))
}
const results = await ctx.parallel(effects)
```

The collection intentionally repeats literal inputs. It does not qualify captures
from `item`, dynamic URLs/keys, schemas, named loaders, or callback recognition.
An inline callback and a nested compound loader are explicitly rejected. These
are fixture limits, not recommended final API choices. The existing `ctx.call`
contract is unchanged.

## Execution approach

The fixture compiles the parent expression using the real trusted package
lowerer path and the real Native compiler. A separate investigation adapter
expands each parent into three reserved child sites. A real canonical fetch
compilation supplies the core fetch descriptor; the adapter binds its literal
URL and preserves provider backend admission. The expanded artifact is marked
noncanonical and has a separate plan hash. Both input and expanded plans are
retained: the compiler did not itself prove this child graph.

The recipe is acyclic, depth one, with at most one active child per parent.
The three child slots are reserved statically; skipped children consume storage
but do not acquire tickets or perform host work. Parent and child invocations
all charge the existing cumulative effect budget. A hit uses two invocations;
a successful miss uses four. No stage gets a new request deadline.

The driver still owns the only execution loop. Children enter the ordinary
`host_effect_begin`, use existing per-site tickets and pending tables, resolve
through existing dispatch, and settle through the authenticated completion path.
Cache primitives reuse the ownership spike; fetch uses the production fetch
implementation. No package-owned queue, recursive executor, timer loop, worker,
Promise runtime, or independent polling system is introduced.

The driver nevertheless needs changes; “no new scheduler” is not “no execution
contract work”:

1. A parent waiting on a child is not itself a ready host handle.
2. A driver pass snapshots the admission counter. Children admitted during that
   pass are resolved on the next pass, allowing sibling misses to send their
   fetches before waiting on either fetch.
3. Already-settled slots must be skipped on later passes.
4. Application resumption waits for the existing readiness predicate. A stalled
   pass fails explicitly instead of spinning.
5. Child completion validates the parent ticket and expected phase, then either
   starts the next declared child or makes the parent ready.

These bridges use exact source anchors in the investigation adapter. They are
not a supported provider service interface. Production adoption would require
structural emitter/service seams instead of source-string patching.

The existing slot-ordered blocking waits remain. The proof shows overlap of
independent dispatch, not fairness or readiness-ordered scheduling. It does not
support a child that depends on progress of another pending sibling. Cache
transactions/request collapsing and arbitrary child fan-out are excluded.

## Failure and resource meaning

Introducing fetch selects the provider's existing failed-group settlement path,
even for a plain handler. The experiment extends that path across driver passes;
it does not replace it with the simpler ownership-only loop.

The experimental failure policy preserves already-admitted work for settlement
or cleanup, but suppresses new child stages once a group failure is known.
That is a proposed composition rule requiring explicit review, not an assertion
that existing contracts already specify conditional-child behavior. A successful
write before a sibling fails remains committed. Cleanup never substitutes a
successful parent value or retries a failed write/consuming disposal.

The separate host ledger matters. The cache ownership counter excludes resources
managed by core fetch. Successful text fetches in this fixture retain response
and body handles until host teardown. Consequently zero owned cache handles is
not complete cleanup and the eight-handle cache cap is not a request-wide
resource bound. A deployable cross-capability contract needs either shared
accounting/disposition or explicitly composed guarantees for each child service.
The eight-miss collection reaches 24 live handles in the injected host ledger
and returns with 16 fetch response/body handles remaining, while the cache ledger
peaks at eight and returns to zero. A standalone core fetch control retains the
same two handle kinds. These are observed guest-disposal results, not claims about
host reclamation or physical memory consumption.

All original ownership qualifications remain: failed consumption can be unknown;
cache cleanup may not wait after deadline; a trap bypasses guest cleanup; and an
error after commit cannot promise rollback. Host reclamation is unqualified.

The eight live cache handles, 64-byte cache values and bounded read/write steps
come from the previous test adapter. They are deliberately small pressure tools,
not measured Fastly limits or proposed developer tuning requirements. Collection
capacity is authored; the child layout is derived from that capacity and recipe.
This spike does not solve a general resource reservation policy.

## ESP32 contract pressure, without a hardware implementation

Consider a hypothetical operation that owns an exclusive bus lease and a buffer
while a transfer is in flight, then performs a dependent transfer. This is a
design counterexample, not a claim about any particular ESP-IDF API or board.

| Contract question | Cache proof | Hardware pressure |
| --- | --- | --- |
| Parent identity | One root awaits declared children | Lease and buffer must remain attributed to the same root |
| Bounded work | Fixed graph, one active child | A fixed transfer sequence can fit; interrupt-driven progress needs separate qualification |
| Exclusive access | No lock held across children | Conflicting acquisition should reject explicitly unless a sharing policy is declared |
| Ownership transfer | Lookup released before loader | A buffer may need to remain owned across child stages; this proof does not implement that transfer |
| Cancellation | Stop new children; safe cleanup only | A deadline cannot justify freeing memory while hardware may still access it |
| Cleanup uncertainty | Report unresolved disposal | Require a proven quiescence/host-lifecycle guarantee or reject the operation |
| Dependencies | Independent siblings only | A child waiting for a sibling that needs its retained lease is an invalid dependency, not something to fix by hidden scheduling |

The transferable investment is authenticated child execution plus explicit
resource lifetimes and disposition. Counting opaque handles is insufficient:
exclusivity, byte capacity, and continued external access are different facts.
Package descriptors should express those needs; users should not have to tune
three internal child-slot counts for every top-level call.

This lens supports continuing contract design if the shared mechanism stays
small. It does not establish ESP32 viability, ABI support, ISR safety, DMA
correctness, or real-time behavior.

## Evidence and remaining decisions

All 47 final checks passed, including hit/miss selection in all three forms,
overlapping loader dispatch, an ordinary core sibling, inherited handle pressure,
cache/loader/insert failure, draining admitted children, suppression of follow-on
work, partial commit, deadlines, cumulative budget exhaustion, raw-result fences,
wrong tickets, repeated phases, closure and traps. Explicitly rejected callback,
nested-loader and unbound-backend cases are passing negative tests.

Actual optimized Wasm sizes (same 1,000 ms request configuration):

| Artifact | Root capacity | Total reserved effect sites | Bytes |
| --- | ---: | ---: | ---: |
| Plain text baseline / absent / imported-unused | 0 | 0 | 24,457 |
| Cache read primitive, no test exports | 1 | 1 | 27,444 |
| Core fetch control, no test exports | 1 | 1 | 34,804 |
| Compound direct, no test exports | 1 | 4 | 39,165 |
| Compound direct, test exports | 1 | 4 | 39,490 |
| Two keyed parents, test exports | 2 | 8 | 40,648 |
| Collection: zero items, capacity four | 4 | 16 | 42,436 |
| Collection: two items, capacity four | 4 | 16 | 42,607 |
| Collection: two items, capacity eight | 8 | 32 | 45,574 |
| Collection: eight items, capacity eight | 8 | 32 | 45,664 |
| Compound parent plus ordinary clock sibling | 2 | 5 | 40,701 |

Absent output is byte-identical to the production baseline. Imported-unused adds
zero bytes and no cache imports; its source/plan identity can differ. Primitive-only
generation contains none of the composition-driver bridges. The uninstrumented
compound adds 14,708 bytes versus the plain response and 4,361 versus the fetch
control, but those comparisons include different authored work, cache code and
result materialization; neither isolates composition machinery. Test exports add
325 bytes to the direct case. Increasing capacity four to eight for the same two
items adds 2,967 bytes. Static reservation costs remain even for an empty collection.
No latency, RSS, allocation or hardware benchmark was performed.

The receipt records executable checks, artifact sizes, source identities, host
traces and candidate capability-binding rows. Child rows retain parent identity,
phase, conditionality and backend demand. They are **proposed evidence**, not
standard `pulse report` integration. A possible loader capability remains in the
static artifact even when one runtime request hits cache and skips that loader.
Static capability demand and runtime execution must remain separate facts.

The synthetic child descriptors are prototypes, not a complete portable child
plan: the runtime bridge supplies parent-key and loader-result inputs. Exact
child capture/result typing, lexical source spans, canonical graph validation,
plan/report schema integration and semantic comparison remain contract work.
The host-contribution carrier also requires nonempty ABI declarations, so the
parent repeats its lookup demand; a future composition descriptor should express
child dependencies directly rather than pretend to be another ABI contribution.

Remaining choices before implementation:

- Define a small child-plan contract with exact capability, capture, result,
  parent identity and resource requirements. Reject cycles and unsupported depth.
- Specify failure admission and cleanup dispositions, including what a sibling
  failure does to children not yet started.
- Unify or explicitly compose resource accounting across package and core effects.
- Decide reservation rules from resource demand, with explicit rejection and
  useful defaults rather than silently changing concurrency.
- Replace experimental source bridges with bounded, testable provider hooks.
- Qualify the intended DSL in all three forms, JavaScript behavior or explicit
  target rejection, report bindings, and real host lifecycle guarantees.

This investigation does not authorize those production changes or the next
workstream. No real engine/host test, JavaScript parity, Router recovery,
transaction coordination, terminal GRIP composition, packed-package qualification,
full regression run, latency benchmark or memory benchmark is claimed.

Evidence files: [receipt](receipt.json), [archive index](evidence-index.json),
[retained artifacts](artifacts.tar.gz), and [repository validation](validation.json).
The archive includes the final build inputs/artifacts and prior attempts: the
initial nonempty-import carrier rejection, the failed simple-driver anchor after
fetch selected failed-group settlement, an incomplete injected WASI host, and the
earlier 45-check passing run. Those attempts are retained rather than presented
as a single uninterrupted success.

## Reproduction and source owners

With the repository's lockfile-pinned dependencies available:

```sh
node docs/internal/host-extensions/composition/run.cjs /tmp/hex-bounded-composition
```

The harness writes authored source, canonical and expanded plans, generated
AssemblyScript, actual Wasm, manifests and a terminal receipt. Its assertions
include expected failures; a passed check does not imply that its operation
succeeded. The injected host is an independent ledger, not Fastly acceptance.

- [Design cost analysis](../DESIGN-02-execution-costs.md)
- [Ownership investigation](../ownership/README.md)
- [Prototype adapter](prototype.cjs), [fixed recipe](service.as.ts),
  [fixture](fixture.cjs), [host](host.cjs), [runner](run.cjs)
- [Provider dispatch and driver](../../../../packages/provider-fastly/src/build/native-platform-capabilities.js)
- [Failed-group settlement](../../../../packages/provider-fastly/src/build/native-application-errors.js)
- [Invocation tickets](../../../../packages/provider-fastly/src/build/effect-invocations.js)
- [Request budget](../../../../packages/provider-fastly/src/build/request-budget.js)
- [Native result/readiness support](../../../../wasm/packages/runtime-core-as/src/compiler/canonical-native-support.js)
