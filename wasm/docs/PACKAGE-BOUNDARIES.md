# PulseWasm package boundaries

## Canonical user API

`@pulse-compute/runtime` owns the provider-neutral TypeScript application contract. It contains plain handler/context types and the static `Router` marker; it does not contain provider SDKs, ambient host authority, Promises, stream iterators, binary mutation helpers, or a second live runtime implementation.

## CLI

`@pulse-compute/cli` owns the product workflow:

```text
config discovery
init
doctor
test
inspect
build
dev
provider selection
project schema orchestration
```

The `pulse` binary is exposed only by this package. It resolves a normal project and drives the compiler, runtime, and provider through public package exports. Lower-level `pulsewasm` wrappers remain repository tooling and are not promoted into the application-author surface.

The CLI may depend on the compiler and executable provider. The compiler must not import the CLI, expose the product `pulse` binary, or own project configuration/development behavior.

## Compiler and runtime

`@pulse-compute/wasm-compiler/canonical-project-compiler` orchestrates the complete project: it invokes package-owned schema JSON compilation, links exact schema references, then delegates handler lowering to `canonical-api-compiler`. `@pulse-compute/wasm-compiler/canonical-api-compiler` lowers supported TypeScript to explicit effect markers and continuation sites. It reuses the established route-effect lifecycle rather than exposing `ctx.resolve` or creating another scheduler.

`@pulse-compute/wasm-host-runtime/runtime/continuation-registry` owns continuation state and guards. `@pulse-compute/provider-node/runtime/canonical-api-runtime` executes generated programs through the Node route-effect implementation.

`@pulse-compute/wasm-schema-json` owns schema extraction, normalized registries, and generated codecs. The CLI drives it but does not duplicate its semantics. Stable low-level contracts stay under `@pulse-compute/wasm-contracts`. Historical confidence-pass modules are not public package subpaths.

## Providers

User scope remains provider-neutral. A provider realizes canonical request/response, fetch, config, secret, KV, logging, and opaque-body capabilities; it does not add `ctx.fastly`, `ctx.cloudflare`, or SDK objects to user code.

`@pulse-compute/provider-node` supplies the Node realization. The root-workspace `@pulse-compute/provider-fastly` package supplies typed project configuration, a canonical provider descriptor, contract-driven lowering, a local conformance runtime, and generated native Fastly Wasm with direct host imports. `pulse compile` and `pulse build` share the same provider-neutral native plan; selected providers realize its canonical operations without adding provider APIs to `ctx`. The explicit reality helper records and launches either the Fastly CLI with its managed local engine or an explicitly selected Viceroy binary directly. Neither tool is a runtime package dependency.

## Wasm-specific code

The long-term `wasm/` boundary contains target-specific compiler/runtime/ABI machinery. Product-facing API, CLI, and provider packages live in the root workspace after their interfaces are implementation-proven. Target-specific compiler/runtime/ABI machinery and private provider host support may remain under `wasm/`.
