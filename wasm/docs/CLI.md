# Pulse CLI and project configuration

The public CLI reference is [`../../docs/reference/cli.md`](../../docs/reference/cli.md). This document records the implementation-level workflow used by workspace gates.

`pulse` is the supported boundary between an application and the canonical Pulse compiler/runtime. The command set is:

```text
init
doctor
inspect
test
dev
compile
build
```

## Project creation

```bash
pulse init ./my-app
cd ./my-app
npm install
pulse doctor
pulse test
pulse dev
```

`pulse init` creates `.pulse/config.ts`, `.pulse/.gitignore`, an async `src/index.ts` application, `tests/pulse.harness.ts`, package scripts, strict TypeScript configuration, and project documentation. It performs no package-manager or hidden network work.

## Discovery and selection

Every project command accepts one optional positional directory. Discovery starts there, or at the current directory when it is omitted, and searches upward without crossing the current Git worktree boundary:

```text
.pulse/config.ts
```

The active profile is selected in this order:

1. `--profile`
2. `PULSE_PROFILE`
3. `pulse.defaultProfile`

Entry, schema, harness, provider, and target identity belong to `.pulse/config.ts`. `--out`, `--host`, `--port`, and watch controls are invocation-local command controls.

```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/pulse/schemas/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    schemas: {
      contentTypePolicy: 'accept-json-or-missing',
      maxBytes: 65_536,
    },
    dev: {
      host: '127.0.0.1',
      port: 8787,
      watch: true,
      networkFetch: true,
      config: {},
      secrets: {},
      kv: {},
      fetches: {},
    },
  },
}))
```

Test cases live only in the dedicated module selected by `pulse.tests`.

## Provider realization

The provider set is fixed to `node`, `fastly`, and compile-only `none`. `pulse compile` always emits provider-neutral Pulse Wasm. `pulse build` realizes the provider selected by the active profile.

Fastly configuration belongs to the profile’s `fastly` fragment:

```ts
edge: {
  host: 'fastly',
  target: 'native',
  outDir: 'dist',
  fastly: {
    bindings: {
      configStore: 'app_config',
      secretStore: 'app_secrets',
      kv: { sessions: 'app_sessions' },
      backends: { 'https://api.example.com': 'api_backend' },
      dynamicBackends: false,
    },
    build: { name: 'my-pulse-app' },
    local: { networkFetch: false },
  },
}
```

Provider SDK objects remain outside canonical handler scope. External Fastly reality testing records and uses either the inspected Fastly CLI with its managed local engine or an explicitly selected direct Viceroy launcher. Remote deployment remains separately unvalidated.

## Schema compilation

Schema identity belongs to the default-exported registry selected by `pulse.schema`.

```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

interface CreateUser {
  name: string
}

export default defineSchemaRegistry({
  schemas: {
    'app.createUser': schema<CreateUser>(),
  },
})
```

`pulse inspect` reports the registry and references. `doctor` validates it. `test` and `dev` execute the generated codecs. `compile` and `build` emit the registry and cross-target codec table.

## Output and safety

- Completed commands emit one JSON object with `--json`.
- `pulse dev --json` emits newline-delimited events.
- Output directories must remain real descendants of the project root.
- Raw configured secret values are omitted or redacted from project JSON, manifests, diagnostics, and runtime errors.
- `dev` is a foreground process; it does not create a hidden daemon.
- Stable diagnostics own exit classes and exact-version documentation links.

`pulse inspect --artifact <file.json>` is the explicit path for reading an emitted JSON artifact without rebuilding the project.
