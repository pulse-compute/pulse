# Fastly deployment candidates

Pulse produces separate Fastly Native and Fastly JavaScript Compute candidates.
Local conformance, target building, external provider reality, remote
deployment, and service activation are different proof levels.

This guide does not claim that a local simulation or offline build is a
production deployment.

## Choose the supporting guide

| Configure or implement | Guide |
|---|---|
| Config Store, Secret Store, KV and backend bindings | [Fastly config, secrets, and KV](./fastly-capabilities.md) |
| Gateway-held connections and outbound broadcast | [GRIP and Fanout](./grip.md) |
| Exact supported provider options | [Fastly provider reference](../packages/provider-fastly.md) |

These guides keep their detailed contracts and examples. Start here to connect
that application behavior to local validation, candidate builds and deployment.

## Configure bindings and target

The config/secret example is source-bound to a Fastly Native profile:

<!-- pulse-doc-source: examples/05-fastly-capabilities/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'fastly',
    target: 'native',
    outDir: 'dist',
    apiBase: scope.config('API_BASE'),
    apiToken: scope.secret('API_TOKEN'),
    dev: {
      config: { API_BASE: 'https://api.example.com' },
      secrets: {
        API_TOKEN: 'local-example-secret',
        GRIP_TOKEN: 'local-grip-secret',
      },
      kv: {
        sessions: { 'session:123': { userId: 123 } },
      },
      fetches: {
        'https://api.example.com/users/7': {
          value: { id: 7, name: 'Ada' },
        },
        'POST https://publisher.example.com/publish': {
          status: 202,
          value: { accepted: true, messageId: 'message-1' },
        },
      },
    },
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: { sessions: 'app_sessions' },
        backends: {
          'https://api.example.com': 'api_backend',
          'https://publisher.example.com': 'publisher_backend',
        },
        dynamicBackends: false,
        grip: {
          publishEndpoint: 'https://publisher.example.com/publish',
          publishBackend: 'publisher_backend',
          authentication: {
            scheme: 'bearer',
            secretRef: 'GRIP_TOKEN',
          },
        },
      },
      build: { name: 'pulse-fastly-capabilities-example' },
    },
  },
}))
```
<!-- /pulse-doc-source -->

Select the JavaScript candidate explicitly with `target: 'javascript'`.

The `dev` values and fixtures are local conformance inputs. They do not create
or populate Fastly Config Stores, Secret Stores, KV Stores, backends, Fanout
resources, or services. Deployment resource names belong under
`fastly.bindings`.

## Validate locally

```bash
pulse doctor
pulse test
pulse dev
```

For both Fastly targets, `test` and `dev` use provider-owned local execution.
Fastly JavaScript identifies this as provider emulation. Fastly Native uses the
canonical local runtime. Neither path contacts or proves a deployed service.

## Build Fastly Native

```bash
pulse build
```

With `target: 'native'`, Pulse compiles the provider-neutral plan and emits
generated `src/main.as.ts` plus compact direct-host-ABI:

```text
bin/main.wasm
```

The Wasm imports the required `fastly_*` hostcalls directly. It does not contain
the Fastly JavaScript runtime, `pulse_host`, or a WASI dependency. The build
manifest records exact provider bindings, required capabilities, target
identity, compiler identity, and artifact hashes.

## Build Fastly JavaScript

With `target: 'javascript'`, `pulse build` emits a deterministic source and
deployment closure:

```text
src/index.js
src/application.js
fastly.toml
package.json
pulse-esbuild.config.js
pulse-fastly-javascript-candidate.json
pulse-fastly-javascript-deployment.json
pulse-fastly-javascript-source-package.json
```

The closure pins `esbuild` and `@fastly/js-compute`, bundles the reachable Pulse
application and supported package implementations, and contains no Pulse
Native artifact. Its downstream build produces `bin/main.wasm`; the candidate
and deployment manifests bind that runtime artifact by SHA-256 and retain
`automaticFallback: false`.

Pulse claims deterministic bytes for its source closure and deployment
metadata. It does not claim byte-identical Wizer-owned runtime snapshots.

## Provider reality is a separate gate

The external Native reality lane discovers the Fastly CLI and invokes:

```text
fastly compute serve --file <candidate>/bin/main.wasm
```

and sends real HTTP requests through the generated module. It covers schemas,
config, secrets, KV persistence, named-backend fetch, opaque bytes, repeated
headers, and GRIP hold/publish.

The Fastly JavaScript offline candidate lane runs the exact pinned downstream
compiler and validates the resulting runtime Wasm. It does not currently claim
the same `fastly compute serve` reality execution.

The Sprint 7 final candidate must pass its mandatory external reality gate in
the later packed/provider-reality checkpoint. Checkpoint 5 documents the
boundary; it does not mark that external gate complete.

## Stateful validation

Pulse's exact Fastly Native fixture executor resets KV from supplied fixtures
for each invocation. Conditional KV selects this path in `pulse test`/`pulse dev`.
See [fixture state lifetime](./project-lifecycle.md#fastly-native-fixture-kv-lifetime).
Use the existing Fastly CLI/Viceroy workflow above with the built candidate and
explicit local KV bindings when testing persistence across requests. Compilation
alone does not require these external tools.

1. Select a dedicated test namespace and key, and record candidate Wasm digest,
   selected bindings and exact engine versions. Seed a distinguishable initial
   value (for example `seed-A`). Keep credentials and private values out of reports.
2. Send a write request with a new value `write-B`. In a separate read request,
   require that exact value. A write/read within a single request proves less.
3. Read its generation, then submit two CAS requests using that same generation
   with distinct proposed values `winner-C` and `winner-D`. Require exactly one
   `stored` and one `conflict`, and a later read matching the successful proposal.
   Use a barrier before dispatch if testing overlap; identical proposed values
   cannot reveal a lost update. Also require stale-generation and missing-key
   CAS to conflict without changing or creating state.
4. Record each raw result and cleanup the dedicated test state. Treat timeouts,
   unknown outcomes, duplicate winners and unexpected persistence as nonpassing
   evidence to investigate; keep assertions intact.

Viceroy results establish local engine behavior only. Known Viceroy conditional
KV discrepancies have their own recorded release dispositions; a local run or
an accepted discrepancy does not establish deployed Pulse CAS semantics. Repeat
required schedules against an authorized deployed candidate and resource binding,
including relevant placement/concurrency coverage, for deployed-service evidence.
See the [conditional KV contract](../concepts/effects-and-continuations.md#conditional-kv)
for result semantics. This recipe neither deploys nor activates a service.

## Remote deployment and activation

`pulse build` never runs `fastly compute deploy`. After candidate review, a
human deployment owner must:

1. create or select the Fastly service and required resources;
2. ensure every configured binding names the intended resource;
3. supply account, service, and token authority outside the handler;
4. run the provider deployment command against the reviewed candidate;
5. verify the deployed service and external origins;
6. decide activation, traffic migration, and rollback.

Remote deployment and activation require explicit human authorization. A
successful local conformance run, offline build, downstream JavaScript compile,
or Native reality serve does not authorize those actions.

## Proof-level checklist

| Proof level | What it establishes | What it does not establish |
|---|---|---|
| `pulse test` / `pulse dev` | Canonical behavior and configured local mapping | Remote resources or deployed service health |
| `pulse build` | Deterministic provider candidate and metadata | External provider execution or deployment |
| Native reality gate | Real Fastly CLI-managed host-ABI execution | Remote service deployment or activation |
| JavaScript offline candidate gate | Exact downstream runtime compilation | Fastly serve, remote deployment, or activation |
| Human remote verification | Deployed service/resource behavior | Permission to publish or promote other release surfaces |

See [Project lifecycle](./project-lifecycle.md), [Fastly config, secrets, and
KV](./fastly-capabilities.md), [`@pulse-compute/provider-fastly`](../packages/provider-fastly.md),
[Managed handler TypeScript and JavaScript](../reference/handler-authoring.md),
[Provider and target compatibility](../reference/compatibility-matrix.md),
and [Release acceptance](../maintainers/release-acceptance.md).
