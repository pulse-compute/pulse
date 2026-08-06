<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Package lowerer contract reference

This reference describes the internal first-party lowerer protocol used by the
synchronized `1.0.0-beta.1` release. It documents current repository
interfaces; it is not a third-party plugin compatibility promise. Package
availability remains owned by the release catalog.

Use [Pulse-aware package authoring](./pulse-aware-packages.md) first. This
protocol is necessary only when the synchronized release deliberately adds a
bounded Native subset to an ordinary package-root JavaScript API.

## Application promise versus internal protocol

Do not treat every file in this pipeline as one compatibility surface:

| Surface | Audience | Compatibility meaning |
|---|---|---|
| Package-root exports and documented JavaScript behavior | Application authors | The supported package API for the declared JavaScript targets. |
| Documented package-root Native subset | Application authors | A source eligibility promise backed by provider/target conformance. |
| `pulse.package.json` product metadata | Release and compiler tooling | Static synchronized-release classification; it cannot execute code. |
| `pulsewasm.manifest.cjs` and compiler builder | First-party package/compiler maintainers | An internal version-locked protocol that may change with the synchronized compiler. |
| Canonical package effects and shared feature contracts | Compiler and provider maintainers | Provider-neutral operation semantics inside the synchronized release. |
| Provider plans, bindings, and target output | Provider maintainers and deployers | Host realization, not an application import surface. |

Only explicitly documented package-root facades carry the application support
promise. Resolving a manifest, builder export, sidecar symbol, internal contract
module, or provider lowering name does not make it a public extension API.

## Canonical owner map

The present-tense owner for each stage is:

| Concern | Canonical repository owner |
|---|---|
| Product role, target modes, and conformance IDs | `packages/<feature>/pulse.package.json` |
| Application API and JavaScript implementation | `packages/<feature>/src/` and its package exports |
| First-party manifest and builder entry | `packages/<feature>/pulsewasm.manifest.cjs` and `packages/<feature>/pulsewasm.compiler.cjs` |
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
through `@pulse-compute/crypto`; this does not make the internal protocol
independently version-compatible.

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
Manifest discovery may resolve a synchronized workspace package or an exact
installed package, but it does not make every dependency reachable and it does
not enable third-party self-registration.

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
| Required trust | `first-party` |
| Canonical provider plan | `pulse.canonical-provider-plan.v1` |
| Canonical provider contract | `pulse.canonical-provider-contract.v1` |

Package-specific contract, plan, artifact, and payload versions are owned by their corresponding shared contract modules.

## Package discovery declaration

A lowerable package declares the manifest path in `package.json`:

```json
{
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
| `compiler.trust` | Must be `first-party`. |

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
    trust: 'first-party',
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
- first-party trust;
- normalization of TypeScript, JavaScript-engine, and Wasm mode objects.

A manifest validation error prevents builder execution.

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

This protocol is synchronized inside the `1.0.0-beta.1` release set. It can change with compiler implementation needs. Only explicitly documented application facades carry the package support promise.

A public external lowerer API would require a new contract that addresses trust, sandboxing, provenance, protocol negotiation, resource limits, lifecycle support, and semver compatibility.

## Related documentation

- [Pulse-aware package authoring](./pulse-aware-packages.md)
- [Package-owned lowering concept](../concepts/package-owned-lowering.md)
- [Add a first-party package-owned lowerer](./adding-first-party-lowerer.md)
- [Package support policy](../packages/README.md)
- [Implementation packages](../packages/implementation-packages.md)
