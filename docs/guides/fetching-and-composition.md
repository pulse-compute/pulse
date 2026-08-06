# Fetching and composing data

`ctx.fetch` is the primary host effect for data workflows.

## One project, three composition forms

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

The comments separate one structured origin, explicit sequential composition,
and `ctx.parallel`. Separate awaits retain sequential JavaScript semantics. The
explicit keyed group is the portable concurrency contract across JavaScript and
Native targets. Results retain their source keys even when hosts resolve the
operations in another order.

HTTP 404 and 500 remain ordinary response data. DNS, connection, timeout, and
host failures fail the effect.

## Dependent requests

A request whose URL or options depend on a previous result lowers to a later continuation point. The compiler does not pretend that dependent effects are an independent group.

## Pass-through

<!-- pulse-doc-source: examples/07-opaque-proxy/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/archive', async (ctx) => {
  return ctx.fetch('https://assets.example.com/archive.bin')
})

export default app
```
<!-- /pulse-doc-source -->

The direct response path preserves status, headers, repeated headers, and the host-owned body. User code cannot inspect or transform the opaque body.
