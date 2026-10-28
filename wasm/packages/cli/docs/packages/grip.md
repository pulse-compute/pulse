# `@pulse-compute/grip`

**npm:** [`@pulse-compute/grip`](https://www.npmjs.com/package/@pulse-compute/grip)

`@pulse-compute/grip` provides stateless HTTP framing for an external GRIP/Fanout gateway. Pulse does not own WebSocket objects, connection registries, backpressure, reconnect behavior, or connection-length continuations. The gateway owns the open connection; Pulse classifies requests, returns subscription or handoff instructions, and emits outbound broadcast effects.

## Install

```bash
npm install @pulse-compute/grip@1.0.0-beta.10
```

## Package-root API

```ts
import { Router } from '@pulse-compute/runtime'
import { grip } from '@pulse-compute/grip'

const app = new Router()

app.get('/events/:accountId', async (ctx) => {
  const channel = `account:${ctx.param('accountId')}`

  if (grip.isWebSocket(ctx.req)) {
    return grip.handoff({ channel })
  }

  return grip.subscribe(
    new Response(null, { status: 200 }),
    { channel, mode: 'stream' },
  )
})

app.post('/publish/:accountId', async (ctx) => {
  const data = await ctx.req.json()
  await grip.broadcast(ctx, {
    channel: `account:${ctx.param('accountId')}`,
    data,
  })
  return ctx.json({ accepted: true }, { status: 202 })
})

export default app
```

The root API separates pure HTTP behavior from provider interaction:

- `grip.isWebSocket(request)` — pure request classification;
- `grip.subscribe(response, options)` — pure response decoration with GRIP subscription headers;
- `grip.handoff(options)` — pure HTTP response construction for gateway handoff;
- `grip.broadcast(ctx, message)` — request-bound outbound effect, directly awaitable and valid inside `ctx.parallel({ ... })`.

## Realization boundary

The canonical root has bounded JavaScript and Native framing realization.
Configured Node and Fastly providers realize `grip.broadcast`; a missing publish
capability fails with a stable capability-required diagnostic rather than
falling back or taking ownership of a connection. Native options and messages
must use supported static shapes, and unsupported expressions fail at the exact
source boundary.

The publish/control endpoint, named backend, authentication, and optional
trusted-proxy verification are provider-owned configuration. Public gateway
URLs and ingress routes are separate. Configuration stores only secret
references; values remain inside the shared secret/redaction boundary.

Cross-target conformance covers framing, cancellation, bounds,
acknowledgements, redaction, and deterministic Node/Fastly provider artifacts.
This bounded realization is included in both generally available JavaScript
targets.

## Compatibility Native facade

`@pulse-compute/grip/pulsewasm` remains a compatibility surface for the Native
`channel`, `hold`, and `publish` contract. It is not the recommended API for
new applications and is not evidence that Pulse owns WebSocket lifecycle. See
[Compatibility imports and migration](../guides/compatibility-imports.md).

## Related documentation

- [GRIP and Fanout guide](../guides/grip.md)
- [Contracts and providers](../concepts/contracts-and-providers.md)
- [Package-owned lowering](../concepts/package-owned-lowering.md)
- [Diagnostics](../reference/diagnostics.md)

## Experimental Fastly Native terminal handoff

Candidate builds expose named `handoffFanout(ctx, backend)` and
`handoffWebSocket(ctx, backend)` functions from
`@pulse-compute/grip/experimental`. This subpath is provisional and outside the
release manifest's supported entry points; it is not added to the root `grip`
object. The existing pure `grip.handoff` framing method is unchanged.

```ts
import type { Handler } from '@pulse-compute/runtime'
import { handoffWebSocket } from '@pulse-compute/grip/experimental'

const handler: Handler = async (ctx) => {
  if (ctx.req.path === '/health') return ctx.text('ok')
  return handoffWebSocket(ctx, 'edge')
}
export default handler
```

Use one direct terminal return in a plain Fastly Native handler, with its current
context and a literal configured backend key (`fastly.bindings.backends.edge`
in this example). Fan-out selects `fastly_http_req.redirect_to_grip_proxy_v2`;
WebSocket passthrough selects `fastly_http_req.redirect_to_websocket_proxy_v2`.
Both use the generic `terminal-request-backend.v1` service and existing lifecycle,
deadline and response authority. They return no application value: the TypeScript
return type is `never`, compatible with a terminal handler branch, not a fabricated
`Response` or a constructible completion token. Native compilation enforces
placement independently of TypeScript; a cast cannot admit unsupported usage.

Router placement, helpers, parallel/multiple handoffs, other surrounding effects,
body forwarding and dynamic backend expressions remain unsupported. Node Native
and JavaScript targets do not advertise this service. Direct JavaScript calls
throw `PULSE_HOST_EXTENSION_TARGET`; there is no runtime fallback.

Current evidence covers injected ABI execution and packed consumers. It does not
qualify Viceroy, hosted Fastly, remote delivery or the lifetime of the handed-off
connection. See the [terminal service contract](../architecture/current-contracts.md#fastly-native-terminal-service)
for unknown outcomes and cleanup rules.
