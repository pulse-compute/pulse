<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Add a first-party package-owned lowerer

Start with [Pulse-aware package authoring](./pulse-aware-packages.md) to decide
whether the package needs Native lowering at all. Ordinary target-compatible
JavaScript packages do not require a compiler builder.

> **Scope and trust boundary:** Pulse `1.0.0-beta.1` executes package-owned compiler builders only when their manifest declares `compiler.trust: 'first-party'` and the package is part of the synchronized release set. This is a core-repository contributor workflow, **not an external plugin** interface or a supported third-party plugin API. An external package cannot self-register arbitrary compiler code.

A package-owned lowerer lets one release package define a narrow TypeScript facade and keep its domain-specific static validation outside compiler core. GRIP is the clearest current example; assets is the second implementation proving that the generic loader is not GRIP-specific.

## What belongs where

| Concern | Owner |
|---|---|
| Ergonomic lowerable TypeScript symbols | Feature package root, such as `packages/grip/src/index.ts` |
| Package identity and facade-to-sidecar declaration | Feature package manifest |
| Domain payload versions and diagnostic vocabulary | Shared contracts package |
| AST validation and canonical effect construction | Feature package compiler builder |
| Manifest discovery and trusted builder loading | `@pulse-compute/wasm-library-kit` |
| Whole-project orchestration and merge with canonical effects | `@pulse-compute/wasm-compiler` |
| Capability realization | Node/Fastly provider packages |
| Product workflow, diagnostics, docs, release validation | `@pulse-compute/cli` and root release scripts |

The central compiler may invoke and combine package plans, but it must not absorb package-specific symbol names, payload rules, or provider behavior.

## End-to-end data flow

```text
application import
  → package facade symbol
  → package manifest discovery
  → first-party compiler builder
  → package contract validation
  → canonical package effect
  → shared provider plan
  → Node/Fastly realization
```

## 1. Choose stable identity

Define before implementation:

- a contract ID, such as `pulse.grip`;
- an npm package owner;
- one canonical package-root import;
- a small static symbol set;
- canonical effect kinds and result classes;
- the providers that can realize each operation;
- unsupported or reserved forms and their diagnostics.

Identity must have one owner. Do not duplicate contract IDs, package names, or facade symbol lists in compiler core.

For a new package named `@pulse-compute/example`, a typical layout is:

```text
packages/example/
  src/index.ts
  pulsewasm.manifest.cjs
  pulsewasm.compiler.cjs
  as/index.as.ts
  package.json
  README.md
  test/
```

## 2. Create a real package-root API

The package root must be the application import for both JavaScript execution
and supported Native lowering. JavaScript targets execute the real package
implementation. The compiler recognizes a deliberately narrower set of
package-root calls for Native targets and reports unsupported forms as
eligibility diagnostics.

Design rules:

- keep the public lowerable symbol set narrow;
- prefer literal or statically bounded arguments;
- use the package root as `lowerableSubpath` and `facade.import`;
- do not import a provider SDK;
- route request-bound work through the explicit Pulse context;
- keep pure framing or result-adoption helpers free of ambient authority;
- keep compatibility subpaths, when they already exist, out of new authoring
  guidance.

Export the package root from `package.json` and include its built
JavaScript/types in the packed files.

## 3. Declare the package manifest

The package root advertises the manifest in `package.json`:

```json
{
  "pulsewasm": {
    "manifest": "./pulsewasm.manifest.cjs"
  }
}
```

The manifest uses `pulsewasm.lowerable-library-manifest.v2` and must include:

```js
const pulseWasmManifest = Object.freeze({
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

module.exports = pulseWasmManifest
```

The manifest validator requires the facade, TypeScript/JS entries, sidecar, lowering list, builder protocol, entry, export, owner, and trust declaration. `compiler.builderOwner` must match `npmPackage`.

Do not weaken the `first-party` check to make a local experiment load. A public plugin mechanism would require separate trust, discovery, sandboxing, version negotiation, and compatibility design.

## 4. Define contract-owned schemas and diagnostics

Add the operation and plan vocabulary under `wasm/packages/contracts/src/<feature>/`. Contracts should define:

- contract and artifact version constants;
- valid operation names and capabilities;
- payload and result shapes;
- static status vocabulary;
- internal compiler diagnostics for invalid facade forms;
- normalization helpers used by builder and providers.

Contracts must not contain package discovery, AST traversal, provider execution, or application runtime code.

Export the new contract through the contracts package’s declared subpaths and verify package exports.

## 5. Implement the package compiler builder

The manifest export, such as `buildExampleLoweringPlan`, receives the source, discovered manifest, library contracts, TypeScript parser, and builder ownership metadata from the generic loader.

The builder should:

1. collect only imports from its exact `lowerableSubpath`;
2. classify namespace, default, and named imports intentionally;
3. match supported call placements;
4. validate literals and object options with contract-owned rules;
5. emit source-located diagnostics for unsupported forms;
6. construct canonical package effects;
7. return a versioned package plan and summary;
8. avoid provider-specific lowering names or runtime calls.

A canonical package effect needs enough information for the shared provider contract:

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
  resource: { kind: 'literal', value: 'updates' },
  payload: { topic: 'updates', message: 'ready' },
  loc: { file: 'src/index.ts', line: 4, column: 3 },
}
```

Keep domain rules in the builder. The generic loader is intentionally free of strings such as `grip.hold` or `assets.lookup`.

## 6. Add the sidecar contract when compiled Wasm needs one

The manifest’s sidecar source exports stable symbols and delegates to stable host imports. It is an ABI boundary, not the place to reimplement the package compiler.

For each manifest lowering:

- export the declared `asSymbol`;
- keep arguments/results deterministic and versioned;
- map to named host capabilities;
- add compile/link tests;
- prove packed-package discovery, not only monorepo source resolution.

A sidecar can be a readiness/ABI surface even when provider execution is implemented elsewhere. Document that status explicitly.

## 7. Verify generic discovery

The reachable module graph selects participating package contracts and tracks
package-root symbols through supported imports and re-exports. The compiler
then recognizes operations in each reachable project module. The generic
library kit resolves the selected first-party manifest from the synchronized
workspace or exact installed package and invokes its declared builder.

This is not entry-source substring discovery. An installed dependency is not
participating merely because it has a manifest, and a package cannot
self-register compiler code. The detailed owner and pipeline map lives in the
[package lowerer contract reference](./package-lowerer-contract.md).

Add tests proving:

- the manifest validates;
- the package exports its lowerable facade, manifest, and compiler-builder subpaths as intended;
- `package.json.files` includes the manifest, builder, sidecar, and built facade;
- discovery works from an isolated `node_modules`-style packed package;
- a reachable import or supported project re-export selects the package contract;
- an installed but unreachable lowerable package is not selected;
- the generic loader resolves the manifest-declared builder export;
- compiler core does not hard-code the new package import or symbol names.

Do not rely only on workspace symlinks.

## 8. Add provider realization

A package effect is not usable until each advertised provider maps its capabilities. For every supported provider:

- add capabilities to its descriptor;
- add stable lowering names;
- normalize required bindings;
- implement local conformance behavior;
- implement target/build behavior where applicable;
- fail with a public diagnostic when required bindings are absent;
- preserve `providerSpecificUserland: false` and `providerSdkUserland: false`.

A provider that cannot implement the capability should reject it during provider-plan creation, not at an arbitrary later request branch.

## 9. Add public diagnostics and documentation

Internal `PULSEWASM_*` builder diagnostics are useful for proof lanes but are not automatically public CLI codes. Any failure that can reach application authors through the supported workflow needs an entry in the public diagnostic catalog with title, summary, remediation, exit class, HTTP mapping where applicable, and a generated anchor.

Update:

- the feature package README;
- [Package support policy](../packages/README.md) when the package is published or its supported entries change;
- a package guide under `docs/packages/`;
- concept or tutorial pages that introduce the capability;
- project configuration reference when new bindings are public;
- the environment reference only for genuine process-level inputs.

Public examples must use canonical handlers and the normal `pulse` workflow.

## 10. Required verification

At minimum, cover:

```text
positive static lowering
negative dynamic/literal validation
manifest schema validation
builder owner/trust validation
normal-JavaScript facade failure
canonical effect shape
provider capability plan
Node local conformance when supported
Fastly local and compiled target behavior when supported
packed package discovery
package export and tarball contents
documentation links and source-bound snippets
```

Run the repository’s focused tests first, then the release gates:

```bash
pnpm docs:check
pnpm wasm:test:unit
pnpm wasm:test:native
pnpm wasm:test:providers
npm run release:seal
```

Exact script names may evolve; the authoritative profiles are described in [Testing](../maintainers/testing.md).

## Review checklist

A lowerer is ready for the synchronized release only when all answers are yes:

- Does the feature package own its facade, manifest, and builder?
- Does a shared contract own payload/version semantics?
- Is the builder explicitly first-party and owner-matched?
- Does compiler core remain free of feature-specific AST rules?
- Are all advertised providers capable and bound?
- Does ordinary JavaScript execution use the real package implementation?
- Does packed dependency discovery work without workspace paths?
- Are public failures catalogued and documented?
- Is the Beta boundary narrower than or equal to what tests prove?

## Related documentation

- [Pulse-aware package authoring](./pulse-aware-packages.md)
- [Compilation and lowering](../concepts/compilation-and-lowering.md)
- [Contracts and providers](../concepts/contracts-and-providers.md)
- [GRIP package guide](../packages/grip.md)
- [Assets package guide](../packages/assets.md)
- [Implementation packages](../packages/implementation-packages.md)
