# Fetch composition

<!-- pulse-example-template:v1 -->

Compares one structured origin, sequential composition, and explicit portable
concurrency in one project. Comments in the handler mark each form.

## Request and response

Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.

| Request | Expected response |
|---|---|
| single<br><code>GET /user</code> | <code>{"status":200,"json":{"found":true,"user":{"id":123,"name":"Ada"}}}</code> |
| sequential<br><code>GET /user-summary</code> | <code>{"status":200,"json":{"id":123,"name":"Ada","score":42,"enabled":true}}</code> |
| parallel<br><code>GET /user-summary-parallel</code> | <code>{"status":200,"json":{"id":123,"name":"Ada","score":42,"enabled":true}}</code> |

<!-- pulse-example-view:code -->
## Code

### Handler

<!-- pulse-doc-source: examples/03-fetch-composition/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

interface User {
  id: number
  name: string
}

interface Stats {
  score: number
}

interface Flags {
  enabled: boolean
}

const app = new Pulse({ auto: true })

// One structured origin.
app.get('/user', async (ctx) => {
  const user = await ctx
    .fetch('https://users.example.test/users/123')
    .json<User>()
  return ctx.json({ found: true, user })
})

// Multiple origins with explicit sequential awaits.
app.get('/user-summary', async (ctx) => {
  const user = await ctx
    .fetch('https://users.example.test/users/123')
    .json<User>()
  const stats = await ctx
    .fetch('https://stats.example.test/users/123')
    .json<Stats>()
  const flags = await ctx
    .fetch('https://flags.example.test/users/123')
    .json<Flags>()
  return ctx.json({
    id: user.id,
    name: user.name,
    score: stats.score,
    enabled: flags.enabled,
  })
})

// Multiple origins with explicit portable concurrency.
app.get('/user-summary-parallel', async (ctx) => {
  const { user, stats, flags } = await ctx.parallel({
    user: ctx.fetch('https://users.example.test/users/123').json<User>(),
    stats: ctx.fetch('https://stats.example.test/users/123').json<Stats>(),
    flags: ctx.fetch('https://flags.example.test/users/123').json<Flags>(),
  })
  return ctx.json({
    id: user.id,
    name: user.name,
    score: stats.score,
    enabled: flags.enabled,
  })
})

export default app
```
<!-- /pulse-doc-source -->

### Project config

<!-- pulse-doc-source: examples/03-fetch-composition/.pulse/config.ts -->
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
    dev: {
      fetches: {
        'https://users.example.test/users/123': {
          value: { id: 123, name: 'Ada' },
          delayMs: 15,
        },
        'https://stats.example.test/users/123': {
          value: { score: 42 },
          delayMs: 5,
        },
        'https://flags.example.test/users/123': {
          value: { enabled: true },
          delayMs: 1,
        },
      },
    },
  },
}))
```
<!-- /pulse-doc-source -->

## Inspect

The selected profile is `local`; this checked excerpt identifies its target, provider and recognized capabilities. Paths, hashes and additional inspection fields are omitted.

<!-- pulse-doc-run {"project":"examples/03-fetch-composition","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
```bash
npm run inspect -- --json
```
```json
{
  "status": "ok",
  "project": {
    "target": "native"
  },
  "provider": {
    "id": "node"
  },
  "compiler": {
    "capabilities": [
      "fetch",
      "response.json",
      "response.text"
    ]
  }
}
```

## Doctor

Check this project and its local toolchain before execution. This selected result is verified by the documentation gate; another machine may report different prerequisite checks.

<!-- pulse-doc-run {"project":"examples/03-fetch-composition","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
```bash
npm run doctor -- --json
```
```json
{
  "status": "passed",
  "summary": {
    "warnings": 0,
    "failed": 0
  }
}
```

## Report

Build once into a separate directory, then replay the retained artifact without running or rebuilding the application. This checked excerpt accounts for registered handlers in the build evidence; it is not runtime request coverage.

<!-- pulse-doc-run {"project":"examples/03-fetch-composition","args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"prepare":["build","--out",".pulse-docs-build","--json"],"display":"npm run build -- --out .pulse-docs-build\nnpm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
```bash
npm run build -- --out .pulse-docs-build
npm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json
```
```json
{
  "kind": "pulse.application-report",
  "reportVersion": 1,
  "analytics": {
    "coverage": {
      "handlers": {
        "expected": 3,
        "observed": 3,
        "reason": null,
        "status": "complete"
      }
    }
  }
}
```

Optional offline HTML uses the same retained evidence:

```bash
npm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --html
```

Review reports before sharing. Missing, stale or incompatible evidence is an error; timings, paths and hashes are not presented as stable output.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

## Dynamic endpoint lists

See [dynamic-probes](dynamic-probes/README.md) for a runtime-sized endpoint list,
a bounded effects collection, and explicit concurrent flush.

## Test result

<!-- pulse-doc-run {"project":"examples/03-fetch-composition","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "cases": [
    {
      "name": "single",
      "status": "passed",
      "response": {
        "status": 200
      }
    }
  ]
}
```

## Test harness

<!-- pulse-doc-source: examples/03-fetch-composition/tests/pulse.harness.ts -->
```ts
const fetches = {
  'https://users.example.test/users/123': {
    value: { id: 123, name: 'Ada' },
    delayMs: 15,
  },
  'https://stats.example.test/users/123': {
    value: { score: 42 },
    delayMs: 5,
  },
  'https://flags.example.test/users/123': {
    value: { enabled: true },
    delayMs: 1,
  },
}

const summary = {
  id: 123,
  name: 'Ada',
  score: 42,
  enabled: true,
}

export default {
  cases: [
    {
      name: 'single',
      request: { path: '/user' },
      fetches,
      expect: {
        status: 200,
        json: { found: true, user: { id: 123, name: 'Ada' } },
      },
    },
    {
      name: 'sequential',
      request: { path: '/user-summary' },
      fetches,
      expect: { status: 200, json: summary },
    },
    {
      name: 'parallel',
      request: { path: '/user-summary-parallel' },
      fetches,
      expect: { status: 200, json: summary },
    },
  ],
}
```
<!-- /pulse-doc-source -->

## Wasm size

For build settings, see [Native build optimization](../../docs/reference/native-build-optimization.md).

| Artifact | Default build |
|---|---:|
| Portable guest `canonical-native.wasm` | 4.5 KiB (4,572 bytes) |

The executable documentation gate rebuilds and measures the default artifact.
Measured with Node 24.18.0 and lockfile-pinned AssemblyScript 0.28.18. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.
