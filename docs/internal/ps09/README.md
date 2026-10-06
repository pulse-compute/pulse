# PS-09: final Native emission extraction map

The next implementation is **two sequential PS-10 slices**: preparation and
support emission, then expression/control emission and final assembly. Keep the
existing plan, contract and provider authorities. The extraction needs private
modules and explicit inputs, not another compiler pipeline or IR.

Human direction: implement PS-09 from the next-stream plan. This is planning and
mapping only. No named Entry Point matches this internal compiler map; the
ordinary root/Wasm/compiler instruction chain applies to inspection and the
root/docs chain to these repository-only artifacts. Owner: `docs/internal/ps09/`.
Class: evidence; scope: evidence-only. PS-07 and PS-08 are merged.

Inspected and generated from clean `latest` revision
`97ad8b8d4daeffd7a31248221c4ef61827d45668`, tree
`63e470bee95748a8da66662652df2311737826c2`, on Node 24.19.0.
[corpus.json](corpus.json) records source hashes, fixture recipes and results.
Line references below refer to that revision. They are navigation aids, not
future line-count or byte-count gates.

## Existing authority and call path

The [current contracts](../../architecture/current-contracts.md) own the single
compiler spine, internal helper sharing, effect boundaries and provider-neutral
planning. Source paths in this note are repository-root-relative.

| Boundary | Current owner and data flow | Extraction constraint |
| --- | --- | --- |
| Project/source frontends | `wasm/packages/compiler/src/spine/canonical-project.js`, `canonical-source.js` and their existing compiler adapters produce canonical programs | Project phases currently include pass-through legacy envelopes; the named phases do not mean those responsibilities are already extracted. Keep that migration separate |
| Native plan and packages | `spine/canonical-native-plan.js` calls the existing Native plan builder, then `package-operation-seam.js`; its facts attach to the returned plan in WeakMaps | Keep statement/effect/continuation lowering and package trust here |
| Plan admission | `wasm/packages/compiler/src/canonical-native-plan.js`: `assertCanonicalNativePlan`, exported as `validateCanonicalNativePlan` | One implementation validates builder output and externally supplied/serialized plans |
| Provider requirements | `spine/provider-requirement-authority.js` collects and checks the plan-bound requirement record | Module realization resolves it once, carries it through guest realization and artifact verification; deserialized plans recover it through the same package/requirement owners |
| Portable module realization | `canonical-native-compiler.js` through `spine/canonical-native-module.js` | Validate requirements and plan, generate primary source, run ASC, realize guests, verify final Wasm; flags, retention transforms, staging and cleanup stay here/build-support |
| Portable source generation | `wasm/packages/runtime-core-as/src/compiler/canonical-native.js`: `generateCanonicalNativeAssemblyScript(plan, options)` | PS-10's extraction boundary. Return the same frozen version/source/hash/manifest/block result; `options` is currently accepted but unused |
| Fastly realization | `packages/provider-fastly/src/build/native-platform-capabilities.js` calls the same portable generator and embeds/instruments its text | Preserve generated names, layout and source sections. Provider implementation stays outside the compiler/runtime-core extraction |
| Terminal package applications | Both realization paths select package-owned source when `plan.packages.application` is present | This bypass does not enter the generator; keep the branch and package ownership intact |

The existing spine's fixed adapters remain the orchestration authority. The
private functions proposed below live inside portable source generation; they
do not add registered phases, provider discovery or a second backend.

## Current emitter and proposed ownership

`canonical-native.js` has 1,339 lines. The final generator spans lines 334–1333
(1,000 lines), with 17 directly nested function declarations and 61 direct
variable bindings. Many bindings are immutable derived values; the problem is
their implicit dependencies and ordering, not 61 independent mutable states.

Proposed private files all live beside `canonical-native.js`. Function/result
names below specify the intended seam, not a new public export contract.

| Responsibility and current span | Proposed owner | Explicit inputs | Outputs / owned state |
| --- | --- | --- | --- |
| Plan indexes, expression collection (239–332, 334–350), names and errors | `canonical-native-context.js` | Original plan references and existing runtime/plan/event contracts | Ordered plan views/indexes; `fail`, `localName`, `stringHandle`; existing error class/hash/quoting helpers. No shared mutable emission session |
| Schema composition (60–237) | `canonical-native-schema.js` | Existing schema bundle on the plan | Existing `{ active, imports, declarations, exports, codecs, sourceHash }`; codec-local symbols/arrays stay private |
| Crypto composition (352) | Existing `crypto-guest-source.js` | Plan's selected crypto realization | Existing guest source/provenance result; do not duplicate its trusted source selection |
| Event/decoder emission preconditions (353–382) | Context helper invoked at the same point | Original plan and event contract | Existing diagnostics; no independent full plan validator |
| Expression preparation/rendering (387–667, 668–685; final rendering at 1170–1171) | `canonical-native-expressions.js` | Ordered expressions/indexes, plan views, naming/error helpers, existing contracts | Private alias/retention/body maps; `exprName` for control emission; deferred expression and pure-helper declaration rendering |
| Statements, handlers, shared stages/helpers (687–910) | `canonical-native-control.js` | Plan views plus stable `exprName`, `localName`, `stringHandle`, `fail` | Blocks, entry IDs, resume requirements and error guard. Private traversal state; no mutation of the plan |
| Dispatcher layout/accounting (911–1052, 1124–1137) | Same control owner | Completed blocks and ordered owner maps | Rendered blocks/chunks, dispatch functions, guard allowance and late run-loop rendering; retain separate layout/accounting calls where ordering requires them |
| Runtime support (1053–1123 and support sections embedded in 1138–1236) | `canonical-native-support.js` | Plan indexes/contracts, completed blocks/resume requirements, state/stage/helper/event presence | Imports, globals, stage accessors, string/state/resume helpers and ordered ABI export sections; local output arrays only |
| Final source/manifest/result (1138–1332) | Narrow assembly functions retained in `canonical-native.js` | Completed support, schema, crypto, expression and control outputs plus original plan | Exact section join, source hash, manifest and frozen block copies; one result owner |

Keep runtime scaffolding such as `pulse_start`, event start, effect setters and
resume helpers with support emission. Control owns `__pulse_run` and its
partitioned/unpartitioned choice. Root assembly only places these strings in
their existing positions and constructs the result. This leaves five new
private files across two slices, rather than a module for every small helper.

Existing schema seams are already useful: `schema-scalar-record.js`,
`schema-presence-codec.js`, `schema-admission.js`, and `schema-nested-json.js` own
their current codec pieces. Lift the composition around them; do not copy or
merge their implementations. Reuse `shared-stage-accessors.js` for dynamic
effect-site access. Compatibility emitters are not alternate authorities to fold
into this work. Keep imports acyclic: private emitters may use context helpers;
context must not import the root generator or its emission modules.

## Complete closure-state inventory

This accounts for all 61 direct bindings. The arrays/maps already used internally
are sufficient: explicit records can carry them without a new serialized format,
visitor framework, cache or duplicate IR.

| Owner / lifetime | Current bindings | Mutation and readers |
| --- | --- | --- |
| Plan views, one generation | `pureHelpers`, `stages`, `stageBindings`, `stageSites`, `maxStageSites`, `localIndex`, `effectIndex`, `continuationIndex`, `expressions`, `expressionIndex`, `stateEnabled`, `binaryIndex`, `unaryIndex`, `eventEntries`, `eventReachable`, `applicationErrors`, `helpers`, `handlers`, `routerLocal`, `routerCursor` | Derived once in current order; expression/control/support/manifest read relevant subsets. Build later flow views at their existing phase, not by eagerly moving all work to entry |
| Schema/crypto results | `nativeSchemaCodecs`, `nativeCrypto` | Their existing owners finish construction before readers receive results |
| Expression preparation | `expressionAlias`, `retainedExpressions`, `expressionBodies`, `sharedBodies` | Reverse alias pass then retention pass mutate private maps. Final naming/declaration rendering reads the completed decision; body-dedup maps need not escape |
| Control construction | `stageEntries`, `helperEntries`, `blocks`, `protectedEntries`, `activeBoundary`, `activeHandler`, `activeVisitWeight`, `fallthroughBlock`, `pureLoopIndex`, `entryBlock`, `resumeRequirements` | Only control writes. Recursive traversal restores active owner/boundary/weight. Blocks are appended and read-loop targets patched before support/assembly reads them |
| Control layout | `routeErrorLines`, `errorGuard`, `maxChunkStates`, `maxChunkCharacters`, `renderedBlocks`, `partitioned`, `chunks`, `invalidProgramCounter`, `stageChunks`, `helperChunks`, `chunkName`, `dispatcherFunctions` | Local layout arrays accumulate in block order; assembly consumes finished output |
| Runtime support | `imports`, `globals`, `setterCases`, `readyCases`, `clearCases`, `eventPayloadCases`, `eventExports` | Only support appends its strings; resume cases read completed control data |
| Control allowance | `helperCallCount`, `countHelperCalls`, `guardStateCount` | Local weighted count; assembly/manifest read checked final allowance |
| Final assembly | `source`, `manifest` | Root joins once, hashes actual source bytes and returns existing shallow-frozen block copies |

Of the direct bindings, the five `let` scalars are `activeBoundary`,
`activeHandler`, `activeVisitWeight`, `pureLoopIndex` and `helperCallCount`.
They belong to control, never a context shared with expression/schema emitters.
Maps are read-only by ownership after construction; freezing a Map object does
not prevent its entries changing. Do not add deep cloning/freezing to simulate
an ownership boundary.

The 17 direct nested functions move with these owners: context gets `fail`,
`localName`, `stringHandle`; expressions gets `exprName`, `targetParts`,
`renderExpression`, `renderPureHelper`; control gets `block`, `effectRecord`,
`continuationState`, `resumeAction`, `suspendBlock`, `pureLines`,
`compileSequence`, `errorGuardPartitionSize`, `renderBlock`, `selectChunk`.

## Ordering that must survive extraction

1. **Reference identity and traversal.** `collectExpressions` uses a WeakSet,
   visits entry, handlers, stages, helpers, then effect inputs/decoder arguments,
   and walks expression children in source order. Local/effect indexes follow
   plan arrays; continuation numbers come from their recorded `stateIndex`.
   Preserve references, insertion order and the current child visitation rules.
2. **Two-pass expression sharing.** Render in reverse expression order to choose
   byte-identical body representatives using the aliases available at that point;
   then mark repeated multi-statement bodies retained. Re-render non-aliases for
   final emission only after those decisions. Preserve `$k`/`$i` naming, original
   call evaluations, assignment target evaluation and pure-helper slot resets.
3. **Block allocation.** Allocate fallthrough first; compile effectful helpers,
   then stages (exit before body), then entry. `compileSequence` walks statements
   backwards. Branch recursion, inlined handler bodies, loop guard/increment
   allocation and later target patching determine IDs. Stage/helper entry maps
   must exist before calls use them. Preserve visit weights and router boundaries.
4. **Effect/error timing.** Application-error paths prepare grouped payloads and
   check the error before host effect submission. Keep stage-site translation,
   effect order, resume readiness/clearing and shared error-guard placement.
5. **Partition layout.** First render unpartitioned blocks, then choose layout,
   then render chunks. Keep owner boundaries, 64-state/24,000-character targets,
   balanced chunk selection and retention annotations. Character accounting
   deliberately charges the old inline error-guard footprint. An indivisible
   pure-loop state may exceed the target; it remains reported, not split.
6. **Guard allowance.** Count weighted read-loop/helper visits and shared-stage
   registrations, check the integer limit, then use `max(64, count * 8)`.
   Counting emitted blocks alone would change valid execution bounds.
7. **Failure order and deferred work.** Keep schema generation, crypto generation,
   event ABI/decoder guards, expression preparation, control construction/layout,
   runtime support, allowance check, then final expression/pure-helper rendering.
   An extraction must not eagerly render pure helpers or hoist every guard to
   entry merely to make a context constructor look complete.

Final module order is also observable: banner; schema/host imports; ABI, hash,
entry and execution globals; optional globals/stage accessors; string/drop/state
helpers; schema declarations; crypto source; expression then pure-helper bodies;
resume helpers; error guard; dispatcher; run loop; base/start exports; optional
event exports; resume/result setters/accessors; schema exports; trailing newline.
Preserve blank lines, declaration order, versions, annotations and manifest field
meaning. `allowedImports` currently names the full contract, not only emitted
imports; do not silently change that during extraction.

Fastly's `stripPulseHostImports` recognizes a line prefix, and its platform
instrumentation subsequently rewrites the combined text for errors, headers,
bodies, package effects and budgets. Byte-preserving portable output protects
these consumers as well as hashes and optimizer ordering. Moving JavaScript
functions between files alone establishes no Wasm-size or performance gain.

### Observed reference-identity constraint

For `shared-stages`, the original plan collects **307** expressions; a JSON copy
collects **315** because shared object references become separate objects. Both
forms keep the same plan hash and validate, and each generates repeatable output,
but their source bytes differ. All other 12 captured fixtures produced the same
source across that copy. This is an existing characteristic, not a PS-09 fix.

PS-10 must compare original-to-original and serialized-to-serialized output.
Do not require equality between the two representations or normalize a plan by
cloning, sorting or structural interning while extracting it. Corpus hashes
record both forms so this constraint cannot disappear into a generic claim of
determinism.

## Validation overlap and disposition

| Apparent duplicate | What is actually checked | PS-10 disposition |
| --- | --- | --- |
| Builder and realization plan checks | `assertCanonicalNativePlan` checks version/hash, ownership, locals, effects, continuations, statement tree, handlers/stages/helpers, events and summary; realization also accepts external plans | Keep calls to the same validator at their admission boundaries; do not implement another one in context |
| Attached and recovered provider requirements | In-memory facts versus a deserialized plan lacking WeakMap attachments | Keep `collectProviderRequirements` / `assertProviderRequirementsForPlan` as the single authority; emitters neither infer capabilities nor load providers |
| Event ABI check in plan and source emission | Plan contract admission versus direct generator protection before conditional source exports | Preserve existing contract-based guard and error detail when relocating |
| Local/effect/continuation checks in renderer | Previously validated references must also resolve in the emitter's indexes | Retain bounded lookup diagnostics; extraction does not justify removing direct-call protection |
| Decoder checks in plan and emitter | Plan result validation recognizes decoders and argument expressions; emitter additionally requires exactly one static string schema ID when arguments are supplied | Not equivalent; retain the backend restriction |
| Expression/schema/crypto rejection | Backend mappings, supported codec nodes and selected trusted source may still fail after structural plan admission | Reuse their existing owners and diagnostics |
| Router entry coverage and counter overflow | Properties computed from emitted control flow | Keep with control; these cannot be proved by reusing only the plan's structural check |
| Compiler and host ABI validation | Actual final Wasm/imports/exports at artifact and instantiation boundaries | Different objects/boundaries from plan validation; outside this extraction |

No validation deletion is bundled into PS-10. The useful simplification is clear
ownership and fewer hidden dependencies. A later removal needs a specific
equivalence argument and the existing rejection owner, not a blanket “validated
upstream” assumption.

## Two implementation slices

**PS-10 A — preparation/schema/runtime support.** Add the context, schema and
support modules. Preserve the root export and error identity. Move existing code
and strings, reuse current codec/crypto/stage accessors, and pass the current
control results explicitly into support. Keep expressions/control/assembly in
root for this slice. Acceptance: its diff exposes the inputs above, moves no
plan/provider authority, and preserves source/manifest/blocks for the corpus.

**PS-10 B — expressions/control/final assembly.** After A is reviewed, move
expression aliasing/rendering and control construction/layout to their two
owners. Provide a stable `exprName` after preparation and defer final declarations
until their current assembly point. Keep each mutable builder private and hand
finished values to support/assembly. Root becomes an ordered orchestrator with
small source/result assembly functions. Acceptance: no residual shared mutable
bag, unchanged naming/order/flags/ABI/diagnostics, and matching deterministic
generated source and artifacts under identical inputs/toolchains.

Do not split out a third spine/provider/optimizer redesign. If preserving an
ordering dependency requires an architectural rewrite, report that dependency
before expanding the work. Both slices change structure; neither claims a size
win or promotes an optimization mode.

## Representative generated-output corpus

The capture used existing fixtures, validated every plan, emitted twice from the
same object, checked source/hash/manifest/blocks, and checked that the input JSON
was unchanged. It separately generated twice from JSON copies and recorded that
representation's source identity. The report contains exact recipes and counts.

| Fixture | Existing owner (under `wasm/test/` unless stated) | Blocks / chunks | Responsibility exercised |
| --- | --- | ---: | --- |
| minimal-request | `performance/fixtures.cjs` | 2 / 0 | Small unpartitioned module and absent optional sections |
| schema-effect | Same | 5 / 0 | Schema imports/exports, decoder, suspension/resumption |
| multi-route | Same | 31 / 9 | Handler ownership and owner-partitioned dispatch |
| grouped-fetch | Repository `examples/03-fetch-composition` | 34 / 7 | Grouped effect ordering and resume requirements |
| router-errors | Repository `examples/09-router-lowering` | 89 / 12 | Shared error guard, protected entries, partition accounting |
| shared-stages | `runtime/compiler-efficiency/o18-reusable-stage.cjs:fixture(2)` | 74 / 8 | Shared stage entries/sites/accessors, state, registrations, expression identity |
| nested-schema | `fixtures/projects/schema-nested-json` | 47 / 0 | Nested JSON projection/admission and optional schema fields |
| effectful-helper-loop | `lowering/assert-loop-helpers.cjs` default body/helper | 46 / 5 | Effectful helper entry/return, bounded read-loop and guard weights |
| pure-helper-loop | `lowering/assert-pure-loop-helpers.cjs` default body/helper | 26 / 3 | Pure helper declarations/slots, loops and schema support |
| mixed-events | `events/assert-events-native-runtime.cjs:compileProject(root, 'mixed')` | 21 / 3 | HTTP/event selection, conditional event ABI and invocation state |
| generated-output | `runtime/str03a-generated-output.cjs:source` | 10 / 0 | Output effects and manifest policy |
| bounded-transform | `runtime/str03c-bounded-transforms.cjs:source` | 12 / 0 | Transform/read-loop/output policy composition |
| guest-crypto | `crypto/assert-crypto-native-guest-source.cjs:compiledWithCrypto()` | 22 / 7 | Selected HS256 guest source, provenance and crypto manifest |

This generation-only corpus maps responsibilities, not every supported expression
or error path. It invokes no ASC, Wasm runtime, provider deployment or performance
campaign. Terminal package source bypass, indivisible oversized dispatcher states,
retention transform behavior and malformed-plan diagnostics were traced to their
existing owners, not newly qualified by these rows. No fixtures, registered tests,
CI steps, seal checkpoints or dependencies are added.

For PS-10, use this corpus as a before/after development comparison and select
existing affected tasks from `wasm/test/suite/registry.cjs`: `schema-codecs`,
`crypto-native-guest-source`, `events-native-runtime`, `canonical-api-lowering`,
`canonical-native-wasm`, `shared-stage-o19`, `bounded-loop-helpers`,
`pure-loop-helpers`, `str03a-generated-output`, `str03c-bounded-transforms`, and
`fastly-native-platform-capabilities` as relevant to the slice. In particular,
`canonical-native-wasm` already invokes `native-dispatcher-partitions.cjs` for
large dispatchers, oversized states and runtime parity. Reuse current semantic
and rejection owners; do not resurrect historical optimization campaigns.
The scope classifier still selects required portable checks for each actual diff.

Compare deterministic artifact bytes with matching settings/toolchains, and reuse
the small [PS-08 campaign](../ps08/README.md) serially for compile/RSS/artifact
regressions. Its three small fixtures are not a stress test of every branch above.
Keep timing separate from concurrent validation and explain environment/noise
limits. No repeated full seal is part of this mapping or its development corpus.

## PS-09 validation

The final capture exited successfully with **13/13** rows and a terminal passed
report. An initial attempt incorrectly required original/JSON-copy source
equality and exposed the shared-stage identity dependency above. A second attempt
completed its 12 rows but inherited keepalive timers from two fixture modules and
was interrupted; the final capture excluded those timers and added the existing
crypto fixture. Earlier attempts remain distinct development artifacts and are
not counted as passing runs.

Maintainer/documentation synchronization and checks, release documentation
validation, whitespace and scope declaration passed. The binding inventory was
also checked against the source AST, and the shared-stage plan and its JSON copy
both passed plan validation with the recorded distinct source hashes.
Production compiler sources and test selection have no diff in PS-09.
