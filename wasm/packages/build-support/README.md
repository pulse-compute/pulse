# @pulse-compute/wasm-build-support

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse release-set and compiler maintainers.<br>
> **Install directly:** No for application projects; it is installed transitively where required.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal release-set interface; exported modules may change with compiler implementation needs.<br>
> **npm:** [`@pulse-compute/wasm-build-support`](https://www.npmjs.com/package/@pulse-compute/wasm-build-support)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

Shared build-time helpers for PulseWasm package-owned builders.

This package is intentionally build/tooling scoped. It owns utilities that future package-owned compiler surfaces need without importing `@pulse-compute/wasm-compiler` internals.

## Exposed modules

- `artifactsDir` → canonical `wasm/artifacts` directory resolution helpers.
- `assemblyscriptCompile` → AssemblyScript compiler resolution and compile-smoke helper.
- `files` → shared slash normalization, SHA-256, truncation, ANSI stripping, and file-record helpers.

## Boundary rules

- May depend on `@pulse-compute/wasm-contracts` for diagnostics/artifact normalization.
- Must not depend on `@pulse-compute/wasm-compiler`.
- Must not own the `assemblyscript` dependency; AS is resolved from the caller workspace/package.
