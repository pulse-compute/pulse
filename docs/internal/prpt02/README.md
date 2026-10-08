# PRPT-02: retained build evidence and application collector

Implements 02A/02B from the [v2 plan](../prpt00/feature-spec-v2.md), following
[PRPT-01](../prpt01/README.md). The [design fixture](../prpt00/README.md#00a-exact-design-contract)
remains presentation input, including the expandable schema views; schema truth
comes from the canonical v5 registry and the frozen redacted projection.
Recommended model/effort remains Sol / xhigh. No delegation was used.

Entry point: none; ordinary root/wasm/CLI instruction chain. Explicit human
request: implement PRPT-02 against `latest`. This adds internal collection and
passive build persistence. Public commands/errors belong to 04, the viewer to
05, physical Wasm accounting and 00C capture integration to 03. Protected path
owners are configuration-contract and runtime-target-fluidity; no executable
lowering, provider implementation, exports, trust or dependency changes.

## Completion lifecycle (02A)

Native `build` and `compile` invalidate the previous completion marker when
safe-output build orchestration starts, including `clean: false`. A per-output
writer generation lives outside the cleaned output directory. New attempts
supersede abandoned generations; publication verifies ownership twice. Completion
is written last, after required files, exact artifact validation, and a second input check.
A failed owning attempt leaves no eligible completion. An abandoned attempt
does not block a later rebuild. Concurrent same-output builds remain unsupported: generation checks reject detected overlap; the
collector rejects inconsistent files. This is not a cross-file filesystem
transaction. Config/harness failures before entering build orchestration cannot invalidate a marker, but project matching rejects changed
inputs. Historical capsules remain historical snapshots.

The manifest links `pulse-report-completion.json` and private
`pulse-report-inputs.json`; completion binds the required
`pulse-report-inventory.json` (a Report v1 capsule seed), exact portable/final
Wasm, profile and recipe fingerprints. Every linked read is bounded, contained,
symlink-rejecting and checked for concurrent replacement. Writers use temporary
files and atomic rename. A superseded writer cannot knowingly publish or
invalidate another writer's completion.

Inputs are conservatively snapshotted before schema/harness resolution and
compared at build completion. Project files exclude node_modules, .git, the
selected output, conventional dist and .pulse-* output directories. Every
compiler watch file and project graph hash must be covered. The exact selected
profile, optimization, Node version, release packages and transitive toolchain
package contents are bound. Ancestor workspace manifests, lockfiles and
TypeScript configuration are bound through the existing workspace boundary.
Source checkouts additionally bind exact package
directories from a matching release catalog; no lowerer or provider manifest is
executed for snapshot discovery. No new compiler trust is granted.

Unsupported input shapes (including source symlinks, uncovered external inputs,
precompiled objects with no resolution receipt, or snapshot limits) preserve the
ordinary build and explicitly record `reportEvidence.status: unavailable` with
no completion. Detected stale/concurrently mutated inputs also prevent
completion, while preserving ordinary build admission. Programmatic callers
reusing resolved project objects after input or other output changes must resolve
again to obtain matching evidence.
Snapshots cap each file at 64 MiB, each tree at 20,000 files/256 MiB, and Report
JSON at 16 MiB. This deliberately favors conservative rebuilds over guessing.
Private fingerprints can cover config/test values and must stay local; they are
not copied into the shareable capsule.

## Collection and replay (02B)

Internal consumers use `internal/report/retained.js` and its declaration file:

- `collectProjectReport({ cwd, profile?, outDir?, optimization? })` statically
  parses the existing config grammar, matches retained project/profile/recipe
  fingerprints and returns `currentSnapshotMatched: true`. It does not compile
  application source, evaluate config, import a harness or load a provider.
- `collectArtifactReport(manifestFile)` verifies a supported execution manifest,
  its completion, required inventory and exact Wasm files. It does not inspect
  current project files and returns `currentSnapshotMatched: false`.
- Passing a verified Report v1 capsule to artifact mode performs historical
  replay only. Older manifests without completion are ineligible; the collector
  never repairs them or builds missing evidence. 04 owns actionable CLI wording.

The inventory consumes the already completed build's canonical application
entries, routing plan, schema registry/references, effects, event catalog and
package declarations. Registration order, duplicate registrations, shared
handler IDs, mounted entry flow and non-HTTP entries are preserved. Additive
optional `Entry.flow` and `Route.compositionCoverage` fields retain the canonical
continuation topology while preserving all PRPT-01 golden capsules.

Schema descriptors support the fixture's expandable views, structural counts,
requiredness and explicit unknown states. Literal binding names are retained;
config values, secret values, embedded asset bodies and arbitrary package
metadata are not. Declarations are names/capability references, never inferred
authorization. Tests are not inferred from successful compilation.

[PRPT-03](../prpt03/README.md) now adds the physical ledger and passive final-emission
capture; the list below records the boundaries of this original packet.

## Explicit remaining gaps

- Composition is a bounded candidate sequence when middleware/mounts apply;
  it is not a trace or a complete path-sensitive execution model.
- Logical binding realization remains unavailable; dynamic names make binding
  inventory partial. No environment/provider access check runs.
- Selected embedded assets have resolved input size. Generated helper/validator
  resource enumeration and retained payload sizes remain partial/unavailable.
- Git revision/dirty status and shareable source fingerprint remain unknown.
  Exact local matching fingerprints are private, not provenance attestations.
- Function/section ledgers, reachability, 00C optimized-emission capture, guest
  final mapping and exclusive ownership remain with 03. No unavailable byte
  measurement is presented as zero.
- Installed-package qualification, supported-Node-floor and external Fastly
  runtime proof remain release/06 checks. Local Fastly evidence verifies emitted
  final Wasm and its separate portable identity, not deployed behavior.

See `validation.json` for the bounded evidence and exact tested source identity.

The broader `canonical-native-wasm` task has an existing fixture failure:
`compileExample` tries to load a generator for the default JavaScript
`12-pulse-context-mcp` example. The same minimal failure was reproduced with
the original base CLI config/execution modules; compiler, helper and example
files are unchanged. It is recorded as failed, not counted as passing Native
evidence. Focused Native middleware/build and cross-target checks are recorded
separately.
