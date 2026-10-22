# Request schema

<!-- pulse-example-template:v1 -->

Compiles explicit TypeScript request and response schemas with the project. The
same codecs are used by `test`, `dev`, Node builds, and Fastly builds.

## Request and response

Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.

| Request | Expected response |
|---|---|
| create-user<br><code>POST /users</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"name":"Ada","active":true}</code> | <code>{"status":201,"json":{"id":7,"name":"Ada","active":true,"sameReference":true}}</code> |
| invalid-user<br><code>POST /users</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"name":12,"active":true}</code> | <code>{"error":{"name":"SchemaDecodeError","code":"PULSE_SCHEMA_DECODE"}}</code> |

<!-- pulse-example-view:code -->
## Code

### Handler

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

### Project config

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

## Inspect

The selected profile is `local`; this checked excerpt identifies its target, provider and recognized capabilities. Paths, hashes and additional inspection fields are omitted.

<!-- pulse-doc-run {"project":"examples/02-request-schema","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
```bash
npm run inspect -- --json
```
```json
{
  "status": "ok",
  "project": {
    "target": "native"
  },
  "provider": {
    "id": "node"
  },
  "compiler": {
    "capabilities": [
      "request.json",
      "response.json",
      "response.text",
      "schema.decode",
      "schema.encode"
    ]
  }
}
```

## Doctor

Check this project and its local toolchain before execution. This selected result is verified by the documentation gate; another machine may report different prerequisite checks.

<!-- pulse-doc-run {"project":"examples/02-request-schema","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
```bash
npm run doctor -- --json
```
```json
{
  "status": "passed",
  "summary": {
    "warnings": 0,
    "failed": 0
  }
}
```

## Report

Build once into a separate directory, then replay the retained artifact without running or rebuilding the application. This checked excerpt accounts for registered handlers in the build evidence; it is not runtime request coverage.

<!-- pulse-doc-run {"project":"examples/02-request-schema","args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"prepare":["build","--out",".pulse-docs-build","--json"],"display":"npm run build -- --out .pulse-docs-build\nnpm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
```bash
npm run build -- --out .pulse-docs-build
npm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json
```
```json
{
  "kind": "pulse.application-report",
  "reportVersion": 1,
  "analytics": {
    "coverage": {
      "handlers": {
        "expected": 1,
        "observed": 1,
        "reason": null,
        "status": "complete"
      }
    }
  }
}
```

Optional offline HTML uses the same retained evidence:

```bash
npm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --html
```

Review reports before sharing. Missing, stale or incompatible evidence is an error; timings, paths and hashes are not presented as stable output.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

## Test result

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

## Wasm size

For build settings, see [Native build optimization](../../docs/reference/native-build-optimization.md).

| Artifact | Default build |
|---|---:|
| Portable guest `canonical-native.wasm` | 31.9 KiB (32,707 bytes) |

The executable documentation gate rebuilds and measures the default artifact.
Measured with Node 24.18.0 and lockfile-pinned AssemblyScript 0.28.18. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.
