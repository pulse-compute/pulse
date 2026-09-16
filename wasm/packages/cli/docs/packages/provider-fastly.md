# `@pulse-compute/provider-fastly`

`@pulse-compute/provider-fastly` supplies typed Fastly project configuration,
canonical capability lowering, direct JavaScript execution, local conformance
runtimes, Native and JavaScript Compute target generation, and an explicit
Fastly CLI boundary.

Install it only in projects that select the Fastly provider.

## Install

```bash
npm install @pulse-compute/provider-fastly@1.0.0-beta.4
```

## Configure a project

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

The provider maps logical origins and stores used by canonical handler calls to Fastly deployment resources. Local values and fixtures do not create or populate deployed resources.

## Configuration groups

The root `fastly()` helper supports:

- Config Store and Secret Store names;
- logical KV namespace to Fastly KV Store mappings;
- origin to backend-name mappings;
- explicit dynamic-backend policy;
- GRIP/Fanout hold and publish bindings;
- package name, description, and authors;
- local network-fetch policy.

See [Project configuration](../reference/project-config.md#fastly-provider-options) for field-level defaults, precedence, and constraints.

## Build outputs

The active `.pulse/config.ts` profile selects one target explicitly:

```bash
pulse build ./my-app
```

### Fastly Native

`target: 'native'` compiles the provider-neutral plan and emits generated
`src/main.as.ts` plus compact `bin/main.wasm` importing the required `fastly_*`
hostcalls directly. It contains no JavaScript runtime image or `pulse_host`.
Clock-dependent capabilities import only WASI `clock_time_get`.

Conditional KV (`getVersioned`, `insertIfAbsent`, `compareAndSwap`) uses this
Native path and the existing logical KV bindings. It preserves generation tokens
without numeric narrowing, stages a bounded Pulse JSON envelope, and distinguishes
confirmed rejection from unconfirmed dispatch. Pending completion and body reads
use readiness selection with a monotonic deadline. Read bodies are closed; expired
pending operations remain owned by invocation teardown, with no rollback promise.
Fastly JavaScript remains explicitly incomplete for these operations. See
[conditional KV](../concepts/effects-and-continuations.md#conditional-kv) for the
portable contract. The generated-Wasm corpus is local evidence; it does not replace
deployed cross-location acceptance. The legacy JavaScript fixture runner does
not realize Native conditional KV; it reports a configuration failure. Exercise
these operations through generated Wasm or the Compute execution lane.

The required conditional KV acceptance task is `kv-conditional-acceptance`.
It builds and installs exact tarballs and executes their Native artifact through
Fastly CLI/Viceroy; an unavailable engine fails the task. Viceroy 0.21.0 currently
fails the missing-key CAS contract: it creates the key instead of returning
`conflict`. A September 12, 2026 standalone Rust SDK probe on deployed Fastly
rejected CAS on both never-created and deleted keys, which remained absent.
This resolves the live missing-key concern for those cases and distinguishes it
from the Viceroy defect. The required local gate still fails, and full Pulse
deployed cross-location acceptance remains pending the isolated development
environment. The [K4 acceptance record](https://github.com/pulse-compute/pulse/blob/latest/wasm/test/kv/K4.md)
retains both captures and their scope. Neither that standalone probe nor passing
injected-host or portable tests clears the full acceptance gates.

The Native `ctx.req.headers` snapshot is a cached, immutable array of name/value
pairs. Names are lowercased; repeated values remain separate pairs in their
per-name order, including empty values. Enumeration is lazy and bounded to
256 pairs and 64 KiB of UTF-8 name/value bytes, counting a terminator for each
name and value. An incomplete, malformed or oversized host result fails the
request before later effects or a success response; it never returns a partial
snapshot. This is a provider read limit, not a configurable HTTP ingress limit.
`ctx.req.header(name)` retains its single-value lookup behavior.

### Fastly JavaScript

`target: 'javascript'` emits a deterministic, self-contained source closure:

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
application and package implementations, and contains no Pulse Native artifact.
The generated build first produces `dist/index.js`, then the pinned Fastly
JavaScript compiler produces `bin/main.wasm`. Candidate, source-package,
deployment, and top-level manifests agree on the selected `fastly-javascript`
target and retain `automaticFallback: false`.

The release gate builds the source closure twice, compares its bytes, and
successfully invokes the pinned downstream compiler. The resulting runtime Wasm
is bound to the candidate by SHA-256. Wizer-owned runtime snapshot bytes are not
claimed byte-reproducible; the Pulse-owned closure and deployment metadata are.

Provider selection is configuration-owned. Removed public `--provider` and
`--source-only` flags are rejected with stable diagnostics.

Use:

```bash
pulse doctor ./my-app --json
```

to inspect compiler and Fastly CLI readiness before a release build.

## Local conformance and external reality

For Fastly Native, `pulse test` and `pulse dev` use the provider’s local
canonical runtime. For Fastly JavaScript, they use explicit provider emulation
and the same provider-owned bundled application closure. Both paths use
configured values, fixtures, and optional network fetch; neither silently runs
through the Node provider.

The native provider module is checked by the explicit reality profile through an inspected local Compute launcher. `PULSE_FASTLY_BIN` selects CLI-owned `fastly compute serve --file`; `PULSE_VICEROY_BIN` selects direct `viceroy serve` when no explicit Fastly CLI launcher is selected. Both are documented in [Environment variables](../reference/environment.md#pulse-fastly-bin).

The Fastly reality gate proves Native local host-ABI compatibility through real
HTTP requests covering schemas, configuration, secrets, KV persistence,
named-backend fetch, opaque bytes, repeated headers, and GRIP hold/publish. The
JavaScript candidate gate proves downstream runtime compilation but does not
invoke `fastly compute serve`. Neither gate claims that remote resources or a
deployed Fastly service are healthy; remote deployment remains separately
unvalidated.

Fastly JavaScript is generally available under the full-target-support policy:
all declared runtime, capability, packaging, four-mode, tooling, and offline
candidate gates are satisfied. General availability is a supported-target
statement, not evidence that a particular candidate was deployed.

## Public entry points

| Entry point | Purpose |
|---|---|
| `@pulse-compute/provider-fastly` | Typed `fastly()` project configuration. |
| `@pulse-compute/provider-fastly/contract` | Canonical descriptor and lowering-plan integration. |
| `@pulse-compute/provider-fastly/runtime/canonical-api-runtime` | Local canonical runtime used by project execution. |
| `@pulse-compute/provider-fastly/build/canonical-target` | Fastly source/target writer. |
| `@pulse-compute/provider-fastly/testing/fastly-cli` | Explicit Fastly CLI discovery and serve boundary. |

Other exported compiler/runtime subpaths are compatibility or implementation surfaces and do not gain the same application-facing promise.

## Handler isolation

Application source continues to import only `@pulse-compute/runtime` and supported package facades. The provider plan records:

```json
{
  "providerSpecificUserland": false,
  "providerSdkUserland": false,
  "capabilityDiscoveryFromUserland": false
}
```

Do not import Fastly SDK objects into canonical handlers. Bindings belong in project configuration.

## Current limitations

- The official `fastly` shorthand resolves this package's explicit
  `./toolchain` export. That narrow bootstrap is not automatic plugin
  discovery, self-registration, or a lowerer extension API.
- Local fixtures do not provision Fastly resources.
- Offline candidate validation does not deploy, activate, or publish a Fastly service.
- Dynamic backends are disabled unless explicitly enabled.
- GRIP requires the documented Fanout/publish bindings for the operations used.
- Full userland stream processing and provider SDK escape hatches remain
  outside the Beta.

## Related documentation

- [Fastly deployment candidates](../guides/deploying-fastly.md)
- [Fastly config, secrets, and KV](../guides/fastly-capabilities.md)
- [GRIP and Fanout](../guides/grip.md)
- [Contracts and providers](../concepts/contracts-and-providers.md)
- [Add a core provider](../contributing/adding-core-provider.md)
- [Fastly diagnostics](../reference/diagnostics.md#toolchain-diagnostics)
