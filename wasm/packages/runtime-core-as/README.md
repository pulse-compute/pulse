# @pulse-compute/wasm-runtime-core-as

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse AssemblyScript runtime-core and compiler maintainers.<br>
> **Install directly:** No for application projects; it is installed transitively.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal code-generation interface synchronized with this release set.<br>
> **npm:** [`@pulse-compute/wasm-runtime-core-as`](https://www.npmjs.com/package/@pulse-compute/wasm-runtime-core-as)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

AssemblyScript runtime-core and code-generation implementation for the synchronized Pulse compiler.

Application projects do not import this package. Its exports support compiler/runtime maintainers building the compiled-Wasm core and related lifecycle artifacts.

## Responsibilities

- generate and validate the AssemblyScript runtime core;
- describe the supported AssemblyScript shape and smoke-compilation boundary;
- generate compiled handler modules for maintained internal subsets;
- plan request, response, effect, body, schema, and backend lifecycle bridges;
- keep generated ABI surfaces aligned with shared contracts and host-runtime expectations.

## Boundaries

This package does not own product CLI behavior, provider execution, package-specific lowering rules, or public canonical TypeScript APIs. It emits deterministic implementation artifacts consumed by compiler and provider lanes.

The package’s focused compiler subpaths are internal synchronized interfaces. New application behavior must first be represented in canonical contracts and public docs rather than exposed directly through this package.

See [Implementation packages](https://pulsecompute.io/v1.0.0-beta.4/packages/implementation-packages/) and [Architecture overview](https://pulsecompute.io/v1.0.0-beta.4/architecture/overview/).
