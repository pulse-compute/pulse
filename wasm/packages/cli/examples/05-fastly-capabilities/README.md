# Fastly capabilities

Combines provider-neutral config, secrets, KV, a named backend, and a
request-bound GRIP broadcast in one Fastly project. The handler imports GRIP
from its supported package root; the compatibility-only `/pulsewasm` facade is
not part of this example.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/05-fastly-capabilities","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "fastly",
  "summary": {
    "total": 4,
    "passed": 4,
    "failed": 0
  },
  "cases": [
    {
      "name": "configured-fetch",
      "status": "passed",
      "response": {
        "status": 200
      }
    }
  ]
}
```

Fastly builds produce a verified `.pulse-docs-build/bin/main.wasm`. Configured
tests execute through the local-conformance runtime; compiled-target execution
remains in the explicit reality profile.

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 5.3 KiB (5,454 bytes) | 4.8 KiB (4,888 bytes) | 10.4% |
| `bin/main.wasm` | 41.8 KiB (42,806 bytes) | 34.6 KiB (35,420 bytes) | 17.3% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.1`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

<!-- pulse-doc-source: examples/05-fastly-capabilities/src/index.ts -->
```ts
import { grip } from '@pulse-compute/grip'
import { Pulse } from '@pulse-compute/pulse'

interface User {
  id: number
  name: string
}

interface Session {
  userId: number
}

const app = new Pulse({ auto: true })

// Config, secret, and a named Fastly backend.
app.get('/users/7', async (ctx) => {
  const base = await ctx.config.get('API_BASE')
  const token = await ctx.secret.get('API_TOKEN')
  const user = await ctx
    .fetch('https://api.example.com/users/7', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-api-base': base,
      },
    })
    .json<User>()
  return ctx.json({ user })
})

// Named Fastly KV storage.
app.get('/session', async (ctx) => {
  const current = await ctx.kv<Session>('sessions').get('session:123')
  if (current === undefined) {
    return ctx.json({ error: 'not_found' }, { status: 404 })
  }
  await ctx.kv<Session>('sessions').put('session:last', current)
  return ctx.json({ session: current })
})

// Request-bound GRIP broadcast through the supported package root.
app.post('/publish', async (ctx) => {
  const acknowledgement = await grip.broadcast(ctx, {
    channel: 'events:demo',
    event: 'pulse.message',
    id: 'message-1',
    data: { message: 'hello from Pulse' },
  })
  return ctx.json(
    { accepted: acknowledgement.accepted },
    { status: 202 },
  )
})

export default app
```
<!-- /pulse-doc-source -->

## Project config

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

## Test harness

<!-- pulse-doc-source: examples/05-fastly-capabilities/tests/pulse.harness.ts -->
```ts
const config = { API_BASE: 'https://api.example.com' }
const secrets = {
  API_TOKEN: 'test-example-secret',
  GRIP_TOKEN: 'test-grip-secret',
}
const grip = {
  publishEndpoint: 'https://publisher.example.com/publish',
  authentication: {
    scheme: 'bearer',
    secretRef: 'GRIP_TOKEN',
  },
}

export default {
  cases: [
    {
      name: 'configured-fetch',
      request: { path: '/users/7' },
      config,
      secrets,
      fetches: {
        'https://api.example.com/users/7': {
          value: { id: 7, name: 'Ada' },
        },
      },
      expect: {
        status: 200,
        json: { user: { id: 7, name: 'Ada' } },
      },
    },
    {
      name: 'session-hit',
      request: { path: '/session' },
      kv: { sessions: { 'session:123': { userId: 123 } } },
      expect: {
        status: 200,
        json: { session: { userId: 123 } },
      },
    },
    {
      name: 'session-miss',
      request: { path: '/session' },
      kv: { sessions: {} },
      expect: {
        status: 404,
        json: { error: 'not_found' },
      },
    },
    {
      name: 'grip-broadcast',
      request: { method: 'POST', path: '/publish' },
      secrets,
      grip,
      fetches: {
        'POST https://publisher.example.com/publish': {
          status: 202,
          value: { accepted: true, messageId: 'message-1' },
        },
      },
      expect: {
        status: 202,
        json: { accepted: true },
      },
    },
  ],
}
```
<!-- /pulse-doc-source -->
