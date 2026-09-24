# Router lowering

Uses the static `Router` authoring surface to define terminal middleware, route
fallthrough, error handling, mounts, parameters, wildcards, and method-specific
routes. Pulse lowers the flat Router execution graph into the same canonical
native plan used by single-handler applications.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse compile
pulse build
```

The inspect result exposes Router execution entries and route/middleware
ownership for effects and continuations. `return next()` terminates the current
handler and advances dispatch; it never resumes.

<!-- pulse-doc-run {"project":"examples/09-router-lowering","args":["inspect","--json"]} -->
```bash
pulse inspect --json
```
```json
{
  "status": "ok",
  "provider": {
    "id": "node"
  },
  "compiler": {
    "authoring": {
      "kind": "router"
    },
    "routing": {
      "version": "pulse.router-authoring.v2",
      "routes": [
        {
          "method": "GET",
          "path": "/api/health"
        }
      ]
    },
    "effectCount": 1,
    "continuationCount": 1
  }
}
```

The documented test result below is also executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/09-router-lowering","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 9,
    "passed": 9,
    "failed": 0
  },
  "cases": [
    {
      "name": "mounted-health",
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
| `canonical-native.wasm` | 9.5 KiB (9,762 bytes) | 9.1 KiB (9,355 bytes) | 4.2% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.
The artifact includes checks that transfer application data failures to the
next error handler.

## Router application

<!-- pulse-doc-source: examples/09-router-lowering/src/index.ts -->
```ts
import { Router } from '@pulse-compute/runtime'

interface User {
  id: number
  name: string
}

const users = new Router()
const api = new Router()
const app = new Router()

app.use(async (ctx, next) => {
  if (ctx.req.header('x-pulse-deny') === '1') {
    return ctx.json(
      { error: 'denied by middleware' },
      { status: 401 },
    )
  }
  return next()
})

api.use(async (ctx, next) => {
  if (ctx.req.header('x-api-state') === 'closed') {
    return ctx.text('api closed', { status: 503 })
  }
  return next()
})

users.get('/:id', async (ctx) => {
  const id = ctx.param('id')
  const user = await ctx
    .fetch('https://users.example.test/users/' + id)
    .json<User>()
  return ctx.json({ route: 'user', id, user })
})

api.get('/health', async (ctx, next) => {
  if (ctx.req.header('x-health-handler') === 'fallback') {
    return next()
  }
  return ctx.json({ ok: true, handler: 'primary' })
})
api.get('/health', async (ctx) => ctx.json({ ok: true, handler: 'fallback' }))
api.head('/health', async (ctx) => ctx.text('', {
  status: 204,
  headers: [['x-pulse-route', 'health']],
}))
api.post('/users', async (ctx) => ctx.json(
  { route: 'create', method: ctx.req.method },
  { status: 201 },
))
api.get('/files/*', async (ctx) => ctx.text(ctx.req.path))
api.get('/failure', async (ctx, next) => next('documented-failure'))

api.mount('/users', users)
app.mount('/api', api)

app.error(async (error, ctx, next) => {
  if (error === 'documented-failure') {
    return ctx.json({ error: 'handled' }, { status: 418 })
  }
  return next(error)
})

export default app
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/09-router-lowering/.pulse/config.ts -->
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
        'https://users.example.test/users/7': {
          value: { id: 7, name: 'Ada' },
        },
      },
    },
  },
}))
```
<!-- /pulse-doc-source -->


## Test harness

<!-- pulse-doc-source: examples/09-router-lowering/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'mounted-health',
      request: { method: 'GET', path: '/api/health' },
      expect: {
        status: 200,
        json: { ok: true, handler: 'primary' },
      },
    },
    {
      name: 'middleware-short-circuit',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-pulse-deny': '1' },
      },
      expect: {
        status: 401,
        json: { error: 'denied by middleware' },
      },
    },
    {
      name: 'scoped-middleware-short-circuit',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-api-state': 'closed' },
      },
      expect: { status: 503, text: 'api closed' },
    },
    {
      name: 'route-fallthrough',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'x-health-handler': 'fallback' },
      },
      expect: {
        status: 200,
        json: { ok: true, handler: 'fallback' },
      },
    },
    {
      name: 'error-middleware',
      request: { method: 'GET', path: '/api/failure' },
      expect: { status: 418, json: { error: 'handled' } },
    },
    {
      name: 'parameter-and-fetch',
      request: { method: 'GET', path: '/api/users/7' },
      fetches: {
        'https://users.example.test/users/7': {
          value: { id: 7, name: 'Ada' },
        },
      },
      expect: {
        status: 200,
        json: {
          route: 'user',
          id: '7',
          user: { id: 7, name: 'Ada' },
        },
      },
    },
    {
      name: 'method-specific-post',
      request: { method: 'POST', path: '/api/users' },
      expect: {
        status: 201,
        json: { route: 'create', method: 'POST' },
      },
    },
    {
      name: 'trailing-wildcard',
      request: {
        method: 'GET',
        path: '/api/files/guides/start',
      },
      expect: {
        status: 200,
        text: '/api/files/guides/start',
      },
    },
    {
      name: 'default-not-found',
      request: { method: 'GET', path: '/missing' },
      expect: { status: 404, text: 'Not Found' },
    },
  ],
}
```
<!-- /pulse-doc-source -->
