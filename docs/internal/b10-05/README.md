# B10-05 — bounded dynamic effect collections

Issue [#378](https://github.com/pulse-compute/pulse/issues/378), target `latest`.
Scope investigation and executable seam proof, October 18, 2026. Baseline
`7c2d9a69234ec8404d260253be4ffcbe2c58c2ad` includes the CI round. This document
is a proposed contract for #379, **not current public API documentation**.
No production runtime, compiler, provider, manifest or type export is changed.

**Result:** 21 executable proof cases passed on Node 24.18.0. The Native module
is 5,271 bytes and imports only `pulse_host`. Existing `api-surface`,
`javascript-effect-adapter`, `continuation-registry`, `canonical-api-lowering`
and `canonical-api-runtime` tasks passed, as did maintainer/documentation
synchronization and checks plus documentation-release validation. These are
focused investigation results, not full release or installed-provider acceptance.

## Recommendation

Keep the illustrated `ctx.effects({ max })`, immediate `add`, and explicit
`await ctx.parallel(collection)` shape. Use a homogeneous typed result array,
one collection owner per execution, a literal finite bound and single-use flush.
Reuse the existing effect adapters, all-member settlement, invocation tickets
and continuation scheduler. Add a bounded collection-build region to compiler
IR; do not introduce arbitrary Promise work, callbacks, an async loop scheduler,
implicit flush, or a Native-to-JavaScript fallback.

Proposed authoring (not executable on the current public compiler):

```ts
const input = await ctx.req.json<ProbeInput>('probe.Input')
const effects = ctx.effects<ProbeResult>({ max: 32 })
for (const endpoint of input.endpoints) {
  effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
}
const results = await ctx.parallel(effects)
return ctx.json({ results })
```

The input schema must bound the endpoint array, URL strings and request bytes;
the result schema bounds each decoded response. Generic TypeScript arguments
alone do not supply those runtime bounds. Collection capacity is not a total
response-byte, process-memory or remote-work guarantee. Existing request/body,
effect-count and deadline limits remain in force.

Proposed types, private until #379 implements and qualifies them:

```ts
interface PulseEffects<T> { add(effect: PulseParallelEffect<T>): void }
// On PulseExecutionContext:
effects<T = unknown>(options: { readonly max: number }): PulseEffects<T>
parallel<T>(effects: PulseEffects<T>): PulseEffect<readonly T[]>
```

Keep the existing keyed overload and its mapped result type. `T` is explicit
when useful; an omitted type means `unknown`, not a growing heterogeneous tuple.
An explicit union is possible at the type level, but the first Native source
subset below admits one producer/projection template per collection. Runtime
brands and execution ownership must be private, not structural TypeScript trust.

## Membership and lifecycle

| Concern | Proposed rule |
| --- | --- |
| Capacity | `max` is a positive safe integer, literal 1–32 in portable source. Invalid values fail before collection creation. 32 is a conservative proposed ceiling, not a measured maximum; #379 must prove that boundary. |
| Construction | Creating a collection and adding descriptors dispatch no provider work. Only explicit flush releases the cohort. No global deferred mode. |
| Membership | Only fresh, unstarted, parallel-eligible effects from the same execution. `add` claims the root, including its chosen projection, once. Arbitrary promises, local request-body effects, nested groups, generated-output effects and already claimed/started roots are rejected. Existing provider/package restrictions continue to apply. |
| Admission errors | Invalid membership or capacity overflow poisons the collection and fences its queued roots. No partial flush or silent truncation. Already dispatched work from earlier groups has no rollback guarantee. |
| Snapshot | Evaluate and validate member arguments at construction/add, detach mutable payloads using the existing effect owner, and retain the chosen projection. Later mutation cannot alter dispatched requests. |
| Order | Insertion order defines result indices and stable observation order. Provider completion order may differ. Do not use numeric object keys to implement the public array contract. |
| Empty | Flush once to `[]`, with no external effect, effect-budget charge or native suspension. Still respect an already cancelled/expired execution. |
| Flush | Seal membership synchronously before releasing any member. A second flush or add-after-flush fails. The collection cannot be copied, serialized, exported, stored in state, shared between requests or passed to source helpers. |
| Unflushed return | A nonempty open collection cannot cross handler return or Router transfer; reject and cancel its deferred roots without dispatch. An unused empty collection may be discarded. |
| Budget | Preserve the cumulative 1,024-effect default and host-specific ceiling. Reserve/account each root once, never once per projection or again at flush. Preflight the complete cohort before dispatch. No refunds by clearing/reusing a collection. |
| Lifespan | One open collection at a time in the initial portable subset. A consumed collection cannot reopen. Multiple sequential build/flush regions remain subject to the same cumulative budget and request deadline. |

State transitions: `open → sealed → completed/failed/cancelled`. Admission errors
move `open → failed`; execution termination invalidates all outstanding members.
There is no `clear`, remove, retry, independent member await or partial flush.

Ordinary member failures preserve the current all-settled group behavior: wait
for the cohort, then fail without delivering a partial result array. Select the
first insertion-index failure within the applicable error class. Terminal
request cancellation/deadline/contract failures take priority over recoverable
application failures, following the existing host's classification. Do not
accidentally turn cancellation into an application recovery path. Diagnostic
failure entries should use stable collection/member identities and indices,
with existing redaction; exact cross-target aggregate-error metadata is a #379
parity gate, not established by this proof.

Cancellation before flush dispatches nothing. In flight, propagate the owning
signal, invalidate tickets and prevent continuation/result delivery after
termination. A provider may finish remote work later. Fastly Native has no
pending-request cancel hostcall: retire handles and retain existing bounded
cleanup; do not promise wire cancellation or rollback. Each fetch timeout starts
at its dispatch admission, not when its deferred descriptor was created. The
whole-request monotonic deadline includes collection construction time.

## JavaScript: preserve existing eager effects

`packages/runtime/src/internal/effect-adapter.js` currently registers/counts an
effect, emits its dispatched observation and starts its operation signal before
a `Promise.resolve().then(...)` invokes the provider. Fetch projections share
one root through `context.js`. `parallel` validates roots and performs ordered
`Promise.allSettled`; it does not currently defer construction.

Consequently, wrapping today's promises in an array is insufficient. The proof
explicitly shows a current effect dispatching before any group is called.

The proposed minimal production technique is **immediate root claiming**:

1. Keep the ordinary eager path. Add execution-private queued/started/claimed
   root state shared by all projections.
2. Require portable `add` to receive the inline recognized effect expression.
   It claims the root synchronously, before its existing dispatch microtask.
3. That microtask must respect the claim and wait for the collection's explicit
   release or execution cancellation. A late claim fails; it cannot undo work.
4. Move only claimed roots' dispatch observation and per-operation timer setup
   to actual flush admission. Unclaimed static/direct effects retain their
   current semantics. Reserve the complete cohort before releasing any root.
5. Reuse existing projection, redaction, settlement, cancellation and disposal.

The initial portable build region contains no await/yield, async callback,
arbitrary helper call or escaping effect alias. An already-started promise can
never become deferred retroactively. Runtime checks complement compiler checks;
the mechanism is not a sandbox for arbitrary direct JavaScript.

This technique is a recommendation, **not an implemented or measured claim**.
The proof's JS model stores private descriptors and creates real runtime effects
only at flush. It establishes the semantics and existing dispatch/rejoin path;
it does not prove the root-claim patch, timer relocation or forgotten-collection
integration with Router completion. Those are mandatory #379 acceptance cases.

## Native: bounded build region and active slots

The current frontend accepts a nonempty inline keyed `ctx.parallel` record.
`handler-ir.js` and `handler-ir-managed.js` create fixed members and bindings.
`canonical-native-plan.js` records `effect-group` statements and fixed effect IDs.
`canonical-native-control.js` emits one `effect_begin` for each fixed member and
a literal pending count. `canonical-native-host.js` requires exact equality with
the continuation's fixed effect list. Repeating a slot inside a normal loop is
therefore not a safe implementation of a dynamic collection.

Initial source subset for #379:

- A local `const` collection in one handler, followed by one direct bounded
  `for...of` over an already available bounded array, then one awaited flush.
- One direct `add` per iteration, one recognized producer/projection template,
  static schema/capability identities, dynamic bounded argument values. The
  loop-entry length check rejects values exceeding `max` before any admission;
  it must not turn a long list into an unnoticed prefix. A schema bound alone
  is not an excuse to omit the independent collection check.
- No nested loops/collections, conditional filtering, break/continue, effectful
  helpers, escaping locals, effect awaits in the build region, recursion,
  callbacks, arbitrary array iterables or mutation of the input list. Existing
  bounded sequential read loops are unchanged and do not acquire parallel work.
- Reads producing the endpoint list occur before collection construction.
  Result-array consumption uses already admitted bounded value operations.

Recommended lowering: one versioned collection-build/group IR region with
`max`, producer template, member inputs, active count, result local and source
mapping. Reserve a bounded bank of distinct slots, evaluate/snapshot inputs
without dispatch, then issue exactly the active prefix at flush and suspend
once. Reconstruct exactly that many array entries on resume. Zero bypasses
suspension. Code/metadata growth should be O(max), not a branch per cardinality.

Keep existing single-use invocation tickets and one scheduler. For this new
plan kind only, the managed host validates the active count, allowed unique
slot prefix, ownership and continuation identity instead of accepting arbitrary
dynamic effect IDs. Reject duplicate, missing, out-of-range and stale results.
Do not weaken exact-list validation for existing static groups. Clear slot state
on terminal paths and reuse only across independently authenticated invocations.
Older hosts must reject the new plan/feature requirement rather than silently
executing a different protocol. Whether ABI v2 exports suffice is a #379
implementation check, not permission to avoid plan/host feature versioning.

The executable proof compiles one fixed module with branches for cardinalities
0–4, then supplies endpoint lists at runtime. It uses today's exact static
groups and managed host unchanged. This proves bounded fan-out/rejoin behavior
and existing ticket/cancellation reuse; it does **not** prove the new IR or
dynamic pending-set validation. Its 1+2+3+4 effect expansion is deliberately not
the recommended production implementation.

## Options considered

| Option | Disposition |
| --- | --- |
| Make every Pulse effect globally lazy | Avoid: changes existing eager JavaScript behavior and promise compatibility. |
| Ambient deferred mode from collection creation to flush | Reject: captures unrelated effects and complicates nested/exceptional control flow. |
| Callback/thunk list | Reject for this slice: introduces callback/capture syntax and risks a general async scheduler. |
| Immediate inline root claim + bounded native slot bank | Recommend; preserves static behavior, but requires the explicit implementation gates above. |
| Static group branch for every possible length | Proof vehicle only; quadratic expansion is unsuitable as the production design. |
| One sequential request at a time | Does not satisfy explicit concurrent fan-out. |

## Compatibility and evidence

| Surface | This investigation | Required before a support claim |
| --- | --- | --- |
| JavaScript shared effect runtime | Real fetch/json projection, group and cancellation path exercised with private deferred descriptors | Production collection/root claim, types and direct original-source workflow |
| Canonical Native Wasm + managed host | One compiled module; runtime endpoint lists; existing fixed-group branches | New collection IR, bounded slots and dynamic group validation; max=32 |
| Node JS/Native HTTP provider | No real HTTP transport or installed-package claim in this proof | Installed public workflow, real concurrent local endpoints, failure and cleanup |
| Fastly JS | Shared adapter path relevant; target not independently exercised | Fastly-supported effect matrix and exact JS packaging/runtime acceptance |
| Fastly Native | No provider artifact or Viceroy execution in this proof | Generated slot/handle allocation, pending polling, deadlines and retirement on the real local provider path |
| Event handlers | Shared execution contract is applicable, not tested here | Event-owned lifecycle parity before claiming collection support there |

Provider support remains the intersection of the existing effect, projection,
schema, host and target contracts. Collections cannot make an unsupported
conditional-KV or package cell supported. Preserve composed schema/error-wrapper
fixtures such as the lesson from #371; this work neither repairs nor waives it.

Run from the repository root with the restored lockfile toolchain:

```sh
node docs/internal/b10-05/proof.cjs /tmp/b10-05-results.json
```

The deterministic adapter exposes per-member completion gates; no outbound
network is used. The same Wasm bytes serve all Native inputs. Assertions cover
empty, one, three and four members, reverse completion, ordered results, full
overflow rejection, first-index partial failure after settlement, pre-entry and
in-flight cancellation, and late completion. The private model checks capacities,
ownership/forgery, duplicate claims, double flush, add-after-flush and unflushed
termination. A negative compiler assertion confirms the proposed API is not yet
accepted. [results.json](results.json) binds the proof, expanded source and Wasm.

Two initial fixture attempts failed: the JS context lacked the mandatory Web
Request frame, then the test adapter read the Native URL from the JS descriptor
field instead of Native's normalized `parts.url`. Both were proof-harness errors;
no production source was patched. Retain their distinction from passing evidence.

## Implementation owners and acceptance handoff

| Owner | B10-06 work |
| --- | --- |
| `packages/runtime/src/index.d.ts`, `host.d.ts`, internal `context.js` / `effect-adapter.js` | Types, private collection/root ownership, atomic admission, timer/observation placement, close semantics |
| `wasm/packages/contracts/src/handler/` | Surface/versioned group contract and diagnostic catalog ownership |
| Compiler spine `handler-surface-authority.js`, `async-surface-normalizer.js`, `handler-ir.js`, `handler-ir-managed.js` | Narrow build-region recognition, affinity checks, bounded iteration and source diagnostics |
| `wasm/packages/compiler/src/canonical-native-plan.js` and plan contract/validator | New bounded region, independent max/template/prefix validation and result bindings |
| Runtime-core `canonical-native-control.js`, `canonical-native-support.js`, expression/ownership owners | Bounded slots, active-count suspension, result array and cleanup |
| Host-runtime `canonical-native-host.js`, `canonical-api-runtime.js`, invocation/continuation owners | New-kind admission and result authentication without weakening static groups |
| Node/Fastly provider realization owners | Capability intersection, host resource bounds, real transport/timeout/cleanup parity |
| Existing API/runtime/lowering/native/provider/installed fixtures | Acceptance below; register in current suites rather than a new scheduler/harness |

Suggested diagnostic family (proposed names, not registered public codes):
`PULSE_EFFECT_COLLECTION_CAPACITY`, `_OVERFLOW`, `_MEMBER`, `_OWNER`, `_CLAIMED`,
`_SEALED`, `_UNFLUSHED`, plus a source-specific
`PULSE_CANONICAL_EFFECT_COLLECTION_UNSUPPORTED`. Route diagnostics through the
existing catalogs and generated-reference owners when implemented.

#379 must prove: 0/1/max/max+1 membership; exact cohort budget boundaries;
argument mutation after add; no dispatch before flush including microtask turns;
static-group behavior unchanged; late/reused/foreign/projected-root rejection;
all lifecycle exits; deterministic ordinary failure and terminal failure priority;
per-member timeout starts at flush; cancellation during build/dispatch/rejoin;
stale/duplicate/forged/missing Native results; independent request/route/event
ownership; unsupported source diagnostics; bounded memory and artifact size at
max; schema text/JSON/error instrumentation composition; actual Node and Fastly
claimed target cells and installed-consumer evidence.

The API shape and semantics are recommended within the authorized narrow
extension. The root-claim mechanics, linear-size Native lowering, host feature
version and measured maximum remain implementation proof obligations. If those
cannot be preserved without a broader execution model, stop #379 with that
specific design result rather than replacing the scheduler. This investigation
does not substitute for #379 acceptance or the final #382 release qualification.
