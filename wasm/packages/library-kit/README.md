# @pulse-compute/wasm-library-kit

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse package-lowering and compiler maintainers.<br>
> **Install directly:** No for application projects; it is installed transitively.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal package-lowering interface synchronized with this release set.<br>
> **npm:** [`@pulse-compute/wasm-library-kit`](https://www.npmjs.com/package/@pulse-compute/wasm-library-kit)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.2/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.2` package policy.
<!-- pulse-package-status:end -->

PulseWasm package-owned library contract, sidecar, and host capability builders.

## Current split status

This package now owns the library-kit builder surface that was previously exposed through compiler codegen wrappers. The compiler still orchestrates extraction, but it imports these library builders from this package.

## Exposed modules

- `@pulse-compute/wasm-library-kit` — compatibility root exposing the package-owned builder groups
- `@pulse-compute/wasm-library-kit/compiler` — build-time compiler integration helpers
- `@pulse-compute/wasm-library-kit/compiler/handler-library-contracts`
- `@pulse-compute/wasm-library-kit/compiler/library-sidecars`
- `@pulse-compute/wasm-library-kit/compiler/host-capabilities`

The compiler subpath exposes:

- `handlerLibraryContracts`
- `librarySidecars`
- `hostCapabilities`
- `buildHandlerLibraryContracts`
- `buildLibrarySidecarConsumption`
- `buildHostCapabilities`

## Notes

- Owns declared-library sidecar consumption and ctx-extension validation builder behavior.
- Owns the host capability artifact builder because it aggregates library capability requirements.
- Consumes stable contract surfaces from `@pulse-compute/wasm-contracts`.
- Consumes shared build helpers from `@pulse-compute/wasm-build-support`.
- Does not depend on `@pulse-compute/wasm-compiler`.
- Examples under compiler/examples/libraries remain canonical fixtures for now.
