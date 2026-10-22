# Opaque binary proxy

<!-- pulse-example-template:v1 -->

Returns an origin response directly. The binary or streaming body stays
host-owned and is never decoded or copied into user scope.

## Request and response

Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.

| Request | Expected response |
|---|---|
| pass-through<br><code>GET /archive</code> | <code>{"status":206,"bodyClass":"opaque","headers":[["x-part",["one","two"]]]}</code> |

<!-- pulse-example-view:code -->
## Code

### Handler

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

### Project config

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

## Inspect

The selected profile is `local`; this checked excerpt identifies its target, provider and recognized capabilities. Paths, hashes and additional inspection fields are omitted.

<!-- pulse-doc-run {"project":"examples/07-opaque-proxy","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
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
    "id": "fastly"
  },
  "compiler": {
    "capabilities": [
      "fetch",
      "response.text"
    ]
  }
}
```

## Doctor

Check this project and its local toolchain before execution. This selected result is verified by the documentation gate; another machine may report different prerequisite checks.

<!-- pulse-doc-run {"project":"examples/07-opaque-proxy","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
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

<!-- pulse-doc-run {"project":"examples/07-opaque-proxy","args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"prepare":["build","--out",".pulse-docs-build","--json"],"display":"npm run build -- --out .pulse-docs-build\nnpm exec -- pulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
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



Fastly builds produce a verified `.pulse-docs-build/bin/main.wasm`. Configured
tests execute through the local-conformance runtime; compiled-target execution
remains in the explicit reality profile.

## Test result

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

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| `canonical-native.wasm` | 2.3 KiB (2,304 bytes) | 2.2 KiB (2,205 bytes) | 4.3% |
| `bin/main.wasm` | 42.8 KiB (43,842 bytes) | 35.8 KiB (36,610 bytes) | 16.5% |

The executable documentation gate rebuilds and measures both variants from this
checkout. The provider artifact includes Fastly transport handling, deadlines,
the complete send-error detail record, and bounded transport diagnostics through
WASI stdout. The clock and stdout imports are checked explicitly. These are
uncompressed on-disk sizes, not transfer sizes or platform limits.
