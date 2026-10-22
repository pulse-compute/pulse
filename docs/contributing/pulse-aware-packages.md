<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-10-21
review-by: 2027-04-21
pulse-doc-meta:end -->

# Pulse-aware package authoring

A Pulse-aware package begins as an ordinary JavaScript package with a real
package-root API. Native lowering is an additional bounded realization, not a
second application-facing facade and not a requirement for JavaScript use.

```text
ordinary package API
  + real JavaScript implementation
  + bounded Native-lowerable subset
  + package contract
  + trusted compiler builder
  + provider requirements
  + cross-target conformance
```

## Choose the extension boundary

| Goal | Current boundary |
|---|---|
| Provide ordinary library behavior on JavaScript targets | Publish a normal target-compatible JavaScript package API. |
| Add package-root Native lowering | Implement the versioned trusted package-lowerer contract, including for independently released external packages. |
| Add a project-owned execution provider | Export the versioned provider `./toolchain` contract from an exact scoped package. |
| Add arbitrary compiler hooks or execute an untrusted plugin in isolation | Not supported; the versioned trusted package-lowerer contract above is the supported extension seam. |
| Self-register a provider by scanning dependencies or package metadata | Not supported. |

Provider toolchains and package lowerers are separate extension systems. A
provider realizes canonical capabilities and target artifacts. A package
lowerer recognizes a bounded package-root call and emits canonical package
effects. Neither mechanism grants provider SDK access to handlers.

## 1. Design the package root first

The package root owns the application API:

```ts
import { feature } from '@example/pulse-feature'
```

For JavaScript targets, ship a real implementation with ordinary types,
runtime code, tests, and target-compatible dependencies. Pulse's Node and
Fastly JavaScript packagers include reachable dependencies, but each runtime
still has its own platform constraints. A Node-specific package is not
automatically Fastly-compatible.

Keep authority explicit:

- accept `ctx` only when the operation needs a request-owned Pulse effect;
- keep pure framing and result adapters independent of ambient state;
- do not read provider SDK objects, `process.env`, global network authority, or
  mutable request globals from canonical APIs;
- document which JavaScript targets the implementation actually supports.

Independent packages may stop here. They do not need a compiler builder merely
to work on an explicitly selected compatible JavaScript target.

## 2. Define the Native subset separately

If your package needs Native support, define a smaller static
subset of the same package-root API:

- exact package-root import and symbol identities;
- supported call placement;
- literal or statically bounded arguments;
- canonical operation, payload, result, and capability vocabulary;
- source-located diagnostics for unsupported shapes;
- provider requirements and result ownership;
- optional sidecar ABI symbols.

The JavaScript implementation may remain broader. Unsupported Native shapes
make that project ineligible for Native selection; they do not trigger target
fallback.

## 3. Keep contract and execution owners distinct

| Concern | Owner |
|---|---|
| Public package-root API and JavaScript implementation | Feature package |
| Operation, payload, result, and diagnostic vocabulary | Shared package contract |
| Native call-shape recognition | Package-owned compiler builder |
| Manifest discovery and trusted builder loading | Generic library kit |
| Whole-project effect and continuation composition | Canonical compiler |
| Capability and binding realization | Selected provider |
| Product support, packing, docs, and acceptance | Synchronized release |

Compiler core may combine package effects but must not absorb package-specific
symbol names, payload rules, or provider lowering names.

## 4. Understand the trust boundary

Package-root Native lowering runs as trusted build code. Declare:

- `compiler.trust: 'build-dependency'` and matching product `lowering.trust`;
- builder ownership equal to the npm package owner;
- the exact supported manifest and builder protocol versions;
- static product metadata and package-contained manifest, builder, and sidecar;
- packed-package discovery and target conformance evidence.

The legacy `compiler.trust: 'first-party'` value remains accepted with the same
authority. Third-party packages need no monorepo awareness, allowlist, extra
pin, or equality with Pulse's release version. Graph compilation discovers the
package resolved by imports, including nested dependencies. Installed package
and contract identities remain part of compilation evidence.

Manifests and builders execute in the compiler's Node process with its
filesystem and environment access. This is trusted execution without sandboxing
or isolated failure containment. It is not a public third-party plugin API for
arbitrary compiler hooks; the documented package-lowerer contract is supported.

The provider-toolchain boundary is different. A project may name an exact scoped provider package
whose versioned `./toolchain` export Pulse loads directly.
That package also executes as trusted project build code. It does not
self-register, create a public lowerer, or enter handler source.

## 5. Prove each advertised target

For each claimed mode, test the layer that actually executes:

- package-root JavaScript behavior on Node and/or Fastly;
- positive and negative Native static shapes;
- direct await and `ctx.parallel` for request-bound package effects;
- package contract and manifest validation;
- provider capability and binding behavior;
- structured or opaque result ownership;
- cross-target semantic conformance;
- deterministic source and target packaging;
- isolated packed dependency discovery;
- explicit unsupported-form diagnostics.

Do not infer a support claim from a resolvable export or an SDK feature.

## Existing first-party patterns

Assets demonstrates a package-root JavaScript implementation, Native lookup
lowering, and opaque response adoption. GRIP demonstrates pure package-root
framing, request-bound broadcast, provider requirements, and bounded Native
lowering. Compatibility-only `/pulsewasm` imports remain isolated in the
[migration guide](../guides/compatibility-imports.md).

Continue with:

- [Package lowerer contract reference](./package-lowerer-contract.md);
- [Add a first-party package-owned lowerer](./adding-first-party-lowerer.md);
- [Add a provider toolchain](./adding-core-provider.md);
- [Package-owned lowering](../concepts/package-owned-lowering.md);
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md);
- [Provider and target compatibility](../reference/compatibility-matrix.md).
