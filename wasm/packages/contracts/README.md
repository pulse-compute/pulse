# `@pulse-compute/wasm-contracts`

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse compiler, runtime, provider, and package-lowering maintainers.<br>
> **Install directly:** Provider toolchain authors may install it for the versioned bootstrap contract; application projects receive it transitively.<br>
> **Supported entry points:** `@pulse-compute/wasm-contracts/provider/toolchain`<br>
> **Stability:** The provider toolchain contract is versioned and supported for the Beta; other protocol and proof interfaces remain internal.<br>
> **npm:** [`@pulse-compute/wasm-contracts`](https://www.npmjs.com/package/@pulse-compute/wasm-contracts)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.3/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.3` package policy.
<!-- pulse-package-status:end -->

This package owns stable data contracts shared by the compiler, runtime, and providers.

Public contract categories include:

- route/path/dispatch/execution contracts;
- handler effect and context contracts;
- host ABI, headers, JSON body, and streaming contracts;
- package-owned lowerer contracts;
- schema JSON contracts;
- provider-neutral config, provider, and KV contracts;
- the canonical app runtime facade;
- project capability and Native optimization identity contracts.

Canonical Beta imports:

```js
const runtimeApi = require('@pulse-compute/wasm-contracts/handler/runtime-api')
const canonicalProvider = require('@pulse-compute/wasm-contracts/provider/canonical-provider')
```

Fastly primitive realization is owned by `@pulse-compute/provider-fastly`.
Historical confidence-pass modules are private implementation sources. They are not package exports and must not be used as application or provider API.
