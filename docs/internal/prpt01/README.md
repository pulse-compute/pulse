# PRPT-01: Report v1 capsule contract

This packet implements the data contract from the [v2 plan](../prpt00/feature-spec-v2.md)
and [00C attribution proof](../prpt00c/README.md). The pure implementation lives in
`wasm/packages/cli/src/internal/report/`. It adds no command, collector, build
hook, renderer, provider behavior or package export. Those remain 02–05.
Entry point: none; ordinary root/wasm/CLI instruction chain. Human direction is
the explicit request to implement PRPT-01 against `latest`, following merged
PR #221. Model/effort recommendation remains Sol / high.

## Frozen records and owners

| Format | Version | Purpose |
| --- | --- | --- |
| `pulse.application-report` | `reportVersion: 1` | One allowlisted, hashed capsule for all renderers and historical replay |
| `pulse.report-completion` | `completionVersion: 1` | Local completion envelope binding exact matching fingerprints, artifact files and sidecar hashes |
| `pulse.report-attribution` | `attributionVersion: 1` | Optional, artifact-bound function/chunk mapping and bounded direct-call edges |
| `pulse.report-schema-shape.v1` | In descriptor/structure | Explicitly redacted structural schema representation |

`schema.js` owns all three JSON Schema documents and `model.d.ts`. The contract
test regenerates those files only with `--write-fixtures`; ordinary tests verify
exact synchronization. They are packed through the CLI's existing `src` rule.
The hand-written module declaration files describe the pure functions. There
are no new runtime dependencies and no compiler import in these modules.

The capsule follows the planned context/provenance/application/inventory model,
with `declarations`, `bodies` and `rootSets` made explicit. Routes retain their
original registration order and link to execution entries; duplicated method
and path registrations and shared handlers remain distinct. Event, fallback,
error, startup and export entries retain their own kinds. Schema/binding reverse
references must agree with forward references. Declarations are explicit named
records, never an effective-authorization inference from a route or handler name.

## Identity and deterministic bytes

- Canonical object keys sort by JavaScript UTF-16 code-unit order, independent of
  locale. Integer-looking keys also use lexical ordering, not insertion-order
  JSON enumeration. Strings are preserved, with no Unicode normalization or
  trimming. Negative zero normalizes to zero; nonfinite numbers are rejected.
- Unordered inventories sort by ID; reference sets sort and reject duplicates.
  Route/entry registration sequences and route composition remain ordered.
  Schema fields sort by exact field name. No current time, cwd or locale is added.
- `stableReportId(kind, canonicalId)` hashes a domain-separated canonical
  identifier supplied by its authoritative owner. Route IDs must represent
  registrations, not just method/path or shared authored handler names. Reuse
  canonical identities; never feed config objects or secret material into IDs.
- Artifact IDs are `artifact:<sha256>` and body IDs are
  `body:<artifact-sha256>:<final-function-index>`. Identical bytes have one
  physical identity; the recorded stage must describe the artifact actually
  used. Generator chunk ordinals are not function indices.
- `evidenceHash` is SHA-256 of canonical UTF-8 JSON excluding only the root hash
  field. `serializeCapsule` adds one final newline outside those hashed bytes.
  Historical parsing validates structure, references, accounting and the hash.
  Hashes provide identity/integrity, not producer authentication or attestation.
- Returned capsules are deeply frozen. `htmlPayload` escapes HTML delimiters and
  line separators in the same JSON; decoding it reproduces canonical serialization.
  `terminalText` escapes terminal control characters. DOM/CSP/template security
  and interactive/browser validation remain 05/06.

## Facts, accounting and attribution

A numeric fact carries availability, basis, coverage, value, reason and evidence
references. Available facts need a numeric value and evidence. Unavailable and
not-applicable facts require null values and a stable reason. Zero is an actual
measurement, never the encoding of missing evidence. Inventory coverage has
observed/expected counts and a reason; empty-complete and unavailable are distinct.

Artifact sections reconcile with the eight-byte Wasm header when their ledger
is complete. Defined-body records exclude body-length and section framing;
their IDs bind final indices to a particular artifact. Resource input bytes and
retained payload bytes stay separate. All reference sets resolve inside the
capsule; paths are normalized relative source locations, not arbitrary links.

| Metric | Contract |
| --- | --- |
| Handler body | Sum of unique referenced final bodies; mapped/expected chunk counts distinguish exact and partial mappings |
| Reachable | Explicit body membership under `static-direct-calls-v1`; includes conditional/shared callees, excludes imported implementation bytes |
| Own | Root membership excluding every body reached by another modeled root; requires complete root-universe coverage |
| Shared | Root membership also reached by another modeled root; same completeness gate as Own |

Known routes and non-HTTP execution roots may not be omitted from a root set
claiming completeness. Unsupported graphs cannot supply available reachability
or exclusivity. Available measurement bytes must reconcile with their referenced
bodies; artifact, stage, root, subject and evidence identities must agree.
Partial direct mappings may retain measured bytes with `coverage: partial` and
unequal mapped/expected counts. A missing map cannot become a complete zero.
Overlapping per-route numbers are never an additive physical ledger or deletion
savings. PRPT-03 owns calculation from the sidecar and qualification of its
graph/root coverage; the contract does not certify claims merely because their
JSON is internally consistent.

The attribution sidecar carries only artifact identity/stage, imported-function
count, ordered defined-function indices/byte lengths, canonical handler/entry
ownership, explicit chunk mappings and direct-call edges. Missing chunk maps
carry null indices and reasons. Unsupported graph data carries no edges.
Generated symbol names, WAT, source and debug-name sections are not exported.
All three authentic 00C captures pass this format without compiling again.
Guest-linked primary/prelink evidence remains distinct from linked final bytes.

## Schema projection and disclosure

The input adapter is pinned to `pulse.schema-registry-ir.v5`. It accepts the
owner's scalar, object, array, nullable, string-enum, scalar-record and nested JSON
shapes. Object fields include name/type/required detail; nested structural nodes
and known numeric JSON/record limits are preserved. Descriptor bytes measure
canonical UTF-8 of the entire **redacted descriptor**, including its representation
tag. They are not raw schema bytes, validator Wasm, instance size or semantic
schema equivalence.

Defaults, examples, descriptions, source text/locations, enum literal contents
and unsupported constraint fields are excluded from the measured descriptor.
String enums preserve only literal count. Object-field ordering and ignored
sensitive fields cannot change its byte count or capsule identity. Constraints
outside the documented representation are not claimed as represented. Source
locations have their own allowlisted provenance records.

Reference/union/recursive forms are unsupported by this adapter, not newly added
schema syntax. Unsupported versions/shapes and unknown required status produce
unavailable structure with null counts. Non-object projections have descriptor
bytes but key counts are not applicable. Empty objects have real zero counts.
Metrics and the expanded property projection are recomputed and checked against
the descriptor. The pinned ARC expandable-schema design remains the interaction
reference; its synthetic JSON-schema-like shape is not the schema authority.

`createCapsule` explicitly projects only schema-owned fields before hashing.
Arbitrary config, secrets, binding values, asset bodies and diagnostic details
are dropped. Historical `validateCapsule` rejects unknown fields instead of
silently accepting them. Neither can recognize a secret intentionally inserted
in an allowed name or path: 02 must supply approved metadata, and reports remain
operationally sensitive review artifacts. Local matching hashes are not capsule
fields; only an explicitly safe source fingerprint may be exported.

## Completion, supported inputs and pure admission

The only build-manifest adapter is `pulse.project-execution.v10`:

- `status: compiled`, `target: portable-native-wasm`, with `native.wasm` identity.
- `status: built`, `buildMode: native-provider`, `configuredTarget: native`, with
  explicit provider Native evidence and `providerTarget.wasm` identity. If a
  native host reuses portable bytes and supplies no second filename, the adapter
  accepts the portable reference only when both declared byte count and hash match.
- JavaScript source-package output, unsupported versions, failed/incomplete
  attempts, leaf/plan-only records and bare Wasm are rejected. **Node Native is
  valid.** Configured host is not representation eligibility; an explicit portable
  compile can also originate from a JavaScript-configured project.

Legacy v10 alone is insufficient. It needs `reportCompletion: {file, bytes,
sha256}` linking the exact completion JSON. The completion envelope identifies
the operation/context, three local matching fingerprints (inputs/profile/recipe),
all required Wasm files, and required/optional sidecars. Project-mode admission
requires the current snapshot and selected profile/host/Native target to match.
Artifact-mode admission checks completed evidence without claiming a current
project match. All supplied file bytes are copied, length/hash checked and, for
Wasm, validated without instantiation.

The required `inventory` sidecar (`version: 1`) is an allowlisted Report v1
capsule seed, validated by the same capsule contract. Its artifact/context
identities must agree with completion. It can carry empty/unavailable optional
attribution. The optional `attribution` sidecar (`version: 1`) uses the separate
format above; PRPT-03 computes/enriches measurements from it before the final
capsule is hashed. Missing optional evidence returns a visible missing-kind
list. A present checksum/version/content mismatch is an error, not a missing
measurement. This reuses the capsule model instead of introducing a second
inventory language for the build path.

`admitCompletedBuild` accepts an in-memory file map; it never reads a file or
executes code. PRPT-02A must still invalidate previous completion before a new
attempt (including no-clean), bind the bytes actually read, detect concurrent
mutation, and publish completion atomically after all writes. PRPT-02/04 own
physical file containment/symlink checks and safe reads. The pure contract's
relative-path checks are not a substitute for those filesystem protections.

Historical replay validates the capsule without any project context or required
original Wasm file. `verifyHistoricalArtifacts` additionally checks supplied
artifact bytes, reports absent ones, and never claims current project verification.
Replaying does not recollect or add evidence. New report generation from an
unmatched/incomplete build remains forbidden.

## Limits, errors and downstream acceptance

JSON/data admission is bounded at 16 MiB, depth 64, 500,000 visited values,
100,000 elements per array and 1 MiB UTF-8 per string. Wasm/file-byte admission
is capped at 64 MiB per file. These are rejection limits, not truncation: every
accepted record is preserved. Invalid UTF-8, duplicate JSON keys, prototype
keys, accessors, cycles, non-data objects and nonfinite numbers are rejected.
No remote schema references are resolved. Internal `REPORT_*` error codes expose
no payload contents; PRPT-04 maps them to the existing CLI diagnostic/exit system.

This packet owns A02 and the contract portions of A01/A05/A06/A08/A10/A15/A17.
It does not claim UI acceptance, a shipped `pulse report`, build lifecycle
qualification, a real application capsule or release acceptance. Recorded tests
require named producer, corpus/cases, targets, artifact scope and original result;
missing recorded checks do not become passes.

The runner owns `report-capsule-contract` in both unit and CLI profiles, with an
explicit assignment to the existing historical-contracts release shard in
`scripts/release-evidence-bundle.cjs`. This adds test coverage without changing
release authority, candidate selection or publication behavior. It covers
golden minimal/shared-route capsules, generated schema/type synchronization,
malicious inputs, deterministic locale/cwd-independent identity, reference and
accounting failures, real schema-v5 projection, retained 00C captures, pure
replay/import canaries and TypeScript consumer declarations. Commands:

```sh
node wasm/scripts/run-wasm-tests.cjs --task report-capsule-contract --no-report
# Only when deliberately changing the canonical format/fixtures:
node wasm/test/cli/assert-report-capsule-contract.cjs --write-fixtures
```

Validation results and remaining implementation gates are recorded in
[validation.json](validation.json).
