# RPT8-00: entry identity and final-body proof

Repository-only implementation handoff. This is a synthetic producer proof, not
a new Report contract or production coverage claim. The active contracts remain
in [current-contracts.md](../../architecture/current-contracts.md).

RPT8-01 follow-up: the task below now checks production v2 attribution and runs in
the unit/CLI profiles. It adds bounded-size cells, multi-body handlers, shared
route stages, and shared helper consumers. The original findings below describe
the RPT8-00 baseline; current behavior is owned by the architecture contract.

## Result and reproduction

Two repeated, transfer-capable middleware registrations can be joined to one
surviving final Wasm stage body using existing canonical identity. No new export,
retention rule, optimizer change, or compiler refactor is required for that case.
Unfactored `next` and error entries still have no authoritative entry-to-body
record after control lowering. A dispatcher carrier is not a route-owned body.

Run from the repository root with lockfile-pinned workspace dependencies:

```bash
node wasm/scripts/run-wasm-tests.cjs --task cli-report-entry-proof --no-report
```

At RPT8-00 this was an explicitly selected feasibility task outside aggregate
profiles; RPT8-01 promotes it to production regression coverage. It reuses the
[PRPT-00C final-emission observer](../prpt00c/capture-transform.cjs) and the
[PRPT-03 capture boundaries](../prpt03/README.md), rather than starting another
capture implementation or evidence campaign.

The fixture is `wasm/test/fixtures/report/transfer-router.ts`; the assertions are
in `wasm/test/cli/assert-report-entry-proof.cjs`. It has nine application entries:
six routes, two middleware registrations, and one error recovery entry. It covers
ordinary response, conditional response/`next`, error transfer/recovery, one
effectful shared stage, repeated middleware, and one handler at distinct paths.
An exact duplicate route method/path/handler is rejected by the existing
`PULSE_CANONICAL_ROUTER_DUPLICATE_ROUTE_HANDLER` diagnostic.

| Build cell | Proven entry joins | Shared registrations / bodies | Current Report route bodies | Unmapped dispatcher entries |
| --- | --- | --- | --- | --- |
| Portable, default | 6 / 9 | 2 / 1 | 4 / 6 | 3 |
| Fastly, default | 6 / 9 | 2 / 1 | 4 / 6 | 3 |
| Portable, experimental-native-size | 6 / 9 | 2 / 1 | 4 / 6 | 3 |

Each cell compiles a control and an observed artifact. Each build invokes the
real generator and asc once. Assertions compare the complete Wasm, including
custom sections, generated source, and normalized compile recipe. The observer
serializes names from the same optimized module; it does not recompile with
`--debug`. It verifies identical non-custom sections and restored serialization.
The size cell also exercises convergence emissions without treating them as final
capture. Seven request cases run against both artifacts in every cell: 42 total,
including response/status and effect-count checks on Node and the Fastly test host.

The test records the actual control/layout results from that generator invocation.
It pairs each completed chunk with the actual emitted declaration by its exact
ordered program-counter cases, then joins the exact qualified symbol to the
verified final function census. It never derives a Wasm index from chunk order or
guesses an optimizer alias. Shared registrations resolve to the same physical
indices. Missing final names stay unavailable; mismatched handler ownership fails.
Raw captures and artifacts are temporary; stdout contains only bounded counters.
The test deliberately asserts today's production gap: four of six route body
measurements available, two `unsupported-mapping`, and no Own/Shared values.

## Field-to-producer map

Paths below are repository-root-relative. These are existing owners, not proposed
new modules.

| Field / boundary | Authoritative producer | Preserved meaning or loss |
| --- | --- | --- |
| Entry `stableId`, `handlerId`, `index`, `nextIndex` | `wasm/packages/compiler/src/spine/router-topology-frontend.js`, `stableEntryId` and `cleanExecutionEntry` | Entry identity distinguishes registrations and retains the handler-table identity. Entry IDs include topology/order context; they are not a promise of cross-edit identity for future diff views. |
| `generatedRange`, `nativeBody`, retained entry ownership | `wasm/packages/compiler/src/spine/router-handler-ir.js`, `emitCanonicalRouterFromHandlerIrs` | Only terminal routes without `router-transfer` receive a private native body. Other entries remain cursor-gated branches. |
| `plan.routing`, `plan.handlers[].{id,handlerId,family}` | `wasm/packages/compiler/src/canonical-native-plan.js`, `privateHandlerBody` and plan assembly | Terminal entry ID is the body ID. Routing identity survives even when no private body is created. |
| Effect/continuation `routerEntryStableId`, `applicationEntryStableId`, route/event fields | Same plan owner, effect and continuation construction | Canonical execution ownership exists before emission. These IDs must be retained, not inferred from generated names or display labels. |
| `plan.stages[].{id,handlerId,registrations}`; effect `stageId`, `stageSite` | `wasm/packages/compiler/src/shared-stage-plan.js`, `lowerSharedStages` | Each registration retains `entryId`, `nextIndex`, `effectIds`, `continuationIds`. Equivalent eligible transfer bodies share one implementation. |
| Control block `id`, `handlerId`, `boundary`; completed chunks | `wasm/packages/runtime-core-as/src/compiler/canonical-native-control.js`, `buildNativeControl`, `layoutNativeControl` | Terminal/stage bodies have implementation ownership. Inline cursor branches retain transfer boundary state but do not set an entry owner. Chunk partitioning depends on `handlerId`; using it for new entry annotations would change lowering. |
| Actual declaration name and ordered state cases | Same control owner, `chunkName` and function rendering | The renderer knows the exact terminal/stage/helper declaration. There is no explicit emitted-symbol record today. The proof observes this output; production must return metadata from the renderer itself. |
| Manifest `handlerBodies`, `stages`, `helperBodies`, `dispatcher` | `wasm/packages/runtime-core-as/src/compiler/canonical-native.js`, result assembly | Terminal rows carry entry ID, handler ID, chunk IDs. Stage rows carry stage ID, handler ID, chunks, and only a registration **count**. Registration identities are lost here. |
| Generated source and capture prefix | `wasm/packages/compiler/src/canonical-native-compiler.js`; `packages/provider-fastly/src/build/native-platform-capabilities.js` | Both ordinary Router and transfer/error Router use the same canonical generator. Fastly copies its ownership manifest and adds the host shell. Prefixes are `canonical-native.as/` and `fastly-native-platform-capabilities.as/`. |
| Final `functions`, `handlerBodies`, `chunkMappings`, artifact hash | `wasm/packages/build-support/src/report-capture.js` and `report-capture-transform.cjs` | The passive v1 adapter consumes only terminal ownership and excludes stage/helper chunks. Its physical census still sees their bodies. Capture is bound to final emitted bytes. |
| Sidecar validation and route measurement | `wasm/packages/cli/src/internal/report/{schema,completion,size}.js` | v1 validates entry/chunk/index identity, then joins route entry canonical ID and verifies handler ID. Missing ownership is unavailable; incomplete roots cannot establish complete reachability or Own/Shared. |
| Binding/schema/resource inventory | `wasm/packages/cli/src/internal/report/inventory.js` | Uses effect ownership, literal resources, registry schema IDs, generated ranges, and embedded asset payload metadata. Dynamic resource expressions, range-only schema association, and partial generated-resource inventory need producer work in RPT8-02/04. |

The separately supplied `plan.packages.application` path in the portable compiler
and Fastly `package-native-application.js` is a trusted package-root application
path. It is **not** the alternate lowering for Router `next`/error handlers, and
this fixture does not qualify it. Nor does it qualify event entries, mounts,
shared helpers, arbitrary transfer shapes, or post-guest-link identities.

## Smallest proposed metadata handoff

For RPT8-01, return a versioned, observational generator manifest member
`reportOwnership: { version: 'pulse.native-report-ownership.v1', entries, bodies }`.
Do not add it to the executable plan: the serialized plan contributes to the
embedded plan hash, so an otherwise unused plan property can change Wasm bytes.

| Record | Minimum fields | Rules |
| --- | --- | --- |
| `entries[]` | `entryId`, `handlerId`, `bodies: [{chunk, relation}]`, `reason` | Preserve each registration and allow multiple bodies per entry and multiple entries per body. Relations distinguish `terminal-body`, `shared-stage-body`, and `dispatcher-carrier`. No proven relation means an empty list and a reason, not a guessed body. |
| `bodies[]` | `chunk`, `symbol` | Build-local chunk key and exact declaration name, returned by the existing render operation. The realizing owner supplies the existing file prefix. No names reconstructed by ordinal conventions. |

Populate terminal rows from `plan.handlers` and shared-stage rows from
`plan.stages[].registrations`. At the manifest boundary preserve those entry IDs
instead of only the registration count. Reuse the actual completed chunk layout;
do not invoke the generator again. Existing preparation, flow, control, layout,
and assembly functions already provide sufficient atomic boundaries.

For inline transfer/error entries, first carry a separate observational entry ID
from the canonical cursor-branch admission into control records. Do not overload
`handlerId`, change partitioning, introduce private bodies, or infer ownership by
AST resemblance downstream. If the existing representation cannot expose that ID
without executable change, keep `entry-ownership-not-retained` and split the work.
An eventual carrier join must be labeled as such; its bytes cannot be presented
as the handler's exclusive body or a complete route root.

The final adapter should consume explicit symbols and retain one physical body
per `(artifactSha256, functionIndex)`. A missing/ambiguous symbol is unavailable;
there is no forced retention, fallback alias, new export, or second compilation.
RPT8-01 should introduce a versioned attribution envelope (v2) with the necessary
entry relations, evolve the reader/schema/validator in the same change, and keep
v1 replay behavior explicit. Do not silently reinterpret v1 `handlerBodies` as
all application entries. Completeness requires all expected bodies and canonical
entry/handler agreement; a shared carrier does not complete the root universe.

## Follow-on ownership and stop conditions

| Ticket | Producer and reader work | Boundary |
| --- | --- | --- |
| RPT8-01 | Control renderer → generator manifest → both realizing owners → capture → attribution schema/validator → `size.js` | Implement the joins above with this fixture as a starting point. Keep body identity and physical deduplication separate from display labels. Add tests for one-to-many bodies and retained replay. |
| RPT8-02 | `spine/handler-ir.js` (`staticResource`, provider effect sites), Router ownership and schema references → native plan → `inventory.js` | Resolve binding/schema/resource identities while authoritative context exists. Today `staticResource` makes nonliteral expressions dynamic; the reader must not reverse-engineer them. Deduplicate by semantic kind and resolved identity, preserve distinct identities, leave unknowns null. |
| RPT8-03 | `build-support/src/report-direct-graph.js` → capture envelope → reader observations | Internal failures distinguish tables/elements, indirect/reference/tail calls, parse/name/index disagreement, and budgets; capture currently collapses them to `unsupported-call-graph`. Expose bounded structured reasons. No general interprocedural solver. |
| RPT8-04 | `contracts/src/assets/embedded.js`, generated codec/resource owners and their emission manifests → `inventory.js` / `size.js` | Inventory generated resources before identity is lost. Distinguish authored input bytes, descriptor bytes, and retained final payload bytes. A tiny handler body does not measure its CSS/JS payload. Do not attribute data by byte-pattern guessing. |
| RPT8-05 | Installed CLI replay and integration acceptance | Exercise completed producers on representative private/production workflows. Keep private source, logs, catalog data, and raw evidence outside repository fixtures. |

Paths in the last table without a leading workspace prefix are under
`wasm/packages/`. No public schema, compiler behavior, ABI, retention policy,
artifact bytes, or Report presentation changes land in RPT8-00. Final guest-link
capture, payload attribution, and a complete Own/Shared root universe remain
separate unresolved work. Any need for forced retention, new exports, optimizer
changes, or general interprocedural analysis is a stop condition, not an implicit
extension of this ticket.
