# Hello JSON

The smallest canonical Pulse project: branch on the request path and return JSON or text.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/01-hello-json","args":["test","--json"]} -->
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
      "name": "health",
      "status": "passed",
      "response": {
        "status": 200
      }
    }
  ]
}
```

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 2.2 KiB (2,212 bytes) | 2.0 KiB (2,058 bytes) | 7.0% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

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

## Project config

<!-- pulse-doc-source: examples/01-hello-json/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
  },
}))
```
<!-- /pulse-doc-source -->


## Test harness

<!-- pulse-doc-source: examples/01-hello-json/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'health',
      request: { path: '/health' },
      expect: { status: 200, json: { ok: true } },
    },
    {
      name: 'hello',
      request: { path: '/hello' },
      expect: {
        status: 200,
        json: { message: 'hello from Pulse' },
      },
    },
    {
      name: 'missing',
      request: { path: '/missing' },
      expect: { status: 404, text: 'not found' },
    },
  ],
}
```
<!-- /pulse-doc-source -->
