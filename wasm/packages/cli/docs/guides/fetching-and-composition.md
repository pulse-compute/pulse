# Fetching and composing data

A handler describes outbound work with `ctx.fetch`, awaits the result, and
returns a response. Use sequential awaits when work depends on an earlier
result; group independent work explicitly when it can run together.

| Work to do | Form |
|---|---|
| Read one result or chain dependent requests | `await ctx.fetch(url).json<T>(schemaId)` |
| Join a fixed set of named requests | `await ctx.parallel({ name: effect, ... })` |
| Join a bounded runtime list | `ctx.effects({ max })`, inline `add`, then `await ctx.parallel(collection)` |
| Forward an opaque response | Return `ctx.fetch(url)` directly |

Use literal schema IDs at [structured JSON boundaries](./json-schemas.md).
Type arguments help authoring; they do not replace schema validation. These are
managed Pulse effects, not arbitrary Promises or a separate effect-handler registry.

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

## Collect a bounded runtime list

When input supplies the number of requests, create one execution-owned
collection, add one inline effect per item, then flush it once. The runnable
[dynamic probe example](../../examples/03-fetch-composition/dynamic-probes/README.md)
binds its input, fetched result and response to declared schemas:

<!-- pulse-doc-source: examples/03-fetch-composition/dynamic-probes/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

import type { ProbeInput, ProbeResult } from './schemas.js'
const app = new Pulse({ auto: true })
app.use(async (ctx, next) => {
  ctx.state.set('probe-admitted', 'yes')
  return next()
})
app.post('/probe', async ctx => {
  const input = await ctx.req.json<ProbeInput>('probe.Input')
  const effects = ctx.effects<ProbeResult>({ max: 32 })
  for (const endpoint of input.endpoints) {
    effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
  }
  const results = await ctx.parallel(effects)
  return ctx.json({ results }, { schema: 'probe.Output' })
})
app.error(async (error, ctx, next) => ctx.text('invalid probe data', { status: 422 }))
export default app
```
<!-- /pulse-doc-source -->

`max` must be a literal integer from 1 through 32. `add` captures work without
dispatching it; `await ctx.parallel(effects)` seals and dispatches the group.
Results keep insertion order. Empty input returns `[]`; overflow fails before
dispatch, without truncation. Capacity does not replace schema, response-byte,
request or cumulative-effect limits.

Keep the portable region to one local `const` collection, one direct `for...of`
with one inline `add` of the same effect template, and an immediately following
awaited flush assigned to a `const`. Do not filter, await, nest loops, mutate,
call helpers or let the collection escape inside that region. Reusing a member,
flushing twice, adding after flush or leaving a nonempty collection unflushed
fails. The [full collection contract](../concepts/effects-and-continuations.md#bounded-dynamic-collections)
owns grammar, cancellation and failure ordering.

Provider limits still apply. Runtime URLs on Fastly Native require its existing
explicit single-backend binding; collections do not grant arbitrary origin
access or multi-backend selection. See the example's four explicit profiles.

## Handle failures and deadlines

HTTP status is response data; a 404 or 500 does not itself reject the fetch.
Network, timeout and decode failures have their own contracts. A failed group
settles before continuation and delivers no partial result array. The example's
`app.error` handler handles admitted failures; it is not a catch-all for terminal
faults. See [Router recovery](./routing.md#next-is-a-terminal-transfer).

A per-fetch `timeoutMs` starts at provider admission/dispatch, including at a
collection flush. Its end boundary depends on the existing transport path:
ordinary Fastly Native and JavaScript fetches stop at headers; Node Native live
structured fetches also include body acquisition. The request's `maxDurationMs` also covers collection construction
and remains terminal. Cancellation does not promise remote wire cancellation,
retry or rollback of completed effects. Read the [deadline and ownership rules](../concepts/effects-and-continuations.md#timeouts-have-two-scopes)
for provider-specific behavior.

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
