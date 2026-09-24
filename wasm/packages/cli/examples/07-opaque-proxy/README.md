# Opaque binary proxy

Returns an origin response directly. The binary or streaming body stays
host-owned and is never decoded or copied into user scope.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented test result below is executed by the documentation gate.

<!-- pulse-doc-run {"project":"examples/07-opaque-proxy","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "fastly",
  "summary": {
    "total": 1,
    "passed": 1,
    "failed": 0
  },
  "cases": [
    {
      "name": "pass-through",
      "status": "passed",
      "response": {
        "status": 206
      }
    }
  ]
}
```

Fastly builds produce a verified `.pulse-docs-build/bin/main.wasm`. Configured
tests execute through the local-conformance runtime; compiled-target execution
remains in the explicit reality profile.

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 2.3 KiB (2,304 bytes) | 2.2 KiB (2,205 bytes) | 4.3% |
| `bin/main.wasm` | 33.9 KiB (34,718 bytes) | 29.3 KiB (29,992 bytes) | 13.6% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.5`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits.

## Handler

<!-- pulse-doc-source: examples/07-opaque-proxy/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/archive', async (ctx) => {
  return ctx.fetch('https://assets.example.com/archive.bin')
})

export default app
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/07-opaque-proxy/.pulse/config.ts -->
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
    host: 'fastly',
    target: 'native',
    outDir: 'dist',
    dev: {
      fetches: {
        'https://assets.example.com/archive.bin': {
          opaque: true,
          status: 206,
          headers: [
            ['content-type', 'application/octet-stream'],
            ['x-part', 'one'],
            ['x-part', 'two'],
          ],
          chunks: ['opaque-example'],
        },
      },
    },
    fastly: {
      bindings: {
        backends: {
          'https://assets.example.com': 'assets_backend',
        },
        dynamicBackends: false,
      },
      build: { name: 'pulse-opaque-proxy-example' },
    },
  },
}))
```
<!-- /pulse-doc-source -->


## Test harness

<!-- pulse-doc-source: examples/07-opaque-proxy/tests/pulse.harness.ts -->
```ts
export default {
  cases: [
    {
      name: 'pass-through',
      request: { path: '/archive' },
      fetches: {
        'https://assets.example.com/archive.bin': {
          opaque: true,
          status: 206,
          headers: [
            ['content-type', 'application/octet-stream'],
            ['x-part', 'one'],
            ['x-part', 'two'],
          ],
          chunks: ['opaque-example'],
        },
      },
      expect: {
        status: 206,
        bodyClass: 'opaque',
        headers: { 'x-part': ['one', 'two'] },
      },
    },
  ],
}
```
<!-- /pulse-doc-source -->
