# Node build and execution

Pulse exposes Node Native and Node JavaScript as explicit targets over the same
provider-neutral application contract. The public `@pulse-compute/provider-node/server`
integration launches a trusted build in a production HTTP process. The Beta does not install a process manager, create
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

The production launcher loads the build manifest, verifies the plan, Wasm and
package artifact hashes, and validates the Native ABI before readiness. Each
request executes the built Wasm; it never loads `canonical-handler.cjs` or
falls back to JavaScript.

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

`index.cjs` exports the packaged Pulse application. The production launcher
loads it and its schema codecs through the Node provider. Build inputs and
JavaScript dependencies are trusted executable code; this is not a sandbox.

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

## Production launcher (NODE-01)

Install the exact matching `@pulse-compute/provider-node` version alongside the
build and its dependencies. Launch using only the public integration export:

```js
// server.cjs — host integration, outside the Pulse application graph
const { createNodeLauncher } = require('@pulse-compute/provider-node/server');
const launcher = createNodeLauncher({
  target: 'native', // or 'javascript', matching pulse build
  buildDir: require('node:path').resolve(__dirname, 'dist'),
  host: '0.0.0.0', port: 8080,
  maxDurationMs: 10000, shutdownTimeoutMs: 10000,
  config: { environment: 'production' },
  secrets: { apiToken: process.env.APP_API_TOKEN || '' },
  networkFetch: true,
});
async function main() {
  await launcher.start();
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, async () => {
      const result = await launcher.close();
      if (result.forced) process.exitCode = 1;
    });
  }
}
main().catch(() => { console.error('Node launcher startup failed'); process.exitCode = 1; });
```

`node server.cjs` is the production entry. It does not compile, watch source,
load `.pulse/config.ts`, or copy `dev` credentials. Pass production bindings and
budgets explicitly. Unknown options and invalid bounds fail before listening.
There are no hidden environment defaults, installed signal handlers, or calls
to `process.exit` in the launcher.

| Option | Default | Bounds / meaning |
| --- | --- | --- |
| `target`, `buildDir` | Required | Exact `native` or `javascript` build directory |
| `host`, `port` | `127.0.0.1`, `8787` | Explicit bind address; port 0–65535 (0 is ephemeral) |
| `readinessPath` | `/_pulse/ready` | Reserved GET/HEAD path, outside application routing |
| `maxDurationMs` | 10000 | 1–30000 ms across body admission, effects, continuations and response completion |
| `shutdownTimeoutMs` | 10000 | 1–30000 ms drain deadline |
| `headersTimeoutMs`, `keepAliveTimeoutMs` | 10000, 5000 | 1–30000 ms, Node HTTP admission / idle connection timers |
| `maxRequestBodyBytes`, `maxFetchBodyBytes` | 65536 each | 1–2097152 bytes, structured ingress / structured fetch |
| `maxEffects` | 128 | 1–65536 request-owned effects |
| `maxConcurrentRequests`, `maxConnections` | 128, 512 | 1–65536 per process; overload receives 503 or connection rejection |
| `networkFetch` | false | Explicit outbound HTTP effect authorization |
| `strict` | true | Strict structured JSON policy; profile values are not loaded |
| `config`, `secrets` | Empty | Host-owned string records; never derived from request headers |
| `kv` | Empty | Process-local reference KV seed; reset on restart, not durable storage |

`createNodeLauncher` validates and snapshots the trusted build. `start()` resolves
only after listening; `status()` reports lifecycle, address, build identity and
active request count without credentials. The readiness endpoint returns 200
only while ready, and bypasses the application concurrency limit. Bind failure
rejects startup without claiming readiness. Readiness proves local initialization,
not availability of downstream services.

`close()` immediately withdraws readiness and stops new connections. It drains
admitted requests, then aborts remaining request authority and destroys sockets
at the shutdown deadline. Its result distinguishes graceful from forced close.
Repeated start/close calls are idempotent in their respective states; start while
draining rejects. After close resolves, `start()` opens a fresh host generation
for the same build and resets reference KV. This is not hot reload: use a new
process for a new build, credentials or application module state. A process
supervisor owns crash restart, activation and rollback.

Budgets and drain revoke Pulse-owned asynchronous work; they cannot preempt
synchronous JavaScript/Wasm, stop arbitrary JavaScript dependency side effects,
or prove rollback of an already dispatched write. Use process-level resource
limits and a supervisor kill deadline as well. The launcher sends generic HTTP
errors and never returns exception messages or secrets to the client.

NODE-01 qualifies finite HTTP applications. Generated output, incoming body
forwarding/transforms, S3 body bindings, and blob-specific production qualification
remain separate launcher extensions. Unsupported launcher options fail closed.
The HTTP host preserves existing opaque responses without implicit text decoding.
No event transport, TLS termination, automatic environment loading, hot reload,
or durable KV backend is added by this launcher.

## Deployment-owner boundary

After Pulse produces and validates the candidate, the deployment owner remains
responsible for:

- selecting the Node process/container host;
- installing the candidate's exact dependencies;
- wiring signals, readiness probes, TLS/proxy ingress, credentials, and resource bindings;
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
