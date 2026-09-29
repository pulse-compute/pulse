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

## JavaScript workflow

Install the example's declared dependencies, then run the ordinary lifecycle
from this directory. The default profile is `node-javascript`:

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

`pulse doctor` checks the selected JavaScript target and reports Native
eligibility separately.
`pulse inspect` reports the static entity catalog, declared schemas, handler
effects, and target evidence. `pulse test` invokes both operations through the
Node JavaScript request boundary. The lookup fixture supplies plain text because
its handler consumes `ctx.fetch(...).text()`; a `value` fixture would encode a
JSON string, including quotes.

<!-- pulse-doc-run {"project":"examples/10-entities-tools","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{"status":"passed","provider":"node","target":"javascript","summary":{"total":2,"passed":2,"failed":0}}
```

During `pulse dev`, send a JSON-RPC `system.status` request to check the live
boundary. The harness's lookup fixture applies only to `pulse test`;
`customer.lookup` needs a configured development fetch fixture or backend.
This example disables development network fetches by default. Stop the dev
server before continuing to `pulse build`.

The JavaScript build emits the source package, catalog, and inspection
artifacts.

## Node Native workflow

Select the existing `node-native` profile to compile and execute the package-owned
dispatcher through the ordinary CLI:

```bash
pulse doctor --profile node-native
pulse inspect --profile node-native
pulse test --profile node-native
pulse dev --profile node-native
pulse build --profile node-native
```

The build emits `dist-node-native/canonical-native.wasm` and its Native plan,
catalog, and inspection artifacts. Tests and development execute this generated
guest through the canonical Node host. The guest selects the operation, validates
its schemas, suspends for governed effects, and frames the response. Test JSON
records the plan hash and executed Wasm hash. Native never falls back to
JavaScript. Ordinary Fastly Native integration remains separate.

Maintainers can also run the package-owned orchestration proof from this
source checkout:

```bash
node ../../wasm/scripts/run-wasm-tests.cjs --task entities-orchestration-demo --no-report
```

That proof consumes the catalog through the tools facade and compiles/inspects
the package-owned Native artifact. It supplements the ordinary JavaScript
workflow above; ordinary Node Native execution has its own lifecycle gate.

## Wasm size

The default `node-javascript` profile emits **no application Wasm artifact**.
Select `node-native` to emit an application guest. `--experimental-native-size`
is meaningful only on that Native profile; the default JavaScript build has
no application guest to optimize.

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
      'https://directory.example.test/customers/ada@example.test': { text: 'Ada Lovelace' },
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
