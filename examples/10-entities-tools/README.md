# Entities tools facade

This experimental example declares two schema-bound operations with
`@pulse-compute/entities`, exposes them through the first-party JSON-RPC
adapter, and projects their emitted static catalog into a dependency-free tools
facade. The facade invokes the governed request boundary; it does not call
application handlers directly.

The application contributes:

- `system.status`, which accepts no input and completes with `null`;
- `customer.lookup`, which validates named input and output and performs one
  governed `ctx.fetch` effect.

## Candidate workflow

```bash
pulse inspect
node ../../wasm/scripts/run-wasm-tests.cjs --task entities-orchestration-demo --no-report
```

`pulse inspect` reports the static entity catalog, declared schemas, handler
effects, and target evidence. The focused orchestration gate builds and consumes
the catalog, invokes both operations through the Node JavaScript request
boundary, validates the governed fetch, and compiles/inspects the package-owned
Native artifact.

The ordinary JavaScript `test`/`dev` application loader currently requests the
unexported physical package entry, and ordinary Native builds do not yet adopt
the Entities intrinsic. I11 records those product-integration blockers instead
of widening package exports or compiler/provider authority. A JavaScript build
can still emit the source package, catalog, and inspection artifacts; no command
may fall back to another target.

## Wasm size

The default `node-javascript` profile emits **no application Wasm artifact**.
The ordinary `node-native` build currently fails closed at the unadopted
Entities intrinsic. The focused gate's package-owned Native artifact exercises
a different boundary and is not comparable to an emitted application guest.
Consequently, `--experimental-native-size` has no application artifact to
optimize for this example.

## Entity application

<!-- pulse-doc-source: examples/10-entities-tools/src/index.ts -->
```ts
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { lookupCustomer, systemStatus } from './handlers.js'

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true }),
})

rpc.on('system.status', {
  input: null,
  output: null,
  metadata: {
    title: 'Check system status',
    description: 'Checks that the governed entity request boundary is available.',
    mcp: { readOnlyHint: true },
  },
}, systemStatus)

rpc.on('customer.lookup', {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
  metadata: {
    title: 'Look up customer',
    description: 'Looks up one customer through the configured directory backend.',
    mcp: { readOnlyHint: true },
  },
}, lookupCustomer)

export default async function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/10-entities-tools/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-javascript',
    strict: true,
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-node-javascript',
    dev: { networkFetch: false },
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    dev: { networkFetch: false },
  },
}))
```
<!-- /pulse-doc-source -->

## Test harness

<!-- pulse-doc-source: examples/10-entities-tools/tests/pulse.harness.ts -->
```ts
export default { cases: [
  {
    name: 'system-status',
    request: {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'system.status', id: 'status-doc' }),
    },
    expect: {
      status: 200,
      json: { jsonrpc: '2.0', result: null, id: 'status-doc' },
    },
  },
  {
    name: 'customer-lookup',
    request: {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'customer.lookup',
        params: { email: 'ada@example.test' },
        id: 'lookup-doc',
      }),
    },
    fetches: {
      'https://directory.example.test/customers/ada@example.test': { value: 'Ada Lovelace' },
    },
    expect: {
      status: 200,
      json: {
        jsonrpc: '2.0',
        result: { email: 'ada@example.test', displayName: 'Ada Lovelace' },
        id: 'lookup-doc',
      },
    },
  },
] }
```
<!-- /pulse-doc-source -->

## Facade boundary

`tools-facade.cjs` is an orchestration example, not a complete MCP server. It
does not add listeners, SSE, sessions, tasks, resources, prompts, sampling,
authorization, transport negotiation, or protocol lifecycle state to Pulse
runtime core. A future MCP or tools facade remains an adapter outside the
entity engine, just as a future Worker/event adapter would bind a different
request or event protocol without changing entity handler semantics.
