# Dynamic endpoint probes

<!-- pulse-example-template:v1 -->

A bounded endpoint list becomes an ordered array of probe results through
`ctx.effects({ max: 32 })` and one explicit `await ctx.parallel(effects)`.
The request and result schemas are declared in `src/schemas.ts`.

## Request and response

Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.

| Request | Expected response |
|---|---|
| empty<br><code>POST /probe</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"endpoints":[]}</code> | <code>{"status":200,"json":{"results":[]}}</code> |
| dynamic<br><code>POST /probe</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"endpoints":["https://one.example/probe/a","https://two.example/probe/b"]}</code> | <code>{"status":200,"json":{"results":[{"ok":true},{"ok":false}]}}</code> |
| invalid-result<br><code>POST /probe</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"endpoints":["https://one.example/probe/a"]}</code> | <code>{"status":422,"text":"invalid probe data"}</code> |

<!-- pulse-example-view:code -->
## Code

### Handler

<!-- pulse-doc-source: examples/03-fetch-composition/dynamic-probes/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

import type { ProbeInput, ProbeResult } from './schemas.js'
const app = new Pulse({ auto: true })
app.use(async (ctx, next) => {
  ctx.state.set('probe-admitted', 'yes')
  return next()
})
app.post('/probe', async ctx => {
  const input = await ctx.req.json<ProbeInput>('probe.Input')
  const effects = ctx.effects<ProbeResult>({ max: 32 })
  for (const endpoint of input.endpoints) {
    effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
  }
  const results = await ctx.parallel(effects)
  return ctx.json({ results }, { schema: 'probe.Output' })
})
app.error(async (error, ctx, next) => ctx.text('invalid probe data', { status: 422 }))
export default app
```
<!-- /pulse-doc-source -->

### Project config

<!-- pulse-doc-source: examples/03-fetch-composition/dynamic-probes/.pulse/config.ts -->
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
  'node-native': { host: 'node', target: 'native' },
  'node-javascript': { host: 'node', target: 'javascript' },
  'fastly-native': {
    host: 'fastly',
    target: 'native',
    fastly: {
      bindings: {
        backends: {
          'https://one.example': 'origin',
          'https://two.example': 'origin',
        },
      },
    },
  },
  'fastly-javascript': {
    host: 'fastly',
    target: 'javascript',
    fastly: {
      bindings: {
        backends: {
          'https://one.example': 'origin',
          'https://two.example': 'origin',
        },
      },
    },
  },
}))
```
<!-- /pulse-doc-source -->

### Schemas

<!-- pulse-doc-source: examples/03-fetch-composition/dynamic-probes/src/schemas.ts -->
```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface ProbeInput { endpoints: string[] }
export interface ProbeResult { ok: boolean }
export interface ProbeOutput { results: ProbeResult[] }

export default defineSchemaRegistry({
  schemas: {
    'probe.Input': schema<ProbeInput>({
      json: { maxArrayItems: 32, maxStringLength: 2048, maxTextBytes: 65536 },
    }),
    'probe.Result': schema<ProbeResult>(),
    'probe.Output': schema<ProbeOutput>({ json: { maxArrayItems: 32 } }),
  },
})
```
<!-- /pulse-doc-source -->

## Inspect

The selected profile is `node-native`; this checked excerpt identifies its target, provider and recognized capabilities. Paths, hashes and additional inspection fields are omitted.

<!-- pulse-doc-run {"project":"examples/03-fetch-composition/dynamic-probes","args":["inspect","--json"],"display":"pulse inspect --json"} -->
```bash
pulse inspect --json
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
      "fetch",
      "request.json",
      "response.json",
      "response.text",
      "schema.decode",
      "schema.encode",
      "state.set"
    ]
  }
}
```

## Doctor

Check this project and its local toolchain before execution. This selected result is verified by the documentation gate; another machine may report different prerequisite checks.

<!-- pulse-doc-run {"project":"examples/03-fetch-composition/dynamic-probes","args":["doctor","--json"],"display":"pulse doctor --json"} -->
```bash
pulse doctor --json
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

<!-- pulse-doc-run {"project":"examples/03-fetch-composition/dynamic-probes","args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"prepare":["build","--out",".pulse-docs-build","--json"],"display":"pulse build --out .pulse-docs-build\npulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
```bash
pulse build --out .pulse-docs-build
pulse report --artifact .pulse-docs-build/pulse-build.json --json
```
```json
{
  "kind": "pulse.application-report",
  "reportVersion": 1,
  "analytics": {
    "coverage": {
      "handlers": {
        "expected": 3,
        "observed": 3,
        "reason": null,
        "status": "complete"
      }
    }
  }
}
```

Optional offline HTML uses the same retained evidence:

```bash
pulse report --artifact .pulse-docs-build/pulse-build.json --html
```

Review reports before sharing. Missing, stale or incompatible evidence is an error; timings, paths and hashes are not presented as stable output.

## Workflow

From the parent fetch-composition example, with the candidate packages installed:

```sh
pulse test dynamic-probes --profile node-native
pulse test dynamic-probes --profile node-javascript
pulse test dynamic-probes --profile fastly-native
pulse test dynamic-probes --profile fastly-javascript
```

The harness uses fixtures and does not contact external endpoints. Native tests
execute the compiled artifact. In a real deployment, configure the provider's
outbound transport and keep endpoint inputs bounded and appropriate for the
application's authority. Fastly profiles here map both example origins to the
existing single `origin` backend; configure that backend before deployment.
Collections do not add runtime selection among multiple Fastly Native backends.

```ts
const input = await ctx.req.json<ProbeInput>('probe.Input')
const effects = ctx.effects<ProbeResult>({ max: 32 })
for (const endpoint of input.endpoints) {
  effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
}
const results = await ctx.parallel(effects)
return ctx.json({ results }, { schema: 'probe.Output' })
```

An empty list returns no results. Completion order does not change result order.
An individual failure fails the group after settlement. Capacity, cumulative
effect limits and request cancellation remain enforced. This example supplies
the generic fan-out building block; it does not deploy a tick/uptime service.

The harness also checks schema failure through the composed middleware and error
handler. Native test profiles execute the compiled Wasm artifact.

From this subdirectory, with the matching candidate CLI available, the ordinary lifecycle is:

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
```

Stop the foreground development server before building:

```bash
pulse build
```

## Test result

<!-- pulse-doc-run {"project":"examples/03-fetch-composition/dynamic-probes","args":["test","--json"]} -->
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
  }
}
```

## Test harness

<!-- pulse-doc-source: examples/03-fetch-composition/dynamic-probes/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'empty',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":[]}',
      },
      expect: { status: 200, json: { results: [] } },
    },
    {
      name: 'dynamic',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":["https://one.example/probe/a","https://two.example/probe/b"]}',
      },
      fetches: {
        'https://one.example/probe/a': { value: { ok: true }, delayMs: 10 },
        'https://two.example/probe/b': { value: { ok: false }, delayMs: 1 },
      },
      expect: { status: 200, json: { results: [{ ok: true }, { ok: false }] } },
    },
    {
      name: 'invalid-result',
      request: {
        method: 'POST',
        path: '/probe',
        headers: { 'content-type': 'application/json' },
        body: '{"endpoints":["https://one.example/probe/a"]}',
      },
      fetches: {
        'https://one.example/probe/a': { value: { ok: 'invalid' } },
      },
      expect: { status: 422, text: 'invalid probe data' },
    },
  ],
}
```
<!-- /pulse-doc-source -->

## Wasm size

Measured application guest: **86,361 bytes** by default and **71,626 bytes** with `--experimental-native-size`. These are compiled artifact sizes, not transfer or runtime memory estimates.
