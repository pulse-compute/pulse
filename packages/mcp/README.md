# Pulse MCP HTTP adapter — private candidate

MCP-02 implements the bounded protocol shell for **MCP 2026-07-28** outside the
entity engine. This package is private, version `0.0.0`, and excluded from the
release manifest. Its interfaces are repository candidate interfaces, not
supported Pulse guest imports. It has no runtime dependencies.

Only `server/discover` is implemented. Discovery advertises **no optional
capabilities** (`{}`). Catalog-backed tools and governed HTTP invocation belong
to MCP-03; remote authentication and per-operation policy belong to MCP-04.
Do not expose this unauthenticated candidate remotely. The eventual tools
profile remains [MCP-01](../../wasm/test/mcp/MCP-01.md), with its corrected removal
of `ping`. The independently installed official client verified that correction.

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

Defaults: 64 KiB request, 1 MiB response, 32 JSON nesting levels, 10-second admission
deadline. Options may lower ceilings; the response budget must exceed the request
budget by 512 bytes to leave room for echoed IDs in errors. The host owns header
and connection limits. The Node bridge uses the host's ordinary HTTP parser.

Early rejection cancels unread bodies. Chunked input is counted while reading;
oversized, failed, cancelled or stalled bodies release the reader. Cleanup does
not wait for an uncooperative source's cancel promise. Node pauses rejected input
and closes the connection after sending the error instead of draining unlimited
input or resetting the socket before replying. Disconnects abort admission.
Extending the deadline across governed invocation is MCP-03 work; no effect
cancellation or rollback is claimed here.

There are no protocol sessions, handshake, SSE output, subscriptions, tasks,
MRTR or optional RPC methods. Removed `ping` and `logging/setLevel` are rejected.
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
checked. Name agreement precedes the method allowlist. No method registry,
application callback, compiler hook or Entities import is exposed.

## Evidence

```sh
node wasm/scripts/run-wasm-tests.cjs --task mcp-http --report /tmp/mcp-http.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-http-sdk --report /tmp/mcp-sdk.json
```

`mcp-http` covers T01–T06 and HTTP admission in T07 from MCP-01, including negative
envelopes/headers, concurrent isolation, byte/depth limits, stalled streams,
disconnects and real chunked Node requests. It belongs to the unit profile and
historical-contracts evidence shard. Tool-count and invocation bounds remain MCP-03.

`mcp-http-sdk` installs the locked official client **2.2.0** independently and
performs repeated discovery over TCP against this adapter. The reference server
SDK is not used. Source/fixture identities, wire records and terminal status are
saved under `wasm/.test-results/mcp-http-sdk-*`. It remains explicit external
evidence. Node JavaScript is measured; Native/Fastly MCP, remote auth and complete
installed application acceptance remain unclaimed. The MCP-01 reference-server
wire proof is separate evidence.

Authority: dated [base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic),
[versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
[HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
and [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
