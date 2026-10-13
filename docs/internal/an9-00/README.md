# AN9-00 — prove the compiler analytics association contract

Status: original evidence-only handoff. AN9-01 now implements definitions and
registration retention in the optional analytics block; the other recorded gaps
remain follow-up work. The proof rejects malformed current analytics rather than
treating the now-owned key as an unknown field.
Investigated against `latest` at `3bee78387f46d7933d987bbb3f8273bc7b711a37`
(includes IMP9-01 and IMP9-02). This is repository-only investigation material,
not a public support promise or hosted documentation page.

The association work is feasible using existing compiler owners. Retain authored
handler/use-site identities before normalization, carry them as passive metadata,
and derive contextual associations from canonical registration and helper-call
links. Neither guest layout changes nor general interprocedural analysis are
needed for the demonstrated cases. Exact authored-site → lowered-effect joins
are **not currently available** and must not be guessed.

## Reproduce

With the lockfile-pinned dependencies installed and workspace built:

```bash
node wasm/scripts/run-wasm-tests.cjs --task compiler-analytics-an9-00 --no-report
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --skipLibCheck docs/internal/an9-00/contract.ts
```

The explicit task writes `wasm/.test-results/an9-00-*/summary.json`, a full
`authored-trace.json`, and the four in-memory report capsules. It verifies the
committed [selected producer examples](examples.json). Regenerate those examples
only deliberately with `node docs/internal/an9-00/proof.cjs --update-examples`.
The examples are compiler input/proof records, not instances of a new report
schema. The [wire schema](contract.ts) specifies the proposed report projection.

This investigation asserts known deficiencies and is excluded from aggregate
release profiles. Replace the relevant gap assertions with product acceptance
in AN9-01–04; do not preserve a defect merely to keep this proof passing.

## Fixture and measured result

One [authored fixture](fixture/index.ts) exercises root middleware with a
conditional early response, scoped middleware, a child router mounted at `/api`
and `/v2`, a handler reused at `/direct-a` and `/direct-b`, repeated `REGION`
reads plus `OTHER` (both config bindings), two callers of one effectful helper,
error transfer/recovery, an event entry, and a dynamic config name. A synthetic
npm source package supplies the [helper and imported handler](fixture/package.ts)
through the IMP9 ordinary-source import path. It is not a trusted lowerer.

The full frontend/Native-plan trace has **12 handler definitions, one helper,
18 registrations, two mount instances and 11 HTTP routes**. The full fixture
reaches Native planning but AS generation rejects the event/error combination.
Two variants isolate that existing limitation: HTTP omits only the event block;
event omits only the error route/handler. Omitted text is whitespace padded so
original line and offset coordinates remain unchanged. A third source-location
variation copies the package implementation into a project module solely to
isolate the retained-snapshot gap described below.

| Imported-source variant | Native recipe | Wasm bytes | Executions with projection on/off | Local-source replay |
| --- | --- | ---: | ---: | --- |
| HTTP + error | default | 12,786 | 28 | passes |
| HTTP + error | experimental-native-bounded-size | 11,999 | 28 | passes |
| HTTP + event | default | 9,738 | 28 | passes |
| HTTP + event | experimental-native-bounded-size | 9,060 | 28 | passes |

All **112 executions** check responses/status and dispatched binding names/order,
including early stop, scoped/sibling routes, helper callers, repeated reads,
dynamic name selection, missing route, error recovery and event dispatch. Event
dispatch accesses only `EVENT`, without HTTP root middleware. `/api/plain` and
`/v2/plain` access only `ROOT`, never `SCOPED`. `/error` accesses `ROOT` then
`RECOVERY`. The bounded recipe leaves the existing semantic route projections
unchanged. Size is recorded for context, not treated as semantic ownership.

For each cell, disabling the existing report-reference projection leaves the
Native plan, generated AS, Wasm bytes and optimization manifest identical.
This proves noninterference of the existing projection seam; it does not qualify
an analytics implementation that has not been written. Normal completion of the
local-source variant replays successfully in a fresh process that rejects loads
of compiler, provider, TypeScript, project configuration/execution, subprocess
and network modules. Imported-source replay remains unavailable in all cells.

## Exact producer and loss points

Paths below are repository-root relative; named functions are the ownership seams.

| Fact | Authoritative producer | Current loss / handoff |
| --- | --- | --- |
| Authored handler definition | `wasm/packages/compiler/src/spine/router-topology-frontend.js`, handler table exposed by `topologyForCanonicalRouterOutput` in `spine/canonical-router.js` | Handler ID, declaration location, source hash and uses exist. `wasm/packages/cli/src/internal/report/inventory.js` emits IDs/names on routes/entries, without a first-class definition table. |
| Imported handler/helper source | `wasm/packages/compiler/src/project/router-module-linker.js`, `sourceHelpers`, linked source files and handler table | Imported handler retains npm source file and authored location; helper ID is linked source identity plus export/local name. Preserve these trusted records before generated-source reparse. A filename alone must not grant package/lowerer trust. |
| Registration and mount instance | topology `entries[].entry`, `rawEntry.loc`, execution-plan child/next/parent-return indices | `inventory.application()` retains some flow but drops registration expression spans. `routerPath` identifies router definitions: both mounts share that path, so it is insufficient to identify a mount instance. |
| Authored recognized use | `spine/handler-surface-authority.js`, `inspectCanonicalRouterSurfaces` and `sourceModelForRouterRecognition().surfaceForNode()` | Recognition facts retain start positions but omit per-fact file and end. Join the original node by identity to the descriptor's `sourceFile` before normalization. This produces exact UTF-16 spans without text/offset guessing. |
| Normalized per-handler capabilities | `spine/router-handler-frontend.js`, `analysisForSurfaceFacts` / `normalizeRouterHandler` | Managed handlers use `source-statement` operations; root `canonicalIr.effectSites` is empty although `capabilities` includes `config.get`, `req.header`, `response.text`, `state.set`. Recognition and normalization still know the authored owner. |
| Lowered effect and helper consumer | `wasm/packages/compiler/src/canonical-native-plan.js`, effect construction, helper-call validation | Effects carry direct entry or helper IDs and canonical capability. `source` uses generated metadata file/positions. Validated helper calls carry `helperId` and `callerEntryId`. These are safe owner joins; no retained per-occurrence authored node link exists. |
| Binding reference inventory | `wasm/packages/compiler/src/report-reference-provenance.js`, `calls()`, `owners()`, `add()` | Helper callers are propagated. Resolved references deduplicate by kind/name and union consumers, discarding individual use sites, operations and authored spans. Keep this inventory identity; add a separate use-site relation. |
| Route capability association | `wasm/packages/cli/src/internal/report/inventory.js`, effect/declaration loop | Only `applicationEntryStableId` / `routerEntryStableId` are used. `helperId` has no owner here. Global capability declarations do not establish per-handler ownership. |
| Contextual route composition | same inventory file, `application()` and final composition union | Index order + router-path prefix collects candidate middleware/mounts. It does not prove scope predicates, mount instance, early return or error continuation. Existing `bounded` coverage must remain visible. |
| Retained source admission | `wasm/packages/cli/src/internal/report/snapshot.js`, `dependencyRoots`, `finishSnapshot`; `retained.js`, `publishBuild` | Snapshots cover project files and release/toolchain dependencies, not arbitrary npm source imports. Their `compiled.watchFiles` cannot be bound; completion is withheld with `REPORT_INPUT_UNBOUND`. |

### Findings demonstrated, not inferred completeness

1. **Helper capability gap confirmed.** `/helper-a` and `/helper-b` have
   `HELPER_TOKEN` in their binding inventory but omit `secret.get` from their
   declaration associations. The Native helper effect explicitly carries
   `secret.get`; the validated caller IDs match the binding-reference consumers.
2. **Synchronous capabilities lose their owner.** Recognition/handler IR includes
   response, request and state operations. Route capability associations come
   from effects, so `response.text` is absent even on the tested terminal routes.
   Do not derive capability solely from binding kind.
3. **Scoped middleware is overassociated.** Both plain child routes list `SCOPED`
   through bounded composition although runtime dispatch proves it is skipped.
   `/error` conversely omits `RECOVERY` from its current route binding union.
   Present candidates and incomplete coverage honestly until AN9-03.
4. **Original-source spans are recoverable before normalization.** Imported
   `packageHandler`'s `config.get` is authored on package line 7; helper
   `secret.get` is on line 2. Native effect positions instead point into emitted
   `src/index.ts`. The proof uses recognition-node identity for handlers and
   explicitly labeled diagnostic recognition replay on the linked helper node.
   Production router recognition does not yet retain the helper's use site.
5. **Npm source needs snapshot admission.** In-memory reports exist, but normal
   imported compilation records `REPORT_INPUT_UNBOUND`; replay returns
   `REPORT_MISSING_COMPLETION`. AN9-04 must bind the exact already-resolved
   ordinary source inputs without trusting or discovering new lowerers. Local
   replay passing is not evidence that this imported path is already supported.
6. **Combined event/error Native generation is a separate defect.** The full
   fixture fails with `PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED`, “Router
   application errors require explicit compiler-owned entry boundaries.” In
   `wasm/packages/runtime-core-as/src/compiler/canonical-native-control.js`,
   `buildNativeControl` requires protected boundaries for every
   routing entry when errors exist; its cursor branch protection covers HTTP
   entries, while this plan also contains an event entry. The isolated variants
   compile and execute. Repair/qualify that execution issue separately; analytics
   must not change layout to work around it.

## Frozen handoff: schema and identity policy

[contract.ts](contract.ts) freezes the proposed **optional**
`analytics: { version: 'pulse.report-analytics.v1', ... }` extension for AN9-01–04.
It is a TypeScript wire specification, not an installed API or runtime validator.
AN9-01 implements its closed JSON schema and graph validation alongside its first
producer, keeping not-yet-produced tables explicitly unavailable. Existing report
fields and inventories remain readable and keep their current meaning.

- **Definition versus use:** one handler row per compiler handler identity; role
  lives on registration. Reuse keeps two entry IDs. Mount rows have no authored
  handler. Helpers are separate definitions; a consolidated stage is never a
  user handler. Synthetic/fallback records explicitly say `authored: false`.
- **ID rules:** reuse `stableReportId('handler', canonicalHandlerId)` and existing
  report entry IDs. Helpers use `helper:` plus SHA-256 of canonical JSON
  `["helper", canonicalHelperId]`. Use-site IDs use `use:` plus SHA-256 of
  `["use", ownerId, file, startOffset, endOffset, surfaceId]`. A source range plus
  surface is one authored observation even when used by multiple registrations.
  Include canonical operation as an additional discriminator only if the
  canonical recognizer produces multiple operations for the same surface/node;
  reject collisions rather than assigning positional counters.
- **Call/association IDs:** `call:` hashes `["call", callerId, calleeId,
  file, startOffset, endOffset]`; unavailable authored call spans use an explicit
  compiler call identity within this build, never a generated offset presented
  as authored. If neither is available, omit that edge and mark coverage partial.
  `association:` hashes `["association", consumerRegistrationId,
  useSiteId, orderedVia, lane]`. All digests use canonical JSON and full SHA-256.
  The runtime/compiler IDs themselves must not change for reporting.
- **Identity lifetime:** IDs are deterministic for identical bound inputs, not
  guaranteed stable after edits, changed package contents, path renames or
  toolchain changes. Existing handler IDs include source hashes/inline context.
  AN9-06 must separate exact identity from an explicitly labeled comparison
  match; no fuzzy identity by name, similar body or Wasm bytes.
- **Operations and bindings:** keep three source observations for the two
  `REGION` reads and one `OTHER` read. Reuse the two existing kind/name inventory
  identities. Capability/operation comes from canonical recognition/IR, never
  a report-owned lookup inferred from the binding. Dynamic names keep null
  binding IDs and explicit dynamic state; missing evidence is `unknown`, not
  dynamic. No expression or resolved value is serialized.
- **Source:** exact authored `[start,end)` with one-based line/column and full
  authored file hash. Generated positions cannot fill authored source fields.
  Missing source is an explicit unavailable fact. Package provenance must come
  from linker/trusted producer records, not by parsing a display path.
- **Context:** preserve next/child/parent-return links and an ordered mount-instance
  path. Derive associations from canonical control predicates/continuations plus
  bounded validated helper calls. `via` explains the dependency path; `lane`,
  conditionality and coverage are separate facts. A complete static association
  still does not mean it executed on a request. Error/event lanes remain distinct.
- **Validation:** IDs unique, references resolvable and of the right kind; a use
  site has one owner; resolved bindings point to matching existing reference and
  binding rows; dynamic/unknown uses have null target. `complete` requires known
  expected count equal to observed and null reason. Partial/unavailable requires
  a reason; unavailable has zero observed and null expected. Set-valued IDs are
  sorted/deduplicated; ordered flow and `via` paths retain order. Unknown fields
  are rejected. Evidence producers are allowlisted and values/source bodies
  excluded. Native occurrence counts and byte ownership are not use-site counts.

### Compatibility and unsupported joins

New readers must accept legacy capsules without `analytics` and present
analytics as unavailable. The existing strict reader rejects an unknown
`analytics` key at the investigated base (before AN9-01). `createCapsule` projects away unknown fields,
so round-tripping through it is **not** forward-compatibility validation. Update
schema/projection/validation together in AN9-01; update completion hash binding,
passive replay and absent-data viewer handling in AN9-04. Do not claim old
binaries can read the new block; if that becomes a requirement, decide an
explicit version/sidecar migration first.

No exact source-site → Native effect occurrence, consolidated stage → authored
statement, or physical byte → handler dependency mapping is frozen here. Those
joins require explicit producer lineage. Do not match generated offsets, effect
order, source text, Wasm names or equal sizes. Arbitrary dynamic calls, recursion,
path-feasibility analysis and transitive dependency internals are outside this
bounded contract; retain partial/unavailable coverage instead of inventing them.

## Implementation flow

| Ticket | Concrete next work from this proof | Completion gate |
| --- | --- | --- |
| AN9-01 | Retain handler/helper definitions, registration spans and canonical flow/mount instances; implement minimal optional schema/validator. | Reuse is one definition/two uses; two mounts remain distinct; absent analytics is unavailable. |
| AN9-02 | Retain authored recognition nodes/spans before normalization, including linked helpers; share canonical capability and binding ownership projection; retain validated call edges. | Repeated operations remain distinct; helper capability follows both callers; sync operations need no binding; dynamic remains unresolved. |
| AN9-03 | Derive contextual associations using scope/match and continuation facts; separate normal/error/event paths and early-return conditions. | Plain child routes exclude scoped use; error recovery is explained; event does not inherit HTTP middleware; no claim of request execution. |
| AN9-04 | Admit exact imported npm source inputs to passive snapshot; persist optional analytics, validate/hash/replay and support older capsules. | Imported-source completion/replay passes without compiler/provider execution; malformed/dangling graph rejected. |
| AN9-05 | First-class handler list and definition detail, registrations, helper callers and capability/binding use-site drill-down with source/coverage. | Reused handler appears once; mount/middleware path is visible; unavailable source stays unavailable. |
| AN9-06 | Compare semantic inventories/associations with explicit identity coverage. | Bounded/default byte changes cannot masquerade as capability/binding changes. |
| AN9-07 | Qualify integrated report and noninterference in both recipes; retire investigation-only expected-gap checks as product tests take ownership. | Close or explicitly isolate combined error/event defect; imported replay qualified; no size-derived execution claim. |

Size/shared-size remain a later physical-attribution workstream. If bounded size
becomes the default, choose semantic ownership from authored/compiler identities
and record the actual recipe in provenance; do not key dependencies to whichever
stage/body layout the default happened to emit.
