<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Package lowerer contract reference

This reference defines the versioned trusted package-lowerer protocol for
first-party and third-party packages. External packages need no monorepo
registration, package-specific pin, or equality with Pulse's npm version.
Compatibility is determined by the exact supported protocol versions below.

Use [Pulse-aware package authoring](./pulse-aware-packages.md) first. A package
owns its JavaScript facade and the Native subset that its lowerer implements.
The release catalog describes Pulse's own packages, not an external admission
allowlist. Package authors remain responsible for their own target claims.

Manifests and builders execute as trusted build dependencies in the compiler's
Node process. They can access its filesystem, environment, and other Node APIs.
There is no sandbox, provenance check, resource quota, or isolated failure
boundary. Installing a package that declares a lowerer is a build-time trust
decision. The immutable invocation envelope describes supported inputs; it does
not constrain what trusted JavaScript can access.

## Application support and protocol compatibility

The versioned manifest, invocation, result, canonical operation, and provider
requirement contracts are the compatibility boundary. Internal implementation
modules and new compiler hooks are not additional public extension surfaces.

## Canonical owner map

The present-tense owner for each stage is:

| Concern | Canonical repository owner |
|---|---|
| Product role, target modes, and conformance IDs | `packages/<feature>/pulse.package.json` |
| Application API and JavaScript implementation | `packages/<feature>/src/` and its package exports |
| Package manifest and builder entry | `packages/<feature>/pulsewasm.manifest.cjs` and `packages/<feature>/pulsewasm.compiler.cjs` |
| Manifest validation and trust contract | `wasm/packages/contracts/src/library/manifest.js` |
| Manifest discovery and trusted builder loading | `wasm/packages/library-kit/src/compiler/handler-library-contracts.js` |
| Reachable package/symbol ownership | `wasm/packages/compiler/src/project/package-reachability.js` |
| Per-module syntax recognition | Trusted `packages/<feature>/pulsewasm.compiler.cjs` builder |
| Builder invocation/result envelopes | `wasm/packages/contracts/src/package/package-contract.js` and `wasm/packages/library-kit/src/compiler/handler-library-contracts.js` |
| Canonical package operation, lowering bundle, and provider-requirement record | `wasm/packages/contracts/src/package/package-contract.js` |
| Recognition and whole-project orchestration | `wasm/packages/compiler/src/spine/package-operation-seam.js` |
| Feature operation and payload vocabulary | `wasm/packages/contracts/src/<feature>/contracts.js` |
| Provider-neutral whole-project composition | `wasm/packages/compiler/src/canonical-project-compiler.js` |
| Provider capability and target realization | `packages/provider-<id>/src/` |
| Public support and package availability | `release/pulse-release-manifest.json` |

Assets and GRIP are synchronized release references:
`packages/assets/pulse.package.json`,
`packages/assets/pulsewasm.manifest.cjs`,
`packages/assets/pulsewasm.compiler.cjs`,
`wasm/packages/contracts/src/assets/contracts.js`,
`packages/grip/pulse.package.json`,
`packages/grip/pulsewasm.manifest.cjs`,
`packages/grip/pulsewasm.compiler.cjs`, and
`wasm/packages/contracts/src/grip/contracts.js`.

JWT is the current cryptographic-composition reference:
`packages/jwt/pulse.package.json`,
`packages/jwt/pulsewasm.manifest.cjs`,
`packages/jwt/pulsewasm.compiler.cjs`, and
`wasm/packages/contracts/src/jwt/contracts.js`. It composes HS256 and ES256
through `@pulse-compute/crypto`; external packages may use the same versioned contracts.

This owner map is the detailed package-lowering companion to
[Current architecture contracts](../architecture/current-contracts.md). Update
the owning source, conformance, and this reference together when the protocol
changes.

## Contract pipeline

```text
reachable module graph
  → package binding and contract selection
  → trusted manifest discovery
  → package-owned static recognition
  → canonical package operations
  → whole-project capability envelope
  → provider plan and binding validation
  → JavaScript execution or Native target realization
```

The reachable graph chooses participating package contracts and attributes
their imported symbols. Recognition then runs per reachable project module.
The project graph resolves the installed or workspace package at each import,
including nested dependencies, before loading its declaration. Unrelated
installed manifests are not executed by graph compilation. Explicit inventory
tools may enumerate declared lowerers. There are no dynamic registration hooks.

## Protocol constants

| Contract | Value |
|---|---|
| Manifest version | `pulsewasm.lowerable-library-manifest.v2` |
| Manifest kind | `pulsewasm.lowerable-library-manifest` |
| Builder protocol | `pulsewasm.lowerable-compiler-builder.v1` |
| Builder invocation | `pulse.package-builder-invocation.v1` |
| Builder result | `pulse.package-builder-result.v1` |
| Canonical package operation | `pulse.canonical-package-operation.v1` |
| Package lowering bundle | `pulse.package-lowering-bundle.v1` |
| Provider requirement record | `pulse.provider-requirement-record.v1` |
| Required trust | `build-dependency` (`first-party` is a legacy alias) |
| Canonical provider plan | `pulse.canonical-provider-plan.v1` |
| Canonical provider contract | `pulse.canonical-provider-contract.v1` |

Package-specific contract, plan, artifact, and payload versions are owned by their corresponding shared contract modules.

## Package discovery declaration

A lowerable package declares the manifest path in `package.json`:

```json
{
  "pulse": { "contract": "./pulse.package.json" },
  "pulsewasm": {
    "manifest": "./pulsewasm.manifest.cjs"
  }
}
```

The manifest file, compiler builder, built facade, and sidecar must be included by `package.json.files` and available from an extracted npm tarball.

## Required manifest fields

The validator requires these paths:

| Field | Meaning |
|---|---|
| `version` | Locked manifest schema version. |
| `contractId` | Stable feature contract identity. |
| `npmPackage` | Package that owns the facade and builder. |
| `lowerableSubpath` | Exact application import recognized by the compiler. |
| `facade.namespace` | Canonical namespace used by the facade. |
| `facade.symbols` | Non-empty static symbol list. |
| `modes.typescript.entry` | Normal package TypeScript/JavaScript entry. |
| `modes.jsEngine.entry` | Manual JavaScript engine entry. |
| `modes.wasm.sidecar` | Package-owned AssemblyScript sidecar path. |
| `modes.wasm.lowerings` | Non-empty facade-symbol to sidecar-symbol mappings. |
| `compiler.version` | Builder protocol version. |
| `compiler.entry` | Package-relative CommonJS builder module. |
| `compiler.export` | Exported builder function name. |
| `compiler.builderOwner` | Must equal `npmPackage`. |
| `compiler.trust` | `build-dependency`, or the legacy `first-party` alias. |

The manifest may also document public runtime symbols, compiler inputs, artifact filename, host capabilities, protocol owner, and feature policy.

## Representative manifest

```js
'use strict'

module.exports = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.example',
  npmPackage: '@pulse-compute/example',
  lowerableSubpath: '@pulse-compute/example',
  facade: Object.freeze({
    namespace: 'example',
    import: '@pulse-compute/example',
    symbols: Object.freeze(['emit']),
  }),
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'buildExampleLoweringPlan',
    artifact: 'example-lowering-plan.json',
    builderOwner: '@pulse-compute/example',
    trust: 'build-dependency',
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './dist/index.js' }),
    jsEngine: Object.freeze({ entry: './dist/index.js' }),
    wasm: Object.freeze({
      mode: 'wasm-sidecar',
      sidecar: './as/index.as.ts',
      lowerings: Object.freeze([
        Object.freeze({
          tsSymbol: 'example.emit',
          asSymbol: 'pulse_example_emit',
          callShape: 'literal-topic-message',
          hostCapabilities: Object.freeze(['example']),
        }),
      ]),
      hostCapabilities: Object.freeze(['example']),
    }),
  }),
})
```

## Validation rules

The manifest validator additionally enforces:

- non-empty string identities and paths;
- a valid facade symbol array;
- static `tsSymbol` and `asSymbol` values for each lowering;
- valid optional public API symbol arrays;
- owner equality between `npmPackage` and `compiler.builderOwner`;
- supported builder protocol and explicit build-dependency trust;
- normalization of TypeScript, JavaScript-engine, and Wasm mode objects.

A manifest validation error prevents builder execution. The manifest itself is
trusted executable code and is loaded before that validation. Its `npmPackage`
and `compiler.builderOwner` must match package.json; product metadata identity,
trust, and authoring subpaths must agree. Duplicate contract/import owners fail.
Declared files must remain inside their package after resolving symlinks.

Package versions are independent of Pulse's release. Unknown manifest or builder
protocol versions are rejected explicitly. Normal application dependency
resolution chooses installed versions; Pulse requires no additional package pin.
No declaration grants a new provider capability: emitted requirements must still
be supported by the selected provider.

## Builder resolution

The generic library kit resolves:

1. the package manifest record;
2. its package-relative compiler entry;
3. the named export;
4. the trust and owner declaration;
5. shared library contracts.

It invokes the builder with this exact shared field set:

```js
{
  version,
  cwd,
  workspaceRoot,
  sourcePath,
  sourceText,
  sourceFile,
  typescript,
  manifest,
  libraryContracts,
  packageCompilerBuilder: {
    owner,
    entry,
    export,
    trust,
  },
  generatedBy,
  routePlan,
  schemaBundle,
}
```

The top-level envelope and normalized data values are immutable. `sourceFile`
and `typescript` are the only compiler-owned syntax references; no `Program`,
type checker, language service, cache, CLI configuration, provider object,
target descriptor, runtime object, or resolved secret crosses the seam.
Builders should tolerate either `sourceText`/`sourcePath` or the supplied
`sourceFile` according to their maintained tests.

## Builder result

A successful package invocation is normalized before compiler orchestration:

```js
{
  version: 'pulse.package-builder-result.v1',
  contractId: 'pulse.example',
  npmPackage: '@pulse-compute/example',
  lowerableSubpath: '@pulse-compute/example',
  artifact: { /* package-owned, versioned, owner-checked */ },
  contributions: {
    canonicalEffects: [],
    canonicalIntrinsics: [],
    resultAdapters: [],
    schemaReferences: [],
    cryptoRequirements: [],
    realizationArtifacts: [],
    guestUnits: [],
  },
  diagnostics: [],
  warnings: [],
  hasErrors: false,
}
```

Exact artifact fields beyond shared ownership/status metadata remain
package-contract-owned. Compiler orchestration consumes only the normalized
`contributions` fields; it does not fall back to package artifact entries.
Unknown result fields, owner/version mismatches, provider/compiler object
bleed, and disagreement between diagnostics and `hasErrors` fail at this
receiving boundary.

## Terminal Native application contribution

A trusted package manifest may additionally name `compiler.nativeApplicationExport`
in the same compiler module. This internal hook applies only to a recognized
terminal package application. It does not change package discovery or trust.
The input is `{ plan, managedHandlerNativeBundle, schemaBundle }`; it contains
static compiler facts and no provider instance or runtime values.

The builder returns `pulse.package-native-application.v1` with matching
`contractId`, `package`, and `intrinsic`, `automaticFallback: false`, generated
`source` and `sourceHash`, canonical `effects`, `continuations`, `capabilities`,
and a Native codec `manifest`. The compiler binds this contribution into the
Native plan and requires one terminal `package.application` return with no
additional handler bodies. Source hash and effect/continuation tables must agree.
The selected provider must explicitly declare the matching
`package-native-application` realization before ordinary project compilation.

The contribution uses `effectFailure: 'package-completion'` and exports
`pulse_package_set_effect_failure(index)`. Managed hosts authenticate failure
settlement using the same single-use effect tickets as successful results.
The package receives no host exception detail and owns its failure response.
This versioned contribution does not enable arbitrary compiler hooks.

## Canonical package effect

A package effect passed into provider planning has this conceptual shape:

```js
{
  version: 'pulse.canonical-package-effect.v1',
  contractId: 'pulse.example',
  package: '@pulse-compute/example',
  import: '@pulse-compute/example',
  kind: 'example.emit',
  providerKind: 'example',
  operation: 'emit',
  capability: 'example.emit',
  result: 'ack',
  placement: 'statement',
  resource: { kind: 'literal', value: 'updates' },
  payload: { topic: 'updates', message: 'ready' },
  range: { start: 100, end: 142 },
  loc: { file: 'src/index.ts', line: 5, column: 3 },
}
```

Required semantics:

- the effect uses the shared canonical-effect version and exact allowed fields;
- `contractId`, `package`, and `import` exactly match the selected manifest;
- `kind`, `operation`, and `capability` agree with contract vocabulary;
- `resource` and `payload` contain normalized, serializable data;
- `result` identifies the normalized result class;
- source range/location points to the author call;
- no provider-specific object or lowering name appears in the effect.

The shared package contract converts this effect into the exact versioned
canonical operation, derives deterministic identity/order, sorts capability
sets, clones immutable data, and rejects unknown fields. The compiler
orchestrates that normalizer; it does not redefine the operation, lowering
bundle, catalog, or provider-requirement identities.

## Diagnostics

Package builders use source-located internal diagnostics for unsupported facade syntax. The contract module should own stable internal code names and payload status vocabulary.

When a package failure is surfaced through the public CLI, the CLI wraps it in [`PULSE_PACKAGE_LOWERING_FAILED`](../reference/diagnostics.md#pulse-package-lowering-failed). Provider-visible missing capability or binding failures use their corresponding public `PULSE_*` entries.

Do not publish internal `PULSEWASM_*` proof codes as stable public diagnostic URLs unless they are deliberately promoted into the public catalog.

## Sidecar lowering declaration

Each `modes.wasm.lowerings[]` entry binds a TypeScript facade symbol to a stable AssemblyScript export:

```js
{
  tsSymbol: 'example.emit',
  asSymbol: 'pulse_example_emit',
  callShape: 'literal-topic-message',
  hostCapabilities: ['example'],
}
```

The sidecar should expose the declared `asSymbol`, call stable named host imports, and remain free of application-level discovery or provider SDK logic.

## Compiler-core separation

The generic loader may contain protocol terms such as manifest, builder, trust, and contract. It must not contain feature strings such as `grip.hold`, `assets.lookup`, or the example package import.

A release test should inspect generic loader/compiler source to enforce that separation for each new lowerer.

The late package-operation seam receives canonical operations, not a
package-specific source AST or source text. Package-specific syntax recognition
belongs to the trusted builder before provider planning; provider-specific
lowering belongs after the complete capability envelope is known.

## Provider contract

Package effects emit provider-neutral requirements. After the complete
reachable program exists, compiler/provider eligibility validates those
requirements through the canonical provider descriptor. The provider must map
every required capability, plus any result capability such as
`opaque.pass-through`.

Package lowerer code must not choose `node.*`, `fastly.*`, backend names, store names, or deployment resources. Those belong to the provider plan.

## Compatibility status

The protocol identifiers above define supported compatibility independently of
npm package versions. Existing `first-party` declarations remain accepted.
Changes to these envelopes require an explicit protocol revision and receiving
validator support; an external package cannot negotiate an unknown protocol by
matching Pulse's release number. Test against each compiler version you claim.

General compiler hooks, untrusted-code isolation, and automatic runtime
capability registration remain outside this contract. The existing prebuilt
guest-unit and provider-realization contracts keep their own restrictions.

## Related documentation

- [Pulse-aware package authoring](./pulse-aware-packages.md)
- [Package-owned lowering concept](../concepts/package-owned-lowering.md)
- [Add a first-party package-owned lowerer](./adding-first-party-lowerer.md)
- [Package support policy](../packages/README.md)
- [Implementation packages](../packages/implementation-packages.md)


## Trusted package runtime bindings

A reachable trusted lowerer can contribute a private `package-runtime-wasm`
realization artifact and canonical `package.invoke` effects. This is an additive
runtime contract, independent of the static prebuilt guest-link contract and
npm release versions. No package-name registration is required. The initial
provider is Node, for explicitly selected Native and JavaScript targets;
Fastly does not implement this capability.

The package owns its facade, protocol, policy, literal configuration, Wasm and
fixtures. The provider owns HTTP capture, time, secret lookup and cryptography.
Applications trust the package's executable build dependency and runtime Wasm;
this mechanism is not an untrusted-code sandbox or CPU preemption boundary.
Existing first-party runtime definitions remain valid and unchanged.

### Definition and artifact

`@pulse-compute/runtime/package` accepts a definition with exact version
`pulse.package-runtime-definition.v1`, a scoped `package`, `contractId`,
`providerKind: 'package'`, and exactly one operation:

```js
operations: {
  invoke: { kind: 'package.invoke', capability: 'package.invoke', result: 'string' }
}
```

`effect(ctx, 'invoke', payload)` still requires the actual live managed context.
The exact payload is `{ artifact, binding, operation, configuration }`; all are
static strings. The compiler rejects dynamic runtime inputs and requires the
same package/contract's artifact, declared operation and configuration. The
result is a UTF-8 string of at most 65,536 bytes; the package defines its format.
Request execution, effect limits, continuation settlement and cancellation are
shared with existing effects. No ambient registration or current request exists.

A realization artifact has exactly these fields:

```js
{
  version: 'pulse.package-runtime-binding.v1',
  id: 'vendor.protocol:profile',
  package: '@vendor/protocol',
  contractId: 'vendor.protocol',
  kind: 'package-runtime-wasm',
  mediaType: 'application/wasm',
  data: {
    abi: 'pulse.package-wasm.v1',
    wasm: 'CANONICAL_BASE64',
    sha256: 'LOWERCASE_HEX_SHA256',
    operations: [{
      name: 'verify', configuration: 'PACKAGE_DEFINED_STATIC_POLICY',
      capabilities: ['http.snapshot', 'time.wall-clock', 'crypto.sha256', 'crypto.hmac-sha256']
    }]
  }
}
```

The canonical validator lives in `@pulse-compute/wasm-contracts/package/runtime-binding`.
It checks owner identity, supported versions, unique operations (1–16), known
capabilities, configuration (8,192 characters maximum), canonical base64 and
hash, actual Wasm imports/exports and memory declaration. Artifacts are at most
1 MiB. There must be one defined, unshared 32-bit memory with an explicit maximum
of at most 32 pages (2 MiB); imported memories and ambient host imports fail.
Conflicting artifact IDs fail compilation. Wasm is a separate instance per
operation; it is not linked into the application's guest memory.

The package builder receives the compiler's TypeScript API as `input.typescript`
for inspection of its provided source file. This adds no provider, key, project
configuration, TypeScript program or language-service authority.
Crypto requirements must also be emitted through the existing package-owned
`cryptoRequirements` contribution. Native explicitly selects the existing
Crypto guest-source byte primitives; JavaScript explicitly selects its
runtime-builtin byte backend. Native never runs JavaScript protocol logic or
falls back to JavaScript crypto.

### Provider grant and HTTP authority

`node.bindings.packages` maps up to 32 literal binding names to records:

```js
{
  package: '@vendor/protocol', contractId: 'vendor.protocol',
  artifact: 'vendor.protocol:profile', operations: ['verify'],
  secret: 'PROTOCOL_KEY', keyId: 'local-key', keyVersion: '1',
  trustDomain: 'tenant-a', origin: 'https://api.example.test'
}
```

The provider checks package, contract, artifact, allowed operation and exact
configuration before invoking Wasm. Wire metadata cannot select a secret name.
Only the provider reads the named secret; UTF-8 key material is 32–4,096 bytes
and never enters effect inputs or protocol memory. The host HMAC verification
command uses constant-time comparison. This first version requires a named key
and HTTP origin even for operations using fewer capabilities.

`origin` is an explicit trusted HTTPS termination setting. The operator must
ensure the transport serves that external origin; this setting is not inferred
from `Host`, forwarded headers, a normalized URL, or a client assertion. The
Node adapter retains original method, origin-form target, ordered field
instances and exact buffered body before creating its Web Request. Limits are
128 fields, 16,384 bytes per value and target, 131,072 combined name/value bytes,
and 65,536 body bytes. Non-ASCII field bytes, absolute/authority/asterisk targets,
fragments, backslashes and opaque/transforming bodies are refused.

The optional provider-driver `capturePackageRequest` hook returns the versioned
`pulse.provider-package-http.v1` envelope with host execution `options` and
`close()`. Node uses branded, request-owned captures; passing an application
record cannot mint one. CLI HTTP development and built Node launchers capture
and close them automatically. Launcher operators supply `packageBindings`
explicitly; project development settings and secret values are not imported
into a production launcher. HTTP fixture tests that bypass transport must
supply a capture through the host integration API. The low-level
`@pulse-compute/provider-node/runtime/package-operations` export is host
integration, not a portable application facade.

Outbound signing is a host integration operation: the host freezes the exact
intended message, captures it with direction `outbound`, invokes the package,
and installs returned fields before sending. No generic send transaction or
proof of a later send is provided. Inbound server captures cannot be relabeled
by an application's payload. Hosts must close direct captures in `finally`.

### Wasm ABI and lifetime

The only allowed imports are `(i32) -> i32` `pulse_package.input_len`,
`(i32, i32, i32) -> i32` `pulse_package.input_read` and optional `env.abort`.
Input reads copy bytes into package memory and return a length, or `-1` when
undeclared/unavailable. Input slots are:

| Slot | Content | Required host capability |
|---|---|---|
| 0, 1, 2 | Configuration, operation, reserved `{}` | None |
| 3–6 | Original method, origin target, scheme, authority | `http.snapshot` |
| 7 | LE u32 field count, then LE u32 length + ASCII bytes for each name and value | `http.snapshot` |
| 8 | Exact body bytes | `http.snapshot` |
| 9 | One nonnegative integer epoch-seconds sample | `time.wall-clock` |
| 10–12 | Key ID, key version, trust domain | `crypto.hmac-sha256` |
| 13 | `inbound` or `outbound` | `http.snapshot` |

Exports are `memory`, `start(): i32`, `resume(length: i32): i32`, and zero-argument
i32 accessors `buffer`, `capacity`, `output_ptr`, `output_len`, `aux_ptr`,
`aux_len`. Pointers are byte offsets in the private memory. Buffer capacity is
65,536–262,144 bytes. `start`/`resume` return a command: 0 completes with UTF-8
output, 1 hashes output with SHA-256, 2 signs output with HMAC-SHA256, 3 verifies
output using the 32-byte tag at the auxiliary pointer. Commands 1/2 write 32
result bytes at `buffer`; command 3 writes one byte (0 or 1). The host then calls
`resume` with that length. At most four crypto commands run per operation and
all output/crypto inputs are at most 65,536 bytes. Every pointer is bounds-checked.

The host checks request activity and capture lifetime before and after async
work and before resumption. Late values never resume or settle a cancelled
request. Key staging, input/output copies, returned crypto bytes and the whole
private Wasm memory are wiped on completion/failure once host work settles.
Provider errors use fixed codes/messages. Native traces and JavaScript effect
observations exclude payloads and results for these operations, regardless of
package-supplied redaction declarations. Returned application responses remain
application-owned output. This contract does not preempt a looping trusted Wasm
function or promise transactional rollback.

JavaScript source packages with runtime artifacts carry an optional hashed
`pulse.package-runtime-artifacts.v1` record. Native artifacts retain the existing
private realization artifact container. Node launchers validate stored hashes
before execution; packages without these artifacts retain their prior layout.

Focused evidence: `node wasm/scripts/run-wasm-tests.cjs --task package-runtime
--task provider-toolchain --task external-lowerers --task package-exports` and
`packages/runtime/test/package-runtime.test.ts`. Protocol-specific parity and
host integration fixtures remain in the independent protocol package.

## Bounded package HTTP completion

`pulse.package-native-application.v2` extends the terminal application contract
with `terminalFailure: 'package-http-v1'` and finite `requestLimits`
(`maxDurationMs`, `maxRequestBytes`). The selected provider must explicitly
realize that package. Its duration may only shorten the host request budget.
The required `pulse_host.package_http_version` import returns 1; older managed
hosts reject the import. The v1 Entities application remains unchanged.

A v2 guest exports `pulse_package_http_failure(kind)`, returning a pointer to
bounded JSON response data. Kinds 1/2/3 mean interruption, oversized input and
invalid input encoding. The function performs no I/O or effect settlement.
Providers retain cancellation, close pending invocations and deliver this
package-owned terminal framing. They never pass exception detail to the guest.
The ordinary result/continuation ABI remains version 2.

Entities' trusted compiler composition seam validates original AST registrations
and the supplied terminal binding, preserving source ranges and schema/handler
ownership. Its Native component builder contributes dispatch, codecs and managed
continuations with package-owned transport hooks. MCP supplies its HTTP protocol
at those hooks. The internal JavaScript transport export uses the same Entities
operation pipeline; detached schema descriptions include declared IDs only.


## Operation-level host contributions

The HEX integration workstream defines `pulse.host-extension.v1` inside the
existing `realizationArtifacts` array. The builder-result and artifact-set
carrier versions do not change. Other artifact kinds and current lowerers keep
their existing contracts. This protocol does not promote the provisional GRIP
Fanout/WebSocket methods to the released supported API; packed and actual-host
qualification remain separate acceptance work.

A lowerer contributes a plain immutable data record with these exact fields:

| Field | Required value or meaning |
| --- | --- |
| `version` | `pulse.host-extension.v1` |
| `kind`, `mediaType` | `host-extension`, `text/assemblyscript` |
| `id` | Package-qualified ID beginning with `<package>:` |
| `package`, `contractId` | Exact selected lowerer authority |
| `data.target` | Exact `{ provider, target: "native", targetId }` |
| `data.operation` | Operation name under that package and contract |
| `data.service` | Required versioned provider service |
| `data.source`, `data.sha256` | Self-contained generated source and its exact SHA-256 |
| `data.entry` | Package-owned source symbol beginning with `__`; never `__pulse_` or `__Pulse` |
| `data.imports` | Unique `{ module, name, parameters, results }` declarations |

Source is at most 65,536 UTF-8 bytes. This representation carries generated
source, not file paths or export resolvers. Module `import`/`export` keywords
(including in comments) and `__pulse_`/`__Pulse` identifiers are excluded. The trusted
builder and manifest still resolve through the existing package-contained,
symlink-checked path contract. No new filesystem read authority is introduced
by the artifact. These restrictions bind the declared source closure; they do
not sandbox trusted build dependencies or generated native code.

Import types are MVP `i32`, `i64`, `f32`, or `f64`, with at most 32 parameters
and one result. At most 64 imports and 256 candidate contributions are admitted.
The provider service can impose a narrower signature and placement.

The optional target descriptor field `hostExtensions` advertises
`{ version: "pulse.host-extension-admission.v1", protocols, services }`.
Absence means no host-contribution admission. Selection matches package,
contract, operation and all three target fields, then requires an advertised
protocol and service. Npm release versions do not participate. Exactly one
compatible contribution may realize each used operation. Duplicate IDs,
overlapping compatible realizations, conflicting contract ownership of a
package operation, and selected entry-symbol collisions fail. Disjoint targets
can coexist; input graph or declaration order does not choose a winner.

Only selected implementations enter provider source or its effective import
ceiling. The ceiling is computed from provider baseline imports and validated
selected declarations before inspecting emitted Wasm. Contributions may not
redeclare baseline imports. Identical selected import declarations can share
an import; conflicting signatures fail. `pulse.host-extension-import-policy.v1`
binds baseline identity, selected package/contract/operation/target/service,
source digests, entry symbols and declared signatures. The binary audit checks
actual function types, missing selected imports, undeclared imports, conflicting
observed signatures and policy-content identity. Observed imports never grant
permission. Selected manifest attribution and actual binary audit observations
remain distinct records.

Fastly Native currently advertises only `terminal-request-backend.v1`. It
accepts one directly returned terminal operation in an ordinary handler with a
static logical backend key and one `(i32, i32, i32) -> i32` host import. The
provider supplies request handle and UTF-8 backend pointer/length, owns dispatch
and completion, and prevents response emission after dispatch. Helpers,
Router/managed handlers, grouped or additional effects, request-body/state
access, body forwarding, logging and guest-unit composition remain rejected.
The service borrows the request handle: status zero transfers downstream
response authority but leaves local request/body handles owned by the provider.
Contributions implementing this service must preserve that borrowing contract.
The provider closes those handles once on success, including when completion
later fails, and on undispatched invocation exit. Cleanup failures do not retry
or restore response authority. After a nonzero status or trap, ownership remains
uncertain; the provider performs no speculative close and leaves reclamation to
host teardown. Hosted correspondence and failure-status ownership remain
unqualified. There is no retry or failure-driven implementation fallback.

Opaque completion is bound to the selected effect's invocation ticket and a
private provider delivery path. Raw exported result setters cannot authenticate
terminal results; stale, reused and forged completion is rejected. The shared
request deadline is checked immediately before dispatch, and a closed invocation
cannot start or settle the handoff. Normal, shared-error and timeout responders
are fenced after dispatch, including an ambiguous outcome. The provider retires
its token on completion or invocation close. This synchronous service adds no
cancellation API or scheduler; a hostcall already executing cannot be interrupted.

GRIP's provisional `handoffFanout` and `handoffWebSocket` use the same service and
protocol, differing only in package-owned source/ABI identity. The latter binds
`redirect_to_websocket_proxy_v2`; no session or frame engine is added. Neither
method is promoted to the released supported facade by this integration pass.

Generic methods and host-specific methods can coexist in a package. Unsupported
reachable operations fail with a `PULSE_HOST_EXTENSION_*` diagnostic and authored
location where an operation is available; dynamically invoked JavaScript calls
retain their package guard. Generic GRIP methods keep their existing semantics.
Stable public diagnostics cover target, protocol, binding, ownership, source,
conflict, signature, import-policy and placement failures. No provider object,
compiler service, mutable configuration or resolved secret is added to the
lowerer invocation.


### Authoring a generic package with host upgrades

Keep the portable contract explicit. A package can expose its existing generic
methods alongside separately named host-specific methods. Co-locate the facade,
trusted builder and generated contribution when that helps maintenance and code
reuse; splitting them into another package is optional. A separate package does
not receive additional compiler authority.

GRIP illustrates the distinction: `grip.handoff(...)` continues to construct the
generic GRIP response, while the provisional `grip.handoffFanout('fanout')` and
`grip.handoffWebSocket('fanout')` request the terminal Fastly Native service.
They are different operations, not a transparent optimization of the generic
method. Changing to Node Native, Node JavaScript or Fastly JavaScript rejects a
recognized reachable host-specific operation with `PULSE_HOST_EXTENSION_TARGET`.
An opaque JavaScript lookup that reaches the facade throws “not implemented for
this host.” Do not catch either failure and silently retry a different operation:
a handoff may already have transferred response authority.

Choose contribution IDs under the owning package, keep generated source and its
UTF-8 SHA-256 together, and declare the exact target, service and function
signatures. The provider matches protocol versions rather than npm versions.
Installing a package is not selection: only reachable operations select an
implementation. Neither an unused import nor generic-only use grants additional
ABI imports. Test those controls from an installed tarball consumer as well as
testing a used operation. Use only declared exports in the consumer; private
checkout paths cannot demonstrate package usability.

Retained Native reports can record `hostExtensions`: contribution identity,
package/contract/operation owner, authored call location, generated-source digest,
required target/service/protocol, import-policy digest, final artifact identity,
and separate declared and observed import signatures. Collection re-audits the
exact final Wasm against the provider's policy. Observed signatures cover that
contribution's imports; the policy still checks the entire import ceiling.
Comparison joins the logical package/contract/operation/target and exposes
source, policy and import changes. An absent collection in a historical or
portable-only report is unknown, not an empty selection. These records neither
invent a whole-application source fingerprint nor prove that a hostcall ran.

Qualify the separate layers honestly: injected lifecycle tests, exact installed
consumer builds, local Viceroy/Pushpin transport, and separately authorized hosted
acceptance. Pin engine and artifact identities and retain failed or unavailable
lanes. A local WebSocket exchange does not qualify hosted failure-status ownership,
and a successful build does not qualify a GRIP hold/publish exchange. The bounded
terminal placement and lifecycle restrictions above apply to every contribution
using this service. This integration protocol remains provisional; qualification
does not by itself promote a package symbol or a target support tier.
