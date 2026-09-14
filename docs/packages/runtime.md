# `@pulse-compute/runtime`

`@pulse-compute/runtime` is the canonical, provider-neutral TypeScript authoring surface for Pulse applications. Install it in every canonical project and import handler types or the static `Router` marker from the package root.

## Install

```bash
npm install @pulse-compute/runtime@1.0.0-beta.4
```

A project created by `pulse init` depends on the public
`@pulse-compute/pulse` conventional application package, which re-exports these
runtime types for convenience. Public package availability remains
release-manifest-owned.

Conventional `.pulse` projects require async-shaped managed handlers and report `PULSE_HANDLER_ASYNC_REQUIRED` for synchronous forms. The compiler erases the wrapper and lowers trusted awaited Pulse effects through the Promise-free effect/continuation machinery.

## Minimal handler

<!-- pulse-doc-source: examples/01-hello-json/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.json({ ok: true }))
app.get('/hello', async (ctx) => ctx.json({ message: 'hello from Pulse' }))
app.get('/*', async (ctx) => ctx.text('not found', { status: 404 }))

export default app
```
<!-- /pulse-doc-source -->

The source-bound example is the conventional authoring shape. Managed handlers are async-shaped, while `ctx` remains the handler's only authority.

## Public contract

The package exports:

- `PulseRequest` for method, URL, path, headers, bounded text, and bounded JSON reads;
- `PulseFetchInit` and `PulseFetchResponse` for canonical outbound fetches;
- structured and opaque response types;
- `PulseExecutionContext`, shared by HTTP and event handlers, with state, logging,
  fetch, config, secret, KV, keyed parallel, and one-way event emission;
- `PulseContext` with the shared authority plus HTTP request and response construction;
- `PulseEvent`, `PulseEventContext`, and `PulseEventHandler` for exact type,
  immutable schema payload, non-HTTP authority, and void completion;
- `PulseResult`, `Handler`, `PulseRouteContext`, `RouteHandler`, `RouterMiddleware`, `RouterErrorHandler`, and `RouterNext`;
- `Router`, the compile-time marker for static route topology;
- `RUNTIME_API_VERSION`, currently `pulse.runtime-authoring.v4`, and `ROUTER_API_VERSION`, currently `pulse.router-authoring.v2`.

The complete type-by-type reference is in [Canonical API](../../API.md).


## Static Router applications

```ts
import { Router } from '@pulse-compute/runtime'

const app = new Router()
app.use(async (ctx, next) => {
  if (!ctx.req.header('authorization')) return ctx.text('Unauthorized', { status: 401 })
  return next()
})
app.get('/health', async (ctx) => ctx.json({ ok: true }))
app.get('/users/:id', async (ctx) => ctx.json({ id: ctx.param('id') }))
export default app
```

The compiler extracts and flattens static routes, middleware, mounts, and error entries before normal canonical lowering. `return next()` and `return next(error)` are terminal control transfers; the current handler never resumes. The marker does not dispatch through a JavaScript runtime. See [Static Router authoring](../guides/routing.md).

## Request access

```ts
const method = ctx.req.method
const path = ctx.req.path
const requestId = ctx.req.header('x-request-id')
const text = await ctx.req.text()
const input = await ctx.req.json<{ name: string }>('app.CreateUserInput')
```

Schema-backed JSON reads use an exact ID declared by the selected `.pulse/config.ts` profile:

```ts
const input = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
```

See [Explicit JSON schemas](../guides/json-schemas.md).


## Async and execution state

Native targets treat `async` and trusted `await` as authoring notation. The compiler erases the async wrapper, lowers awaited Pulse effects into the existing continuation state machine, warns when `await` wraps a proven synchronous `ctx` value, and rejects arbitrary library awaits for native selection. No Promise runtime or Asyncify transform is linked.

The exact accepted source shapes, `ctx.parallel` record restrictions, and
JavaScript-only forms live in [Managed handler TypeScript and
JavaScript](../reference/handler-authoring.md). The tested four-mode claims live
in the [compatibility matrix](../reference/compatibility-matrix.md).

`ctx.state` is a synchronous execution-local string map:

```ts
ctx.state.set('request-id', 'r1')
const requestId = ctx.state.get('request-id') // string | undefined
```

For HTTP, state is visible across forward middleware, mounted Routers, error
recovery, and effect continuation resume. Event handlers use the same state
surface across continuation resume. State is isolated between HTTP requests and
between event invocations.

With project `pulse.strict: true` (the default), schema-less request JSON is rejected. Explicit `pulse.strict: false` enables the byte-bounded `host-generic-json` capability for reachable schema-less calls; the native plan and manifest report that dynamic-host choice. Schema-bound JSON remains specialized in either mode.

## Event context and Native ingress

Static event handlers receive `PulseEventContext<Payload>`:

```ts
app.on('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const reading = ctx.event.payload
  const mode = await ctx.config.get('MODE')
  ctx.state.set('last-mode', mode)
  void reading
})
```

`ctx.event.type` is the exact registered event type. The payload is validated
against the registration schema and detached before entry; a `schema: null`
registration receives `null`. Event contexts expose shared execution authority
but no request, route, response, middleware, or Router-transfer surface, and
handlers complete with `void`.

Eligible event handlers lower to the provider-neutral Native plan and execute
through the conditional `pulse.native-event-abi.v1` entry. Event-only and mixed
artifacts are supported; HTTP-only Native bytes remain unchanged. Node wraps
this entry with an invocation-scoped bounded FIFO reference adapter for direct
JavaScript/Native parity. That adapter is provider-maintainer infrastructure,
not a public listener, deployment transport, or process-global bus.

## Outbound events

HTTP and event handlers can create a one-way, schema-bound effect:

```ts
await ctx.emit('device.led.set', {
  schema: 'events.DeviceLedSet',
  payload: { enabled: true },
})

await ctx.emit('system.tick', { schema: null })
```

The call must be awaited directly or through an awaited `ctx.parallel` group.
Event type and schema IDs must be literal at compilation; non-null schemas must
resolve in the project registry and require a payload, while `schema: null`
forbids one. JavaScript and Native execution validate and detach the same frame
before host acceptance and return `undefined`. Native suspends and resumes
through the ordinary effect/continuation protocol. The Node reference adapter
records exact accepted frames independently from its FIFO ingress queue, so it
never performs automatic loopback. It does not deliver a receipt, persistence,
retry, or public provider transport.

`ctx.emit` is not a call operation. The runtime exposes no request/reply
correlation, automatic local dispatch, `ctx.call`, or reserved call capability.
See [Static events and outbound emission](../guides/events.md) for the frame,
queue, target, and Native-extension details.

## Logging

`ctx.log` exposes four synchronous string methods:

```ts
ctx.log.error('failed to publish event')
ctx.log.warn('retrying origin request')
ctx.log.info('user created')
ctx.log.debug('decoded request body')
```

The active profile’s flat `reporting` setting resolves `off`, `error`, `warn`,
`info`, or `debug`; the default is `info`. Native lowering removes calls below
the resolved threshold and writes enabled messages through the synchronous
`pulse_log(level, ptr, len)` host ABI. JavaScript targets use the same threshold
and provider-owned destination at runtime.

Logging is not a Pulse effect and cannot suspend a handler. Sink failures are
request-contained, and known request secrets are redacted before managed output.
Messages are strings only; structured logging and application-significant side
effects inside message expressions are outside the Beta contract.

## Responses

```ts
return ctx.json({ ok: true }, { status: 201 })
return ctx.text('not found', { status: 404 })
return ctx.response({ status: 204 })
```

A schema-backed JSON response names its compiled schema:

```ts
return ctx.json(output, { schema: 'app.CreateUserOutput' })
```

## Host capabilities

Canonical host work is requested through `ctx`:

```ts
const upstream = await ctx.fetch('https://api.example.test/items').json('app.ItemList')
const mode = await ctx.config.get('MODE')
const token = await ctx.secret.get('API_TOKEN')
const session = await ctx.kv<{ userId: number }>('sessions').get('current')
```

Conditional KV extends the same namespace with `getVersioned`, `insertIfAbsent`,
and `compareAndSwap`. The Node reference realizes them through JavaScript and
compiled Native execution; Fastly Native uses direct conditional KV hostcalls. Reads pair a value with an opaque string generation;
writes distinguish `stored`, `conflict`, `not-stored`, and `unknown` (possibly
committed). Pulse snapshots candidates, preserves tokens without numeric
coercion, and performs no automatic retry. Fastly JavaScript remains incomplete;
K4 retains the deployed acceptance gate.
The detailed contract is in [Effects and continuations](../concepts/effects-and-continuations.md#conditional-kv).

Those calls are compiled into explicit effects and validated against the selected provider. See [Compilation and lowering](../concepts/compilation-and-lowering.md).

## Structured and opaque fetch results

A response can be inspected as bounded structured data:

```ts
const item = await ctx.fetch('https://api.example.test/item').json<{ id: number }>('app.Item')
return ctx.json(item)
```

Or returned directly as an opaque pass-through response:

```ts
return ctx.fetch('https://assets.example.test/archive.bin')
```

Opaque bodies are returnable but not inspectable or iterable. See [Structured and opaque bodies](../concepts/bodies.md).

## Deliberate exclusions

The runtime contract does not expose:

- arbitrary Promise construction or general Promise semantics under native lowering;
- ambient `process.env`, global fetch, timers, or randomness;
- provider SDK objects or provider-specific namespaces;
- arbitrary binary body inspection;
- userland stream transforms or background tasks;
- raw sockets.

The compiler rejects unsupported forms rather than treating them as
provider-dependent behavior. See the
[Beta scope](../preview-scope.md).

## Package and installed references

The npm tarball includes:

- `docs/API.md` — the canonical API reference;
- `docs/preview-scope.md` — the supported and excluded Beta surface.

For workflow and project configuration, use [`@pulse-compute/cli`](./cli.md).
