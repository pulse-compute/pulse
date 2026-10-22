# Pulse context MCP server

<!-- pulse-example-template:v1 -->
<!-- pulse-example-requests:authored -->

A read-only MCP server that helps you start a Pulse project, find contracts,
and retrieve maintained examples. It demonstrates schema-bound tools, shared
`ctx.call` computations, and a bundled documentation corpus.

Run the project in **`application/`**. Node Native is the default; Node
JavaScript and Fastly Native are explicit alternatives.

| Tool | Use it to |
|---|---|
| `pulse.start` | Get a project plan for a JSON, schema, fetch or router API. |
| `pulse.search` | Find cited contracts with keyword search. |
| `pulse.read` | Read a contract by its returned ID. |
| `pulse.example` | Retrieve maintained starter files. |
| `pulse.diagnostic` | Explain a Pulse diagnostic and its suggested local checks. |

## Request and response

With the server running, ask for a Node Native starter. Run this from
`application/` in a second terminal:

```bash
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.start '{"version":"1.0.0-beta.9","goal":"json-api","provider":"node","target":"native"}'
```

Selected fields from the successful response:

```json
{
  "structuredContent": {
    "status": "ok",
    "plan": {
      "goal": "json-api",
      "provider": "node",
      "target": "native",
      "exampleId": "01-hello-json"
    }
  }
}
```

The full result includes dependencies, configuration, commands and citations.
It returns a plan; it does not create files or run commands for you.

<!-- pulse-example-view:code -->
## Code

### Application

Each tool calls a computation through `ctx.call`; the MCP binding exposes the
router at `/mcp`.

<!-- pulse-doc-source: examples/12-pulse-context-mcp/application/src/index.ts -->
```ts
import { EntityRouter, jsonRpc, mcp } from '@pulse-compute/mcp/pulse'
import type { PulseContext, PulseReadonly } from '@pulse-compute/pulse'
import type {
  StartInput,
  SearchInput,
  ReadInput,
  ExampleInput,
  DiagnosticInput
} from './schemas.js'
import { computeStart } from './start.js'
import { computeSearch } from './search.js'
import { computeRead } from './read.js'
import { computeExample } from './example.js'
import { computeDiagnostic } from './diagnostic.js'

export async function start(ctx: PulseContext, input: PulseReadonly<StartInput>) {
  return ctx.call(computeStart, input, {
    inputSchema: 'context.StartInput', outputSchema: 'context.StartOutput',
  })
}
export async function search(ctx: PulseContext, input: PulseReadonly<SearchInput>) {
  return ctx.call(computeSearch, input, {
    inputSchema: 'context.SearchInput', outputSchema: 'context.SearchOutput',
  })
}
export async function read(ctx: PulseContext, input: PulseReadonly<ReadInput>) {
  return ctx.call(computeRead, input, {
    inputSchema: 'context.ReadInput', outputSchema: 'context.ReadOutput',
  })
}
export async function example(ctx: PulseContext, input: PulseReadonly<ExampleInput>) {
  return ctx.call(computeExample, input, {
    inputSchema: 'context.ExampleInput', outputSchema: 'context.ExampleOutput',
  })
}
export async function diagnostic(ctx: PulseContext, input: PulseReadonly<DiagnosticInput>) {
  return ctx.call(computeDiagnostic, input, {
    inputSchema: 'context.DiagnosticInput', outputSchema: 'context.DiagnosticOutput',
  })
}
const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on('pulse.start', {
  input: 'context.StartInput', output: 'context.StartOutput',
  metadata: {"title":"Start a Pulse project","description":"Return a Node Native or JavaScript starter plan for this exact snapshot.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, start)
rpc.on('pulse.search', {
  input: 'context.SearchInput', output: 'context.SearchOutput',
  metadata: {"title":"Search Pulse contracts","description":"Exact-token sparse lexical search with integer ranking, cited excerpts and offset pagination; not semantic search.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, search)
rpc.on('pulse.read', {
  input: 'context.ReadInput', output: 'context.ReadOutput',
  metadata: {"title":"Read a Pulse contract","description":"Read one cited corpus ID; continue with the returned UTF-16 nextOffset.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, read)
rpc.on('pulse.example', {
  input: 'context.ExampleInput', output: 'context.ExampleOutput',
  metadata: {"title":"Retrieve a Pulse example","description":"Retrieve maintained starter files by exact corpus ID, with pagination.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, example)
rpc.on('pulse.diagnostic', {
  input: 'context.DiagnosticInput', output: 'context.DiagnosticOutput',
  metadata: {"title":"Explain a Pulse diagnostic","description":"Explain an exact diagnostic with citations and suggested local checks.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, diagnostic)
const server = mcp({
  router: rpc,
  serverInfo: {"name":"pulse-context","version":"1.0.0-beta.9"},
  limits: {"maxRequestBytes":32768,"maxResponseBytes":131072,"maxDepth":32,"deadlineMs":5000},
})
export default async function handler(ctx: PulseContext) {
  return server.handle(ctx)
}
```
<!-- /pulse-doc-source -->

### Project config

The bundled [config](./application/.pulse/config.ts) selects a profile and binds
three immutable corpus resources. Keep `application/` and `context-data/` together
when copying the example.

| Profile | Execution |
|---|---|
| `node-native` (default) | Native Wasm on Node |
| `node-javascript` | Explicit JavaScript on Node |
| `fastly-native` | Native Wasm for Fastly Compute |

## Inspect

Run these commands from `application/`. This excerpt identifies the default target.

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp/application","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
```bash
npm run inspect -- --json
```
```json
{"status":"ok","project":{"target":"native"},"provider":{"id":"node"}}
```

## Doctor

Check the selected profile and local toolchain. The example has no `pulse test`
harness; its live MCP requests are checked by the executable documentation gate.

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp/application","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
```bash
npm run doctor -- --json
```
```json
{"status":"warning","summary":{"failed":0}}
```

## Report

Build the selected profile, then inspect that completed artifact:

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp/application","prepare":["build","--out",".pulse-docs-build","--json"],"args":["report","--artifact",".pulse-docs-build/pulse-build.json","--json"],"display":"npx pulse report --artifact .pulse-docs-build/pulse-build.json --json"} -->
```bash
npx pulse report --artifact .pulse-docs-build/pulse-build.json --json
```
```json
{"kind":"pulse.application-report","reportVersion":1}
```

The website's Report tab captures this Node Native build. Corpus resources
contribute to artifact size; consult the report for measured bytes and coverage.
To generate a report locally, first run
`npm run build -- --out .pulse-docs-build`, then the command above.

## Install

Use Node 22.14+ or Node 24. Copy the complete `examples/12-pulse-context-mcp/`
directory from the matching CLI package, including `application/`, `client/`
and `context-data/`, then:

```bash
cd application
npm install
```

This source preview uses the exact `1.0.0-beta.9` candidate dependencies. Obtain
matching candidate packages from the release owner; a matching version string
alone does not identify the same build. The bundled corpus needs no upstream
service or credentials.

## Workflow

<a id="compiled-application-workflow"></a>

From `application/`:

```bash
npm run doctor
npm run inspect
npm run build
npm run dev
```

Connect a compatible MCP HTTP client to **`http://127.0.0.1:8787/mcp`**, or use
the included request helper from another terminal:

```bash
node ../client/request.cjs --url http://127.0.0.1:8787/mcp tools/list
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.search '{"version":"1.0.0-beta.9","query":"schema","limit":2}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.read '{"version":"1.0.0-beta.9","id":"contract/application"}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.example '{"version":"1.0.0-beta.9","id":"01-hello-json"}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.diagnostic '{"version":"1.0.0-beta.9","code":"PULSE_CALL_SOURCE_LIMIT"}'
```

Use the corpus's exact version and check each tool's `structuredContent.status`.
For paged results, follow `nextOffset` with the same version and selection.
Search matches keywords, not semantic embeddings.

Stop the server before changing profiles. For Node JavaScript, append
`-- --profile node-javascript` to the same npm commands. For Fastly:

```bash
npm run build -- --profile fastly-native
cd dist-fastly-native
fastly compute serve --file bin/main.wasm --addr 127.0.0.1:8787
```

This runs Fastly locally. See [Deploying to Fastly](../../docs/guides/deploying-fastly.md)
for deployment. The example serves public documentation without authentication
and rejects requests with an Origin header. See the [MCP package guide](../../docs/packages/mcp.md)
for protocol options and supported clients.

## Maintaining the snapshot

Corpus regeneration, compatibility fixtures and qualification details are in the
[repository maintenance notes](../../docs/internal/mcp-context-example.md).
