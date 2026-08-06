# Migrate an Express service

Pulse uses a familiar application, route, middleware, and error-handler shape,
but it is not an Express-compatible runtime or a drop-in replacement. Express
owns a live JavaScript server and mutable request/response objects. Pulse owns a
static application description whose managed handlers compile to the selected
JavaScript or Native target.

Start from the similarity, then make each boundary explicit.

## Map the mental model

| Express concept | Pulse equivalent | Important difference |
|---|---|---|
| `express()` | `new Pulse({ auto: true })` | The default export is compiled; it is not a live dispatcher. |
| `req.method`, `req.url`, `req.path` | `ctx.req.method`, `ctx.req.url`, `ctx.req.path` | Request metadata is read-only. |
| `req.get('name')` | `ctx.req.header('name')` | Headers are normalized by the Pulse request contract. |
| `req.params.id` | `ctx.param('id')` | Parameters exist only inside a matching static route. |
| `res.locals` | `ctx.state.get()` / `ctx.state.set()` | State is request-local string storage, not an arbitrary object. |
| `res.status(201).json(value)` | `return ctx.json(value, { status: 201 })` | Response builders return the terminal result; they do not mutate `res`. |
| `res.status(204).end()` | `return ctx.response({ status: 204 })` | Every reachable handler branch returns a Pulse result or transfers control. |
| `next()` | `return next()` | The transfer is terminal; the current handler never resumes. |
| `next(error)` | `return next(error)` | Error transfer is explicit; authored `throw` is not Router control flow. |
| Four-argument error middleware | `app.error(async (error, ctx, next) => …)` | Pulse error handlers use the canonical context and terminal transfer. |
| Body-parser middleware | `await ctx.req.text()` or `await ctx.req.json('schema.id')` | Reads are explicit, bounded, and optionally schema-bound. |
| `app.listen()` | `pulse dev` / `pulse build` plus a provider | The CLI and selected provider own execution and deployment lifecycle. |

## Translate one route

This Express example is illustrative; Express is not a Pulse dependency:

```ts
import express from 'express'

const app = express()
app.use(express.json())
app.post('/users/:id', async (req, res, next) => {
  try {
    const user = await saveUser(req.params.id, req.body)
    res.status(201).json(user)
  } catch (error) {
    next(error)
  }
})
app.listen(3000)
```

The Pulse shape moves host work onto `ctx`, makes body decoding explicit, and
returns the response:

```ts
import { Pulse } from '@pulse-compute/pulse'
import type { CreateUserInput, User } from './schemas.js'

const app = new Pulse({ auto: true })

app.post('/users/:id', async (ctx, next) => {
  const id = ctx.param('id')
  if (!id) return next('missing-user-id')

  const input = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const user = await ctx.fetch('https://users.example.test/users/' + id, {
    method: 'POST',
    json: input,
    schema: 'app.CreateUserInput',
  }).json<User>('app.User')

  return ctx.json(user, 'user.created')
})

app.error(async (error, ctx, next) => {
  if (error === 'missing-user-id') {
    return ctx.json({
      code: 'missing-user-id',
      message: 'The route did not produce a user ID.',
    }, {
      status: 400,
      schema: 'app.ApiError',
    })
  }
  return next(error)
})

export default app
```

The snippet assumes the named schemas and `user.created` response case are
declared in the project schema registry. See
[Explicit JSON schemas](./json-schemas.md).

## Rewrite middleware as terminal control flow

Express middleware can perform work after `await next()` in frameworks with an
onion model, or depend on the eventual mutable response. Pulse middleware is a
flat, compiler-owned cursor:

```ts
app.use('/api', async (ctx, next) => {
  const token = ctx.req.header('authorization')
  if (!token) return ctx.json({ error: 'unauthorized' }, { status: 401 })

  ctx.state.set('principal', token)
  return next()
})
```

`return next()` permanently finishes this middleware. Do not assign its result,
await it, or place cleanup and response mutation after it. Request state remains
visible to later middleware, routes, error recovery, and resumed Pulse effects,
but it is isolated between requests.

Use `return next(error)` for a deliberate error-lane transfer. An unhandled
normal lane ends as `404 Not Found`; an unhandled error lane ends as
`500 Internal Server Error`.

## Reduce routing to the static topology

The Beta Router supports:

- `use`, `get`, `head`, `post`, `mount`, and `error`;
- exact paths, named `:parameters`, and a trailing `*` wildcard;
- statically declared, acyclic mounted routers;
- first-match order and explicit route fallthrough.

It does not support `put`, `patch`, `delete`, regular-expression routes,
runtime route registration, Express Router plugins, or hidden server lifecycle
hooks. Keep an unsupported endpoint on its existing service or redesign it
before moving that endpoint into Pulse; selecting a JavaScript target does not
widen the Pulse Router API.

## Replace ambient server capabilities

Express code often reaches capabilities through Node globals, process state,
SDK clients, or objects attached by middleware. Managed Pulse handlers use
request-owned operations instead:

| Existing dependency | Pulse boundary |
|---|---|
| Ambient `fetch` or HTTP client | `ctx.fetch()` |
| `process.env` | `ctx.config.get()` or `ctx.secret.get()` |
| Request-scoped SDK/client attachment | Explicit `ctx` effect or a supported package-root operation |
| Logging package bound to the process | `ctx.log` |
| Body-parser buffer or stream | Bounded `ctx.req.text()` / `ctx.req.json()` |
| Streaming proxy response | Direct opaque response pass-through |

Provider SDK objects, sockets, filesystem access, timers, background work, and
userland body streams are outside the managed handler contract.

## Decide what code can move unchanged

Pure TypeScript or JavaScript expressions can move unchanged when they stay
within the [managed handler language](../reference/handler-authoring.md).
Imported project helpers also have to use compiler-supported static call shapes
to remain Native-eligible. An ordinary library may work on an explicitly
selected JavaScript target when that provider runtime supports the package.

Express middleware packages cannot be mounted directly: they expect Express
`req`, `res`, `next`, server lifecycle, or ambient Node behavior. Rewrite the
needed policy against `ctx`, and verify its source form in the
[compatibility matrix](../reference/compatibility-matrix.md). A JavaScript-only
library or arbitrary library `await` makes the project ineligible for Native;
Pulse never changes targets or falls back automatically.

## Migrate in bounded slices

1. Inventory routes, methods, middleware order, error paths, body parsing, and
   ambient host dependencies.
2. Move one supported `GET`, `HEAD`, or `POST` route to a statically declared
   `Pulse` application.
3. Replace response mutation with returned `ctx.json`, `ctx.text`, or
   `ctx.response` results.
4. Replace body-parser assumptions with bounded text or schema-bound JSON reads.
5. Rewrite middleware around terminal `return next()` and explicit
   `return next(error)`.
6. Move network, config, secret, KV, logging, and supported package work onto
   explicit `ctx` operations.
7. Run `pulse doctor`, `pulse test`, and `pulse inspect` for the configured
   provider/target before `pulse build`.

Choose the target deliberately. JavaScript is useful for compatible ordinary
packages; Native requires the bounded TypeScript/JavaScript subset. Neither
lane is an Express runtime.

## Continue with

- [Static Router authoring](./routing.md)
- [Explicit JSON schemas](./json-schemas.md)
- [Structured and opaque bodies](../concepts/bodies.md)
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Project lifecycle](./project-lifecycle.md)
- [Troubleshooting](./troubleshooting.md)
