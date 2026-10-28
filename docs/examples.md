# Canonical examples

Each example includes a handler, project config and package metadata. Follow its
README for executable checks: most use a `pulse test` harness; context MCP runs
live tool requests against its compiled `application/` project. The documentation
lane verifies the shown CLI results and request evidence.

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
| [`12-pulse-context-mcp`](../examples/12-pulse-context-mcp/) | A read-only MCP server for project starters, cited contracts, examples and diagnostic help. |
| [`13-jwt-es256`](../examples/13-jwt-es256/) | ES256 bearer verification with an explicit guest-linked Native realization. |

For build settings, see [Native build optimization](./reference/native-build-optimization.md).

## Wasm size at a glance

The Native rows show fresh default builds with Node 24.18.0 and lockfile-pinned
AssemblyScript 0.28.18. Values are exact, uncompressed on-disk bytes. Portable
guests and deployable provider modules are separate artifacts; the JWT guest is
the final linked output.

| Example | Default application guest | Default deployable Fastly module |
|---|---:|---:|
| `01-hello-json` | 2,273 bytes | — |
| `02-request-schema` | 32,707 bytes | — |
| `03-fetch-composition` | 4,572 bytes | — |
| `03-fetch-composition/dynamic-probes` | 71,947 bytes | — |
| `05-fastly-capabilities` | 5,181 bytes | 45,928 bytes |
| `07-opaque-proxy` | 2,205 bytes | 36,637 bytes |
| `09-router-lowering` | 7,407 bytes | — |
| `10-entities-tools` | No application Wasm | — |
| `11-events` | 32,458 bytes | — |
| `12-pulse-context-mcp` | See its Report (corpus-dependent) | Explicit `fastly-native` profile |
| `13-jwt-es256` | 35,926 bytes | — |

Run the normal workflow from any example directory:

```bash
pulse doctor
pulse test
pulse dev
pulse build
```

Use `pulse inspect` to examine the plan before building. Most examples record
fixed default byte counts verified by the docs gate. Context MCP
instead reports its completed build: bundled corpus changes affect its size.
See [Project lifecycle](./guides/project-lifecycle.md).

Examples 01, 02, 03, 05, 07, 11, and 13 use current package-root application
surfaces. Example 09 retains the lower-level Router surface. Examples 10 and 12 use
the synchronized `@pulse-compute/entities` Beta package; executable examples do
not themselves authorize publication. Example 11 is executable only through
the Node JavaScript/Native reference adapter. It does not claim a public
listener, delivery, or Fastly/browser/ESP32 event support; see
[Static events and outbound emission](./guides/events.md).

Example 12 serves five read-only MCP tools directly from `application/`, with
Node Native, Node JavaScript and Fastly Native profiles. It uses a bundled corpus
and requires no upstream server. Its README explains installation and shows the
MCP endpoint and request helper.

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
