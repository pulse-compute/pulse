# Pulse context MCP server

Start a Pulse project with cited contracts and maintained examples. This app
serves five read-only tools from an immutable bundled snapshot: `pulse.start`,
`pulse.search`, `pulse.read`, `pulse.example`, and `pulse.explain_diagnostic`.
The handlers are an ordinary schema-bound Entities application. The separate
host uses `@pulse-compute/mcp/node` and the public Node launcher; every tool
crosses the app's HTTP boundary.

## Install

Use Node 22.14+ or Node 24. Copy this complete example from the matching CLI
package's `examples/12-pulse-context-mcp/` directory into a new directory. The
corpus, host and request helper are included; no repository checkout, upstream
server, credentials or global Pulse installation is needed at runtime.

**Candidate status:** all Pulse dependencies, including MCP, use the exact
`1.0.0-beta.7` synchronized candidate version. Registry installation becomes
available after release-owner bootstrap, trusted-publisher setup and publication.
Until then, use matching candidate packages through the candidate registry.
PMCP-07 owns the installed context-app onboarding journey. The install command is:

```bash
npm install
```

Do not substitute an older CLI or an unrelated MCP package. This README's
context version is `1.0.0-beta.7` with snapshot status `candidate`; check the
readiness response for the bundled version before calling tools.

## Workflow

Run the example's local CLI scripts:

```bash
npm run doctor
npm run inspect
npm test
npm run dev
```

`doctor` reports `canonical-native-plan` as a warning because the selected
JavaScript app is not Native eligible. That warning does not select a fallback.

`dev` serves the underlying JSON-RPC application on loopback, with network fetch
disabled. It is useful for developing handlers; the MCP endpoint is supplied by
`start`. Stop the foreground dev process before continuing:

```bash
npm run build
npm start
```

`build` runs `pulse build` and prepares the deterministic host identity file in
`dist-node-javascript/`. This is ordinary app packaging.
Startup prints a JSON `ready` event with endpoint, build identity and corpus
version/hash. The default MCP endpoint is `http://127.0.0.1:8788/mcp`.

In another terminal:

```bash
curl http://127.0.0.1:8788/_pulse/ready
node client/request.cjs server/discover
node client/request.cjs tools/list
```

The included Node request helper sends the modern protocol headers and metadata,
prints JSON results, and reports transport/protocol errors with a nonzero exit.
Tool results carry `structuredContent`; check its `status` before using its
content. Pass `--url URL` before the operation to use the endpoint printed by readiness
when using another port. These same tools can be used by an MCP client pointed at the local HTTP
endpoint. Modern framing is the default, including the qualified Claude client.
For the pinned Codex compatibility profile, start with `npm start -- --codex`.

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{"status":"passed","provider":"node","target":"javascript","summary":{"total":2,"passed":2,"failed":0}}
```

## Walkthrough 1: start a JSON API

Ask for a Node Native plan with an explicit goal and exact corpus version:

```bash
node client/request.cjs pulse.start '{"version":"1.0.0-beta.7","goal":"json-api","provider":"node","target":"native"}'
node client/request.cjs pulse.example '{"version":"1.0.0-beta.7","id":"01-hello-json"}'
```

The plan selects `01-hello-json`, gives imports, exact dependency versions,
configuration, contract citations, local command steps and unresolved choices.
`pulse.example` returns maintained file/workflow records and `availableIds`.
Follow `nextOffset` with the same version/selection until `truncated` is false;
use `pulse.read` for a file that needs content pagination. Copy the selected
files to your own directory, decide your routes and response contracts, then
run the plan's install/test/dev/build commands locally. The server returns
context; it does not create the project or run those commands.

## Walkthrough 2: choose Native or JavaScript explicitly

Compare the same starter across the two targets:

```bash
node client/request.cjs pulse.start '{"version":"1.0.0-beta.7","goal":"schema-api","provider":"node","target":"native"}'
node client/request.cjs pulse.start '{"version":"1.0.0-beta.7","goal":"schema-api","provider":"node","target":"javascript"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.7","id":"contract/eligibility"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.7","id":"node/javascript"}'
```

Both plans select `02-request-schema`. Its maintained files remain Node Native;
the JavaScript plan explicitly changes `local.target` and records that change
in `configuration.changedFields`. Retrieve those original files without a
JavaScript applicability filter, then apply the returned configuration yourself.
Native requires proven compilation eligibility and never silently falls back.
JavaScript retains its resolved static source graph and ordinary awaited calls;
inspection describes recognized Pulse behavior rather than proving dependency
internals. These are starter choices; this context server itself selects Node
JavaScript and does not claim Native eligibility.

## Walkthrough 3: understand a schema or effect diagnostic

Use the exact code reported by your local CLI, then read the cited boundary:

```bash
node client/request.cjs pulse.explain_diagnostic '{"version":"1.0.0-beta.7","code":"PULSE_SCHEMA_COMPILE_FAILED"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.7","id":"schema/boundaries"}'
node client/request.cjs pulse.explain_diagnostic '{"version":"1.0.0-beta.7","code":"PULSE_PACKAGE_LOWERING_FAILED"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.7","id":"contract/effects"}'
```

A schema explanation supplies the canonical diagnostic, remediation and related
schema contracts. A package lowering explanation points to the reported call
shape and its explicit effect contract; it does not infer a fix without the
local nested diagnostic. Read `contract/effects` to review governed operations.
`nextLocalChecks` suggests `pulse doctor --json`; run it in your project yourself.
For catalog entries without textual summaries, `summaryAvailable: false` is
explicit. Unknown codes or versions return an error status without a substitute.

Every reply includes corpus version/hash and candidate status. Returned records
include source and content SHA-256 hashes and immutable Git blob citations;
selected documentation records also identify heading and source line range.
Use those returned citations when explaining a contract. They identify the
snapshot's exact bytes, not a mutable latest page or your project's current state.

## Tool contract and limits

| Tool | Selection and continuation |
| --- | --- |
| `pulse.start` | Four goals: `json-api`, `schema-api`, `fetch-api`, `router-api`; Node plus explicit `native` or `javascript`. |
| `pulse.search` | Lexical query, optional category and paired provider/target; at most five excerpts, ranked deterministically. |
| `pulse.read` | One exact corpus ID; content `offset` is the returned UTF-16 position. No arbitrary paths or URLs. |
| `pulse.example` | One of four maintained starters; optional `files` are exact IDs from `availableIds`; record `offset` continues the selection. |
| `pulse.explain_diagnostic` | One exact public diagnostic code; canonical evidence, remediation and suggested local checks. |

Every call requires the exact `version`. Search accepts at most 256 UTF-8 bytes
and eight terms; excerpts are at most 384 bytes. Read pages allow 12 KiB raw /
16 KiB escaped content; application replies are at most 24 KiB. Preserve version,
query and selection when following `nextOffset`. Hashes identify the complete
record even when a page is truncated.

The corpus is generated from an explicit allowlist of public contract sections,
package/provider metadata, CLI commands/diagnostics and four maintained starters.
It has no runtime generator, repository crawler or external index. The snapshot
has 220 records and remains explicitly a candidate. No client filesystem,
process execution, build, doctor, inspection, outbound fetch, Resources, Prompts
or stdio capability is exposed. Command descriptions are context, not authority.

## Standalone host

`start` needs only `host/`, the prepared build directory and matching runtime
dependencies. A copied build can be started outside the source project:

```bash
node host/start.cjs --build-dir /absolute/path/to/trusted-build --port 8788
```

The host verifies bounded artifact identities and a read-only corpus probe before
opening MCP admission. Both listeners are fixed loopback: MCP port 8788 by default
(`--port 0` selects an ephemeral port), backend on an ephemeral port. No client
can select a backend destination. Readiness is `GET`/`HEAD /_pulse/ready` with
`no-store`; startup disagreement or occupied ports fails without a ready event.

MCP requests/responses are capped at 32/128 KiB, depth 32, with a five-second
request budget, 16 concurrent requests, 64 connections and 16 KiB headers.
Supplied Origins are rejected. SIGINT/SIGTERM withdraw readiness and drain MCP
then backend for one second each. Graceful shutdown exits zero; forced shutdown
or startup failure exits one. Budgets revoke Pulse-owned asynchronous work and
do not preempt synchronous JavaScript. Remote deployment and authentication
require a separate deployment design.

## Wasm size

This explicit Node JavaScript profile emits **no application Wasm artifact**.
`--experimental-native-size` does not apply. Switching this app to Native fails
eligibility rather than selecting JavaScript automatically.

## Entity application

<!-- pulse-doc-source: examples/12-pulse-context-mcp/src/index.ts -->
```ts
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { start, search, read, example, explainDiagnostic } from './handlers.js'

const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on(
  'pulse.start',
  {
    input: 'context.StartInput',
    output: 'context.StartOutput',
    metadata: {
      title: 'Start a Pulse project',
      description:
        'Return a Node Native or JavaScript starter plan for this exact snapshot.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  start,
)
rpc.on(
  'pulse.search',
  {
    input: 'context.SearchInput',
    output: 'context.SearchOutput',
    metadata: {
      title: 'Search Pulse context',
      description: 'Search bundled context with ranked excerpts and explicit pagination.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  search,
)
rpc.on(
  'pulse.read',
  {
    input: 'context.ReadInput',
    output: 'context.ReadOutput',
    metadata: {
      title: 'Read a Pulse contract',
      description:
        'Read one cited corpus ID; continue with the returned UTF-16 nextOffset.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  read,
)
rpc.on(
  'pulse.example',
  {
    input: 'context.ExampleInput',
    output: 'context.ExampleOutput',
    metadata: {
      title: 'Retrieve a Pulse example',
      description:
        'Retrieve maintained starter files by exact corpus ID, with pagination.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  example,
)
rpc.on(
  'pulse.explain_diagnostic',
  {
    input: 'context.DiagnosticInput',
    output: 'context.DiagnosticOutput',
    metadata: {
      title: 'Explain a Pulse diagnostic',
      description:
        'Explain an exact diagnostic with citations and suggested local checks.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  explainDiagnostic,
)

export default function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/12-pulse-context-mcp/.pulse/config.ts -->
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
    schemas: { maxBytes: 65536 },
    dev: { host: '127.0.0.1', networkFetch: false },
  },
}))
```
<!-- /pulse-doc-source -->

## Test harness

<!-- pulse-doc-source: examples/12-pulse-context-mcp/tests/pulse.harness.ts -->
```ts
import { contextCorpus } from '../context-corpus.ts'

const meta = {
  pulseVersion: contextCorpus.pulseVersion,
  corpusSchemaVersion: contextCorpus.schemaVersion,
  corpusHash: contextCorpus.corpusHash,
  snapshotStatus: contextCorpus.status,
  applicationVersion: 'pulse.context-application.v1',
  requestedVersion: contextCorpus.pulseVersion,
  maxReplyBytes: 24576,
}

export default {
  cases: [
    {
      name: 'unknown-record',
      request: {
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'pulse.read',
          params: { version: contextCorpus.pulseVersion, id: 'missing' },
        }),
      },
      expect: {
        status: 200,
        json: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            meta,
            status: 'unknown-id',
            truncated: false,
            error: {
              code: 'unknown-id',
              message: 'No bundled record has that exact ID.',
            },
          },
        },
      },
    },
    {
      name: 'schema-admission',
      request: {
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'pulse.search',
          params: { version: contextCorpus.pulseVersion, query: 42 },
        }),
      },
      expect: {
        status: 200,
        json: {
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32602, message: 'Invalid params' },
        },
      },
    },
  ],
}
```
<!-- /pulse-doc-source -->

## Maintaining the snapshot

From a source checkout, regenerate only when canonical inputs change:

```bash
node scripts/pulse-context-corpus.cjs --write
node scripts/pulse-context-corpus.cjs --check
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-corpus --task pulse-context-application --task pulse-context-host --no-report
```

`context-corpus.ts` is generated from `scripts/pulse-context-inputs.json`; edit
those owners instead of the module or installed CLI copies. The generator checks
selected headings, stable IDs, versions, applicability and bounded content.
Run normal documentation synchronization to refresh packaged examples and docs.
The host test builds once, copies the runtime outside the checkout with sources
removed, and replays the exact client requests above. This is development evidence;
exact tarball/client installation is the separate installed qualification.
