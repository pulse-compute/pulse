# Pulse context MCP server

<!-- pulse-example-template:v1 -->

Start a Pulse project with cited contracts and maintained examples. The
[compiled application workflow](#compiled-application-workflow) serves five
read-only tools through shared `ctx.call`: `pulse.start`, `pulse.search`,
`pulse.read`, `pulse.example`, and `pulse.diagnostic`. Select Node Native,
Fastly Native, or explicit Node JavaScript in `application/`.

The root project preserves the v1 compatibility host using
`@pulse-compute/mcp/node`; its diagnostic tool is `pulse.explain_diagnostic`
and every tool crosses its fixed HTTP backend. The generated code, inspection,
doctor, test and size sections below describe that root project. Use the compiled
workflow for direct MCP execution and resource-backed lexical retrieval.

## Request and response

Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.

| Request | Expected response |
|---|---|
| unknown-record<br><code>POST /</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"jsonrpc":"2.0","id":1,"method":"pulse.read","params":{"version":"1.0.0-beta.9","id":"missing"}}</code> | <code>{"status":200,"json":{"jsonrpc":"2.0","id":1,"result":{"meta":{"pulseVersion":"1.0.0-beta.9","corpusSchemaVersion":"pulse.context-corpus.v1","corpusHash":"3dd815c0748b6ee9421e6489194850cd1dc15b212e84d520ea5e6285314e1118","snapshotStatus":"candidate","applicationVersion":"pulse.context-application.v1","requestedVersion":"1.0.0-beta.9","maxReplyBytes":24576},"status":"unknown-id","truncated":false,"error":{"code":"unknown-id","message":"No bundled record has that exact ID."}}}}</code> |
| schema-admission<br><code>POST /</code><br>Headers: <code>[["content-type","application/json"]]</code><br>Body: <code>{"jsonrpc":"2.0","id":2,"method":"pulse.search","params":{"version":"1.0.0-beta.9","query":42}}</code> | <code>{"status":200,"json":{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"Invalid params"}}}</code> |

<!-- pulse-example-view:code -->
## Code

### Entity application

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

### Project config

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

## Inspect

The selected profile is `node-javascript`; this checked excerpt identifies its target, provider and recognized capabilities. Paths, hashes and additional inspection fields are omitted.

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp","args":["inspect","--json"],"display":"npm run inspect -- --json"} -->
```bash
npm run inspect -- --json
```
```json
{
  "status": "ok",
  "project": {
    "target": "javascript"
  },
  "provider": {
    "id": "node"
  },
  "compiler": {
    "capabilities": [
      "schema.decode",
      "schema.encode"
    ]
  }
}
```

## Doctor

Check this project and its local toolchain before execution. This selected result is verified by the documentation gate; another machine may report different prerequisite checks.

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp","args":["doctor","--json"],"display":"npm run doctor -- --json"} -->
```bash
npm run doctor -- --json
```
```json
{
  "status": "warning",
  "summary": {
    "warnings": 1,
    "failed": 0
  }
}
```

The `canonical-native-plan` warning describes this JavaScript-only app’s Native eligibility; it does not select an automatic fallback.

The selected JavaScript profile has no completed Wasm artifact for `pulse report`. No Report result is claimed; use the inspection above and the standalone-host readiness evidence below.

## Install

Use Node 22.14+ or Node 24. Copy this complete example from the matching CLI
package's `examples/12-pulse-context-mcp/` directory into a new directory. The
corpus, host and request helper are included; no repository checkout, upstream
server, credentials or global Pulse installation is needed at runtime.

**Candidate status:** all Pulse dependencies, including MCP, use the exact
`1.0.0-beta.9` synchronized candidate version. These instructions describe the current source candidate, not a claim that these
bytes are already on npm. Obtain the matching CLI and dependency tarballs from
the release owner through one candidate registry. A matching version string alone
does not establish matching candidate bytes. Copy the complete installed CLI
example, including `application/`, `client/`, and `context-data/`. The install command is:

```bash
npm install
```

Do not substitute an older CLI or an unrelated MCP package. This README's
context version is `1.0.0-beta.9` with snapshot status `candidate`; check the
readiness response for the bundled version before calling tools.

## Workflow

This section runs the root v1 compatibility host. For direct Native MCP use
[Compiled application workflow](#compiled-application-workflow).

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

## Compiled application workflow

The separate `application/` project now implements **`pulse.start`, `pulse.search`, `pulse.read`,
`pulse.example`, and `pulse.diagnostic`** through
shared `ctx.call`. It supports Node Native, Fastly Native and explicit Node
JavaScript. The existing project and standalone five-tool Node host below remain
the v1 workflow; its search ranking remains unchanged.
The `@pulse-compute/mcp/node` host API is unchanged.

The migrated tools return application version `pulse.context-application.v2`, the
exact bundled package version and corpus hash. All four goals and both maintained
Node starter targets return dependencies, configuration, complete contract arrays,
immutable citations, commands and unresolved choices. A starter's selected target
is independent of the provider running this MCP application. Version, goal and
selection errors retain the existing structured statuses without fallback.

From a complete copy of this example:

```bash
cd application
npm install
npm run doctor -- --profile node-native
npm run inspect -- --profile node-native
npm run build -- --profile node-native
npm run dev -- --profile node-native
```

Call the running modern MCP endpoint from another terminal in `application/`:

```bash
node ../client/request.cjs --url http://127.0.0.1:8787/mcp tools/list
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.start '{"version":"1.0.0-beta.9","goal":"schema-api","provider":"node","target":"native"}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.search '{"version":"1.0.0-beta.9","query":"schema","limit":2}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.read '{"version":"1.0.0-beta.9","id":"contract/application"}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.example '{"version":"1.0.0-beta.9","id":"01-hello-json"}'
node ../client/request.cjs --url http://127.0.0.1:8787/mcp pulse.diagnostic '{"version":"1.0.0-beta.9","code":"PULSE_CALL_SOURCE_LIMIT"}'
```

Stop `dev` before reusing its port. The application has no `npm test` script;
`doctor` checks the selected profile, `inspect` exposes its plan, and the five
requests above check the running MCP boundary. `npm start` in `application/`
is an alias for `pulse dev`, not the root standalone host. The application
endpoint uses port 8787; the root compatibility host uses port 8788.

| Profile | Execution | Local command |
| --- | --- | --- |
| `node-native` (default) | Native Wasm on Node | `npm run dev -- --profile node-native` |
| `node-javascript` | Explicit JavaScript differential profile | `npm run dev -- --profile node-javascript` |
| `fastly-native` | Native direct Fastly ABI | Build, then Fastly CLI serve below |

Node JavaScript admission recognizes the binding's existing effect execution,
logging and response transport requirements. Run `npm run doctor -- --profile
node-javascript` before starting it. The example has no configured test cases,
so doctor retains that warning. The `mcp-installed` gate checks the exact packed
application through JavaScript doctor, dev, build and all five tools, with
separate effect, logging and deadline-recovery fixtures. The root v1 Node host
remains a separate onboarding path.

Fastly JavaScript is not supported by this MCP binding. `pulse dev` for Fastly
is local provider execution; actual CLI/Viceroy proof requires the built module.
From `application/`, check and package the selected Fastly candidate:

```bash
npm run doctor -- --profile fastly-native
npm run inspect -- --profile fastly-native
npm run build -- --profile fastly-native
cd dist-fastly-native
fastly compute serve --file bin/main.wasm --addr 127.0.0.1:8787
```

`pulse build` writes the provider package, including `fastly.toml`,
`bin/main.wasm`, and retained build manifests. There is no `pulse package`
command. Preserve this complete output and its hashes when handing it to a
deployment owner. Fastly CLI 16.1.0 with Viceroy 0.21.1 is the qualified local
host pair. Run the same five requests from another terminal in `application/`.
Stop the foreground server afterward. This public documentation application
accepts POST `/mcp`, rejects supplied Origin, and grants no outbound fetch,
secrets, client filesystem or process authority. It has no authentication or
Origin allowlist feature. Local success does not establish deployed service
health; service selection, deployment, activation and remote smoke remain
separately authorized steps in the Fastly deployment guide.

The exact installed application has source-deleted execution coverage; actual
CLI/Viceroy workload and pinned-client checks are separate registered gates.
Discovery exposes all five tools. `pulse.diagnostic` is the compiled application name for the
operation called `pulse.explain_diagnostic` by the unchanged legacy host.

`pulse.search` advertises encoder `pulse.context-sparse-lexical.v1` in
`meta.encoder`. Queries accept 1–256 ASCII bytes and one to eight tokens before
deduplication (at most 64 bytes each). Only ASCII letters are case-folded; maximal
`[a-z0-9_]` runs are tokens. All distinct terms must match. Scores sum field
presence weights: ID 8, title 6, tags 4, content 1. Equal scores sort by ASCII ID.
Category and exact provider/target filters apply before scoring. `limit` is 1–5;
`offset` may equal the complete match count for an empty terminal page.

Excerpts preserve the leading scalar-aligned 384 UTF-8 bytes, including whitespace,
with `excerptTruncated` when more text exists. The complete MCP tool result,
including both content copies and citations, must fit 24 KiB; oversized pages
return `response-too-large` without partial results. Lower the limit or use
`pulse.read`. Search uses the same generated finite citation projection as read,
plus immutable vector/text resources and a request-owned numeric heap. This is
sparse lexical retrieval, not semantic embeddings: no synonyms, stemming,
non-ASCII query language or learned model. The reconstructed corpus is explicit;
it does not recover the unavailable original vector workload. Frozen relevance
cases and whole-request cost gates cover the admitted workload, not arbitrary
future corpus growth. Source changes require regeneration and fresh qualification.

The computations use complete existing output schemas. Cited content is read
from `context.text`; generated code contains bounded metadata and no full-text
corpus module. Reads retain UTF-16 offsets and scalar-aligned UTF-8 pages, counting
both raw bytes and JSON escaping. Examples return whole files in corpus order,
with explicit pagination or `record-requires-read`; diagnostics retain complete
remediation, related contracts and local-check arrays. The complete tool result remains capped
at 24 KiB, including metadata and both text/structured copies; the complete MCP
protocol reply remains capped at 128 KiB. Compared with v1, read pages can end
earlier and example pages can contain fewer files to fit that whole-result bound.
Their explicit continuation fields retain the original content and offsets.
Oversized results produce an explicit error, never silent truncation. Native
reachability selects immutable resource backings and deduplicates equal bytes.
Report artifact bytes, selected backing bytes and committed linear memory
separately; unavailable peak/live allocation and process memory remain unknown.

### Pinned clients and migration

| Client | Protocol configuration | Qualified local transport |
| --- | --- | --- |
| Official SDK 2.2.0 | Default `2026-07-28` | Native Fastly HTTP |
| Claude Code 2.1.292 | Default `2026-07-28` | Native Fastly HTTP |
| Official SDK 2.2.0 | Explicit `2025-06-18` | Native Fastly HTTP |
| Codex 0.160.1 | Explicit `2025-06-18` | Native Fastly HTTP |

The shipped application is modern-only. For the compatibility profile, explicitly
add `legacyProtocol: '2025-06-18'` to the existing `mcp({...})` declaration and
rebuild. That produces a different artifact identity. `--codex` belongs only to
the root v1 host; it is not a compiled-application CLI flag. Modern admission
never silently falls back. These are pinned local transport/tool checks, not
inference, sessions, SSE, MCP Resources, Prompts or deployed-service qualification.

When moving a v1 caller, rename `pulse.explain_diagnostic` to `pulse.diagnostic`,
select the application endpoint, and follow returned `nextOffset` values rather
than assuming identical page sizes or search ranking. Check application version,
corpus hash, exact package version and tool `status` on every response. Preserve
selection and version across pages; citations and hashes identify full source
records even when the returned page is shorter.

## Walkthrough 1: start a JSON API

Ask for a Node Native plan with an explicit goal and exact corpus version:

```bash
node client/request.cjs pulse.start '{"version":"1.0.0-beta.9","goal":"json-api","provider":"node","target":"native"}'
node client/request.cjs pulse.example '{"version":"1.0.0-beta.9","id":"01-hello-json"}'
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
node client/request.cjs pulse.start '{"version":"1.0.0-beta.9","goal":"schema-api","provider":"node","target":"native"}'
node client/request.cjs pulse.start '{"version":"1.0.0-beta.9","goal":"schema-api","provider":"node","target":"javascript"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.9","id":"contract/eligibility"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.9","id":"node/javascript"}'
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
node client/request.cjs pulse.explain_diagnostic '{"version":"1.0.0-beta.9","code":"PULSE_SCHEMA_COMPILE_FAILED"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.9","id":"schema/boundaries"}'
node client/request.cjs pulse.explain_diagnostic '{"version":"1.0.0-beta.9","code":"PULSE_PACKAGE_LOWERING_FAILED"}'
node client/request.cjs pulse.read '{"version":"1.0.0-beta.9","id":"contract/effects"}'
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
identity and record count come from the generated manifest; it remains explicitly
a candidate. No client filesystem,
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

## Test result

<!-- pulse-doc-run {"project":"examples/12-pulse-context-mcp","args":["test","--json"]} -->
```bash
pulse test --json
```
```json
{"status":"passed","provider":"node","target":"javascript","summary":{"total":2,"passed":2,"failed":0}}
```

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

## Wasm size

The root v1 Node JavaScript profile emits **no application Wasm artifact**.
`--experimental-native-size` does not apply. Switching this app to Native fails
eligibility rather than selecting JavaScript automatically.

## Maintaining the snapshot

From a source checkout, resolve source/version changes and synchronize documentation,
then explicitly rebuild the immutable data with **Node 24.18.0** (the release-pinned
producer). No model, network service or output cache participates:

```bash
npm run docs:sync
npm run context:build
npm run docs:sync
npm run context:check
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-build --task pulse-context-corpus --task pulse-context-application --task pulse-context-host --no-report
```

The corpus extractor remains `scripts/pulse-context-corpus.cjs`, with the explicit
allowlist in `scripts/pulse-context-inputs.json`. `context:build` owns the generated
`context-corpus.ts`, `context-data/`, the migrated application config/source/schema
outputs and their byte-identical installed CLI mirrors.
Its `context-manifest.json` binds source selections, immutable citation blobs,
producer/config/lockfile hashes, row IDs, vocabulary and every generated payload.
The manifest's own SHA-256 belongs in the external check receipt, avoiding a
self-reference. Edit canonical inputs, never the emitted files.

The new `vector.bin` is **sparse lexical data**, not semantic embeddings or the
unrecovered historical vector. It uses exact ASCII tokens and integer field
presence weights. `text.bin` retains cited UTF-8 content; `metadata.bin` maps rows
to their citations. Scalar filter/tool tables contain no full cited text. Limits
are 512 records, 4,096 terms, 1,024 nonzeros per row, 24 KiB content per record and
2 MiB canonical corpus, together with explicit raw and serialized resource byte
budgets. Every limit applies simultaneously; overflow fails without truncation.

`context:check` reconstructs in a fresh temporary directory and compares all 30
outputs. It fails on missing, stale, corrupt, mixed or unexpected data and never
repairs the checkout. The receipt names the actual verifier Node version;
verification on another Node version proves only that invocation's byte equality.
Generation requires the pinned producer. Repository `build` and `docs:check` run
the read-only check. `docs:sync` may refresh the legacy corpus and copy emitted
files, but never builds vectors; finish explicit generation before committing.

The existing Node JavaScript host continues using its v1 corpus module. The migrated
`application/` project implements all five tools through compiled computation.
Installed resource acceptance and a candidate-bound seal receipt remain separate.
B10-MCP-07/09 own installed qualification and seal/recovery integration.

The recovered application config template is
`application/.pulse/config.template.ts`. `scripts/pulse-context-start.json` owns
finite starter metadata; `scripts/pulse-context-tools.json` owns the additional
tool metadata and `scripts/pulse-context-tools.cjs` owns their finite projection.
`application/src/scalars.ts` owns shared pure byte-cost helpers.
`application/src/*.template.ts` owns the call and
computation shape. The context builder generates the resource manifest, inlines
it into the new config, binds protocol budgets and exact server version, copies
the canonical schema and materializes the eight finite starter plans. Edit these
canonical inputs and run the pinned build/check sequence; generated edits are
rejected by freshness checks. `pulse-context-start` adds three-target real MCP
execution against the existing host's complete responses as an independent oracle.
