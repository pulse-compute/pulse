# @pulse-compute/provider-fastly

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications targeting Fastly Compute and Pulse provider maintainers.<br>
> **Install directly:** Yes, for Fastly projects. Node-only projects do not need to import it directly.<br>
> **Supported entry points:** `@pulse-compute/provider-fastly`, `@pulse-compute/provider-fastly/contract`, `@pulse-compute/provider-fastly/toolchain`, `@pulse-compute/provider-fastly/config-schema`, `@pulse-compute/provider-fastly/runtime/canonical-api-runtime`, `@pulse-compute/provider-fastly/build/canonical-target`, `@pulse-compute/provider-fastly/testing/fastly-cli`<br>
> **Stability:** The listed entry points are supported for the Beta; all other exported subpaths are implementation-only.<br>
> **npm:** [`@pulse-compute/provider-fastly`](https://www.npmjs.com/package/@pulse-compute/provider-fastly)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/provider-fastly/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

Fastly provider configuration, canonical capability lowering, local conformance execution, Compute target generation, and explicit external-tool boundaries.

<!-- pulse-doc-source: examples/05-fastly-capabilities/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'local', strict: true },
  local: {
    host: 'fastly', target: 'native', outDir: 'dist', apiBase: scope.config('API_BASE'), apiToken: scope.secret('API_TOKEN'),
    dev: { config: { API_BASE: 'https://api.example.com' }, secrets: { API_TOKEN: 'local-example-secret' }, fetches: { 'https://api.example.com/users/7': { value: { id: 7, name: 'Ada' } } } },
    fastly: { bindings: { configStore: 'app_config', secretStore: 'app_secrets', backends: { 'https://api.example.com': 'api_backend' }, dynamicBackends: false }, build: { name: 'pulse-config-secret-example' } },
  },
}))
```
<!-- /pulse-doc-source -->

Bindings map canonical logical resources to Fastly deployment resources. Handler source remains provider-neutral and does not receive Fastly SDK objects.

A normal `pulse build` compiles the provider-neutral plan and emits generated Fastly-targeted AssemblyScript plus compact direct-host-ABI `bin/main.wasm`. Provider selection comes from the active `.pulse/config.ts` profile; public provider overrides and the former source-only JavaScript packaging mode are not supported. Local `test` and `dev` use the provider-owned conformance runtime. External target checks record and use either `fastly compute serve --file` or an explicitly selected direct `viceroy serve` launcher. The package installs neither tool and keeps this test-only orchestration outside application runtime dependencies.

## Supported entries

- package root — typed `fastly()` configuration;
- `contract` — canonical provider descriptor and plan integration;
- `runtime/canonical-api-runtime` — local canonical execution;
- `build/canonical-target` — target writer;
- `testing/fastly-cli` — Fastly CLI discovery and serve boundary.

Other exported subpaths are implementation or compatibility surfaces.

JWT verification is not currently an eligible Fastly JavaScript capability.
The provider fails `pulse.jwt` effects with `PULSE_JWT_TARGET_UNSUPPORTED`
until the pinned Compute runtime proves the required Web Crypto algorithms and
trusted wall-clock authority. It does not fall back to Node execution.

## Documentation

- [Fastly package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/provider-fastly/)
- [Project configuration](https://pulsecompute.io/v1.0.0-beta.5/reference/project-config/#fastly-provider-options)
- [Fastly capabilities guide](https://pulsecompute.io/v1.0.0-beta.5/guides/fastly-capabilities/)
- [Environment variables](https://pulsecompute.io/v1.0.0-beta.5/reference/environment/#pulse-fastly-bin)
