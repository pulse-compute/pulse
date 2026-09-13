# Fastly provider maintainer instructions

The Fastly package owns its descriptor, configuration, local runtime, host
bindings, generated AssemblyScript, and native Wasm realization.

- Do not silently fall back to Node when Fastly compilation or local execution is unavailable.
- Keep secrets and configured binding values out of diagnostics and generated public artifacts.
- Treat new hostcalls, bindings, provider fields, or deployment behavior as protected provider/configuration work.
- Keep selection configuration-owned; native builds emit source and verified `bin/main.wasm` together.
- Separate injected-host fixtures, local Fastly CLI/Viceroy execution, standalone deployed probes and deployed Pulse acceptance. Record tool/artifact identities and the exact claim each proves; `providerReality: true` alone is not a passing result.
- For conditional KV, the Fastly JavaScript SDK is incomplete capability mapping, never the semantic canon or a gate for other targets. Preserve the Pulse contract when docs, wire observations or engines disagree; report the discrepancy with its scope and evidence. Do not add retries, non-atomic prechecks or weaker assertions to conceal it.
- Consult `wasm/test/kv/K4.md` and `docs/maintainers/release-acceptance.md` before claiming conditional KV acceptance. The recorded Viceroy failure and standalone live success are distinct; existing local and deployed Pulse requirements remain in force until an explicit acceptance-policy decision changes them.

## Pulse entry points

Paths are repository-root-relative. The root Entry Point rules remain in force.

### provider-fastly

**Use for**

Fastly descriptors, configuration, JavaScript/Native realization, local
tooling, and provider-owned lifecycle behavior.

**Contracts**

- `packages/provider-fastly/src/provider-contract.js`
- `packages/provider-fastly/src/config-schema.json`
- `wasm/packages/contracts/src/provider/canonical-provider.js`
- `wasm/packages/contracts/src/provider/toolchain.js`
- `wasm/packages/contracts/src/project/target-support-evidence.js`
- `release/pulse-release-manifest.json`

**Write**

- `packages/provider-fastly/src/**`
- `packages/provider-fastly/tsconfig.json`
- `wasm/test/provider/assert-fastly-*.cjs`
- `wasm/test/fixtures/projects/fastly-compute-reality/**`
- `wasm/test/fixtures/projects/fastly-javascript-source/**`

**Read**

- `packages/provider-node/src/**`
- `wasm/packages/compiler/src/provider-toolchain.js`
- `wasm/packages/compiler/src/project-target-support.js`
- `wasm/packages/cli/src/provider-drivers.js`

**Evidence**

- `node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-package --task provider-fastly-apps --task fastly-javascript-runtime --no-report`
- `node wasm/scripts/run-wasm-tests.cjs --task fastly-native-http-shell --task fastly-native-http-effects --task fastly-native-platform-capabilities --no-report` for Native realization
- `node wasm/scripts/run-wasm-tests.cjs --task fastly-cli-gate-surface --task fastly-javascript-tooling --no-report` for CLI/tooling integration
- `node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-compute-reality --no-report` only when either the Fastly CLI or an explicitly selected Viceroy binary can run the local Compute lifecycle

**Supplements**

- `docs/packages/provider-fastly.md`
- `docs/guides/fastly-capabilities.md`

**Exclude**

- `packages/provider-node/**` mutation
- compiler-core ownership or public authoring syntax changes
- package metadata, release identity, publication, deployment, or activation
