# Fetch composition

Compares one structured origin, sequential composition, and explicit portable
concurrency in one project. Comments in the handler mark each form.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

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

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 4.9 KiB (5,039 bytes) | 4.2 KiB (4,349 bytes) | 13.7% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

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

## Project config

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
