# MCP-shaped HTTP proxy

Forwards one JSON-RPC-shaped HTTP request to an upstream endpoint and returns
the upstream response without inspecting it. This is intentionally not a full
MCP server: it has no SSE, sessions, discovery, tools catalog, authorization,
or protocol lifecycle state.

Pulse does not expose an opaque incoming-body handle. The request body crosses
one bounded `ctx.req.text()` materialization seam before the outbound POST. The
upstream response remains provider-owned and opaque.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/12-mcp-proxy","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 1,
    "passed": 1,
    "failed": 0
  },
  "cases": [
    {
      "name": "json-rpc-pass-through",
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
| `canonical-native.wasm` | 2.5 KiB (2,589 bytes) | 2.4 KiB (2,418 bytes) | 6.6% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.1`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

<!-- pulse-doc-source: examples/12-mcp-proxy/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.post('/mcp', async (ctx) => {
  const body = await ctx.req.text()
  return ctx.fetch('https://mcp.example.test/rpc', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body,
  })
})

export default app
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/12-mcp-proxy/.pulse/config.ts -->
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
    dev: {
      fetches: {
        'POST https://mcp.example.test/rpc': {
          opaque: true,
          status: 200,
          headers: [['content-type', 'application/json']],
          chunks: ['{"jsonrpc":"2.0","result":{},"id":1}'],
        },
      },
    },
  },
}))
```
<!-- /pulse-doc-source -->

## Test harness

<!-- pulse-doc-source: examples/12-mcp-proxy/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'json-rpc-pass-through',
      request: {
        method: 'POST',
        path: '/mcp',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      },
      fetches: {
        'POST https://mcp.example.test/rpc': {
          opaque: true,
          status: 200,
          headers: [['content-type', 'application/json']],
          chunks: ['{"jsonrpc":"2.0","result":{},"id":1}'],
        },
      },
      expect: {
        status: 200,
        bodyClass: 'opaque',
      },
    },
  ],
}
```
<!-- /pulse-doc-source -->
