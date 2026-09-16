# Request schema

Compiles explicit TypeScript request and response schemas with the project. The
same codecs are used by `test`, `dev`, Node builds, and Fastly builds.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/02-request-schema","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 2,
    "passed": 2,
    "failed": 0
  },
  "cases": [
    {
      "name": "create-user",
      "status": "passed",
      "response": {
        "status": 201
      }
    }
  ]
}
```

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 40.0 KiB (40,981 bytes) | 31.8 KiB (32,604 bytes) | 20.4% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

<!-- pulse-doc-source: examples/02-request-schema/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'
import type { CreateUserInput, CreateUserOutput } from './schemas.js'

const app = new Pulse({ auto: true })

app.post('/users', async (ctx) => {
  const first = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const second = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const output: CreateUserOutput = {
    id: 7,
    name: first.name,
    active: first.active,
    sameReference: first === second,
  }
  return ctx.json(output, { status: 201, schema: 'app.CreateUserOutput' })
})

export default app
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/02-request-schema/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    schemas: { contentTypePolicy: 'require-json', maxBytes: 1024 },
  },
}))
```
<!-- /pulse-doc-source -->


## Test harness

<!-- pulse-doc-source: examples/02-request-schema/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'create-user',
      request: {
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', active: true }),
      },
      expect: {
        status: 201,
        json: {
          id: 7,
          name: 'Ada',
          active: true,
          sameReference: true,
        },
      },
    },
    {
      name: 'invalid-user',
      request: {
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 12, active: true }),
      },
      expect: {
        error: {
          name: 'SchemaDecodeError',
          code: 'PULSE_SCHEMA_DECODE',
        },
      },
    },
  ],
}
```
<!-- /pulse-doc-source -->
