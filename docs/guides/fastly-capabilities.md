# Fastly config, secrets, KV, and backends

User code stays provider-neutral:

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

Fastly bindings belong in project configuration:

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

The same example maps its logical `sessions` store and its GRIP publish endpoint
inside the provider-owned Fastly configuration boundary:
[`examples/05-fastly-capabilities`](../../examples/05-fastly-capabilities/).

Dynamic backends are disabled by default. Map every known origin to a named backend or opt in deliberately.

Secret values are never included raw in trace output, errors, snapshots, or CLI project JSON.

Fastly Native conditional KV reads and writes redact object field names as
complete quoted JSON tokens in managed logs. A field named `id` therefore does
not alter unrelated structured metric keys such as `considered` or `invalidAcks`,
and numeric fields remain numeric. KV string values, lookup keys, generation
tokens, and known Secret Store values retain substring redaction. Keep operational
observations separate from private payloads: redacting a payload does not preserve
its schema or distinguish fields that collapse to the same redacted name.

Logging uses the provider-owned `stdout` endpoint on a best-effort basis. An
unavailable or rejected endpoint is a separate sink failure; proving correct
emitted log bytes with an injected Fastly ABI host does not prove that Viceroy or
a deployed service accepts that endpoint.

For `target: 'native'`, `pulse build` compiles the generated Compute package to
direct-host-ABI `bin/main.wasm`. For `target: 'javascript'`, it emits the
deterministic source/deployment closure consumed by the pinned Fastly JavaScript
runtime compiler. Both targets use these same logical bindings.

The external reality task records its selected launcher and executes the Native
candidate through either direct Viceroy:

```bash
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-compute-reality --no-report
```

or `fastly compute serve --file` selected with `PULSE_FASTLY_BIN`. The gate
sends real HTTP requests through the Native module. It remains separate from
portable and offline JavaScript-candidate validation and does not deploy a
service.

## Experimental Native binary forwarding

Opt in with `fastly.bodyForwarding: { requestMaxBytes: 1048576,
responseMaxBytes: 1048576 }` and `fastly.maxDurationMs: 2000`. In a Native
application with one fetch effect, return
`ctx.fetch('https://origin.example/upload', { method: 'POST', body: ctx.req.body() })`
from the handler and map that origin to a named backend. Both byte bounds are
required, independent, and limited to 1 MiB. Request headers must be literal,
explicit and fit 64 pairs/16 KiB; incoming credentials are not copied implicitly.

Pulse pumps opaque bytes, watches for early origin responses and enforces the
request deadline plus any earlier fetch `timeoutMs` through response pumping.
Successful final close hands queued delivery to Fastly; it provides no client
receipt or post-handoff cancellation. Fastly JavaScript remains ineligible.
See [body transport limits](../concepts/bodies.md#current-transport-limits)
for the initial shape restrictions and qualification boundary.

`fastly-incoming-body-forwarding` checks the normal Native build and adversarial
host ABI cases. Set `PULSE_VICEROY_BIN` to the reviewed Viceroy 0.21.1 executable
to also check real HTTP byte identity, caps, incremental upload/output, early
responses, header filtering, bodyless statuses, disconnects and post-header
aborts. The separate installed task requires that executable:

```bash
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task fwd9-03-installed --no-report
```

It packs exact candidates, installs outside the checkout with lifecycle scripts
disabled, verifies installed bytes before and after the CLI workflows, and
replays the emitted Wasm under both the ABI fixture and Viceroy. Its report binds
package, Wasm, runner and engine identities. Additional builds exercise unequal
request/response caps and an earlier total deadline. These are local and
installed qualification results; deployed Fastly remains unqualified. Fixed
guest storage and loopback timing samples do not prove a host queue bound,
zero-copy forwarding or a Pulse-versus-Rust performance result.
