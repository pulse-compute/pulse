# Hello JSON

<!-- pulse-example-template:v1 -->

The smallest canonical Pulse project: branch on the request path and return JSON or text.

## Request and response

Generated from the executable test harness below; these are tested cases, not an exhaustive route specification.

| Request | Expected response |
|---|---|
| `GET /health` | `{"status":200,"json":{"ok":true}}` |
| `GET /hello` | `{"status":200,"json":{"message":"hello from Pulse"}}` |
| `GET /missing` | `{"status":404,"text":"not found"}` |

<!-- pulse-example-view:code -->
## Code

### Handler

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

### Project config

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

## Inspect

```bash
npm run inspect
```

Inspect describes the configured Node Native target and the recognized response capabilities.
This is a selected JSON excerpt; paths, hashes and other fields are omitted.

<!-- pulse-doc-run {"project":"examples/01-hello-json","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
```bash
npm run inspect -- --json
```
```json
{
  "status": "ok",
  "project": { "target": "native" },
  "provider": { "id": "node" },
  "compiler": { "capabilities": ["response.json", "response.text"] }
}
```

## Doctor

```bash
npm run doctor
```

Doctor checks the project and its local toolchain before execution. This selected
result is checked by the documentation gate; it is not a promise about another machine.

<!-- pulse-doc-run {"project":"examples/01-hello-json","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
```bash
npm run doctor -- --json
```
```json
{
  "status": "passed",
  "summary": { "warnings": 0, "failed": 0 }
}
```

## Report

Build into a separate directory, then review the retained evidence. The report
reads the completed artifact without rebuilding or running the application.
This selected excerpt accounts for all three registered handlers in the build evidence; timings,
paths, hashes and optional evidence are deliberately not presented as stable output.

<!-- pulse-doc-run {"project":"examples/01-hello-json","prepare":["build","--out",".pulse-docs-build","--json"],"args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"display":"npm run build -- --out .pulse-docs-build\nnpm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
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
      "handlers": { "expected": 3, "observed": 3, "status": "complete" }
    }
  }
}
```

Optional offline HTML uses the same retained artifact:

```bash
npm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --html
```

Reports are build-review artifacts; review their contents before sharing.
Missing, stale or incompatible evidence is an error, not permission to invent a report.

## Workflow

Run commands from this example directory after installing the repository dependencies.
The npm scripts use the project-local CLI; Inspect and Doctor commands are shown with their results above.

```bash
npm test
npm run dev
```

While the foreground server is running, request `http://127.0.0.1:8787/health`
or `/hello`. Stop it with **Ctrl+C** before building:

```bash
npm run build
```

## Test result

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

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 2.3 KiB (2,353 bytes) | 2.2 KiB (2,270 bytes) | 3.5% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.9`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.
