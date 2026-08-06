# Static events and outbound emission

Pulse events are a second, provider-neutral application plane beside HTTP.
`Pulse.on` declares exact inbound event handlers and `ctx.emit` requests
one-way outbound host acceptance. Neither surface creates a process-global bus,
a listener, delivery machinery, or reflexive application routing.

The current executable realization is deliberately narrow: Node JavaScript and
Node Native provide a bounded invocation-scoped reference adapter for tests and
direct parity evidence. Fastly fails closed for event ingress or emit, while
browser and ESP32 hosts remain unclaimed. Target selection never falls back.

## Declare the topology

Event registrations belong only to the resolved `Pulse` application root. The
type, declaration, and handler are static compiler inputs:

<!-- pulse-doc-source: examples/11-events/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

type DeviceReading = Readonly<{
  deviceId: string
  temperatureC: number
}>

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.text('ok'))

app.on<DeviceReading>('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const reading = ctx.event.payload
  ctx.log.info('device reading accepted')
  await ctx.emit('device.reading.accepted', {
    schema: 'events.DeviceReadingAccepted',
    payload: { deviceId: reading.deviceId, accepted: true },
  })
})

app.on('system.tick', { schema: null }, async (ctx) => {
  ctx.log.info('system tick accepted')
  await ctx.emit('system.heartbeat', { schema: null })
})

export default app
```
<!-- /pulse-doc-source -->

Each exact event type has one owner. A schema ID must be a literal dotted ID
present in the project registry. `schema: null` declares an explicit
no-payload event. Registrations cannot be hidden in helpers, aliased, mounted on
a `Router`, or created dynamically.

## Event context

An event handler receives `PulseEventContext<Payload>` and completes with
`Promise<void>`:

| Available | Deliberately absent |
|---|---|
| `ctx.event.type` and immutable `ctx.event.payload` | `ctx.req`, route parameters, and HTTP metadata |
| execution-local `ctx.state` and synchronous `ctx.log` | response builders or a response result |
| fetch, config, secret, KV, and `ctx.parallel` | middleware and Router `next()` transfer |
| one-way `ctx.emit` | provider SDKs, listeners, or transport handles |

Schema selection and payload validation complete before handler entry. The
payload is detached from host input and immutable. State, effects,
continuations, cancellation, logging, redaction, completion, and disposal are
owned by one invocation and do not leak into another event or HTTP request.

## Canonical frame and schema rules

Ingress and outbound acceptance use `pulse.event-frame.v1` internally:

```ts
type EventFrame =
  | { version: 'pulse.event-frame.v1'; type: string; schemaId: string; payload: unknown }
  | { version: 'pulse.event-frame.v1'; type: string; schemaId: null }
```

The public authoring and harness shapes use `schema`, while emitted artifacts
and host-runtime frames normalize it to `schemaId`. A schema-bound frame must
contain `payload`; a no-payload frame must omit it. Unknown fields, accessors,
sparse arrays, cycles, non-finite numbers, symbols, and non-JSON values fail
before dispatch.

Default host bounds are:

| Bound | Default |
|---|---:|
| Event type | 128 UTF-8 bytes |
| Schema ID | 256 UTF-8 bytes |
| Payload | 65,536 UTF-8 JSON bytes |
| Payload nesting | 32 levels |
| Payload entries | 4,096 |
| Static registrations | 256 |
| Adapter queue depth | 65,536 |
| Bounded error text | 4,096 UTF-8 bytes |

These are containment limits, not an application-facing tuning API. A provider
or direct host may impose a stricter bound.

## `ctx.emit` means acceptance, not delivery

`ctx.emit(type, { schema, payload? })` must use literal event and schema
identities. It may be awaited directly or supplied as a fresh member of an
awaited `ctx.parallel({ ... })` group. The effect resolves to `undefined` only
after the execution-owned adapter accepts a detached, schema-validated frame.

Acceptance does not promise:

- delivery, persistence, retry, acknowledgement, or a receipt;
- a correlation ID or remote handler result;
- automatic invocation of a matching local `Pulse.on` handler;
- same-stack reentry or an implicit queue consumer;
- substitution through HTTP, GRIP, logging, or another target.

The Node reference adapter maintains separate FIFO ingress and exact outbound
acceptance ledgers. Outbound frames never feed the ingress queue automatically.
Queue overflow, cancellation, invalid acceptance results, schema failures, and
effect-budget exhaustion remain bounded invocation failures.

## Harness event cases

`pulse test` uses an explicit discriminant so event input never masquerades as
an HTTP request:

<!-- pulse-doc-source: examples/11-events/tests/pulse.harness.ts -->
```ts
export default { cases: [
  {
    name: 'http health remains separate',
    request: { method: 'GET', path: '/health' },
    expect: { status: 200, text: 'ok' },
  },
  {
    name: 'schema event emits an accepted frame',
    kind: 'event',
    event: {
      type: 'device.reading',
      schema: 'events.DeviceReading',
      payload: { deviceId: 'sensor-7', temperatureC: 21 },
    },
    expect: {
      status: 'completed',
      emitted: [{
        type: 'device.reading.accepted',
        schema: 'events.DeviceReadingAccepted',
        payload: { deviceId: 'sensor-7', accepted: true },
      }],
    },
  },
  {
    name: 'no-payload event emits a no-payload frame',
    kind: 'event',
    event: { type: 'system.tick', schema: null },
    expect: {
      status: 'completed',
      emitted: [{ type: 'system.heartbeat', schema: null }],
    },
  },
] }
```
<!-- /pulse-doc-source -->

`expect.emitted` is ordered and exact. It verifies host acceptance, not
transport delivery. `pulse dev` continues to serve the HTTP plane only; there
is no public event injection command.

## Target eligibility

| Selected target | Ingress and emit status | Meaning |
|---|---|---|
| Node JavaScript | Eligible | Live application execution through the bounded Node reference adapter. |
| Node Native | Eligible | Provider-neutral Native event entry driven through the bounded Node reference adapter. |
| Fastly JavaScript | Blocked | No Fastly event ingress or emit adapter is claimed. |
| Fastly Native | Blocked | No Fastly event ingress or emit adapter is claimed. |
| `none` compile-only | Inspection only | Catalog and Native plan may be produced without execution authority. |
| Browser or ESP32 | Unclaimed | A future host must define and prove its own adapter and queue ownership. |

For a blocked Fastly project, `inspect` remains available and `doctor`, `build`,
and `test` report the exact eligibility boundary. Pulse never produces an
alternate target artifact.

## Inspection, artifacts, and diagnostics

`pulse inspect --json` and `pulse doctor --json` report registrations,
emission callsites, referenced schemas, `event.ingress`/`event.emit` host
requirements, command eligibility, and `automaticFallback: false`. Eligible
builds and compile-only output write deterministic `event-catalog.json` and
`event-inspection.json` files.

Common public workflow diagnostics include:

- [`PULSE_TEST_EVENT_INVALID`](../reference/diagnostics.md#pulse-test-event-invalid)
  for a malformed harness frame;
- [`PULSE_EVENT_TARGET_UNSUPPORTED`](../reference/diagnostics.md#pulse-event-target-unsupported)
  for a target without the required event plane;
- [`PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED`](../reference/diagnostics.md#pulse-fastly-event-ingress-unsupported)
  and
  [`PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED`](../reference/diagnostics.md#pulse-fastly-event-emit-unsupported)
  for the explicit Fastly boundary.

Compiler diagnostics additionally point to the exact dynamic type, unresolved
schema, hidden or duplicate registration, missing await, invalid payload, HTTP
surface in an event handler, or event surface in an HTTP handler.

## Native extension

Event-reachable Native artifacts conditionally expose
`pulse.native-event-abi.v1` through `pulse_event_abi_version()` and
`pulse_event_start(runtimeId, payloadHandle)`. The host validates the frame and
schema before module entry. A positive payload handle references an immutable
host-owned value; `0` means a declared no-payload event.

The extension adds no imports. Event-only artifacts expose the event entry;
mixed artifacts retain independent HTTP and event entries. HTTP-only source
adds no event imports, exports, catalog data, code, or byte changes. Native
event effects reuse the ordinary continuation protocol and add no JavaScript,
Promise, Asyncify, target probing, or fallback.

## No `call` or reflexive routing

The event contract intentionally exposes no `ctx.call`, `app.call`, generic
call effect, request/reply bus, correlation protocol, or compiler/runtime
reservation for one. `ctx.emit` cannot observe or invoke a local handler. Any
future call mechanism requires a separately specified host, ownership model,
failure contract, recursion/reentrancy guard, and explicit authorization; it is
not latent in this candidate.

See the [canonical API](../../API.md), [effects and
continuations](../concepts/effects-and-continuations.md), [compatibility
matrix](../reference/compatibility-matrix.md), and [event example](../../examples/11-events/).

