# GRIP and Fanout

Pulse treats GRIP as stateless HTTP framing around an external connection owner. Fanout, Pushpin, or another GRIP gateway maintains connections and fan-out state. Pulse handles ordinary requests and responses.

The JavaScript target permits ordinary runtime values:

```ts
import { Router } from '@pulse-compute/runtime'
import { grip } from '@pulse-compute/grip'

const app = new Router()

app.get('/events/:topic', async (ctx) => {
  const channel = `topic:${ctx.param('topic')}`

  if (grip.isWebSocket(ctx.req)) {
    return grip.handoff({ channel })
  }

  return grip.subscribe(
    new Response(null, { status: 200 }),
    { channel, mode: 'stream', timeoutMs: 30_000 },
  )
})

app.post('/events/:topic', async (ctx) => {
  const data = await ctx.req.json()
  await grip.broadcast(ctx, {
    channel: `topic:${ctx.param('topic')}`,
    event: 'pulse.message',
    data,
  })
  return ctx.json({ accepted: true }, { status: 202 })
})

export default app
```

`isWebSocket`, `subscribe`, and `handoff` are pure request/response helpers. `broadcast` is the only provider effect, so it participates in normal request cancellation, secret redaction, direct `await`, and keyed `ctx.parallel({ ... })` behavior.

The Native target recognizes the same root with supported static framing options
and broadcast messages:

```ts
import { grip } from '@pulse-compute/grip'

export async function handler(ctx) {
  if (grip.isWebSocket(ctx.req)) {
    return grip.handoff({ channel: 'topic:news', body: 'handoff' })
  }

  await grip.broadcast(ctx, {
    channel: 'topic:news',
    event: 'pulse.message',
    data: { available: true },
  })

  return grip.subscribe(new Response(null, { status: 202 }), {
    channels: ['topic:news', 'topic:audit'],
    mode: 'stream',
    timeoutMs: 30_000,
  })
}
```

Dynamic Native channel, option, or message shapes fail at the unsupported
expression. Pulse does not retry another lowering or switch targets.

Provider broadcast configuration is distinct from the public gateway URL and
the application's ingress route. It supplies an explicit publish/control
endpoint and, on Fastly, its named backend:

```ts
fastly({
  backends: {
    'https://publisher.example': 'grip_publisher',
  },
  grip: {
    publishEndpoint: 'https://publisher.example/publish',
    publishBackend: 'grip_publisher',
    authentication: {
      scheme: 'bearer',
      secretRef: 'GRIP_PUBLISH_TOKEN',
    },
  },
})
```

Only the secret reference enters project configuration; the provider resolves
the value inside the shared redaction boundary. There is no ambient endpoint,
credential, connection state, or automatic fallback. Cross-target conformance
covers framing, cancellation, bounds, acknowledgements, redaction, and
deterministic Node/Fastly provider artifacts. GRIP is included in the generally
available Node JavaScript target in the Beta.
