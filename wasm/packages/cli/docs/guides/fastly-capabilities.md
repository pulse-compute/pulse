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

For Native runtime destinations, set `fastly.bindings.dynamicBackends: true`.
Configured canonical-origin mappings still win; unmapped origins register under
a request-local policy with at most 32 attempts across all collections and
continuations. The service must have Fastly Dynamic Backends enabled. Native
admits ASCII HTTP/HTTPS DNS URLs and canonical IPv4 over HTTP; credentials, IDNA,
IPv6, HTTPS IP literals and unusual numeric host forms fail explicitly. HTTPS
retains normal certificate verification and URL-derived SNI. See
[Native dynamic backends](../packages/provider-fastly.md#native-dynamic-backends)
for precedence, URL handling, limits, failures and the qualification boundary.
S3, GRIP control endpoints and experimental body forwarding remain statically
bound.

With that opt-in and the service capability enabled, this handler fetches two
runtime-supplied destinations concurrently. Send complete HTTP/HTTPS URLs in the
two headers; returned fields retain their authored order even when origins finish
in a different order. Neither origin needs a static declaration.

<!-- pulse-doc-source: wasm/test/fixtures/projects/fastly-compute-reality/dynamic-backends-example.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/compare', async (ctx) => {
  const firstUrl = ctx.req.header('x-first-url')
  const secondUrl = ctx.req.header('x-second-url')
  if (!firstUrl || !secondUrl) {
    return ctx.text('Two complete origin URLs are required', { status: 400 })
  }
  const { first, second } = await ctx.parallel({
    first: ctx.fetch(firstUrl).text(),
    second: ctx.fetch(secondUrl).text(),
  })
  return ctx.json({ first, second })
})

export default app
```
<!-- /pulse-doc-source -->

Secret values are never included raw in trace output, errors, snapshots, or CLI project JSON.

Fastly Native conditional KV reads and writes redact object field names as
complete quoted JSON tokens in managed logs. A field named `id` therefore does
not alter unrelated structured metric keys such as `considered` or `invalidAcks`,
and numeric fields remain numeric. KV string values, lookup keys, generation
tokens, and known Secret Store values retain substring redaction. Keep operational
observations separate from private payloads: redacting a payload does not preserve
its schema or distinguish fields that collapse to the same redacted name.

Unconfigured Fastly Native `ctx.log` writes redacted, newline-terminated messages to standard
output through WASI `fd_write` (descriptor 1). Each enabled statement makes one
best-effort write; errors and partial writes do not retry, change the HTTP result,
or disable later statements. It does not open a named logging endpoint: `stdout`
and `stderr` are reserved names. No logging binding is required.

### Native transport diagnostics

Fastly Native preserves bounded host transport details on `error.detail` when an
existing application error handler receives `PULSE_FETCH_NETWORK`. The existing
`code`, `name`, and `message` remain unchanged. Handlers may return a custom
response or pass the error through `next(error)`. Other providers and failures
may omit `detail`; guard its presence in shared handlers.

The record contains `provider: 'fastly'`, `phase` (`send`, `wait`, or `poll`),
unsigned host `status`, `tag`, `mask`, and `kind`, plus nullable numeric
`dnsRcode`, `dnsInfo`, `tlsAlert`, `h2Frame`, and `h2Code`. DNS fields require the
DNS-error tag and their respective mask bits; TLS-alert and HTTP/2 fields likewise
require both their tag and mask. Valid zero values remain zero. Missing values
are `null`; an absent/uninitialized detail has `kind: 'unavailable'` and null
`tag`/`mask`. Unknown tags use `kind: 'unknown'` and retain the unsigned numeric tag
and mask. These are host observations, not independently verified root causes.

Each active send/wait/poll failure also attempts one `[pulse:error]` JSON log
with `event: 'pulse.transport'` and the same fields through the existing configured
sink. The record is less than 512 UTF-8 bytes and includes only fixed strings and
bounded integers: no pointers, URL, backend name, headers, body, or secret values.
Sink failure does not change error handling. This provider diagnostic does not
require an authored `ctx.log` statement. S3 retains its existing failure result;
forwarding retains its terminal response contract. Their details are available
through this diagnostic, without introducing application recovery for forwarding.

| Native path | Host detail and lifecycle |
| --- | --- |
| Ordinary fetch (also shared GRIP transport) | `send_async`, then `pending_req_wait_v2`; failed sends have no detail output and explicitly report unavailable detail. |
| Fetch with an active header deadline | Existing `pending_req_poll_v2`; expiration remains `PULSE_FETCH_TIMEOUT`, even if a poll also reports a transport failure. |
| S3 | Existing async send and bounded poll; transport diagnostics do not alter S3 result fields or timeout reasons. |
| Terminal body forwarding | Existing streaming send and poll; diagnostics do not resume application code, retry, or send a replacement after response commitment. |
| Cleanup | Late polls discard details and close owned results; they cannot replace the original error. Pending requests have no host cancellation operation. |

All detail-bearing calls reset the complete 20-byte wasm32 ABI record before
reuse. Ordinary Native fetch/GRIP now requires `pending_req_wait_v2`; deadline,
S3, and forwarding paths retain their existing `pending_req_poll_v2` requirement.
An older host missing these imports cannot instantiate the artifact; there is no
legacy-host fallback. Historical internal HTTP-effects/entities prototypes are
not the canonical `pulse build` route and do not acquire this diagnostic contract.

The focused authoring-to-Wasm proof is
`node wasm/test/provider/assert-fastly-transport-details.cjs`. Setting
`PULSE_VICEROY_BIN` adds local socket-reset and untrusted-certificate replay
(requires OpenSSL to create a temporary local certificate). Viceroy 0.21.1 returns
transport statuses for these failures but leaves detail uninitialized; Pulse
reports `unavailable`, without inventing DNS or TLS subcodes. The opt-in
`assert-fastly-transport-details-installed.cjs` runner freshly packs and installs
the candidate, verifies installed bytes before and after compilation, and records
Wasm/package hashes and local engine identity. Enforcing-host DNS/TLS/mask cases
and actual local host observations are distinct evidence; neither establishes
deployed Fastly acceptance.

### Named production log streams

Select one case-sensitive stream explicitly in `.pulse/config.ts`:

```ts
import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig(() => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'production' },
  production: {
    host: 'fastly', target: 'native',
    fastly: { bindings: { logEndpoint: 'application-events' } }
  }
}))
```

The provider facade accepts the equivalent `fastly({ logEndpoint: 'application-events' })`.
Keep using `ctx.log.info(...)`, `warn`, `error` and `debug`; existing severity,
structured message formatting and request-owned redaction still apply. Omitting
`logEndpoint` preserves stdout. Names must be 1–255 UTF-8 bytes, without control
characters or surrounding whitespace; `stdout`, `stderr` and `fst_managed_` names
(case-insensitively) are reserved and rejected with `PULSE_FASTLY_LOG_ENDPOINT_INVALID`.

Create that named Real-Time Log Streaming endpoint separately on the selected
Fastly service. The configuration names an existing destination; it neither
creates a stream nor embeds its credentials. Native uses `fastly_log.endpoint_get`
and `fastly_log.write`; JavaScript packages pass the name to the SDK's
`fastly:logger` `Logger` during request handling. JavaScript keeps its existing
message format; it does not emulate Native output. Named records exceeding
65,536 UTF-8 bytes including the target's prefix and terminator are dropped whole.
This is a Pulse bound, not a promise of a platform message-size limit.

Each Native record makes one lookup and at most one write. Lookup/write errors,
zero writes and short writes drop the remaining bytes with no retry, stdout
fallback or change to the HTTP outcome. JavaScript catches SDK lookup/write
exceptions; its API does not expose short-write counts. Later statements still
attempt delivery. Host acceptance cannot prove that the endpoint exists or that
the downstream destination received the record. Loss, partial records and
reordering remain possible; there is no queue or delivery guarantee.

Viceroy named-endpoint output proves the local logging ABI only. It uses virtual
named sinks in local process output; it does not qualify a production destination
or missing-stream behavior on Fastly. Enforcing-host failures and actual local
Compute evidence are retained separately. Deployed acceptance requires a unique
probe to arrive at the configured receiver, secret absence and unchanged HTTP
responses. `fastly log-tail` alone does not satisfy named-stream delivery; #309's
stdout/log-tail acceptance remains separate from #467.

This corrects the beta.8 Native logger's reserved-endpoint lookup. Local Viceroy
qualification requires positive arrival/outcome output as well as secret absence.
After deploying a corrected candidate, verify delivery with
`fastly log-tail --stream stdout` before relying on live cadence reporting.
Local and injected-host checks do not establish deployed log-tail delivery.

The opt-in `fastly-stdio-installed` task packs and installs exact candidates outside
the checkout with lifecycle scripts disabled. It checks installed bytes before
and after compilation, replays the emitted Wasm with failing writes, and requires
an authenticated probe's arrival/outcome logs from Viceroy:

```bash
PULSE_VICEROY_BIN=/path/to/viceroy \
node wasm/scripts/run-wasm-tests.cjs --task fastly-stdio-installed --no-report
```

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
receipt or post-handoff cancellation. The selected operation reserves fixed
resource claims and protected cleanup before acquisition. Unknown host outcomes
remain charged and are not retried. Cleanup and an error response require time
under the original request deadline; after that deadline or a clock failure,
unresolved resources remain for host teardown. Fastly JavaScript remains ineligible.
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
