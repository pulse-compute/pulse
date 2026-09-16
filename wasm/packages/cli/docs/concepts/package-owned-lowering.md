# Package-owned lowering

Package-owned lowering lets a synchronized Pulse package extend the canonical compiler with narrow, statically recognized operations while keeping domain rules out of compiler core.

The synchronized `1.0.0-beta.5` release uses this pattern for Assets, GRIP,
JWT, Entities, S3, and Crypto exact-text digests.
It is a **trusted first-party synchronization mechanism**, not a public
registry that executes arbitrary npm compiler plugins.

## One package API, two execution paths

Application code imports the normal package root:

```ts
import { assets } from '@pulse-compute/assets'
import { grip } from '@pulse-compute/grip'
import { jwt } from '@pulse-compute/jwt'
```

On the JavaScript target, the actual package TypeScript/JavaScript implementation executes. On Native targets, the compiler recognizes supported package-root symbols and lowers them into canonical package effects. Lowering restrictions remain eligibility and diagnostic rules; they do not require target-specific application source.

Older `/pulsewasm` imports are compatibility-only and are isolated in the
[migration guide](../guides/compatibility-imports.md).

## Why the package owns the lowerer

A domain package knows details that compiler core should not:

- which root symbols are effects or pure result adapters;
- which argument shapes are statically representable;
- which payload versions and diagnostics belong to the domain;
- which sidecar symbols compiled Wasm requires;
- which capabilities a provider must implement;
- which JavaScript behavior is broader than the lowerable Native subset.

## Package anatomy

A lowerable package normally ships:

```text
package.json                 application exports and discovery pointers
pulse.package.json           product, target, ownership, and conformance metadata
src/                         actual JavaScript implementation and portable API
pulsewasm.manifest.cjs       trusted lowerer and compatibility declaration
pulsewasm.compiler.cjs       package-specific validation and effect construction
as/index.as.ts               optional compiled-Wasm sidecar ABI
README.md                    current product and compatibility boundary
```

`pulse.package.json` is static metadata. It cannot register or execute compiler code. `pulsewasm.manifest.cjs` identifies the trusted first-party compiler builder. Product metadata and executable compiler authority remain separate.

## Discovery and trust

The canonical project compiler:

1. builds the reachable module graph;
2. attributes package imports from that graph rather than source substrings;
3. loads synchronized package product contracts;
4. selects a trusted package compiler only for a reachable supported Native operation;
5. invokes it through the exact immutable shared builder envelope;
6. normalizes its artifact and contributions before compiler orchestration;
7. combines canonical package effects with core effects and continuations;
8. validates the complete provider capability envelope.

A package manifest must declare first-party trust and ownership matching the
package. Dynamic third-party compiler registration is not part of the Beta
contract.

Caller option bags do not cross this boundary. In particular, provider target
descriptors, drivers, runtime objects, raw CLI configuration, compiler caches,
resolved secrets, and arbitrary compiler services are not builder inputs.
Package builders emit canonical requirements; later compiler/provider
eligibility checks decide whether the selected target can satisfy them.

## Request-bound package effects

A package effect is created through an explicit `PulseContext`:

```ts
await grip.broadcast(ctx, {
  channel: 'events:demo',
  data: { type: 'message', value: 'hello' },
})
```

The shared package bridge returns the same request-owned effect value used by core operations. It therefore supports:

- direct `await`;
- keyed `ctx.parallel({ ... })`;
- request cancellation and completion containment;
- deterministic grouped failure selection;
- known-secret redaction;
- generic provider dispatch.

The bridge has a fixed first-party identity catalog. It does not use ambient current-request state, `AsyncLocalStorage`, or mutable global registration.

## Pure package operations

Not every package function is an effect. Pure request classification and response decoration should remain ordinary JavaScript:

```ts
if (grip.isWebSocket(ctx.req)) {
  return grip.handoff({ channel: 'events:demo' })
}

return grip.subscribe(new Response(null), {
  channel: 'events:demo',
  mode: 'stream',
})
```

Similarly, `assets.respond()` is a pure result adapter. Native lowering may erase that helper around an `assets.lookup()` result without turning response decoration into another provider effect.

## Static call shapes

Native package lowering intentionally accepts less than arbitrary TypeScript. A package may require:

- a known package-root import and symbol;
- supported direct-await, variable, return, or `ctx.parallel()` placement;
- fixed object-literal options;
- statically representable resources or operation selectors;
- no escaping internal handles;
- no provider SDK values.

Unsupported shapes make the Native project ineligible with a source-located diagnostic. The same package may still support broader direct JavaScript behavior when the selected JavaScript target and provider contract allow it.

## Provider completion

A package is not complete merely because its compiler emits an effect. Every provider advertised for that operation must:

- declare the capability;
- map it to a stable operation;
- validate required bindings;
- execute it in local conformance;
- realize it in deployable output when claimed;
- preserve structured or opaque result ownership.

Assets demonstrates package-root JavaScript execution plus Native package lowering and opaque response ownership. GRIP provides stateless JavaScript framing, bounded broadcast provider realization, and Native/root conformance.

JWT demonstrates a package-owned verification effect whose Native lowering
composes package-owned JWT logic with crypto-owned realizations. HS256 Native
compiles the crypto guest source into the primary module; ES256 Native
contributes one exact prebuilt guest unit through the guest-link boundary.
JavaScript uses the same package contract with the selected runtime builtin for
HS256 and ES256. Provider eligibility begins only after the package emits its
provider-neutral capability and crypto requirements.

A package-selected prebuilt guest is a separate canonical contribution, not a
filesystem or compiler object. It carries only its version, stable ID,
package-relative manifest, exact owner/package version, and
`package-prebuilt` origin. The compiler resolves the synchronized package root
as a separate selection fact. Guest-link then receives that exact contribution
through its own invocation contract; `packageRoot`, target descriptors,
compiler realizations, and option bags are never fields of the contribution.

## Release expectations

A supported package-owned lowerer needs:

- product and trusted-manifest validation;
- positive and negative static lowering tests;
- JavaScript runtime tests for the real package implementation;
- direct-await and keyed-parallel package-effect tests;
- provider capability and binding tests;
- packed-package discovery and clean installation;
- documentation distinguishing canonical roots from compatibility subpaths;
- explicit evidence classifying every unsupported shape.

See [Pulse-aware package
authoring](../contributing/pulse-aware-packages.md), [Add a first-party
package-owned lowerer](../contributing/adding-first-party-lowerer.md), [Managed
handler TypeScript and JavaScript](../reference/handler-authoring.md),
[Provider and target compatibility](../reference/compatibility-matrix.md),
[Contracts and providers](./contracts-and-providers.md), and [Compilation and
lowering](./compilation-and-lowering.md).
