# Canonical examples

Every top-level example is a complete Pulse project with a handler, config,
tests, TypeScript config, and package metadata. The executable documentation
lane runs every example except 10 through `doctor`, `inspect`, `test`, and
`build`; it also starts the hello project with `dev`, sends a request, and
verifies shutdown. Example 10 uses its focused orchestration proof while
ordinary package-loader and Native-intrinsic integration remain candidate
blockers.

| Example | Demonstrates |
|---|---|
| [`01-hello-json`](../examples/01-hello-json/) | Request branching and JSON/text responses. |
| [`02-request-schema`](../examples/02-request-schema/) | Explicit request and response schemas. |
| [`03-fetch-composition`](../examples/03-fetch-composition/) | One fetch, sequential composition, and explicit `ctx.parallel` concurrency. |
| [`05-fastly-capabilities`](../examples/05-fastly-capabilities/) | Config, secrets, KV, a named backend, and package-root GRIP broadcast. |
| [`07-opaque-proxy`](../examples/07-opaque-proxy/) | Direct binary/stream pass-through without body inspection. |
| [`09-router-lowering`](../examples/09-router-lowering/) | Mounted routes, scoped terminal middleware, fallthrough, error transfer, parameters, wildcards, and entry-aware effects. |
| [`10-entities-tools`](../examples/10-entities-tools/) | Experimental schema-bound entities, deterministic catalog discovery, JSON-RPC dispatch, and an external tools facade. |
| [`11-events`](../examples/11-events/) | Static event ingress, schema/no-payload frames, exact outbound acceptance, and separate HTTP/event entries. |
| [`12-mcp-proxy`](../examples/12-mcp-proxy/) | A bounded JSON-RPC request seam and opaque upstream response pass-through. |
| [`13-jwt-es256`](../examples/13-jwt-es256/) | ES256 bearer verification with an explicit guest-linked Native realization. |

## Wasm size at a glance

The Native rows compare the ordinary build with
`pulse build --experimental-native-size`. Values are uncompressed on-disk
sizes; each example page includes exact byte counts.

| Example | Default Native Wasm | Size-optimized Native Wasm | Reduction | Deployable Fastly module |
|---|---:|---:|---:|---:|
| `01-hello-json` | 2.1 KiB | 2.0 KiB | 3.8% | — |
| `02-request-schema` | 40.0 KiB | 31.8 KiB | 20.4% | — |
| `03-fetch-composition` | 4.9 KiB | 4.2 KiB | 13.7% | — |
| `05-fastly-capabilities` | 5.3 KiB | 4.8 KiB | 9.4% | 45.8 → 38.0 KiB |
| `07-opaque-proxy` | 2.1 KiB | 2.1 KiB | 4.5% | 33.9 → 29.2 KiB |
| `09-router-lowering` | 9.0 KiB | 8.4 KiB | 6.6% | — |
| `10-entities-tools` | — | — | Not applicable | JavaScript-first candidate |
| `11-events` | 39.6 KiB | 31.6 KiB | 20.2% | — |
| `12-mcp-proxy` | 2.5 KiB | 2.4 KiB | 6.6% | — |
| `13-jwt-es256` | 38.4 KiB | 38.2 KiB | 0.5% | — |

Run the normal workflow from any example directory:

```bash
pulse doctor
pulse test
pulse dev
pulse build
```

Use `pulse inspect` when you need to examine the plan; it is not required before
`build`. Each example README contains exact source-bound handler/config blocks
and executable evidence selected by the docs lane. Every page also records the
default and experimental size-optimized Wasm outputs; Fastly pages separate the
provider-neutral guest from the deployable module, and the JavaScript-first
Entities page explicitly records that no comparable application Wasm is
emitted. The same gate rebuilds and verifies every exact byte count. See
[Project lifecycle](./guides/project-lifecycle.md).

Examples 01, 02, 03, 05, 07, 11, 12, and 13 use current package-root application
surfaces. Example 09 retains the lower-level Router surface. Example 10 uses
the synchronized `@pulse-compute/entities` Beta package; executable examples do
not themselves authorize publication. Example 11 is executable only through
the Node JavaScript/Native reference adapter. It does not claim a public
listener, delivery, or Fastly/browser/ESP32 event support; see
[Static events and outbound emission](./guides/events.md).

Example 12 is an MCP-shaped HTTP proxy, not an MCP server. The incoming body is
materialized once as bounded text because Pulse has no opaque incoming-body
forwarding contract; the fetched response remains opaque.

Example 13 pins the guest-linked ES256 realization for Native. Its harness
executes valid, invalid-signature, and disallowed-algorithm cases against the
exact linked artifact; only the public P-256 JWK is included in the example.

## Verified native Fastly build

This documented build is executed against the config/secret example and must
produce the configured-provider native Fastly module. The portable compiler
runs before the exact artifact crosses the provider boundary; the provider
target receives no compiler service and does not invoke one.

<!-- pulse-doc-run {"project":"examples/05-fastly-capabilities","args":["build","--out",".pulse-docs-build","--json"],"timeoutMs":360000} -->
```bash
pulse build --out .pulse-docs-build --json
```
```json
{
  "status": "built",
  "provider": "fastly",
  "manifest": {
    "providerTarget": {
      "sourceOnly": false,
      "compiledWasmPresent": true,
      "target": "fastly-compute-native",
      "javascriptRuntime": false,
      "compiler": {
        "package": "assemblyscript",
        "version": "0.28.18",
        "invoked": false
      },
      "wasm": {
        "file": "bin/main.wasm",
        "magic": "0061736d01000000"
      }
    }
  }
}
```

Fastly configured tests and `pulse dev` use the local-conformance runtime. The separate reality profile delegates execution of the native provider module to `fastly compute serve`.
