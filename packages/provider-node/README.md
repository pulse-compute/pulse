# @pulse-compute/provider-node

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse canonical Node provider and compiler maintainers.<br>
> **Install directly:** No for application projects; select provider: node through the CLI.<br>
> **Supported entry points:** `@pulse-compute/provider-node/toolchain`<br>
> **Stability:** The listed built-in toolchain entry is synchronized with the Beta bootstrap contract; other canonical Node provider interfaces remain internal.<br>
> **Canonical replacement:** `provider: 'node' through @pulse-compute/cli`<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.1/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.1` package policy.
<!-- pulse-package-status:end -->

Canonical Node provider implementation used internally when a project selects `provider: 'node'`.

Application projects do not install or import this package directly. The supported entry is provider selection through `@pulse-compute/cli`.

## Responsibilities

- declare the Node canonical provider descriptor and capability mappings;
- execute canonical programs through the Node local/runtime path;
- realize fetch, config, secret, KV, structured response, opaque pass-through, supported package effects, and invocation-scoped event ingress/acceptance;
- normalize provider failures into canonical runtime diagnostics;
- supply compiler/runtime proofs for maintained internal lifecycle surfaces.

## Boundaries

- Canonical handlers never receive Node request/response objects or ambient process authority.
- Package-specific payload rules remain in their owning package/contracts.
- Product command behavior remains in the CLI package.
- JavaScript execution remains an explicitly selected Node target and never an automatic fallback.
- Event ingress is a bounded FIFO reference adapter with one active invocation per instance; outbound acceptance is a separate exact-frame ledger with no loopback, delivery, retry, persistence, or process-global singleton.

## JavaScript application host boundary

The provider-maintainer JavaScript subpaths are:

```text
@pulse-compute/provider-node/javascript/target
@pulse-compute/provider-node/javascript/runtime-host
@pulse-compute/provider-node/javascript/node-adapter
@pulse-compute/provider-node/javascript/lifecycle
```

The graph-backed loader, Web request/response adapter, provider-owned `pulse dev`
lifecycle, capability adapters, schema codecs, Assets, and bounded GRIP behavior
are maintained under the target-support and cross-target conformance contracts.
No automatic fallback occurs, and application projects do not import these
implementation subpaths directly.

The Node JavaScript provider also realizes canonical `pulse.jwt` verification
through the package-owned `jose`/Web Crypto verifier. It owns named-secret
resolution and wall-clock capture; applications cannot select a crypto backend.

## Implementation exports

The package exposes focused compiler and runtime modules for the synchronized
repository, including `runtime/canonical-api-runtime`. Those exports are
implementation interfaces, not application-author APIs.

See [Contracts and providers](https://pulsecompute.io/v1.0.0-beta.1/concepts/contracts-and-providers/) and [Implementation packages](https://pulsecompute.io/v1.0.0-beta.1/packages/implementation-packages/).
