# Host extensions — design pass 2: execution and evidence costs

Status: **investigation complete; implementation estimates, not approved contracts**.
Date: 2026-10-24 (America/Denver).
Inspected base: `a068a02e3bf200699d6cd894b02d65526d108515`, `hex-integration`.
Human direction: “Proceed with pass 2,” following the cost discussion for
[pass 1](DESIGN-01-authoring-shapes.md). Every async operation is assessed as
direct await, keyed `ctx.parallel`, and a bounded collection member. Loaders
receive no exemption. No single named Entry Point covers this internal,
cross-owner investigation; ordinary root/docs instructions apply. Writes are
confined to this evidence directory; product owners remain read-only.

## 1. The decision this pass supports

The proposed syntax is plausible, but the cost is uneven. **Small observations
need a reusable nonterminal service; value caching needs resource ownership;
authored deferred work needs a bounded composition contract.** These are three
different investments. The terminal GRIP proof establishes package selection,
ABI admission and ownership fences; it does not already supply these services.

The best next design exercise is to specify a nonterminal operation with a
validated value result, then pressure it with both an immediate observation and
a pending resource operation. Do not design a general callback runtime from the
metrics example, or claim the cache path is solved by making metrics work.
Keep the attractive package calls from pass 1 while deciding how much execution
they may express. A full async named-loader surface is the most expensive choice
here, not simply an alternate spelling of an inline expression.

| Shape | Cost category at this base | Likely reuse | Missing investment | Confidence |
| --- | --- | --- | --- | --- |
| Runtime snapshot | Reusable extension | Ordinary effect root, invocation ticket, value continuation | Nonterminal service, bounded result, observation capability evidence | High on scope; unmeasured overhead |
| Downstream TLS/client facts | Reusable extension | Same execution shape as snapshot | Request-scoped access, bounded buffers and fact-specific results | High on scope; ABI failure mapping still to verify |
| Cache get/put | Reusable extension plus resource lifecycle | Roots, groups, schemas, cumulative budget | Cache/body ownership, read/write outcomes, logical binding and policy evidence | Medium |
| Inline one-effect loader | New bounded execution concept | Existing child operation and outer group | Deferred child admission, captures, parent/child accounting and settlement | High that work is needed; medium on chosen mechanism |
| Named async loader | New execution concept, broader than inline | Static module discovery and schema conventions | Separate loader contract, call graph, inputs/results and async composition | Low estimate confidence until narrowed |
| HTTP cache origin/bypass + JSON | Reusable extension, conditional on ABI mapping | Existing fetch transport, body projection, deadlines | Admitted policy and package projection recognition | Medium; host-policy mapping is a gate |
| HTTP cache with guest revalidation callbacks | New execution/resource composition | Some transport and core-cache machinery | Candidate response ownership and callback lifecycle | Low; outside pass 1's small policy surface |

No proposed operation works unchanged today. “Reuse” identifies mechanisms that
can survive, not an available extension API or a qualification claim.

## 2. What the current machinery actually buys

The important source owners are linked below; symbol names identify the inspected
boundaries without pretending that a file's existence qualifies a new operation.

| Owner | Observed behavior | Cost implication |
| --- | --- | --- |
| [Package contract](../../../wasm/packages/contracts/src/package/package-contract.js), `normalizeCanonicalPackageEffect` | Strict data envelope carries capability, placement, runtime inputs, schema references and provider requirements. | Reuse identity/discovery. A callback is not a data payload or executable child-plan contract. |
| [Handler IR](../../../wasm/packages/compiler/src/spine/handler-ir.js), `parallelCandidate` | Recognized package effects with statement placement can enter a keyed group. | No need for a separate package parallel API; downstream planning/provider admission must still support the effect. |
| [Collection source](../../../wasm/packages/compiler/src/spine/effect-collection-source.js), `inspectCollection` | Rejects arrows/functions, argument calls, awaits and mutation; one direct loop/add/flush region. | Inline loader syntax needs precise new recognition. Removing the general callback rejection would be too broad. |
| [Native plan](../../../wasm/packages/compiler/src/canonical-native-plan.js), collection construction/validation | Allocates a fixed bank of `max` sites and result locals, with an ordered group continuation. | Cost scales with declared capacity, even for short runtime arrays. Compound children need their own bounded layout. |
| [JS effect adapter](../../../packages/runtime/src/internal/effect-adapter.js), `dispatch`, `effects`, `parallel` | Roots are execution-owned; inline collection add holds dispatch until flush; groups settle with ordered results. | Reuse ownership and collection rules. An ordinary async wrapper loses the branded root. |
| [JS package bridge](../../../packages/runtime/src/internal/package-runtime.js), `normalizePackageDefinition` | Fixed first-party effect catalog, plus a separate generic `package.invoke` definition; payload cloning rejects functions. | Native trusted lowerer discovery does not create JS package dispatch. `package.invoke` is not a Fastly cache service. |
| [Fastly extension owner](../../../packages/provider-fastly/src/build/host-extensions.js), `select`, `instrument` | Only one direct terminal effect; no group/Router/helper composition; lifecycle insertion uses checked source replacements. | Add a new service deliberately. Do not loosen terminal placement and reinterpret its authenticated completion as an ordinary value. |
| [Fastly effect dispatch](../../../packages/provider-fastly/src/build/native-platform-capabilities.js), `effectDispatchSource` | Built-in kinds map to specific begin handlers; `host.extension` maps to the terminal dispatcher. | A carrier and import permission do not supply begin/pending/result/cleanup semantics. |
| [Fastly tickets](../../../packages/provider-fastly/src/build/effect-invocations.js) | Invocation count and per-site tickets fence begin/settle/close. | Keep single settlement and inherited budget; child stages cannot invent fresh request budgets. |
| [Time realization](../../../packages/provider-fastly/src/build/time-native.js) | Synchronous host observation completes through ordinary effect machinery. | Awaited observations need not introduce a new scheduler. They still allocate/result-validate and consume effect budget. |
| [S3 realization](../../../packages/provider-fastly/src/build/s3-native.js) and [source](../../../packages/provider-fastly/src/build/s3-native.as.ts) | An existing operation performs preparation, signing, send and readback internally, with selected source and imports. | Multiple internal host steps are not themselves new. Arbitrary authored child effects with independent capability provenance are the new requirement. |

The service boundary should provide only the authority needed for that service.
Metrics need dispatch and result delivery; downstream facts need the current
request's selected observations; cache needs operation-owned resources; a loader
needs child execution. None implies a general mutable `ctx` object inside a
package's generated host source. Broader lifecycle hooks remain a pass 3 choice.

The v1 generated-source contract also forbids provider-private identifiers and
module imports. Package code cannot simply reach into the current provider's
handle tables. Any access required by the new services must be mediated through
an explicit provider contract. Declarations remain trusted-build metadata, not
a sandbox; this pass does not change that accepted risk.

### All three authoring forms

| Operation family | Direct await | Keyed parallel | Collection + flush |
| --- | --- | --- | --- |
| Observations | Sample at dispatch; resume with validated result | Independent samples; no atomic ordering against siblings | Capture descriptors only; fresh samples at dispatch, capacity-bounded |
| Cache read/write | Own lookup/body/write until settled or safely retired | Start independent operations; ordered results do not imply ordered commits | Snapshot per-item inputs; no cache work during add; bound aggregate bytes and handles |
| Deferred work | Parent waits for its conditional child chain | Parent remains one group member until its child work settles | Each slot captures its own inputs and child template; flush starts parents, not every possible loader |
| HTTP-cache fetch | Preserve transport failure and JSON projection | Existing fetch concurrency after policy admission | Preserve projection and policy per slot, with no early request dispatch |

Returning `PulseParallelEffect<T>` in declarations is necessary but insufficient.
Recognition, accepted plan, provider execution and evidence must agree. For a
target without the service, fail explicitly at target admission when statically
known, and at the runtime boundary where appropriate. Native-only initial support
with explicit JS rejection is a valid scope decision, not a reason to fabricate
a generic cache fallback. All three forms still apply within every supported
target; unsupported forms must not silently serialize or escape the scheduler.

## 3. Lifecycle costs and failure semantics

### Immediate observations

One root can dispatch a synchronous host call, normalize its bounded value and
settle through the existing continuation. Nonterminal completion must preserve
ticket authentication, closure and deadline checks. A synchronous ABI call is
not preemptible; expiry fences its result at the next managed boundary.

Snapshots may make multiple host calls and allocate result objects. Requested
fact fields must determine capability demand; merely importing the package must
not cause every observation ABI to be selected. TLS/client facts need maximum
buffer sizes and explicit unavailable versus malformed/failure outcomes. They
borrow request identity only during the admitted operation; no raw handle leaves
the provider and no subsequent-request reuse follows.

Do not add a global after-request metrics hook as part of this work. That is a
different lifecycle, including failure and terminal-handoff cases, and needs its
own cost/ownership decision. The proposed snapshot measures at an authored point.

### Cache reads and writes

Even a simple value API hides resource work: lookup state, an entry/cache handle,
a body reader or writer, bounded bytes, codec validation and disposal. The
provider must define ownership at every failed host call and partial write.
Reuse schema codecs, but verify cache-specific error classification; a schema
generic is not validation and an unreadable entry is not automatically a miss.

| Exit | Required outcome for a proposed implementation |
| --- | --- |
| Valid fresh hit | Decode within limits; release locally owned cache/body resources; settle once |
| Proven miss | Release lookup resources; return miss, without scheduling fallback implicitly |
| Cache read/codec failure | Surface failure; do not relabel it as miss or unavailable |
| Write accepted | Finish the host write protocol before returning stored; no retention-until-TTL guarantee |
| Failure after write dispatch | Preserve possible partial/committed outcome; no automatic retry or rollback claim |
| Deadline/cancellation | Stop new work; retire/dispose only known-owned resources; reject late settlement |
| Sibling failure | Respect existing group settlement/recovery; already admitted writes may have happened |

The existing architecture waits for already-started group members before Router
recovery. It does not promise fail-fast sibling rollback. A future compound
operation must specify whether a recoverable sibling error prevents its *not yet
admitted* child; adopting immediate cancellation here would be a semantic change.
Whole-request expiry/closure must prevent further child dispatch in either case.
New cache errors also need a deliberate application-recovery classification;
using `app.error` is not automatic for arbitrary provider faults.

Budget the root and every actual managed child, plus separate host-step/byte/
handle ceilings where one root uses several ABIs. One root is not permission for
unlimited work. Collection capacity controls siblings; the current cumulative
effect ceiling (1024) and inherited monotonic deadline control the request.
For child chains, reserve a conservative maximum or explicitly admit children
against remaining budget. Reservation versus incremental admission remains an
open contract decision: it changes when partial writes can precede failure.

### Deferred work: where the larger investment starts

The current group contains fixed effects and resumes its application continuation
after the group settles. It has no general authored parent/child execution plan.
A cache miss that launches a fetch while sibling cache operations remain pending
needs a child to progress *before* the outer group continuation can resume.
Changing `async` spelling cannot supply this behavior.

For the single-fetch loader from pass 1, a bounded parent would need these states:

| Parent state | Next work | Ownership retained |
| --- | --- | --- |
| Admitted lookup | Probe cache without executing loader | Parent ticket and bounded inputs |
| Usable hit | Decode and settle parent | Cache/body until release |
| Miss or producer selected | Admit one recognized child operation | Parent and any insertion obligation |
| Child complete | Validate and insert result | Child result plus writer/transaction |
| Insert complete | Release remaining resources; settle parent | No outstanding child or writer |
| Any failure/expiry | Fence new work, dispose/retire by known ownership | Explicit uncertain ownership stays uncertain |

This is a candidate analysis model, not a new schema or implementation. In a
noncoordinated version, lookup-miss-fetch-put can be a fixed chain. Coordination
adds producer/waiter states, insertion obligations and contention deadlines.
Both versions still need child composition when used as a parallel member.

Fastly's [Transaction documentation](https://www.fastly.com/documentation/reference/compute/sdks/rust/fastly/cache/core/struct.Transaction/)
describes one producer with other lookups waiting, and async transaction lookup
to avoid blocking. Therefore a blocking wait in a member's begin path is a
particular risk: a sibling could be the producer whose loader has not yet run.
This is a derived deadlock scenario to test, not an observed Pulse cache bug.
The exact pending/select/body behavior and timeout/abandon ABI mapping must be
verified for the chosen SDK/host before claiming a safe shared polling loop.

Three possible implementations have different costs:

1. **Bounded child plan in shared execution.** Recognize a single deferred effect,
   snapshot its inputs, retain parent/child identities and progress it under the
   current group. Largest reusable investment; strongest route to consistent
   accounting and evidence. Prefer this direction for further design pressure.
2. **Provider-owned compound operation.** Similar to S3's internal work, but a
   statically admitted child descriptor is needed to preserve authored fetch/KV
   authority. Lower initial cost for a fixed fetch-only recipe; risks growing a
   second dispatch path and duplicated policies. It cannot be sold as arbitrary
   loader composition or hide child capabilities behind cache.
3. **Expand into ordinary sequential statements.** Cheap for a direct miss branch,
   already expressible once cache primitives exist. It does not implement the
   same operation as a member of an outer parallel group. Accepting it as the
   universal lowering would fail the user's three-form requirement.

Candidate A's inline expression needs bounded capture analysis and new collection
admission, but could constrain the child to one statically recognized operation.
Candidate B's named loader also needs declaration identity, module reachability,
input/result contracts, recursion rejection, diagnostics and evidence ownership.
Today's `ctx.call` remains synchronous and effect-free. Do not widen it as a
shortcut. Reject nested compound loaders/groups initially unless their bounds,
settlement and evidence are independently specified; this is a proposed scope
limit to review, not a silent exception for cache.

### HTTP caching: small policy versus guest orchestration

The provider already uses `send_async` for fetch and privately uses
`cache_override_set` for S3 pass-through requests. A small origin/bypass policy
may therefore reuse transport instead of requiring all of the HTTP-cache ABI
family. This is an inference from current source, not tested semantic parity.
The SDK's [Request reference](https://docs.rs/fastly/latest/fastly/http/request/struct.Request.html)
(retrieved as 0.13.1) distinguishes backend sending, pass behavior and callback
surfaces; do not infer full guest-cache behavior from the presence of a send ABI.

Before selecting the cheaper path, verify what existing Pulse fetch already
does under the chosen host configuration, and map `origin`/`bypass` precisely.
The package may be exposing explicit policy over existing host read-through
behavior, rather than introducing caching from zero. Count that separately from
new ABI coverage. Full guest-managed HTTP cache lookup, candidate responses,
revalidation and callbacks are a larger project and not promised by these modes.

The package-owned `httpCache.fetch(...).json(...)` shape needs projection-aware
recognition and lowering into the same transport, retaining both package policy
and fetch identity. A plain async package wrapper will not preserve the branded
root. The alternate `ctx.fetch(..., { cache: policy })` spelling needs an admitted
core fetch option instead; it avoids some receiver recognition but changes a
public core contract. Compare those costs in pass 3. Neither should duplicate
deadline handling, backend resolution, body ownership or schema decoding.

## 4. Evidence is part of the cost, not a finishing step

Current capability use sites and host-extension import records are useful but
different. [Handler topology](../../../wasm/packages/compiler/src/report-handler-topology.js)
projects a recognized package's capability string and source span.
[Binding ownership](../../../wasm/packages/compiler/src/spine/binding-ownership.js)
only maps config, secret, KV and S3. The [reference collector](../../../wasm/packages/compiler/src/report-reference-provenance.js)
uses the same set. The [report schema](../../../wasm/packages/cli/src/internal/report/schema.js)
allows text binding kinds in the inventory, but reference kinds are enumerated;
loosening only one of them would leave an inconsistent report.

The existing topology's `conditional` association describes handler reachability;
it is not a representation of a cache miss spawning a child inside a group.
Use sites have no general parent operation/group/collection fields or cache
policy record. [Semantic comparison](../../../wasm/packages/cli/src/internal/report/semantic-comparison.js)
projects operation, capability and binding; adding a field elsewhere does not
automatically make TTL, cache mode or loader relationships compare-visible.

[HEX host-extension records](../../../wasm/packages/cli/src/internal/report/host-extensions.js)
re-audit the final Wasm and preserve selected package/service/source/policy
identity plus declared and observed imports. They do not encode logical cache
binding, child invocation topology, TTL or executed hit/miss. Keep both layers;
do not replace semantic capability evidence with a list of ABI imports.

| Required evidence | Existing reusable part | Necessary design/change |
| --- | --- | --- |
| Observation capability | Authored use site, package capability, source | Explicit selected fact categories/units and execution placement; no measured values in build report |
| Cache read/write binding | Binding/reference IDs and consumer links | New admitted binding kind, configuration resolution and provenance; never disguise cache as KV |
| Schema, TTL, HTTP mode | Schema references and comparison framework | Canonical bounded policy fields; producer, validator, comparison and viewer agreement |
| Conditional loader | Recognized child capability and source conventions | Parent-child edge with trigger/coverage, including child backend/binding; distinguish may-run from ran |
| Keyed/collection placement | Compiler group IDs/sites and collection capacity | Preserve semantic group membership and capacity in report; distinguish one authored template from generated slots |
| ABI contribution | HEX final-artifact audit and identities | Reuse selected contribution evidence; handle repeated sites without inventing extra authored operations |

Metrics/downstream observations may have **no application-named resource binding**.
They still need selected-host capability attribution and use sites in the binding
explorer. Pass 3 should decide how the viewer presents those capabilities without
inventing a configured store name. A cache binding does have a logical identity;
neither category may vanish behind “not applicable.”

Minimum comparison scenarios are: add/remove observation; TLS facts to client
facts; change cache binding/schema/TTL; origin to bypass; add/remove/change loader
origin; move the same operation into a group; change collection capacity; and
import a package without using it. Policy changes must be semantic differences,
not merely different generated-source digests. A historical report lacking these
facts is unknown, not evidence of no capability or unchanged policy. Preserve
coverage and compatibility through a deliberate versioning decision.

All of this is build evidence. Neither a selected capability nor an observed
Wasm import proves a runtime hit, loader dispatch, commit or successful cleanup.
Future runtime observations need the same identities but separate receipts.

## 5. Runtime and payload costs

Let `N` be declared collection capacity, `n <= N` actual members, `B` bounded
value/body bytes per active member, and `C` maximum admitted children per parent.
These are structural estimates, not measured timings:

- Native compilation currently reserves `N` effect sites; a naive bounded child
  expansion could reserve roughly `N * (1 + C)` sites plus state/result locals.
  Runtime managed invocation cost depends on branches actually admitted, not
  only on roots. Parent and children must not share a single unbounded allowance.
- Buffering a whole value at each sibling can require order `n * B` bytes, with
  additional copies during encoding/decoding/insertion. Bounds on one value do
  not bound the whole parallel group. Host-held buffers are a separate cost.
- Immediate observations need descriptor/result/ticket work and host sampling.
  Do not call that free just because the ABI returns synchronously. Sampling
  itself changes CPU/memory observations; it is not precise per-function profiling.
- JavaScript uses promises, descriptors, maps and group settlement bookkeeping.
  Extending a shared runtime closure may increase unused bundles even if Native
  code is selected away. Native and JS unused-cost claims need separate controls.

The retained [B10-06 measurement](../../../wasm/test/runtime/effect-collection-size.md)
is useful calibration, **not a measurement of this proposal**: six unchanged
handlers had zero raw-Wasm growth; the JS application source bundle grew by
4,510 bytes. At that pinned candidate, dynamic core capacity 1 to 32 added 9,793
bytes, and dynamic Fastly Native was 294–440 bytes larger than comparable static
fixtures. Those numbers cannot be extrapolated to cache/loader sites or described
as current overhead. The linked receipt identifies its older baseline/candidate.

Before a later implementation is accepted, measure: no package; imported-unused;
one operation; keyed 1/4 members; capacity 1/4/16/32 at empty and populated inputs;
cache hit/miss/loader-failure; and repeated-key contention. Record raw/code/data
Wasm sizes, JS bundle separately, compile time, managed effect counts, retained
bytes/handles and cleanup. Compare exact artifacts and source identities. No
latency, allocation count, new Wasm-size figure or unused-cost promise is claimed
by this pass.

## 6. Implementation effort: shared investment and marginal work

These are **planning ranges in focused review units**, not measured engineering
days or model token budgets. One unit is a coherent contract/implementation or
evidence change with focused validation and review fixes; it may take multiple
agent passes. Ranges assume narrow value results, bounded operations, no instance
reuse, no background refresh and no arbitrary async callback bodies. Hosted
qualification access/wait time and release work are excluded. Re-estimate after
pass 3 selects contracts; do not add every range as if they were independent.

| Work package | Estimated units | Shared or incremental | Principal uncertainty |
| --- | ---: | --- | --- |
| Nonterminal service, value admission and lifecycle composition | 2–3 | Shared foundation | Result/handle service shape and safe provider insertion points |
| Capability/binding/policy evidence, compare and viewer coverage | 2–3 | Shared foundation, plus family-specific fields | Historical compatibility and capability-only presentation |
| First runtime snapshot | 1–2 | Increment after foundation | ABI result/error mapping and qualification |
| Selected downstream TLS/client facts | 1–2 | Increment after observation service | Bounds, unavailable states and request-scope proof |
| Cache get/put | 3–5 | Increment; contributes resource-lifecycle machinery | Partial writes, body lifetime, polling and key/codec policy |
| Minimal HTTP origin/bypass, projected JSON | 2–4 | Increment; reuses transport if mapping holds | Existing host cache behavior and projection recognition |
| One deferred recognized child, noncoordinated parent | 4–7 | Shared compound-execution investment | Captures, child scheduling, accounting, topology and group recovery |
| Coordinated fill semantics | 2–4 | Increment after cache and child execution | Same-key liveness, obligations, timeout/abandon |
| Named async loader beyond inline child | 3–6 | Additional, can be deferred | Admitted body/call graph and reusable execution contract |
| JS realization for first new service | 2–4 | Separate target admission/bridge work | Catalog replacement/extension and host API availability |

Thus a first narrow Native observation with credible evidence is roughly **5–8
review units**, not one ABI wrapper. The next similar observation should be much
cheaper. Cache and compound work are meaningful additional projects. The useful
success criterion is decreasing marginal work: a second same-shaped operation
should not require another special-case edit across core compiler, scheduler,
provider and report. If it does, pause and improve the contract before widening
coverage. The estimates are architectural scope estimates, not a delivery date.

Instrumentation standardization belongs in the foundation budget. The current
provider has checked source-splice instrumentation in extensions, invocation
tickets and fetch deadlines/errors. Fail-closed missing anchors are useful, but
they do not prove correct ordering of valid splices. Define a small provider-owned
composition point for admission, dispatch, settlement, error and cleanup, and
test interacting features there. This need not become a public plugin hook API or
a provider-wide rewrite. Preserve terminal GRIP behavior as a regression control.

Qualification is part of each unit, not the last unit. Include direct/keyed/
collection equivalence, deferred construction, duplicate/foreign/stale roots,
expired-before-dispatch and late results, partial group failure, size controls,
installed external packages, final import audits, and report/compare negatives.
Resource families additionally need failure injection at each ownership transfer.
Local engine success is separate from hosted acceptance; the previous GRIP proof
does not qualify cache or observations.

## 7. Evidence retained by this pass

[Probe source](design02-probe.cjs) and [successful receipt](design02-probe-result.json)
record **8 passed cases**, using current production source with injected adapter
values. The probe builds Native plans at capacities 1/4/32, checks both loader
spellings at the collection structural gate, rejects callback payloads and an
undeclared JS package, checks cache binding mapping, and exercises existing time
roots in all three forms plus the rejected async-wrapper case.

No proposed API is compiled or executed. The named loader passing the structural
collection gate is explicitly not package/compiler/runtime admission. The held
collection runtime probe intentionally yields before flush to inspect internals;
that is not an example of admitted authored DSL. Probe input hashes, Node/TS
versions, inspected revision and dirty working-tree state are in the receipt;
uncommitted files are confined to internal design evidence.

The [first attempt](design02-probe-attempt1.json) passed seven cases and failed on
the probe's expected diagnostic spelling (`PULSE_PARALLEL_EFFECT_REQUIRED` versus
the actual `PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED`). Its failed assertion also
closed the execution before observing the wrapper promise, causing a secondary
closed-execution rejection. The retry corrects the assertion and observes that
promise during cleanup. No production code changed. The failed receipt is kept;
this is not a recovered product regression or a clean release qualification.

Reproduce after restoring the lockfile-pinned workspace dependencies:

```sh
node docs/internal/host-extensions/design02-probe.cjs > /tmp/design02-probe.json
```

Source inspection and these bounded probes settle the structural questions.
No new ABI prototype, full regression run, Wasm benchmark, host execution or
deployment was necessary. External SDK documentation informs the cache risks;
exact 0.13.1 cache detail pages were not consistently retrievable, and a `latest`
pending-transaction URL returned older 0.11.13 content. That older result is not
used to assert current ABI behavior. Pending cache lifecycle/selector compatibility
remains an explicit pre-implementation verification gate.

Repository validation: `maintainer:sync`, `docs:sync`, `maintainer:check`,
`docs:check`, documentation-release validation, scope classification and diff/link
checks are required for this evidence-only change. Their completed outcomes are
recorded in the PR; the probe receipt is independent of those checks.

## 8. Pass 3 decisions, with stopping points

1. Specify the smallest nonterminal result/lifecycle service. Use an observation
   and a pending cache operation to test its adequacy. Keep the terminal service
   distinct. Decide Native-only versus additional JS support explicitly.
2. Define capability-only and logical-binding evidence together with policy,
   group and conditional-child relationships before fixing an extension schema.
3. Choose the HTTP-policy spelling only after verifying transport/cache mapping.
   Reject a second transport implementation as the cost of a nicer method chain.
4. Compare a one-child shared execution plan with a strictly bounded provider
   recipe. Decide captures, budget reservation, sibling-failure admission and
   same-key liveness before admitting loaders. Keep named async loaders optional.
5. Set measurable gates for unused artifacts, capacity growth, resources and
   evidence completeness. If the cost is excessive, retain manual cache
   get/miss/fetch/put and defer the compound convenience without claiming it meets
   all three forms. Async operations that are offered must meet those forms.

This pass does not authorize implementation, new lifecycle access, report schema
changes, package publication, merging into `latest`, or service deployment.
