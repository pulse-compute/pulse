# Contracts and providers

Pulse separates application semantics from provider realization. The compiler emits canonical contracts; a provider declares supported capabilities and maps canonical operations to its runtime and build target.

This separation is why the same handler can run through the Node conformance provider and compile to a Fastly Compute target without importing either provider’s SDK.

## Contract layers

| Layer | Owner | Purpose |
|---|---|---|
| Canonical handler API | `@pulse-compute/runtime` | Defines portable request, response, fetch, config, secret, and KV semantics. |
| Canonical compiler program | Pulse compiler | Records values, branches, effects, continuations, schemas, and capability requirements. |
| Package effect contract | Owning package + shared contracts | Defines narrow package-owned operations such as `pulse.grip`. |
| Provider descriptor | Provider package | Declares capabilities, operation lowering names, runtime identity, and build target. |
| Provider lowering plan | Shared provider contract | Verifies requirements and binds every canonical operation to provider behavior. |
| Provider toolchain boundary | Shared provider contract + selected provider package | Validates the exact driver/target surface and projects versioned planning, target invocation, and result envelopes. |
| Local conformance runtime | Provider package | Executes canonical programs for `test` and `dev`. |
| Deployable target builder | Provider package | Emits provider source and compiled target artifacts for `build`. |

No layer may infer capability support from arbitrary application imports or provider-specific objects.

## A package-owned contract in source

Packages expose ordinary application APIs while retaining package-owned effect identities and provider requirements. Assets is the converged example:

```ts
import { assets } from '@pulse-compute/assets'

const found = await assets.lookup(ctx, 'public', '/app.js')
return assets.respond(found)
```

JavaScript executes the package implementation through the request-bound package bridge. Native compilation recognizes the same root call and emits the `pulse.assets` package operation. The package owns payload validation and result semantics; the selected provider owns lookup realization and opaque response delivery.

GRIP uses the same split. `isWebSocket`, `subscribe`, and `handoff` are pure HTTP helpers; only `grip.broadcast(ctx, message)` is a provider effect. Bounded broadcast realization is provider-owned and does not imply Pulse-owned WebSocket lifecycle.

`pulse inspect --json` reports the reachable package contract, selected target support, emitted package effects, provider requirements, and any pending realization reason separately.

## Provider selection

Pulse `1.0.0-beta.1` has three provider driver identifiers:

| Provider | Local execution | Deployable build | Purpose |
|---|---:|---:|---|
| `node` | Yes | Yes, as Node output | Default local and portable conformance path. |
| `fastly` | Yes, through local conformance | Yes, Fastly Compute | Typed bindings plus source and `bin/main.wasm` generation. |
| `none` | No | Canonical compile output only | Inspect or compile without an executable provider. |

Provider selection is normalized from the active `.pulse/config.ts` profile. Public provider overrides are not supported, and `none` cannot drive `pulse test` or `pulse dev`.

## Capability validation

The compiler derives requirements from source. The provider descriptor lists what it implements. The shared contract rejects the plan when any requirement is absent.

```text
source operation
  → canonical capability
  → provider descriptor lookup
  → provider lowering + binding
  → execution/build
```

This catches unsupported behavior before a request reaches a provider runtime. Relevant diagnostics include:

- [`PULSE_PROVIDER_CAPABILITY_MISSING`](../reference/diagnostics.md#pulse-provider-capability-missing);
- [`PULSE_PROVIDER_CAPABILITY_UNSUPPORTED`](../reference/diagnostics.md#pulse-provider-capability-unsupported);
- [`PULSE_FASTLY_BACKEND_REQUIRED`](../reference/diagnostics.md#pulse-fastly-backend-required);
- [`PULSE_FASTLY_KV_BINDINGS_INVALID`](../reference/diagnostics.md#pulse-fastly-kv-bindings-invalid).

## Bindings are configuration, not userland APIs

A Fastly provider configuration maps logical canonical resources to deployment bindings:

```ts
import { defineConfig } from '@pulse-compute/cli'
import { fastly } from '@pulse-compute/provider-fastly'

export default defineConfig({
  provider: fastly({
    configStore: 'pulse_config',
    secretStore: 'pulse_secrets',
    kv: { sessions: 'sessions_store' },
    backends: { 'https://api.example.com': 'api_backend' },
    dynamicBackends: false,
  }),
})
```

Handler source still calls `ctx.config.get`, `ctx.secret.get`, `ctx.kv.get`, or `ctx.fetch`. It never imports a Fastly store, backend, request, response, or SDK type.

## Local conformance versus deployment reality

`pulse test` and `pulse dev` execute through provider-owned local conformance runtimes using configured fixtures and values. They prove the canonical program and provider mapping, not the health of an external deployment.

For Fastly, `pulse build` additionally emits a real Compute target. The explicit environment-dependent reality gate executes it through an inspected Fastly CLI or direct Viceroy launcher and real HTTP requests; remote deployment remains separate. See [Fastly deployment candidates](../guides/deploying-fastly.md), [Fastly package guide](../packages/provider-fastly.md), and [Release acceptance](../maintainers/release-acceptance.md).

## Current extension boundary

There is no automatic provider plugin registry in `1.0.0-beta.1`. Configuration
selects a bare host ID, internal `none`, or an exact scoped project-installed
package name. Bare IDs resolve by the `@pulse-compute/provider-<id>` convention.
A package is loadable only when selected and when it exports the versioned
`./toolchain` contract; Pulse does not scan, self-register, or fall back to
another provider. Adding a host to the built-in support catalog requires a
coordinated source, release, documentation, and acceptance change.

Likewise, package-owned lowerer manifests are executable only when they are trusted first-party packages. External npm packages cannot self-register compiler code merely by shipping a manifest.

Contributor workflows:

- [Pulse-aware package authoring](../contributing/pulse-aware-packages.md)
- [Add a first-party package-owned lowerer](../contributing/adding-first-party-lowerer.md)
- [Add a core provider](../contributing/adding-core-provider.md)

The provider toolchain page defines only its narrow, explicit bootstrap
contract. It does not define general plugin discovery or widen the
first-party-only lowerer compatibility promise.

## Toolchain and target boundary

Loading `./toolchain` is only the bootstrap. The export, driver, selected target,
planning input, target invocation, Native artifact, JavaScript package result,
and provider result each carry an exact contract identity. Driver creation
receives no compiler callback or option bag. Shared validation rejects unknown
versions and fields, missing required methods, malformed target descriptors,
and supported Native targets without a final-Wasm policy before provider code
can generate output.

The compiler composition root projects only:

- the canonical Native or JavaScript application plan;
- the canonical provider lowering plan and explicit capability, binding, and
  package requirements;
- the exact selected target and normalized provider configuration;
- explicit project root, output root, profile, synchronized package versions,
  and optimization posture;
- for Native, copied Wasm bytes plus the narrowed artifact manifest,
  realization contributions, and final guest-audit authorization.

Compiler ASTs and services, builders, raw lowerer output, mutable manifests,
diagnostic collectors, caches, and unrelated environment/profile records do not
cross the seam. Target results are normalized into data-only versioned
envelopes before command orchestration reads them. Guest-linked packaging is
accepted only when the packaged artifact hash equals the final authorized audit
hash. Failure remains attached to the selected provider and target; Pulse does
not attempt another target or provider.

## Related documentation

- [Compilation and lowering](./compilation-and-lowering.md)
- [Effects and continuations](./effects-and-continuations.md)
- [Package support policy](../packages/README.md)
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Node build and execution](../guides/deploying-node.md)
- [Fastly deployment candidates](../guides/deploying-fastly.md)
- [Project configuration](../reference/project-config.md)
- [Fastly capabilities](../guides/fastly-capabilities.md)
