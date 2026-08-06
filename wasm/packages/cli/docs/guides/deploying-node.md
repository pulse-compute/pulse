# Node build and execution

Pulse exposes Node Native and Node JavaScript as explicit targets over the same
provider-neutral application contract. This guide ends at a validated Node
candidate. The Beta does not install a process manager, create
infrastructure, or publish a managed Node service.

## Configure the Node provider

The hello example is a source-bound Node Native project:

<!-- pulse-doc-source: examples/01-hello-json/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
  },
}))
```
<!-- /pulse-doc-source -->

Select JavaScript deliberately by changing only the target:

```ts
local: {
  host: 'node',
  target: 'javascript',
  outDir: 'dist',
}
```

Target choice belongs to the profile. Pulse does not retry a failed Native
selection as JavaScript.

## Validate the application

Use the normal lifecycle:

```bash
pulse doctor
pulse test
pulse dev
pulse build
```

`test` and `dev` execute through the selected Node target's provider-owned local
lifecycle. They prove the configured application and local inputs; they do not
create a production process or remote service.

## Node Native candidate

With `target: 'native'`, `pulse build` emits:

```text
canonical-program.json
canonical-handler.cjs
canonical-native-plan.json
canonical-native.wasm
pulse-build.json
```

The Wasm imports the provider-neutral `pulse_host` contract. The build manifest
records the Node Native target, compiler identity, imports/exports,
optimization profile, provider requirements, and artifact hashes.

Use `pulse test` or `pulse dev` for the maintained Node host execution path.
The built Wasm and manifest are host-integration inputs; the Beta
does not promise a standalone production Native launcher.

## Node JavaScript candidate

With `target: 'javascript'`, `pulse build` emits a deterministic CommonJS
package containing:

```text
index.cjs
package.json
application/
pulse-build.json
pulse-javascript-application-plan.json
pulse-javascript-source-package.json
schema-json-registry.json       # when schemas are active
schema-json-codecs.cjs          # when schemas are active
```

The package contains the reachable application graph and exact reachable Pulse
dependencies. It contains no Pulse Native Wasm, AssemblyScript source, Native
plan, or automatic fallback.

`index.cjs` exports the packaged Pulse application. The maintained local
execution path is `pulse dev`; embedding the package in a production HTTP
server requires a separately owned Node host integration. The current
implementation adapter remains an internal provider surface rather than an
application compatibility promise.

## Inspect the candidate

```bash
pulse inspect --artifact ./dist/pulse-build.json --json
```

Check:

- `configuredTarget` and `providerTarget.target`;
- `automaticFallback: false` for JavaScript;
- Native import/export and optimization identity, or JavaScript source-package
  identity;
- schema registry and codec identity when active;
- the project entry and output root;
- target-support and project-eligibility evidence.

## Deployment-owner boundary

After Pulse produces and validates the candidate, the deployment owner remains
responsible for:

- selecting the Node process/container host;
- installing the candidate's exact dependencies;
- wiring HTTP, signals, health checks, credentials, and resource bindings;
- enforcing operating-system and network policy;
- retaining build and deployment provenance;
- deciding activation and rollback.

Those decisions do not grant application handlers ambient `process.env`,
filesystem, socket, or provider-object authority. Handler access remains
through `ctx` and configured bindings.

See [Project lifecycle](./project-lifecycle.md), [Managed handler TypeScript and
JavaScript](../reference/handler-authoring.md), [Provider and target
compatibility](../reference/compatibility-matrix.md), [Contracts and
providers](../concepts/contracts-and-providers.md), and [Release
acceptance](../maintainers/release-acceptance.md).
