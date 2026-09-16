# Static events

This mixed Node project keeps HTTP and event entries in separate planes. Two
schema-bound `Pulse.on` registrations accept canonical event frames and use the
one-way `ctx.emit` effect. The harness proves exact outbound acceptance; it
does not claim delivery or invoke a matching local handler.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

`pulse test` executes both HTTP and event cases on the selected Node target.
`pulse dev` serves only the HTTP portion; Pulse does not expose a public event
listener or injection command.

The documented result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/11-events","args":["test","--json"],"timeoutMs":240000} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "cases": [
    {
      "name": "http health remains separate",
      "status": "passed",
      "response": {
        "status": 200
      }
    },
    {
      "name": "schema event emits an accepted frame",
      "status": "passed",
      "kind": "event",
      "emittedFrameCount": 1
    }
  ]
}
```

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 39.6 KiB (40,546 bytes) | 31.6 KiB (32,339 bytes) | 20.2% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Application

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

## Schemas

<!-- pulse-doc-source: examples/11-events/src/schemas.ts -->
```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface DeviceReading {
  deviceId: string
  temperatureC: number
}

export interface DeviceReadingAccepted {
  deviceId: string
  accepted: boolean
}

export default defineSchemaRegistry({
  schemas: {
    'events.DeviceReading': schema<DeviceReading>(),
    'events.DeviceReadingAccepted': schema<DeviceReadingAccepted>(),
  },
})
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/11-events/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-native',
    strict: true,
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-node-javascript',
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
}))
```
<!-- /pulse-doc-source -->

## Test harness

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

See [Static events and outbound emission](../../docs/guides/events.md) for the
frame, queue, target, diagnostic, and Native-extension contracts.
