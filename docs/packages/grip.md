# `@pulse-compute/grip`

`@pulse-compute/grip` provides stateless HTTP framing for an external GRIP/Fanout gateway. Pulse does not own WebSocket objects, connection registries, backpressure, reconnect behavior, or connection-length continuations. The gateway owns the open connection; Pulse classifies requests, returns subscription or handoff instructions, and emits outbound broadcast effects.

## Install

```bash
npm install @pulse-compute/grip@1.0.0-beta.2
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
