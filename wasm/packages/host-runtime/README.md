# @pulse-compute/wasm-host-runtime

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse host-runtime and provider maintainers.<br>
> **Install directly:** No for application projects; it is installed transitively.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal compiler/runtime interface synchronized with this release set.<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.1/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.1` package policy.
<!-- pulse-package-status:end -->

Package-owned PulseWasm host-runtime build-time builders and local runtime helpers.

## Runtime surface

The package root re-exports the package-owned compiler and runtime surfaces:

- `compiler` / `@pulse-compute/wasm-host-runtime/compiler`
- `runtime` / `@pulse-compute/wasm-host-runtime/runtime`

## Compiler/build-time surface

Host-runtime builders now live in this package instead of `@pulse-compute/wasm-compiler` internals:

- `wasmHostAbi`
- `wasmHostBridge`
- `requestResultHeaders`
- `channelBroadcaster`
- `jsonBody`
- `backendCapabilities`
- `hostRuntimeKernel`
- `streamingPassthrough`
- `compiledWasmRuntime`

The compiler orchestrator imports these builders from `@pulse-compute/wasm-host-runtime/compiler`.

## Runtime helpers

Local runtime helpers are exposed under `@pulse-compute/wasm-host-runtime/runtime`:

- `compiledWasmHostRuntimeKv`
- `kvProvider`

## Dependencies

This package depends on contracts and build-support. It must not depend on `@pulse-compute/wasm-compiler`.
