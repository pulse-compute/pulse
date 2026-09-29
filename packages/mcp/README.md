# Pulse MCP HTTP adapter — private candidate

MCP-02/03 implement the bounded protocol shell and tools facade for **MCP 2026-07-28** outside the
entity engine. This package is private, version `0.0.0`, and excluded from the
release manifest. Its interfaces are repository candidate interfaces, not
supported Pulse guest imports. It has no runtime dependencies.

`server/discover` always works. Configuring `tools` enables `tools/list` and
`tools/call`, and advertises `{ tools: { listChanged: false } }`. Otherwise the
capabilities remain `{}`. Remote authentication and per-operation policy belong
to MCP-04. This unauthenticated candidate is for local/private integration only.
The protocol profile remains [MCP-01](../../wasm/test/mcp/MCP-01.md).

## Candidate interfaces

`createMcpHttpHandler(options)` returns `{ fetch(Request): Promise<Response> }`.
`createMcpNodeHandler(options)` returns an `http.createServer` request listener.
The application owns the listener, authentication, shutdown and deployment.
This is not the production Node launcher (NODE-01).

Repository-only Node use:

```js
const http = require('node:http');
const { createMcpNodeHandler } = require('./packages/mcp/src/node.js');
const server = http.createServer(createMcpNodeHandler());
server.listen(3000, '127.0.0.1');
```

The default path is `/mcp`. `serverInfo` accepts bounded name/version strings,
copied at construction. `allowedOrigins` is an exact HTTP(S) origin allowlist,
also copied. By default every present Origin is rejected; an absent Origin is
permitted. Origin checks and self-reported client metadata are not authentication.

## Admission and lifetime

The shell validates individual POST envelopes, UTF-8 JSON, the explicit JSON/SSE
Accept list, revision/method/name header agreement, encoded names and required
metadata. IDs may be strings or safe integers; null/fractional/unsafe numeric IDs
are rejected to prevent silent rounding. Batches and client responses are rejected.

Defaults: 64 KiB request, 1 MiB response, 32 JSON nesting levels, 10-second end-to-end
deadline. Options may lower ceilings; the response budget must exceed the request
budget by 512 bytes to leave room for echoed IDs in errors. The host owns header
and connection limits. The Node bridge uses the host's ordinary HTTP parser.

Early rejection cancels unread bodies. Chunked input is counted while reading;
oversized, failed, cancelled or stalled bodies release the reader. Cleanup does
not wait for an uncooperative source's cancel promise. Node pauses rejected input
and closes the connection after sending the error instead of draining unlimited
input or resetting the socket before replying. Disconnects and deadlines abort admission and the backend HTTP request/body read.
The adapter never retries. Aborting the HTTP hop does not promise rollback of
already completed effects or cancellation inside a remote backend.

There are no protocol sessions, handshake, SSE output, subscriptions, tasks,
MRTR or other optional RPC methods. Removed `ping` and `logging/setLevel` are rejected.
Legacy session/resume headers are ignored. Valid notifications are discarded
with 202 and an empty body, including `tools/call` without an ID. This revision
defines no core HTTP client notifications or header requirements for them.

Replies use `Cache-Control: no-store`; discovery includes zero TTL and private
cache scope. Fixed error messages omit input contents, credentials and exception
text. The revision error includes the required requested/supported version data.
Readable IDs are echoed; errors before bounded parsing omit the ID.

| Outcome | HTTP / protocol result |
|---|---|
| Discovery | 200 / `resultType: complete` |
| Accepted notification | 202 / empty |
| Disallowed Origin | 403 / empty |
| Other endpoint / unsupported RPC | 404 / empty endpoint error or `-32601` |
| Non-POST method | 405 / `Allow: POST` |
| Incompatible Accept / media type or encoding | 406 / 415, empty |
| Invalid JSON / envelope / params | 400 / `-32700`, `-32600`, `-32602` |
| Header mismatch / unsupported revision | 400 / `-32020`, `-32022` |
| Body limit / interrupted read | 413 / 408, `-32600` before parsing |
| Response limit / internal failure | 500 / `-32603` |

Header presence precedes metadata validation; then agreement and revision are
checked. Name agreement precedes the method allowlist. No executable method registry,
application callback, compiler hook or Entities import is exposed.

## Catalog-backed tools

Configure the emitted artifacts from the **same deployed backend build**, an
explicit router ID and target, and a fixed JSON-RPC endpoint:

```js
const fs = require('node:fs');
const handler = createMcpNodeHandler({
  tools: {
    catalog: JSON.parse(fs.readFileSync('dist/entities-catalog.json', 'utf8')),
    schemas: JSON.parse(fs.readFileSync('dist/schema-json-registry.json', 'utf8')),
    routerId: 'rpc',
    target: 'node-javascript',
    endpoint: 'http://127.0.0.1:4000/',
  },
});
```

The endpoint accepts HTTPS or loopback HTTP. It must be private or independently
protected: bypassing the facade must not bypass policy. There is no client-token,
cookie or arbitrary-header forwarding, redirect following, retry or injected
handler callback. Backend credentials and remote authorization belong to MCP-04.

Construction snapshots artifacts, rejects missing/duplicate schema IDs, duplicate
or invalid tool names, ineligible operations, unknown artifact versions and
unsupported schema nodes. The selected router may contain at most 128 tools;
overflow fails configuration. Each artifact is bounded to 1 MiB/32 JSON levels,
projection to 4096 nodes/24 nested levels, and the projected list must fit the
response budget with room for protocol metadata and the largest admitted ID.
There is no pagination or mutable registration; cursor params are rejected.
A new artifact/configuration requires a new handler. Artifact hashes are build
identifiers, not authenticated attestations; the operator owns artifact/backend
agreement. No global or cross-principal cache exists.

JSON Schema 2020-12 projection covers strings, booleans, i32/u32 ranges, finite
numbers, optional fields, objects, arrays, enums, nullable and nested JSON nodes.
Closed Pulse inputs admit and drop unknown fields, so their input projection
allows additional properties. Closed encoded outputs contain only declared
fields; open outputs allow JSON extras. No-input tools require empty objects and
omit backend params. No-output completion produces text `null`. Typed completion
includes both `structuredContent` and its serialized text. Aggregate byte/depth
and JSON limits remain enforced by governed schema codecs, beyond the portable
JSON Schema projection. `ScalarRecord` projection is explicitly unsupported
pending qualification of its byte/key constraints; configuration fails rather
than advertising a weaker schema.

Only title, description and the four boolean MCP hints are projected from
metadata. Hints grant no execution authority. The adapter validates structural
input before dispatch, then sends exactly one named request to the governed
endpoint, which owns schema admission, selection, effects and output encoding.
It checks the returned envelope/ID and output structure before MCP completion.

| Outcome | MCP response |
|---|---|
| Unknown tool or malformed call params | 400 / `-32602` protocol error; no backend call |
| Input shape or governed input validation failure | 200 / tool result with `isError: true` |
| Governed execution/output failure or invalid output shape | 200 / tool result with `isError: true` |
| Backend transport, framing, catalog mismatch or response-body failure | 502 / `-32603` protocol error |
| Deadline/disconnect during invocation | 408 / `-32603`, echoed ID |
| Final MCP response exceeds budget | 500 / `-32603` |

Error messages are fixed and redacted; backend error messages/data are never
forwarded. Entities intentionally uses the same wire code for execution and
output-validation failures, so the facade reports that combined category.

## Evidence

```sh
node wasm/scripts/run-wasm-tests.cjs --task mcp-http --report /tmp/mcp-http.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-http-sdk --report /tmp/mcp-sdk.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-tools --report /tmp/mcp-tools.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-tools-sdk --report /tmp/mcp-tools-sdk.json
```

`mcp-http` covers T01–T06 and HTTP admission in T07 from MCP-01, including negative
envelopes/headers, concurrent isolation, byte/depth limits, stalled streams,
disconnects and real chunked Node requests. It belongs to the unit profile and
historical-contracts evidence shard. MCP-03 tool-count and invocation bounds are covered by `mcp-tools`.

`mcp-http-sdk` installs the locked official client **2.2.0** independently and
performs repeated discovery over TCP against this adapter. The reference server
SDK is not used. Source/fixture identities, wire records and terminal status are
saved under `wasm/.test-results/mcp-http-sdk-*`. It remains explicit external
evidence. Node JavaScript is measured; Native/Fastly MCP, remote auth and complete
installed application acceptance remain unclaimed. The MCP-01 reference-server
wire proof is separate evidence.

`mcp-tools` covers projection, mutation isolation, metadata filtering, protocol
versus tool failures, selected-only HTTP dispatch, response bounds, deadlines,
cancellation and concurrent calls. It runs in the unit profile.
`mcp-tools-sdk` uses independently installed client 2.2.0, the actual adapter,
and an ordinary `pulse build`/`pulse dev` Entities application with a deterministic
typed fixture handler. Emitted catalog and schema files drive discovery and one
successful invocation; the backend records exactly one request. This is Node
JavaScript source-workspace evidence, not installed/deployed acceptance. Source,
fixture and adapter identities plus wire records are retained under
`wasm/.test-results/mcp-tools-sdk-*`. MCP-05 owns independent installed acceptance.

Authority: dated [base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic),
[versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
[HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
and [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
