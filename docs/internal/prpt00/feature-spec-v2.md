# Pulse Report
## Feature specification and implementation handoff

**Status:** Plan v2 (specification v0.2, reviewed) · design direction locked · **Updated:** 7 October 2026 · **Repository:** `pulse-compute/pulse`
**Planning baseline:** `latest` at `1dbc6c9623dca55f274715bdc8eca5e31652e5df`
**Scheduling:** Planned for beta.7 before resuming seal/publish, following the release-session decision to pause after bootstrap/setup and include Pulse Report. This review does not execute implementation, sealing, or publishing. PRPT-06 supplies the Report handoff to the existing release gate.
**Version distinction:** “v2 plan” means the second specification revision (v0.2). The first shipped Report feature and its capsule remain v1 / `reportVersion: 1`.

> **Inspect explains the plumbing. Doctor diagnoses problems. Report records facts and evidence.**

`pulse report` is a **successful-Wasm-build evidence export**, anchored by a navigable route table. It provides a concise terminal overview, a complete versioned JSON capsule, and a self-contained HTML viewer of that same capsule. It exposes what Pulse has resolved and what has actually been measured—without deciding whether an application's policy or design is correct.

This is a feature specification, not an implementation claim or a mock report containing measured application results. Command additions and payload fields below are proposed contracts. The ARC HTML mock and its JSON capsule are **synthetic design fixtures, not compiler output or evidence of ARC production behavior**; see §19. Existing integration points are identified separately in §15.

---

## 1. Product decision

The feature answers: **“What Wasm application did Pulse actually compile, what evidence supports that description, and where do its bytes live?”**

The primary review surface is the resolved route table: method and path, handler identity, composition, schemas, declared authorization metadata, referenced bindings, and attributable size. A reviewer can move from a route to its supporting evidence without navigating compiler internals.

| Surface | Purpose | Depth |
|---|---|---|
| `pulse report` | Understand the application at a glance. | Compact, noninteractive terminal summary. |
| `pulse report --json` | Preserve and consume the full evidence capsule. | All report records and provenance; no display truncation. |
| `pulse report --html` | Review, sort, filter, and drill into the same evidence. | One standalone HTML file with embedded data, CSS, and small vanilla JavaScript. |

HTML, not Markdown, is the rich report format. The Markdown form of **this specification** is a handoff document, not an additional output format for the command.

### Success criteria

A developer can locate a route, identify its resolved declarations and dependencies, follow their provenance, and sort reliably attributed handler/resource sizes. A maintainer can retain a report beside a build and later identify exactly which snapshot and artifact it described. Missing knowledge is visible rather than replaced by optimistic defaults.

### Core design rule

**Collect once → validate and redact once → serialize one capsule → render multiple views.**

The viewer must not re-interpret source code, reconstruct authorization policy, run a compiler, or independently calculate application facts. Sorting, filtering, byte formatting, and navigation are presentation operations. **No successful, identity-matched Wasm output means no newly generated report.**

## 2. Boundaries and non-goals

Report is **Wasm-only observability tooling** inside the existing CLI package. It must not add a runtime dependency, change the application programming model, or become a new compiler optimization project. Node Native is a valid Report host; the JavaScript target is unsupported. Eligibility follows the produced representation, as established by PRPT-00B and frozen in [PRPT-01](../prpt01/README.md).

| In scope | Explicitly out of scope for v1 |
|---|---|
| Inventory and provenance from a successfully compiled, matched Wasm build. | Source-only or JavaScript-target report generation; reporting a failed, stale, or missing Wasm build as successful. |
| Resolved application inventory and source provenance. | Inferring business policy, scoring security, or recommending architecture. |
| Explicit declarations and already-produced diagnostics. | A second doctor implementation, new RBAC heuristics, or automatic remediation. |
| Exact artifact totals and honest, supported attribution. | Counterfactual savings estimates, per-route rebuilds, general whole-program analysis, or optimizing to make reporting easier. |
| Versioned JSON and a small offline HTML viewer. | A dashboard service, SPA framework, viewer plugin system, telemetry, or hosted reporting. |
| Existing hash-bound build/test/measurement records. | Running tests, stress tests, benchmarks, deployment checks, or live requests to populate a report. |
| Stable identity and reproducible exports. | Report comparison, historical trends, regression budgets, signatures, attestations, or CI policy gates. |

A route-table “audit trail” means **traceability from a reported fact to its source/build evidence**. It is not a log of production requests, a historical change log, or a certification that access control is correct.

## 3. Proposed command contract

```text
pulse report [directory] [--profile <name>] [--json | --html] [--out <file>]
pulse report --artifact <file.json> [--json | --html] [--out <file>]
```

| Invocation or option | Required behavior |
|---|---|
| No format option | Print a small human overview to stdout. No interactive terminal UI. |
| `--json` | Emit one complete versioned capsule followed by a newline. No progress text on stdout. |
| `--html` | Write a standalone HTML report and print its location. Do not open a browser. |
| `--out <file>` | HTML output file only in v1. Default: `.pulse/reports/pulse-report.html` under the selected report root. |
| `[directory]`, `--profile` | Reuse existing discovery and profile selection. Report does not invent target-selection flags. |
| `--artifact <file.json>` | Read a saved report capsule for **historical replay**, or a supported completed-Wasm manifest with verified artifact identity; do not load project code. Accepted kinds are enumerated and version-checked. |
| `--dry-run` / `--plan` | Reuse existing CLI planning semantics. Describe input/output intent; do not collect or write a report. |

`--json` and `--html` are mutually exclusive. `--out` without `--html` is a usage error. `--artifact` is exclusive with project/profile selection. A bare Wasm binary is not enough to claim a whole-application route report and is not a v1 input form.

```bash
pulse report
pulse report --profile edge --json > pulse-report.json
pulse report --profile edge --html
pulse report --artifact ./dist/pulse-build.json --html
pulse report --artifact ./pulse-report.json --html --out ./review.html
```

The build-manifest example follows the existing inspect documentation; PRPT-00 must confirm which emitted artifact versions can supply report evidence. Unknown input kinds must fail clearly, not fall through to heuristic parsing. [S1]

### Output and exit behavior

Successful reporting returns zero even when optional evidence is unavailable. An application warning remains an observation, not a report failure. Report has no `--strict` or size-threshold gate in v1.

Invalid arguments, unsafe output paths, unsupported target or failed Wasm build, missing/stale/unmatched Wasm evidence, unsupported capsule versions, invalid capsule hashes, explicit artifact checksum mismatches, malformed required input, and failed project resolution use the existing CLI diagnostic/exit-class system. They must not produce a reassuring success report. JSON failures follow the existing machine-readable error convention rather than mixing an error into human output.

Resolve output paths using existing physical-containment and symlink protections. In project mode, the root is the selected project. In standalone artifact mode, it is the input file's parent directory. Allow atomic replacement of the designated regular HTML output; reject symlinks, escapes, and non-HTML output targets. No unrelated output cleanup is permitted. Report files must not be added to deployment packages by this feature.

## 4. Collection modes and side effects

### 4.0 Eligibility gate — successful Wasm compilation

**A fresh Pulse Report requires a successful Wasm compilation and an existing, hash-/snapshot-matched emitted Wasm artifact.** Merely selecting a Wasm target, successfully resolving TypeScript, or producing an in-memory execution plan is insufficient. Report does **not** initiate compilation to satisfy this prerequisite.

| Input state | Required behavior |
|---|---|
| Completed Wasm build, matching source/profile/recipe and artifact | Generate terminal, JSON, or HTML report from retained evidence. |
| JavaScript target/source package (even if functioning perfectly) | Unsupported target; **no report**. Node Native remains eligible. `inspect`/`doctor` remain available separately. |
| Wasm target selected, compile failed or incomplete | Error with existing compile/build diagnostics; **no report**. |
| Wasm target selected, compiled artifact absent or mismatched/stale | Error identifying missing/mismatched evidence; **no fresh report**. |
| Previously saved, validated Wasm report capsule | Render/export as a historical snapshot; no rebuild and no claim about the current project. |

Eligibility is about the **representation successfully produced**, not an AssemblyScript-specific implementation, not Fastly hosting, and not a universal proof of deployment/runtime correctness. Individual size and reachability facts can still be explicitly unavailable inside an otherwise eligible report.

### 4.1 Project mode

First discover the selected profile’s retained completion record without starting a build. Then reuse the canonical project resolution/inspection path as needed to validate source/profile/recipe identity; emit a capsule only after the completed-Wasm gate passes. Collect structural metadata from its existing resolved model; do not parse the same application independently. Reading and in-memory frontend resolution have the same trust boundary as today's inspect operation. PRPT-00B must distinguish this from native/provider compilation and identify any existing resolution side effects; reusing inspect must never silently initiate a Wasm build. This is **not** a sandbox for arbitrary third-party project configuration. [S1, S2]

Look for the completed Wasm artifact only through the selected profile's established output/manifests. Check artifact bytes/hash and source/profile/recipe identity against the resolved snapshot before emitting a report. A convenient filename or matching Git commit alone is insufficient for a dirty working tree or changed profile. Additional optional test/measurement evidence must independently match its claimed scope.

Report does not run an additional native/provider build to obtain missing numbers. **With no matching successful Wasm artifact, the command fails rather than generating a source-derived partial report.** Once that gate is satisfied, optional handler/reachability measurements can still be unavailable with explicit reasons. It never silently uses a stale binary.

### 4.2 Artifact mode

Read supported JSON records and safe, explicitly referenced sidecars. **An eligible build manifest must prove completed Wasm output and its matching identity; a JavaScript build manifest is unsupported.** A saved Wasm report capsule may be replayed without revalidating a current project. Do not evaluate TypeScript configuration, import application modules, execute handlers, load executable plugins, or invoke a toolchain.

A saved capsule is replayed as a historical snapshot. Rendering it with a newer CLI must preserve the evidence identity; it must not merge in today's project state. **A manifest that lacks proof of an eligible, matching completed Wasm build is not sufficient input**—do not render a partial whole-application report. An eligible manifest may still omit optional measurements: disclose their coverage rather than manufacturing missing routes or declarations.

Validate linked file identities when their bytes are available. A completed-build manifest’s required Wasm artifact must be present and hash-matched; its absence is an eligibility error. Missing optional sidecars produce an explicit unavailable state. A validated historical capsule remains independently replayable without its original Wasm file, with no claim of present-byte verification. A present file that contradicts a declared checksum is an integrity error. Linked local paths must remain inside the allowed artifact root; URLs must never be fetched.

### 4.3 Build once, observe many times

The required path is an existing **successful Wasm build** plus its retained evidence, not “report performs a second build.” Small passive metadata sidecars may be added to the established build path only where necessary. PRPT-02A owns their emission and lifecycle; PRPT-00B identifies the exact producer and PRPT-01 freezes the contract. If current builds lack sufficient retained evidence, fail with an actionable rebuild instruction rather than backfilling a success marker from source. A failed/interrupted rebuild must not leave an earlier completion record eligible for the changed inputs; bind evidence to the bytes actually read and reject detected concurrent mutation. They must not alter executable output, optimization flags, retention, or lowering semantics.

No report mode launches tests, contacts KV/object stores, resolves live secrets, runs npm, deploys, publishes, or performs remote verification. HTML is the only intended file write from the command itself; temporary/internal behavior must follow existing CLI conventions and be disclosed.

## 5. Evidence semantics

The capsule must distinguish **availability**, **basis**, and **coverage**. These are factual qualifiers, not confidence scores. The **completed-Wasm eligibility gate** is a prerequisite for a new capsule; it is not an “available/unavailable” property that permits a source-only report.

| Dimension | Meaning |
|---|---|
| Available | The field has evidence supporting a value. |
| Unavailable | Evidence is missing, unsupported, stale, or not collected; include a stable reason. |
| Not applicable | The metric does not apply to this representation or target. |
| Declared | Explicit metadata supplied by the application/configuration. |
| Resolved | A result from Pulse's canonical resolution model. |
| Measured | A value obtained from identified bytes or a recorded measurement procedure. |
| Recorded | A retained test/build observation with its original scope and identity. |
| Exact / bounded / partial | Qualifies the measurement or mapping method; never implied by a precise-looking number. |

Use one small reusable fact/measurement record rather than a new generic evidence framework. Sensitive conclusions—authorization, size attribution, target execution, parity—must have evidence references and explicit coverage.

**Unknown is not zero. No recorded check is not a pass. No visible auth declaration is not “public.” No visible capability reference is not proof of isolation.**

Existing compiler/doctor diagnostics may be included with their original producer, code, and scope. Report may emit its own input-integrity/coverage diagnostics, but it must not add policy judgments or run doctor to fill a panel.

## 6. Route table: the primary review surface

### 6.1 Default presentation

| Column | Content |
|---|---|
| Method | Resolved method or explicit method set. |
| Route | Full resolved path, including router/group prefix. |
| Handler | Stable report identity and useful authored name where available. |
| Declarations | Compact authentication/authorization declaration summary; otherwise “not declared” or “unavailable.” |
| Schemas | Request/response schema references or counts. |
| Bindings | Referenced logical bindings, with resolution state. |
| Handler body | Final mapped code-body bytes when supported; otherwise `—` with a reason. |

The selected host/target belongs in the report header unless route-specific evidence actually differs. Do not repeat noisy values in every row. Additional sizes and composition details belong in the drill-down or optional columns.

### 6.2 Route drill-down

Show the declaration/registration location, resolved path and method, authored handler identity, ordered composition records, request/response schema IDs, explicit policy metadata, logical binding references, available size facts, and links to the corresponding capsule evidence.

Preserve registration order and duplicate/overlapping registrations. The viewer can sort rows without rewriting dispatch order. Explain whether a count is **registrations**, **distinct method/path pairs**, or **handlers**; these are not interchangeable.

The resolved middleware sequence is not a recorded execution trace. Conditional checks, short-circuiting, error paths, and dynamic decisions must not be presented as unconditional runtime behavior unless the canonical metadata explicitly supports that claim.

### 6.3 Coverage and non-HTTP applications

Distinguish an explicitly empty route inventory from an unavailable or partially resolved one. Preserve fallback/error registrations with their actual kind. Do not coerce event registrations into HTTP routes; expose existing non-HTTP entry inventories in a secondary section. Existing CLI documentation already describes static event evidence and target-specific eligibility, so a whole-application report must not erase that plane. [S2]

### 6.4 Authorization visibility without policy inference

Only render policy relations supplied by authoritative metadata. A function named `requireAdmin`, a route beginning `/admin`, or a verifier effect does not by itself prove that every request is authenticated or that a particular role is required.

Where structured authorization metadata is absent, show middleware/declaration references and state the limitation. Do not add a new RBAC language or inspect arbitrary handler logic to fill a cell. Any future role/action matrix must be a direct rendering of declared relationships, not an inferred effective-permission model.

A “public routes” summary is allowed only when explicit evidence supports that classification and its coverage is shown. Otherwise prefer **“routes with recorded auth declarations”** and a separate unknown/not-declared count.

## 7. Schemas, bindings, and resources

Each inventory item needs a stable ID, kind, available provenance, and reverse references to routes/entries where established. The **ARC fixture establishes a schema-comparison UX requirement**: top-level property counts, required-key counts, and a clearly identified comparable descriptor size when a canonical descriptor is available.

| Inventory | Reportable evidence |
|---|---|
| Schemas | Registry identity, schema IDs, canonical top-level key count and required-key count when structurally defined, property name/type/required details, normalized descriptor byte length and basis where available, usage references, and separately attributable final generated bytes **only** where supported. |
| Bindings | Logical name, kind, selected-profile mapping metadata that is safe to disclose, and declaration/reference/resolution status. |
| Embedded assets | Logical asset name, media type if known, input byte count, retained payload byte count if mapped, encoding, artifact identity, and usage references. |
| Generated resources | Validators, schema data, shared helpers, or support groups only where a trustworthy existing map identifies them. |
| Other entries | Existing event/error/entry records with their own kind and coverage. |

Separate **declared**, **referenced**, and **bound** capabilities. A referenced binding is not a proof that the host enforces a per-route grant. Configuration mapping is not proof that a live remote resource exists.

**Schema size semantics:** `descriptorBytes` is the byte length of a documented, deterministic UTF-8 serialization of the **normalized schema descriptor**, with representation/version recorded. It is a structural comparison metric, **not** validator Wasm bytes, object-instance size, peak memory, or savings from deleting a schema. `topLevelKeys` and `requiredKeys` describe the top-level object only; arrays/unions/non-object forms show *not applicable* where key counts do not mean anything. If the normalized descriptor or its property model is absent, show *unavailable*, not zero. Size and count sorting must use underlying numbers, never rendered labels. Required status is true/false only where authoritative evidence resolves it; unsupported status remains unknown. PRPT-01 must define descriptor normalization for references, unions, constraints, recursive forms, ordering and encoding, and distinguish the internal normalized descriptor from the allowlisted property projection exported to viewers. Descriptor bytes identify the exact representation measured, including whether a redacted projection is used; do not hash secret-bearing defaults/examples or export raw descriptors just to reproduce the metric. An expanded schema view exposes known property name/type/required status and referencing routes; nested detail is optional and must not be invented.

“Resource size” means program/build resource bytes, not live KV/object-store inventory. Report does not enumerate remote stores or read stored objects.

Do not dump raw schemas, source code, generated code, or asset bodies merely because JSON is the complete capsule. Completeness means all records in the report contract, not every internal compiler structure. UI hiding must never be used as a secrecy mechanism.

## 8. Size attribution: useful without false precision

### 8.1 Required measurement layers

**Layer A — artifact ledger:** exact byte length and hash of each observed artifact; representation, host, target, build recipe, and toolchain identity where recorded. Native Wasm, JavaScript source packages, deployment archives, and compressed variants are separate measurements, not interchangeable sizes.

**Layer B — section/resource ledger:** code, data, custom metadata, other framing/sections, and mapped embedded-resource bytes. Preserve unattributed bytes explicitly. An unattributed bucket is not a finding of bloat.

**Layer C — handler attribution:** expose sortable final handler-body measurements where a trustworthy mapping already exists or can be supplied through a small passive sidecar. Never substitute lowered-source length or an unoptimized companion's size.

**Layer D — Own / Reachable / Shared:** supported when route-root mapping and call-graph coverage justify the definitions below. This is opportunistic v1 enrichment, not permission to build a generalized analyzer or delay the rest of report.

A v1 report must ship A/B and honest coverage behavior. C must be demonstrated on a supported fixture if feasible within the existing mapping boundary. If that mapping cannot be obtained without compiler redesign, PRPT-00 must record the limitation for explicit scope approval rather than quietly promising route sizes. D may remain unavailable on real applications where the proof is incomplete.

### 8.2 Exact units and accounting

Store nonnegative integer bytes in JSON. Display B/KiB/MiB with exact bytes available in details; do not mix decimal MB with binary MiB. Store the method and representation with every measurement.

For Wasm, preserve a reconciliation of the file header plus physical sections to the file's exact byte length. Function-body measurements include local declarations and instructions; section framing and body-size prefixes stay in the enclosing ledger. Code-body, data-payload, and total-file measurements are deliberately distinct. [S4]

Resource `inputBytes` and `retainedPayloadBytes` are different facts. Encoding, deduplication, or elimination may change the latter. A shared payload is counted once in the physical ledger, regardless of how many routes reference it. Do not add per-route sizes or original asset lengths to the module total.

Imported host functionality is outside the artifact's code-byte accounting; absence of embedded bytes does not mean zero execution or memory cost.

### 8.3 Handler body versus exclusive code

`handlerBodyBytes` is the sum of final function bodies reliably mapped to that handler implementation. A merged/shared implementation may appear in multiple rows; mark that explicitly. Its bytes are not an exclusive ownership claim.

For the optional reachability view, define a root universe including every modeled route plus startup, error, event, export, and other execution roots. Let `R(r)` be the distinct final code bodies statically reachable from root `r` under the stated method:

```text
Reachable(r) = bytes in the union R(r)
Own(r)       = bytes in R(r) reachable from no other modeled root
Shared(r)    = Reachable(r) - Own(r)
```

Use **“Own (exclusive reachable code)”** in the UI to avoid confusing it with direct handler-body size. This view is code-only unless independently proven data attribution is supplied as a separate metric.

Example—illustrative, not a Pulse measurement: a 200-byte handler with a 600-byte helper shared with another root has 800 reachable bytes, 200 own bytes, and 600 shared bytes. The physical helper is still only 600 bytes in the module ledger.

These are structural reachability measurements, not execution frequency, request memory, runtime cost, or the bytes guaranteed to disappear if a route is deleted. Counterfactual removal savings require a separate controlled build experiment and are outside report.

### 8.4 Attribution limitations that must remain visible

Inlining can place behavior in a surviving caller; function merging can erase source-level exclusivity. A shared dispatcher reached from a module export does not establish distinct per-route roots. Report must not show every route as owning the entire dispatcher or silently equate “reachable from the request export” with “attributable to this handler.”

Indirect calls, dynamic tables, unknown callbacks, unmodeled entry roots, or missing data references prevent exact exclusivity claims. Use a documented upper/lower bound only if the implementation can prove it; otherwise mark the field unavailable. Exclude unavailable values from numeric sorting and place them last.

Never assign shared bytes proportionally to make totals look tidy. Never infer ownership from generated symbol-name patterns alone without a documented, tested mapping contract.

### 8.5 Reuse existing census work; do not rerun its research campaign

The repository's O-08 census already distinguishes function-body bytes, section/data sizes, inlined ownership limits, and unknown helper families. It also rejects unsupported indirect-call/table reachability instead of making incomplete claims. That is relevant groundwork, not proof of universal route attribution. [S3]

Its names-enabled companion workflow checked all non-custom section bytes before using companion names. Report must not automatically run that extra compilation. Reuse retained, verified evidence where available. Equal total sizes or equal source hashes are not a substitute for artifact identity.

## 9. Canonical capsule and provenance

The payload has an independently versioned public schema, separate from npm release versions and existing compiler artifact protocols. Its context/provenance/artifact records must carry the validated Wasm representation and completed-build artifact identity; JavaScript source-package capsules are excluded. [PRPT-01](../prpt01/README.md) freezes the concrete schemas, generated types, golden fixtures, and completion/attribution adapters before renderers are written. It adds explicit declaration, body and root-set inventories to the conceptual outline below.

The conceptual shape is:

```typescript
interface PulseReportV1 {
  kind: 'pulse.application-report';
  reportVersion: 1;
  producer: { pulseVersion: string; reporterVersion: string };
  context: ReportContext;
  provenance: ReportProvenance;
  coverage: CoverageSummary;
  application: ApplicationSummary;
  routes: RouteRecord[];
  entries: EntryRecord[];
  schemas: SchemaRecord[];
  bindings: BindingRecord[];
  resources: ResourceRecord[];
  artifacts: ArtifactRecord[];
  measurements: MeasurementRecord[];
  observations: ObservationRecord[];
  evidence: EvidenceRecord[];
  evidenceHash: { algorithm: 'sha256'; value: string };
}
```

This is an outline, not a claimed complete TypeScript implementation. Use existing CLI success/error wrapping conventions where needed; there must be exactly one authoritative report object, not parallel “raw” and “HTML” versions.

### Identity requirements

Retain available source/input fingerprints, sanitized effective profile identity, dirty-worktree state, relevant dependency/toolchain identities, artifact hashes, optimizer recipe, mapping method/version, and recorded measurement/test scope. A Git revision is useful context, not a complete identity for uncommitted work.

Evidence references must resolve to records in the capsule or to explicitly identified artifact records. Preserve source locations as normalized project-relative paths and line/column ranges where available. No absolute home paths, local usernames, or source content are necessary.

A parity/test result must identify its producer, corpus/cases, targets, input/artifact identity, and original result. Display **“recorded suite passed”** rather than a universal “Node/Wasm parity ✓.” Compilation or target eligibility alone is not execution evidence.

### Determinism and hashes

Given the same evidence inputs and producer version, canonical JSON must be byte-identical. Sort object keys and unordered inventories deterministically; preserve semantically ordered sequences such as middleware and registration order. Define number/string normalization and ID construction in schema tests, not through locale-sensitive formatting.

Do not insert the current clock time into canonical evidence. Original build/test timestamps may remain as recorded facts. A renderer timestamp, if ever introduced, belongs outside the evidence and must not change its identity.

Compute `evidenceHash` over the documented canonical bytes excluding the hash field itself. JSON, terminal output, and HTML identify the same capsule. The HTML's decoded embedded payload must reproduce those bytes, with its own template version kept separate.

A hash supports identity and accidental-integrity checking. It is **not** proof of who produced the report or a trusted security attestation.

### Complete does not mean silently capped

The capsule includes every report record within the supported inventory, not only the largest handlers or first twenty routes. UI summaries may be bounded with explicit counts. If an existing upstream source is itself capped, propagate the omission/coverage metadata; do not relabel the resulting inventory complete.

## 10. Terminal overview

Keep default output approximately one terminal screen. Show application/profile/host/verified Wasm target, evidence identity, inventory counts, available artifact/resource totals, mapping coverage, and counts of existing observations. Include a small route excerpt only when useful; the full table lives in JSON/HTML.

An output contract sketch, with placeholders rather than invented measurements:

```text
Pulse report — <application>
Profile <profile>   Host <host>   Target <target>
Evidence <hash-prefix>   Snapshot <revision/dirty/unknown>

Routes <registrations>   Handlers <count>   Schemas <count>
Bindings <count>         Embedded resources <count>

Artifact <exact/display bytes or unavailable>
Mapped handler sizes <known>/<reported handlers>
Existing observations <count>   Evidence gaps <count>

HTML: pulse report --html
JSON: pulse report --json
```

No security grade, optimization score, fabricated health indicator, or all-green badge. No screen full of generated function names. Deep compiler explanation remains inspect's job.

## 11. Standalone HTML viewer

### Layout

A compact header identifies the application, profile/verified Wasm target, snapshot, artifact identity, and evidence coverage. The route table is the first substantial section. Secondary sections contain resources/sizes, schemas/bindings, recorded observations, and provenance/raw capsule access. **The approved ARC-shaped HTML fixture in the Library (§19) is the visual and interaction baseline for v1**, not a source of measured application facts.

Use a small embedded template with CSS and vanilla JavaScript. No framework, remote font, external script, CDN, telemetry, service worker, or network dependency. Opening the file through `file://` must work; no local web server is required.

### Required interactions

Provide text search across route/path/handler names; filters for method, explicitly reported declaration state, binding, and size availability; numeric sorting by the selected size metric; expandable route/resource details; anchor navigation; and a clear reset control. Match the ARC baseline's route-size selector (**Handler body / Own / Reachable / Shared**), drill-down tabs (**Resolved facts / Size attribution / Evidence trail**), and retained full-capsule export. Show visible/total row counts and preserve unknown states under every filter.

Size sorts compare raw bytes, not formatted strings. A column must identify its metric—“Handler body,” “Own,” or “Reachable”—rather than an ambiguous “Size.” Do not rank incomparable representations or quietly mix exact values and bounds.

The table is intentionally not a compiler graph browser. Limit the default columns, keep provenance one drill-down away, and leave raw function graphs/lowering details to inspect or referenced evidence artifacts. **Schemas** get their own sortable inventory with top-level keys, required keys, descriptor bytes and route references; expanding a schema reveals the known property list and source evidence. Descriptor size must always be visibly labeled as distinct from final Wasm/validator attribution.

### Accessibility and portability

Use semantic table headers, labeled controls, keyboard-operable sort/expand actions, visible focus, non-color-only status labels, and readable empty/unknown states. Support desktop and narrow/mobile screens without crushing the table; horizontal table scrolling or a readable row-detail layout is acceptable. Honor light/dark preferences with no external assets. Preserve the mock's restrained slate palette, compact navigation, table-first density, accessible drawers, visible fixture/evidence qualifiers, and small offline implementation; do not require pixel-identical layout. A print stylesheet is useful but must not become a separate PDF feature.

Filters are view state only; they never delete records from the embedded capsule. Raw JSON access must expose the same capsule, not a reconstructed subset.

## 12. Report safety and disclosure

The report is easier to share than source code, so **redaction occurs before every renderer**. Use an allowlisted report model; do not serialize arbitrary project/config/compiler objects and hide fields in CSS.

Exclude secret values, tokens, credentials, live environment values, request/response bodies, source contents, and embedded asset bodies. Logical binding names and route/schema metadata may still be operationally sensitive: describe the report as a build-review artifact, not “safe for public sharing.” Avoid secret-derived hashes and uncontrolled diagnostic/config dumps.

All payload strings are untrusted presentation data. JSON encoding alone is not safe HTML embedding. The embedding path must protect the enclosing HTML context, including closing-script sequences; DOM rendering should use text nodes/`textContent`, not executable interpolation or payload-derived `innerHTML`. No `eval`, dynamic function construction, payload event attributes, or clickable payload-supplied URLs. Test hostile strings explicitly. [S5]

Use a restrictive, offline-compatible content policy as defense in depth, permitting only the fixed embedded template code/styles needed by the viewer. Do not rely on that policy instead of correct encoding. Internal navigation IDs must be generated safely rather than copied from application strings.

Cap parser input/depth according to documented CLI resource limits and validate schema versions/references. Treat capsule/manifest files as data. Artifact mode must never execute code named by those files. Preserve existing physical file-containment rules. [S1, S2]

## 13. Measurement and cost discipline

Report is a consumer of evidence, not the measurement protocol's executor. It may carry already-recorded build time, peak memory, or test outcomes only with units, method, scope, environment, and source identity. Missing runtime metrics stay missing.

No automatic rebuild, disassembly subprocess, names-enabled companion, target matrix, or full suite is permitted merely to make a report richer. Reuse the existing parser/census where possible; optional heavy evidence remains unavailable unless supplied through an established artifact path.

PRPT-00 must identify a small-app fixture and a large-application snapshot for timing/report-size/RSS measurements. PRPT-06 records the environment and measured overhead, distinguishes fresh project resolution from artifact replay/rendering, and sets future report-specific budgets from those observations. Do not invent a universal millisecond or percentage gate before measuring the baseline.

The executable artifact must remain byte-identical in a controlled comparison with and without passive report metadata generation. Reporting must not modify optimization settings, force retained symbols, inflate the shipped guest, or change runtime allocation behavior.

## 14. Acceptance matrix

| ID | Proof required |
|---|---|
| A01 — one capsule | Text/JSON/HTML summaries and evidence IDs agree. Decoding embedded HTML data reproduces canonical JSON; filters do not change it. |
| A02 — determinism | Repeated exports from identical inputs are byte-identical. Working-directory location, locale, or HTML generation time does not change evidence identity. |
| A03 — route fidelity | Nested prefixes, method sets, duplicate registrations, shared handlers, fallback/error paths, and non-HTTP entries match canonical metadata with original ordering preserved. |
| A04 — no inferred authority | Public-sounding/private-sounding paths, middleware names, custom authorization logic, and missing metadata never become invented effective permissions. |
| A05 — evidence gaps | Inside an eligible report, incomplete upstream inventories, missing optional sidecars, unsupported mappings, and absent parity evidence remain explicitly unavailable/partial—not zero, public, or passed. Missing/stale/unmatched required Wasm evidence instead fails generation under A15. |
| A06 — integrity | Invalid input versions/hashes, mismatched present artifacts, and unsafe linked paths are rejected with stable diagnostics. Historical capsule replay performs no recollection. |
| A07 — size ledger | Final byte totals reconcile; source and retained asset bytes are separate; code-body/section framing distinctions are tested; physical shared bytes are counted once. |
| A08 — attribution limits | Shared/merged/inlined bodies, common dispatchers, startup/error roots, and indirect calls produce correct mapping qualifiers or unavailable values. No fabricated removal-savings claim. |
| A09 — HTML behavior | Offline open, filtering, byte sorting, reset, expansion, keyboard navigation, mobile layout, and all empty/unknown states pass. |
| A10 — malicious data | Script-closing strings, markup, control characters, unsafe URL-like values, and malicious names remain inert in HTML and safe in terminal output. Secret canaries never occur in exported bytes. |
| A11 — no hidden work | Instrumented tests confirm no handler/test execution, network calls, deployment, additional native build, or unrelated output writes. Artifact mode does not import project code. |
| A12 — package integration | Installed command/help/completions/reference agree; template/schema are included in the packed CLI; existing inspect/doctor contracts remain unchanged. |
| A13 — practical corpus | Use a minimal fixture, a real smaller app with assets, and a pinned Catalog-scale application/evidence snapshot. Record actual counts/sizes; do not hardcode conversational estimates. |
| A14 — bounded cost | Retain report generation/RSS/output-size measurements and verify unchanged guest bytes. Document unsupported attribution instead of expanding compiler scope. |
| A15 — Wasm eligibility | Positive: matching successful Wasm build reports, including Node Native. Negative: JavaScript target, build error, absent/stale/mismatched artifact return no new report; historical verified Wasm capsule replays without building. |
| A16 — design baseline | Use the exact Library ARC fixture and mock (§19) as the interaction/visual reference; table-first route view, filters, size-mode sorting, three route detail tabs, schema metrics/expansion, resources, provenance/JSON, offline and mobile flows are retained. Fixture labels remain synthetic. |
| A17 — schema accounting | Canonical descriptor byte counts are deterministic and provenance-labeled; top-level/required counts agree with structural descriptors; non-object/unknown keys are not treated as zero; unknown required status is not optional; descriptor size is never presented as compiled Wasm size. Exercise recursive/reference/union forms and sensitive defaults/examples against the frozen descriptor/projection contract. |
| A18 — build-evidence lifecycle | Sidecars attest only completed output, bind exact source/profile/recipe/artifact inputs, and cannot revive a failed/interrupted/stale build. Detect inconsistent concurrent reads; unchanged successful builds retain stable identity. Missing new metadata in older builds yields an actionable error; report never repairs it by building. |

Uptime is a valuable additional consumer once available, not a dependency required to complete report. Private application fixtures must not leak application contents into the published CLI package.

## 15. Verified integration points and implementation unknowns

The planning baseline was inspected on 7 October 2026 through repository documentation. This is not a full source audit. Recheck the branch and implementation before making changes.

| Existing surface | Integration consequence |
|---|---|
| CLI command specification generates installed help, reference, and shell completions. [S1] | Add report to that owner; do not hand-edit generated reference files. |
| Inspect already supports project/profile mode and existing JSON artifacts; project mode compiles in memory. [S1] | Reuse workflow/input boundaries, not terminal-text scraping or a second source parser. |
| CLI has public project-execution, configuration, diagnostics, and generated machine interfaces. [S2] | Keep orchestration in the CLI boundary and preserve installed-package contracts. |
| Doctor's native-expansion view reuses existing plans and explicitly distinguishes lowered-source bytes from final Wasm. [S2] | Reuse its evidence discipline, not its capped human-facing output as a complete route inventory. |
| Native builds record chosen optimization recipes; JavaScript and Native realizations have different artifact types. [S2] | Carry recipe and representation identity into size records. |
| Existing optimized-Wasm census has artifact reconciliation and bounded reachability checks. [S3] | Evaluate a small reuse/extraction path; do not turn its research harness into a default report build step. |

The feasibility pass must answer where the successful Wasm completion marker and artifact hash live, how project/profile/input fingerprints match, and where complete resolved routes, schema descriptors, schema/binding references, auth declarations, embedded-resource mappings, and final function mappings actually live. Fields without a trustworthy producer remain unavailable. Do not assume a complete effective authorization matrix or exact route call graph already exists.

## 16. Bounded work packets and gates

These packets are the reviewed execution plan for the intended beta.7 feature. This document review does not start implementation. Model assignments are task-sizing judgments using models available in this session, not benchmark results or guarantees. Effort is reasoning depth, not elapsed time. Exact runtime IDs are `gpt-6-astra` (Astra) and `gpt-6.1-sol` (Sol).

| Ticket | Deliverable and ownership | Model / effort | Gate / acceptance ownership |
|---|---|---|---|
| **PRPT-00 — design lock + Wasm evidence feasibility** | **00A:** review the four pinned assets (§19), capture schema expansion and route/drawer/mobile/offline requirements. **00B:** map canonical producers, completion/identity proof, supported input kinds, sidecar lifecycle and cheapest final-body mapping on one retained artifact. Identify small/large qualification fixtures. | **Astra / xhigh** for the combined pass; 00A alone needs high. | Field-to-producer/coverage map, concrete source touchpoints, UI checklist and explicit attribution ceiling. Planning/proof only. A13/A16 preparation. |
| **PRPT-00C — bounded final-byte attribution follow-up** | Approved follow-up to 00B: observe existing optimized emission, prove unchanged Wasm, retain exact direct-body mappings and qualified partial/shared-dependency evidence. [Completed proof and ceiling](../prpt00c/README.md): 5/5 fixture routes on portable and Fastly; guest-linked final mapping and exclusive ownership remain gaps. | **Astra / ultra** recommendation for this identity proof only | No optimizer redesign, extra retained guest symbols or second compilation in Report. Feed artifact-bound body/coverage contracts to 01 and passive persistence/consumption to 02A/03. |
| **PRPT-01 — capsule contract** | Versioned schema/types, stable IDs, evidence states, deterministic serializer/hash, eligibility validation contract, descriptor normalization and safe projection, redaction and golden fixtures. Freeze supported manifest/version adapters and input/depth limits. | **Sol / high** | Contract review before dependent work. Own A01/A02, contract parts of A06/A10/A17. Synthetic fixture is a design input, not schema authority. |
| **PRPT-02 — application collector and retained evidence** | **02A:** minimal passive build completion/metadata persistence only where 00B proves it necessary; invalidate stale/failed evidence and bind exact inputs. **02B:** complete route/entry/schema/binding/resource inventory, provenance, declaration-only authority, project snapshot matching, manifest input and historical capsule replay. [Implementation and explicit coverage gaps](../prpt02/README.md). | **Sol / xhigh** | Highest integration risk after feasibility. Own A03–A06/A11/A15/A17/A18. No second frontend, native build or executable semantic changes. If 02A is unnecessary, record the existing producer proof and skip it. |
| **PRPT-03 — size evidence adapter** | Exact artifact/section/resource ledger and supported final handler mapping; optional direct-call reachability only within the explicit [00C ceiling](../prpt00c/README.md). Consume the frozen artifact/sidecar interfaces. [Implementation and qualification ceiling](../prpt03/README.md). | **Sol / high** | Own A07/A08; contribute unchanged-guest proof to A14. Stop attribution expansion at the approved ceiling; no companion build or optimizer work. |
| **PRPT-04 — CLI integration** | Command specification, terminal overview, JSON/HTML/artifact switches, dry-run/plan behavior, safe atomic output, stable errors and generated help/completions. [CLI implementation and explicit HTML integration gap](../prpt04/README.md). | **Sol / medium** | Own command portions of A06/A10–A12/A15. Eligibility and replay delegate to their owners; no duplicate collector in CLI. |
| **PRPT-05 — HTML viewer** | Locked slate/offline shell, route-first navigation, size modes, three route tabs, searchable/sortable schemas with expansion, resources/bindings/evidence, full-capsule export, mobile/keyboard/theme behavior and hostile-data handling. | **Sol / high** | Own A09/A16 and renderer parts of A01/A10/A17. Use capsule fixtures from 01; no collector dependencies or inferred facts in viewer JS. Medium-high was underspecified and too light for this combined surface. |
| **PRPT-06 — qualification and handoff** | Packed-install proof, focused acceptance closure, retained small/real-app/Catalog evidence, measured overhead, docs/example reports, and beta.7 release handoff. Reuse ticket proof records. | **Sol / high** | Own final A12–A14 plus matrix reconciliation. Confirm A01–A18 are closed or explicitly scoped; one real-capsule end-to-end check. No seal/publish in this ticket and no repeated full suite. |

Execution order: **00A → 00B → 00C → 01 → {02, 03, 05} → 04 → 06.** The approved 00C closes the bounded feasibility follow-up before freezing 01. Braces identify dependency independence, not an instruction to launch parallel agents. With one agent, use **00/00C → 01 → 02 → 03 → 05 → 04 → 06**. PRPT-05 can use frozen golden capsules immediately after 01; it need not wait for the collectors. PRPT-03 can start its parser/ledger after 01 but integrates with 02A’s persisted metadata where required. CLI scaffolding may begin after 01; its final integration depends on 02/03/05.

**Agent sizing and escalation:** 00A/00B and 02A/02B remain sub-gates of their existing tickets, not additional workstreams. Start with the listed effort. Escalate a specific unresolved identity/attribution proof to Astra / ultra only with a written question and stop condition; do not promote every ticket to ultra or rerun the research campaign. If 02A needs a compiler redesign or broad new build architecture, return that concrete gap for scope review. PRPT-06 verifies behavior and evidence, not merely green checks.

The first stop gate is especially important: if per-handler attribution requires a new optimizer pass, retaining extra runtime symbols, or a generalized interprocedural analyzer, stop that part. Ship a useful route/resource/artifact report with explicit gaps only after the scope adjustment is approved. Do not quietly substitute approximate source bytes under a final-Wasm label.

Each completed packet retains a small proof record: objective, touched surfaces, invariants, focused evidence, surprises, and remaining limitations. Run full release qualification through the existing release workflow, not redundantly after every report ticket.

## 17. Definition of done and future boundary

V1 is done when a fresh installed CLI can produce a trustworthy terminal/JSON/HTML report **only for completed, matching Wasm builds**, the route table makes the application understandable, schema structure and descriptor size are visible without conflating generated bytes, byte accounting is honest, unsupported claims are visible, and report introduces no new runtime semantics or hidden heavyweight workflow. The standalone HTML viewer follows the locked ARC reference at §19.

The report need not explain every generated byte to be valuable. **It must never make a stronger claim than its evidence supports.**

Future candidates—explicitly deferred—include capsule comparison, measurement trend views, report-based CI thresholds, broader size-attribution coverage, and integrations that consume the published schema. None requires policy inference to belong in report. Deep compiler graphs remain inspect; recommendations and validation remain doctor.

### Suggested opening instruction for the later work session

> Read this specification and the repository's current instruction chain. Execute **PRPT-00 only**, with **00A first**: locate the four named ARC assets in the Library root (§19), review the actual current HTML mock/fixture and capture the UI design-lock acceptance checklist (especially route detail, numeric sizes, schema metrics and mobile/offline behavior). Then **00B**: verify existing CLI/evidence owners, successful-Wasm eligibility and artifact identity, and supported manifest kinds; map every field to an authoritative producer or mark it unavailable. Prove the cheapest trustworthy route/resource size mapping using retained evidence or one tightly scoped fixture. Do not redesign the compiler, run the full release suite, implement the viewer, add runtime behavior, or seal/publish beta.7. Return the UI lock, capsule boundaries, sizes/coverage, exact implementation touchpoints and any scope corrections for review.

## 18. Sources and verification notes

Repository references below are pinned to the planning commit. They establish current integration boundaries; the report feature itself remains a proposal. Web references support only the narrow binary-accounting and HTML-safety details cited above.

**[S1]** Pulse CLI reference, `docs/reference/cli.md`, planning commit `1dbc6c9623dca55f274715bdc8eca5e31652e5df`; read through the inspect/test sections. Confirms generated command ownership, profile selection, artifact inspection, side effects, and exit behavior.
[Open pinned source](https://github.com/pulse-compute/pulse/blob/1dbc6c9623dca55f274715bdc8eca5e31652e5df/docs/reference/cli.md)

**[S2]** CLI package guide, `docs/packages/cli.md`, same planning commit. Confirms existing plan/effect/event evidence, Native versus JavaScript output, native-expansion measurement limits, public entry points, optimization recipe recording, and redaction/path safety.
[Open pinned source](https://github.com/pulse-compute/pulse/blob/1dbc6c9623dca55f274715bdc8eca5e31652e5df/docs/packages/cli.md)

**[S3]** O-08 optimized-Wasm census, `wasm/test/runtime/compiler-efficiency/o08-wasm-census.md`, same planning commit. Supports reuse of existing accounting methods and documents their deliberately bounded ownership/reachability claims.
[Open pinned source](https://github.com/pulse-compute/pulse/blob/1dbc6c9623dca55f274715bdc8eca5e31652e5df/wasm/test/runtime/compiler-efficiency/o08-wasm-census.md)

**[S4]** WebAssembly Core Specification, binary modules/sections/code-section definitions; accessed 7 October 2026.
[Open specification](https://webassembly.github.io/spec/core/binary/modules.html)

**[S5]** OWASP DOM-based XSS Prevention Cheat Sheet; accessed 7 October 2026. Supports safe text sinks and context-safe JSON embedding.
[Open guidance](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)

## 19. Locked ARC design baseline and Library asset manifest

The **ARC-shaped mock is the approved v1 design direction**, not a measured ARC application report and not the final wire-schema authority. Its visual hierarchy and interactions constrain PRPT-05; the versioned capsule contract and actual compiler evidence constrain the data. **Do not replace the UI with a generic CLI text dump, dashboard framework, raw JSON page, or an independent interpretation of source.** Small responsive/accessibility changes are welcome; substantial design deviations require review before implementation.

### Authoritative Library references

These exact assets were located in the **ChatGPT Library root (`/`)** on 7 October 2026. A later session should resolve them by exact filename/path from Library, **not by guessed repository paths or stale copied fixtures**. The relative file links below work if the files are downloaded together; Library paths are the durable handoff references.

| Asset (Library path) | Role in design lock |
|---|---|
| [`/Pulse-Report-ARC-Design.html`](./Pulse-Report-ARC-Design.html) | **Primary reference:** self-contained interactive ARC report. Open and exercise routes, size selector, filters, drawers, resources, schemas, bindings, evidence/JSON, theme/mobile states. |
| [`/Pulse-Report-ARC-Fixture.json`](./Pulse-Report-ARC-Fixture.json) | **Synthetic reference capsule:** fixture field shapes, coverage/unavailable states, schema descriptors and structural metrics. Illustrative values only; not Pulse compiler output. |
| [`/Pulse-Report-ARC-Preview.png`](./Pulse-Report-ARC-Preview.png) | Visual snapshot of the route-first/default overview and information density. |
| [`/Pulse-Report-ARC-Schemas-Preview.png`](./Pulse-Report-ARC-Schemas-Preview.png) | **Latest schema-view reference:** key count, required key count, descriptor bytes, expansion and route references. Use this over the earlier schema-less preview. |

The Library file names above are the canonical lookup keys; the stable IDs and checked SHA-256 hashes below pin this review. If any asset changes, record the delta before adopting it as a new design baseline. Local copies in `/mnt/data` are optional for prototyping, **not** a permanent source path or repository dependency. The implementation must consume its actual emitted capsule, not embed the synthetic ARC data.

### Verified v2 fixture identity — 7 October 2026

| Filename | Stable Library ID | SHA-256 of reviewed file |
|---|---|---|
| `Pulse-Report-ARC-Design.html` | `libfile_100f5d9a5f50819184645a70682216c6` | `4fb0dbdfb90f20bebb3e702eb50f1cd30f8e4b8cb38bb0a1ec7e1394717874f9` |
| `Pulse-Report-ARC-Fixture.json` | `libfile_32ec6c1d74588191a978cf6b1711235f` | `1833a078007104fee92e81154245237036666c896d991dfe8a129094103ba481` |
| `Pulse-Report-ARC-Preview.png` | `libfile_360db7e68a8c8191815af424236670d3` | `525d32959c1418a6c3dcef5902f8d36cde0e494df022958110e2239377ad2c2e` |
| `Pulse-Report-ARC-Schemas-Preview.png` | `libfile_f341642103488191997a93cbe81204f9` | `6e661cc7aaa63e905de1bf1fe3c1e11d2483176807e30fc924f0215adf990990` |

Review evidence: the current HTML contains schema expand/collapse controls, property name/type/required rows, provenance/descriptor details and referencing-route links. Its JSON contains 20 synthetic schemas; all 20 declared descriptor byte counts match their compact, key-sorted UTF-8 JSON descriptors. The updated schema PNG shows the inventory with rows collapsed; it is not by itself proof of the expanded interaction. The earlier route PNG carries an older capsule hash and is a layout reference only. The HTML still labels its viewer/design v0.1; that cosmetic label is separate from this v2 plan and does not supersede the schema update. Browser interaction/accessibility/offline qualification remains PRPT-00A/05/06 work; this review inspected the source, fixture data and both previews.

“Updated schema views” means the current expandable schema inventory, including update-contract schemas such as `UpdateUser` and `UpdateVirtualToken`. It does not introduce schema editing, historical diffing, migrations or update execution.

### Design acceptance checklist (PRPT-00A)

1. **Route-first:** an application/snapshot header with evidence identity and a compact overview; route inventory is the first substantial surface and retains true registration order until the reviewer sorts. Group, method, declarations, binding and size-evidence filters are independent view state; visible/total counts remain obvious.
2. **Measured size vocabulary:** the size dropdown distinguishes Handler body, Own (exclusive reachable), Reachable and Shared; sort uses raw integer bytes and sends unavailable values last. Shared sizes are never added as though physically exclusive; no implied removal savings.
3. **Route audit trail:** selecting a route opens a responsive detail panel with *Resolved facts*, *Size attribution* and *Evidence trail*. The report shows declaration references, provenance and linked evidence rather than inferring effective permissions.
4. **Schema comparison:** retain search across schema and field names; display sortable *Top-level keys*, *Required keys*, *Descriptor bytes* and referencing-route counts; expand/collapse to show property name/type/required, source/descriptor provenance and actionable route references. Route-to-schema navigation selects the referenced schema, and returning to a route preserves coherent view state. Require keyboard activation, accurate expanded-state attributes, and both collapsed and expanded mobile/desktop proof. The mock’s “Shape bytes” wording must remain explicitly tied to normalized descriptor bytes. Descriptor sizes are explicitly different from final generated validator/Wasm bytes. Unsupported metrics say unavailable/NA, not zero.
5. **Resources and bindings:** preserve artifact section/resource ledger, retained payload versus input bytes, referenced logical bindings, and reverse route links; separate known measured facts from fixture examples.
6. **Evidence capsule:** raw JSON access/export reproduces the one canonical payload; search, filters, collapsed details and theme switching never mutate the underlying records.
7. **Usability and safety:** restrained slate visual language, light/dark modes, mobile-safe horizontal table/drawer, keyboard navigation, visible qualifiers, standalone offline use and inert payload strings. No CDN, tracking, runtime framework, or service calls.
8. **Fixture discipline:** use the ARC mock to test representative and unavailable states, not to hardcode ARC counts, route names, security claims or synthetic measurements into released CLI output. Validate the same viewer against an empty/minimal fixture and a later real completed-Wasm capsule.

**PRPT-00A output:** a signed-off design/interaction checklist citing these exact Library artifacts, plus any bounded layout/wording corrections. **PRPT-00B output:** field-to-producer evidence map, completed-Wasm eligibility/error contract, availability/size ceiling, and implementation touchpoints. Both gates precede PRPT-01; they do not themselves implement `report`.

---

**Final invariant:** Report records what Pulse successfully compiled to Wasm and what identified evidence establishes. It neither guesses policy nor manufactures precision.
