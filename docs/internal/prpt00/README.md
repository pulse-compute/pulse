# PRPT-00 — Report design lock and Wasm evidence feasibility

Repository-only implementation handoff, 7 October 2026. Base: `latest` at
`858618a0c04e236b01d992241c87f3b2d222d94e`. Human direction: “Implement PRPT-00”; PRs target `latest`.
Class: documentation/evidence. Entry point: none; the ordinary root and docs
instruction chain applies to this feasibility packet. Product, compiler,
provider, public documentation, release and package behavior are unchanged.

**The inventory and physical byte ledger are feasible. Exact route-body bytes
are not established by the current retained artifacts.** The one compiled
fixture has three routes and explicit handler-to-generated-chunk records, but no
map from those chunks to final Wasm function indices. A names-based research
harness is not a passive production map. Do not implement a guess in PRPT-03.

The [reviewed v2 specification](feature-spec-v2.md) is retained as the planning
input, not documentation of a shipped command. Its plan v2 is distinct from the
proposed first capsule version. [proof.json](proof.json) contains the actual
bounded measurements and fixture identities; [proof.cjs](proof.cjs) reproduces
the read-only proof against an already compiled fixture.

## Gate disposition

| Gate | Result | Consequence |
| --- | --- | --- |
| 00A design contract | Locked to the four reviewed ARC assets, including expandable schemas; user accepted this direction before requesting PRPT-00 | Implement that interaction contract, not a redesigned dashboard |
| 00A interactive exercise | Source/data/previews checked; browser unavailable in this environment | Browser interaction, keyboard and narrow-screen execution are unverified, not passed; retain explicit PRPT-05/06 acceptance |
| 00B inventory/physical sizes | Proven bounded producer paths and one real compiled artifact | PRPT-01 can freeze the capsule with explicit coverage states |
| 00B fresh-report eligibility | Existing manifests contain useful identity but do not meet the complete Report lifecycle contract | PRPT-02A is required; do not treat legacy manifests as fully eligible merely because `status` says built |
| 00B route-body mapping | 0/3 fixture routes have a trustworthy retained final-index map | Scope decision: accept unavailable C/D for initial delivery, or commission a separately bounded post-optimizer mapping proof before promising them |

This packet completes the bounded investigation. The attribution decision is
submitted for human review, not silently approved. No optimizer redesign,
additional names compilation, whole-program analysis or full release suite was
performed. Approval of inventory/ledger delivery must not be worded as proof of
per-route sizes.

## 00A: exact design contract

The files remain in the Library root. Their exact byte hashes are in `proof.json`.
The identifiers below are retrieval references, not runtime dependencies or
fixtures to embed in a real report. No private application source is copied into
this repository packet.

| Asset | Stable Library ID | Required use |
| --- | --- | --- |
| `Pulse-Report-ARC-Design.html` | `libfile_100f5d9a5f50819184645a70682216c6` | Interactive slate/offline design baseline |
| `Pulse-Report-ARC-Fixture.json` | `libfile_32ec6c1d74588191a978cf6b1711235f` | Synthetic data and unavailable states |
| `Pulse-Report-ARC-Preview.png` | `libfile_360db7e68a8c8191815af424236670d3` | Route-view density/layout; its older capsule hash is not current data authority |
| `Pulse-Report-ARC-Schemas-Preview.png` | `libfile_f341642103488191997a93cbe81204f9` | Updated schema inventory; rows are collapsed in this preview |

Checked: HTML embedded payload equals the JSON fixture, the capsule SHA-256 is
valid, and all 20 synthetic descriptors have correct UTF-8 byte counts,
top-level counts and required counts. Both preview images were visually reviewed.
Source inspection confirms schema expansion controls, details and reverse route
links. The mock's cosmetic viewer v0.1 label does not revert the v2 plan.

| Interaction | Locked behavior | Qualification still required |
| --- | --- | --- |
| Application/route overview | Compact snapshot/host/target/evidence header, route-first table, registration order as initial order, visible/total counts | Real capsule, empty/partial inventory |
| Search/filter/sort | Route/handler search, independent group/method/declaration/binding/size-availability filters, reset; raw numeric byte sorts with unavailable last | Unknown states and sort direction; no inference from labels |
| Size mode | Handler body / Own (exclusive reachable code) / Reachable / Shared, with the metric named | All-unavailable mode stays usable and explains why |
| Route detail | Resolved facts / Size attribution / Evidence trail; ordered composition and source references | Focus handling, keyboard dismissal and narrow screens |
| Schemas | Search schema/field names; sort keys, required keys, descriptor bytes and route counts; expand property name/type/required, descriptor basis, provenance and route links | Both expanded and collapsed desktop/mobile states, keyboard controls, unknown versus optional |
| Resource/binding views | Physical ledger, input versus retained payload bytes, logical bindings, reverse references | Partial mapping and shared-resource counting |
| Capsule/export | Export the entire unchanged canonical capsule regardless of filters/theme/detail state | Decode equals canonical JSON, hostile strings inert |
| Shell | Restrained slate, light/dark, responsive drawers/tables, offline `file://`, no framework/CDN/network | Browser execution, screen-reader semantics and mobile layout |

“Updated schema views” covers the inventory update, including update-contract
schemas. It does not add schema editing, migrations or report diffing. Descriptor
size remains structural, never validator Wasm size. The source mock is a visual
reference, not production-safe renderer code: for example, schema DOM IDs are
derived from schema IDs, whereas the real renderer must generate safe IDs.

## 00B: source ownership and field coverage

Paths refer to this base checkout. In the table, `cli/`, `compiler/`,
`contracts/`, `schema-json/` and `build-support/` abbreviate their directories
under `wasm/packages/`; `spine/` abbreviates `wasm/packages/compiler/src/spine/`.
These are inspected owners,
not assumed public APIs. Future changes must read their nested instructions and
declare protected paths. The new Report modules belong in the CLI; do not move
schema/compiler ownership into the viewer.

| Report field/claim | Canonical producer or retained location | Coverage and next action |
| --- | --- | --- |
| Host, selected target/profile, reporting | `wasm/packages/cli/src/internal/project-context.js` (`selectedProfileDocument`, `projectPlanDocument`); `project-config.js` | Allowlisted projection exists. Host `node` and target `native` are separate facts. Do not serialize the entire resolved project |
| Root/source/config discovery | `cli/src/workspace.js`; `compiler/src/project-config-compiler.js`; `contracts/src/project/config-plan.js` | Reuse discovery and static config owners; avoid importing the test harness as a side effect |
| Route method/path/order/identity | `compiler/src/spine/router-handler-ir.js` (`emitCanonicalRouterFromHandlerIrs`); `compiled.metadata.router`; manifest `program.routing`; native plan `routing` | Route and execution-entry records are retained, including mounted topology. Preserve both identities and original ordering; fallback/error/use records are not HTTP registrations |
| Handler/entry linkage and source | `spine/router-topology-frontend.js` (`cleanExecutionEntry`, handler table); `router-handler-ir.js` entry `nativeBody.source` and `generatedRange`; native plan `handlers` | Handler body locations exist in the fixture. Registration location is not guaranteed by cleaned route records; project collection must preserve authoritative topology location or mark unavailable. Generated offsets are not authored locations |
| Composition | Routing `entries`, `nextIndex`, `routerPath`, child/parent continuation fields and canonical terminal-next semantics | Ordered structural composition only; conditional checks and short-circuits are not a request trace |
| Request/response schemas and usages | `compiled.metadata.schemaReferences`; `plan.schemas.references`; handler IR `schemaReferences`; package-managed handlers; Entities inspection | Preserve known use sites/roles. A global schema reference alone does not establish a route edge; project sidecar must persist a supported handler/entry join or disclose partial coverage |
| Schema properties/counts | `schema-json/src/compiler/schema-registry.js` (`extractSchemaRegistry`); `contracts/src/schema-json/registry.js`; `canonical-schema-codecs.js` | Real fixture extraction confirms object `root.fields[]` with `name`, `required`, `value` and source. Current schema roots are objects. Do not invent union/reference support absent from the actual grammar |
| Schema descriptor bytes | No Report descriptor representation yet | PRPT-01 freezes an allowlisted projection from normalized schema IR, deterministic serialization and representation version. Never measure raw TS, raw registry including source paths, or generated validators under this label |
| Declared/bound bindings | Project plan `bindings`, `application.project.symbolicBindings`, package fragments and provider requirement records | Names/configuration are not live resource existence or route grants. Generic KV/assets/etc. mappings require package-owned projections, not config dumps |
| Referenced capabilities/bindings | Canonical Handler IR effects, native plan effects, package inspection and managed handler effects | Persist exact literal logical names/entry links when available; dynamic or lost linkage remains unavailable. Capability counts are not isolation proof |
| Authorization | Explicit package metadata where supplied, e.g. `packages/entities/pulsewasm.compiler.cjs` `inspectionForPlan`; otherwise ordered middleware references | No general resolved HTTP effective-policy matrix found. Package metadata is arbitrary input and needs an allowlist. Never infer public/admin from path, function name or crypto effect |
| Non-HTTP entries | `cli/src/project-execution.js` (`eventInspectionProjection`, `writeEventInspectionArtifacts`); event catalog and outbound requirements | Existing static events are retained separately. Target eligibility is not delivery/execution evidence; no new event feature is proposed here |
| Embedded assets | `packages/assets/pulsewasm.compiler.cjs`; `contracts/src/assets/embedded.js` | Literal manifest supplies path/media type/input byte length/hash. Exclude base64 `data`, embedded body and lookup payloads. No general final data-segment ownership map found; retained per-asset payload bytes may be unavailable |
| Package resources | `canonical-project-compiler.js` package inspection; `writePackageInspectionArtifacts` and hash-bearing manifest references | Reuse explicit package artifact contracts; do not promote all arbitrary package fields to Report facts |
| Wasm identity and physical sections | `canonical-native-compiler.js` (`inspectCanonicalNativeWasm`, `writeCanonicalNativeModule`); manifest `native.wasm` or `portable.wasm`; O-08 `binary()` | Exact bytes/hash and A/B ledger proven. O-08 parser assumes bounded data expressions; extract/harden a small parser instead of importing its compile/disassembly harness into CLI |
| Provider-final Wasm | `project-execution.js` `buildProject` `providerTarget`; selected provider writer, e.g. `packages/provider-fastly/src/build/native-platform-capabilities.js` | Portable intermediate and provider-final module are different artifact identities. Never attach a portable body map to provider bytes. Bare downstream JavaScript-runtime Wasm is not canonical Native evidence |
| Handler bytes | Native manifest `handlerBodies[].chunks`, `canonical-native-control.js` chunks, retention transform | Generated chunk mapping exists; final-index mapping is absent. No route-body measurement is supported by this fixture |
| Own/Reachable/Shared | O-08 research direct-call census | Requires full root coverage and trustworthy final route roots; unavailable in this proof. No disassembly subprocess in Report |
| Recipe/toolchain | Native manifest AssemblyScript version; `build-support/src/native-optimization.js`; provider-final metadata | Default portable manifest omits `optimization` in the fixture. Persist the actual effective recipe even for default flags, transforms, merging and guest linking; do not invent it from a missing field |
| Source/input identity | `canonical-handler-ir.js` source/project hashes; `application.project` config/plan hashes; reachable graph owner | Useful constituent identities, not a complete retained input manifest. `projectSourceHash` is a constructed IR/source fingerprint, not a guarantee of every dependency/config/asset input. Selected profile source can also differ without changing semantics |
| Git/dirty state | Local Git observation, when available, plus completed-build snapshot | Optional context; no VCS requirement and no replacement for fingerprints. Export normalized paths only |
| Diagnostics and recorded tests | Existing compiler diagnostics and separately retained test reports | Producer/scope/identity must match. Do not run doctor/tests; do not copy package capability policy booleans into a “recorded suite passed” claim |

## Required eligibility and input contract

Two unsafe shortcuts were found in existing CLI code:

1. `inspectProject()` calls `compileNativeProjectInMemory()` and may invoke
   provider realization. It is not a read-only collector for Report.
2. `loadConventionalProject()` loads `testsFile` through `loadProjectHarness()`;
   the TypeScript loader executes module top level. Skipping test *cases* alone
   does not satisfy Report's no-test-execution boundary. Add a deliberate
   metadata-only resolution path using the existing owners, with harness-import
   canaries. Artifact replay must bypass `ProjectContext` creation altogether.

`inspectArtifact()` currently checks existence then parses arbitrary JSON. It
does not validate kind/version/hash/sidecars; reuse its dispatch boundary, not
its acceptance rule.

| Input | Observed shape | Proposed Report treatment |
| --- | --- | --- |
| `pulse-compile.json` | `pulse.project-execution.v10`, `status: compiled`, `target: portable-native-wasm`, `native.wasm` and plan/manifest paths | Candidate input adapter, only with the new completed-evidence contract and verified required bytes/sidecars |
| Native `pulse-build.json` | Same execution version, `status: built`, `buildMode: native-provider`, `configuredTarget: native`, `portable` and `providerTarget` | Candidate adapter; identify portable and final artifacts independently, accept only fully matched completion evidence |
| JavaScript `pulse-build.json` | `buildMode: javascript-source-package` | Reject, including a later Fastly JavaScript runtime wrapper binary |
| Saved `pulse.application-report`, `reportVersion: 1` | Proposed, not emitted today | Strict schema/hash/reference validation; historical replay without project loading or fresh artifact-presence claim |
| Native leaf manifest, plan-only JSON, bare Wasm, unknown/older kind/version | Insufficient whole-application completion evidence | Reject; no heuristic fallthrough or partial successful report |

Legacy v10 is therefore a **candidate adapter version**, not an unconditional
allowlist. PRPT-01 must name/version the additional completion envelope (or a
new enclosing manifest version); PRPT-02A emits it. Existing artifacts without
that envelope must receive an actionable rebuild instruction. Retained research
evidence can establish facts for this feasibility review without becoming an
eligible new Report capsule.

### Completion record ownership and lifecycle

PRPT-02A belongs at CLI `buildProject` / `compileNativeProject` orchestration,
using native/provider writers' facts. The native writer itself already records
valid Wasm length/hash; a new reporting serializer must not own compilation.

- After safe output resolution, invalidate the designated report completion
  record before a new compile/build attempt, including `--no-clean`. Native
  `buildProject` currently compiles before output cleanup, so a failed attempt
  can leave earlier files. An old `status: built` alone cannot prove the last
  attempt succeeded. Historical saved capsules retain their old-snapshot meaning.
- Publish completion atomically only after successful required writes and
  verification of all required artifact hashes. Bind selected profile, effective
  recipe, normalized input/dependency identities, structural evidence and actual
  Wasm bytes; hash required sidecars as well as the executable.
- Compare the current selected input identity in project mode, including dirty
  inputs, schema/config/package/asset changes. Read verified bytes once per
  collection snapshot; fail inconsistent concurrent reads. A matching Git SHA
  or a guessed artifact filename is insufficient.
- Separate local matching data from shareable allowlisted evidence. Existing
  config hashes include normalized fragments; assess secret-bearing values
  before exporting any config/plan hash. Do not export arbitrary config objects,
  resolved secrets, secret-derived hashes or embedded source/assets.
- Preserve allowed output containment/symlink checks without calling
  `cleanOutputDirectory()` from Report. Its only intended persistent write is
  the designated atomic HTML replacement. Failure must not replace a prior
  report or print a success path.

Freeze reason states in PRPT-01, then map to public diagnostic catalog/exit
classes in PRPT-04: unsupported target/kind/version; missing completion;
failed/incomplete attempt; stale inputs/profile/recipe; missing required Wasm;
checksum/reference/path failure; malformed/oversized input; optional evidence
unavailable. Node Native is not an unsupported target. Historical replay does
not validate today's source tree.

## Bounded binary proof and size ceiling

One successful default portable compilation of `examples/01-hello-json`:

| Measurement | Observed value |
| --- | ---: |
| Wasm file | 2,353 B |
| File header | 8 B |
| Code section including framing | 1,075 B |
| Function bodies, including local declarations | 1,048 B |
| Data section including framing | 549 B |
| Initialized data payload | 400 B |
| Other physical sections | 721 B |
| Defined function bodies | 21 |
| HTTP route registrations | 3 |
| Routes with final-body mapping | 0 / 3 |

Artifact SHA-256:
`9ea79658959e83d19353f73e73f16b1f9634a11dec962823aa50dfadf3af8479`.
`8 + 1,075 + 549 + 721 = 2,353`; code framing is 27 B. The proof resolves exact
exported ABI function indices to their measured bodies. Those ABI functions are
not independent route roots and their sizes are not route-body sizes.

The native manifest maps the three handlers to chunk ordinals 5, 3 and 1.
They are generator ordinals, not final Wasm indices. This optimized binary has
no custom name section. The retention transform runs before final optimization;
merging and final emission still matter. Capturing its pre-optimization names
or assigning final functions by positional coincidence would not prove identity.

**Recommended scope disposition:** ship A/B and structural route/schema views,
keep handler/Own/Reachable/Shared metrics explicitly unavailable where mapping
is absent, and retain the size selector/coverage UX. If route bytes are required
for the first release, first prove a small final-emission mapping hook that
records identity after all optimization/linking and leaves executable bytes
identical. That follow-up is not approved or implemented here. O-08's matching
names companion is a valid research technique but forbidden automatic Report
work. No proportional allocation or source-length surrogate is acceptable.

## Planning corrections and packet deltas

These findings qualify the imported specification; they do not change product
behavior in PRPT-00.

| Correction | Why / owner |
| --- | --- |
| Say “JavaScript target/source package” where the plan says “Node/JavaScript target” | Node Native is a valid Wasm host. Eligibility is representation-based. A provider-neutral compile from a JS-configured project is a separate Native artifact; PRPT-01 must identify its selection explicitly rather than label the JS build eligible |
| Reuse metadata producers, not `inspectProject()` or full default project loading | Avoid native compilation and harness import; PRPT-02/04 |
| Require passive completion metadata | Current v10 has useful constituents, not the full lifecycle/identity gate; PRPT-01/02A |
| Freeze a schema projection before metrics | Fixture uses illustrative JSON-schema-like descriptors; real owner uses object `root.fields`. Translate the actual IR with explicit coverage, not a new frontend; PRPT-01/02 |
| Make route-body delivery conditional on the human size decision | Final-index map is missing; preserve unavailability instead of using chunk IDs as indices; PRPT-03 |
| Treat fixture code as design input | Production safe IDs/unknown handling/accessibility remain implementation work; PRPT-05 |

No eighth broad ticket is needed. Keep assignments from v2: Astra/xhigh for 00,
Sol/high for 01/03/05/06, Sol/xhigh for 02, Sol/medium for 04. PRPT-02A is now
confirmed necessary; its 02B sub-gate is the narrow collector/replay path.
The ticket table is an effort recommendation, not evidence of the model used
to execute this investigation. No sub-agents were launched.

## Qualification corpus and remaining measurements

- **Minimal measured fixture:** `examples/01-hello-json` at the base above;
  native Node profile, three routes, no declared schemas. Input hashes are
  recorded in `proof.json`.
- **Schema producer fixture:** `examples/02-request-schema/src/schemas.ts` at
  the same base; extraction only, no second Wasm build. Its two object schemas
  demonstrate fields/required/source. Descriptor byte policy remains PRPT-01.
- **Embedded-resource fixture:** the existing `assets-native-embedded` task and its
  source-owned fixture in `wasm/test/assets/assert-native-embedded.cjs` are the bounded asset producer proof
  for PRPT-02/03; use a completed real app with assets in PRPT-06 as A13 requires.
- **Real smaller app:** ARC remains the intended consumer; the four ARC design
  files are synthetic and cannot satisfy real-app acceptance. Pin actual ARC
  source/profile/artifact identity before PRPT-06. No ARC build is claimed here.
- **Large source snapshot:** `nw/catalog` main at
  `54a5bb5876f228a5778b66fb9beb2b2007cf5d18`, tree
  `8ef4cf60cf16f92c95418800db1d4f64eefc0ee2`, resolved read-only during this task.
  No private source, route names or application payload was imported. This is
  a source pin, not a completed artifact: PRPT-06 must retain matched completed
  Wasm/sidecars, selected profile/recipe and compiler dependency identity before
  measuring. The small in-repo Catalog routing subset is not Catalog-scale proof.

PRPT-06 measures report generation versus artifact replay/rendering separately,
records elapsed time/RSS/output size and actual inventory counts, and proves
guest-byte identity with/without passive metadata. None of those report overhead
or unchanged-sidecar claims can be measured before implementation. No universal
performance budget or historical 83/86-route estimate is imposed.

## Reproduction and validation

Use the lockfile-pinned workspace with scripts disabled; do not install a new
production dependency. Commands from the repository root:

```sh
corepack pnpm@12.4.2 install --frozen-lockfile --ignore-scripts
npm run build
node wasm/scripts/pulse.cjs compile examples/01-hello-json --out .pulse/prpt00 --json
node docs/internal/prpt00/proof.cjs examples/01-hello-json/.pulse/prpt00/pulse-compile.json /absolute/path/to/the/four/ARC-assets
```

The explicit compilation is feasibility setup. The proof script only reads its
completed output and extracts the schema fixture; neither is the future Report
command. No names companion or full matrix is needed. Reproduction on a changed
checkout must retain its own source identity rather than claiming this baseline.

Attempts retained in the task history: system pnpm 11.25.0 was rejected by the
repository engine requirement; the pinned 12.4.2 retry installed successfully.
An initial `--out-dir` invocation was rejected before compilation; the documented
`--out` retry completed. The browser runtime was absent and its pinned download
failed with an invalid/truncated ZIP, so no browser pass is claimed.

Repository validation and final commit/PR state are recorded in
[validation.json](validation.json). Full release qualification belongs to the
existing release workflow, once the feature and human scope decisions are ready.
