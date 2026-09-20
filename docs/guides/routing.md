# Static Router authoring

Use `Router` when an application has several method/path entry points or needs compile-time middleware. It is a static authoring marker from `@pulse-compute/runtime`, not a JavaScript runtime dispatcher. The shared async/static restrictions are defined in [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md); target claims live in the [compatibility matrix](../reference/compatibility-matrix.md).

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

## Supported v2 surface

- `new Router()` with a default-exported root router;
- `use(handler)` and `use(path, handler)` middleware;
- `get`, `head`, `post`, `put`, `patch`, and `delete` registrations;
- exact paths, named `:parameters`, and a trailing `*` wildcard;
- static acyclic `mount` composition;
- named or inline async-shaped route handlers using `(ctx)` or `(ctx, next)`;
- async-shaped middleware using `(ctx, next)`;
- async-shaped error middleware using `(error, ctx, next)`;
- `ctx.param('name')` for a parameter declared by the matched route;
- first-match order, explicit route fallthrough, and compiler-owned 404/500 exhaustion.

Every Router handler uses the normal canonical context. Fetches, schemas, config, secrets, KV, opaque responses, and trusted package effects lower into the same native execution plan as single-handler authoring.

`Pulse` inherits the same route registration methods. Each registration matches
its exact HTTP method; a method mismatch advances the route cursor and normal
exhaustion remains `404`. There is no automatic `OPTIONS` or `405` response.
Ingress route methods do not widen the separate outbound `ctx.fetch` contract.

The `catalog-router-parity` conformance task exercises the original Catalog
consumer probe and all 14 of its PUT/PATCH/DELETE operations with their existing
methods and paths. Its shared cases check mounted parameters, request text,
middleware state, exact method misses, registration order, terminal fallthrough,
404 exhaustion and handled errors on Node/Fastly JavaScript and Native. Native
lanes execute compiled Wasm; Fastly evidence uses local provider emulation and
the target ABI mock host, not a deployed service. The fixtures establish routing
acceptance only; they do not implement Catalog persistence or authorization.

```sh
node wasm/scripts/run-wasm-tests.cjs --task catalog-router-parity --no-report
```

## `next()` is a terminal transfer

`next()` is not an onion-style callback. It is a compiler-visible control transfer:

```ts
app.use(async (ctx, next) => {
  if (!authorized(ctx)) return ctx.text('unauthorized', { status: 401 })
  return next()
})
```

After `return next()`, the current handler is finished permanently. The Router cursor advances to the next applicable middleware or route. The handler never resumes and `next()` has no downstream response value.

These forms are rejected:

```ts
next()
return ctx.text('too late')
```

```ts
const response = next()
return response
```

Use `return next(error)` to enter the error lane:

```ts
app.get('/account', async (ctx, next) => {
  if (!ctx.req.header('x-account')) return next('missing-account')
  return ctx.text('ok')
})

app.error(async (error, ctx, next) => {
  if (error === 'missing-account') return ctx.text('account required', { status: 400 })
  return next(error)
})
```

If the normal lane is exhausted, Pulse returns `404 Not Found`. If the error lane is exhausted, Pulse returns `500 Internal Server Error`.

Request UTF-8 failures, schema data failures and JWT validation failures enter the next registered
error handler. Branch on `error.code`; the portable contract does not require
identical messages, stacks, causes or detail fields across providers.

| Boundary | Portable error codes |
| --- | --- |
| Request text encoding | `PULSE_REQUEST_BODY_INVALID_UTF8` (Node Native, Node JavaScript, Fastly Native) |
| Schema data | `PULSE_SCHEMA_DECODE`, `PULSE_SCHEMA_ENCODE`, `PULSE_SCHEMA_JSON_MALFORMED`, `PULSE_SCHEMA_CONTENT_TYPE`, `PULSE_BODY_TOO_LARGE` |
| JWT input and verification | `PULSE_JWT_TOKEN_REQUIRED`, `PULSE_JWT_BEARER_INVALID`, `PULSE_JWT_MALFORMED`, `PULSE_JWT_LIMIT_EXCEEDED`, `PULSE_JWT_ALGORITHM_NOT_ALLOWED`, `PULSE_JWT_KEY_INVALID`, `PULSE_JWT_SIGNATURE_INVALID` |
| JWT claims | `PULSE_JWT_CLOCK_INVALID`, `PULSE_JWT_CLAIMS_INVALID`, `PULSE_JWT_CLAIMS_SCHEMA_INVALID` |

These admitted `error.code` values remain stable through redaction, including
when a secret, KV key or array index overlaps their spelling. Messages, stacks,
causes, details and arbitrary provider error codes remain subject to redaction.
This preserves the existing recovery catalog; it does not admit new failures.

Recovery moves forward in registration order, including through mounted
routers. A failed handler never resumes. An error handler can return a response,
forward with `return next(error)`, or clear the error lane with `return next()`.
A data failure inside an error handler transfers to a later error handler.

Already-started members of a failed effect group settle before application
recovery. Pulse does not retry them, undo completed writes, or imply that a
failed invocation had no external effects. Conditional KV results such as
`conflict`, `not-stored` and `unknown` remain ordinary outcomes for the handler to
inspect. Their meaning does not change when an error handler is registered.

Cancellation ends the invocation without an application response. On Native,
traps, provider protocol failures and unavailable capabilities remain terminal; they
do not acquire recovery or rollback guarantees. Native authoring still does not
admit arbitrary `throw` or `try`/`catch`. JavaScript retains its existing
`PulseUnhandledError` containment for unexpected handler failures.

## Middleware scope and effects

A path-scoped `use('/api', handler)` applies only to that subtree. Middleware declared on a mounted child Router is naturally limited to the mounted subtree.

Middleware may request normal canonical effects before transferring control:

```ts
app.use(async (ctx, next) => {
  const access = await ctx.fetch('https://auth.example.test/check').json<{ allowed: boolean }>()
  if (!access.allowed) return ctx.text('denied', { status: 403 })
  return next()
})
```

Pulse owns suspension and resumption for the effect. `pulse inspect` attributes the effect and continuation to the middleware entry and then resumes the same flat Router execution graph.


Use `ctx.parallel({ ... })` inside any managed route or middleware when named
operations must begin together on both JavaScript and Native targets. Its fixed
object-literal property order owns effect identity and result reconstruction, and
the group settles completely before Router execution continues. Separate awaits
retain ordinary sequential JavaScript behavior; Native may additionally group
adjacent eligible effects as an optimization.


## Deliberately outside v2

Canonical Router v2 does not support onion-style post-`next()` work, assigning or awaiting `next()`, user-authored `throw` as Router transfer, post-response hooks, realtime lifecycle registrations, channels, timeout scopes, `ctx.resolve`, or `ctx.resolved`.

Observability and explicit post-response work should use dedicated future contracts such as trace or defer effects rather than hidden middleware unwinding.

## Inspect the lowering

```bash
pulse inspect examples/09-router-lowering --json
```

Look at:

```text
compiler.authoring.kind
compiler.routing.entries
compiler.routing.semantics
compiler.effects[*].routerEntryStableId
compiler.continuations[*].routerEntryStableId
compiler.native.planHash
```

The same project can then be compiled or built normally:

```bash
pulse compile examples/09-router-lowering
pulse build examples/09-router-lowering
```
