# Native MCP ownership and public admission

## Package and dispatch

Add a lowerable `@pulse-compute/mcp/pulse` subpath to the existing package in
04. It owns a static `mcp` application binding: endpoint path, server identity,
protocol profile, limits, origin policy and a statically declared Entities tool
router. Exact TypeScript signatures are owned by that implementation, but the
binding has no arbitrary callback, supplied fetch implementation, dynamic tool
registry or backend URL. Five tool declarations and their input/output schemas
are compile-time inputs. Package reachability must select only the declarations
reachable from that binding.

The MCP package owns HTTP/MCP admission, discovery, tool schema projection,
envelopes and direct binding. Entities retains operation dispatch and its
input/output validation semantics; schema-json retains JSON codecs. Extract
reusable package-owned seams where needed, with the normal versioned trusted
lowerer manifests and declared provider requirements. No compiler special case
for example 12 or publisher/version allowlist, and no unvalidated raw source
injection. MCP owns any package source contribution through the existing
validated package protocol; a new generic canonical operation requires its own
contract/evidence, not just a lowerer declaration.

Direct dispatch calls the selected local operation inside the same execution,
deadline and artifact. It does not issue HTTP to a loopback server, an internal
public route or a configured backend. The former two Node listeners and
`host/prepare.cjs` are not Fastly deployment dependencies. The provider-neutral
application is explicitly built with `host: fastly, target: native`; Node Native
and Node JavaScript may supply differential evidence. No JavaScript fallback,
embedded JS interpreter, runtime filesystem/process or Fastly SDK in handlers.

Preserve `createMcpHttpHandler` at the package root, `createMcpNodeHandler` at
`/node`, their authorization support and fixed governed HTTP-backend behavior.
The new subpath does not change the release package set or make those host-only
APIs Native. Existing host tests continue to run independently. Installed
acceptance must include the new facade/types, lowerer manifest/builder, schema
projection, declared package source contributions and all example resources.

## Public Fastly route

The selected app is intentionally unauthenticated, read-only public Pulse
documentation. There is no private corpus, secret, user state, model call,
network tool, command execution or mutation. Authentication is not inferred
from localhost or a token sent by a client. No OAuth metadata/introspection
endpoint is exposed by this binding; existing host OAuth APIs remain intact.
Private-content or authenticated Native MCP is a separate approved scope.

One exact `/mcp` path; other paths return 404. POST only; other methods,
including GET/SSE, DELETE and OPTIONS, return 405 with `Allow: POST`.
Default `allowedOrigins: []` rejects **every supplied Origin**, including
`null`, before parsing or catalog disclosure. Absent Origin is allowed for
non-browser clients; it is not authentication. An operator may explicitly select
an exact finite HTTPS-origin allowlist in a later reviewed app configuration;
no wildcard, suffix match, request reflection or default CORS permission. This
design/default does not promise browser preflight support.

Reject compressed bodies; enforce actual received bytes as well as a declared
length. Request cap 32 KiB, structured depth 32, protocol reply cap 128 KiB,
5-second execution deadline. Tool results independently cap at 24 KiB, including
metadata. Response assembly must account for JSON escaping and the MCP text plus
structured-content duplication. Headers are bounded by provider request
admission; 04/10 must demonstrate that duplicates/mixed-case names do not bypass
single semantic header validation. Do not log raw queries, full corpora or
credentials. Deployment hostname, service configuration, operator rate limiting
and activation are outside this source-design PR.

## Protocol profiles

Normative external reference is the official
[2026-07-28 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
The current repository owner is `packages/mcp/src/index.js`, with tests in the
`mcp-http`, `mcp-compatibility`, `mcp-tools`, `mcp-authorization` and pinned-client
lanes. Its historical `wasm/test/mcp/profile.json` is not a reason to silently
remove current legacy support. 04 must retain a version-pinned conformance
matrix rather than treating future upstream drift as this contract.

| Profile | Enabled | Request/reply behavior |
| --- | --- | --- |
| Core `2026-07-28` | Default | `server/discover`, `tools/list`, `tools/call`; strict MCP headers/metadata; one JSON reply |
| Compatibility `2025-06-18` | Explicit static option only | `initialize`, `ping`, `tools/list`, `tools/call`; stateless compatibility envelope as currently tested |
| Sessions, SSE output, resumption, stdio | No | No session IDs, server stream or background request state |
| Prompts, MCP Resources, MRTR extensions | No | Not advertised; unsupported request method error |

Pulse binary resources are internal immutable data, **not** the MCP Resources
capability. List exactly the five selected tools; `listChanged` false. Core
discovery/list response caching remains `ttlMs: 0`, `cacheScope: private` as in
the host adapter. The application corpus identity is in tool metadata and exact
server version is bundled, not a mutable “latest” promise.

Admission order and errors must match the existing bounded host contract where
the profiles overlap:

1. Validate origin/path/method, deadline, media types and byte/depth constraints.
   Require `application/json` input, and explicit nonzero Accept entries for
   both JSON and event-stream even though the server answers only JSON.
2. Parse one JSON-RPC 2.0 object (no batches). IDs are strings or safe integer
   numbers; preserve exact ID value/type. Reject null, fractional/unsafe numeric
   IDs, response envelopes and malformed params. Omit an unavailable ID as the
   existing error encoder specifies; do not coerce it or invent a new one.
3. A valid no-ID one-way envelope receives 202/empty and is never dispatched,
   including unknown notification names. Origin/body admission still applies.
4. Core requests require exact header/body method and protocol agreement,
   `io.modelcontextprotocol/protocolVersion` and clientCapabilities metadata,
   valid optional clientInfo, and canonical `Mcp-Name` agreement for tool calls.
   Preserve current canonical base64-name decoding/UTF-8 failure semantics.
5. Legacy is selected only when explicitly enabled and there are no modern
   method/name headers or modern metadata, and the legacy version matches
   (or its initial initialize has no version header). A failed modern request
   cannot downgrade. Legacy notification envelopes also never dispatch.
6. Validate tool name, arguments and output schema. Unknown tool/invalid
   method params remain protocol errors. Valid tool calls whose input, execution
   or output validation fails use the existing `isError` tool-result boundary;
   application statuses such as version mismatch remain structured tool data.
   Success carries matching structuredContent and JSON text content.

Retain the host's exact error codes/status pairs in overlap tests: bad JSON
400/-32700, invalid envelope 400/-32600, invalid params 400/-32602,
unsupported version 400/-32022, unsupported method 404/-32601; admission media
failures 406/415, size failure 413 and interruption 408. Header mismatch,
internal failure and response-overflow behavior must be copied from their
existing source-owned fixtures, not mapped into a generic success result.
No arbitrary thrown exception, partial tool output or raw provider diagnostic
crosses the protocol boundary. 04 must test errors with a near-limit echoed ID.

## Tool behavior and versioning

| Tool | v2 commitment |
| --- | --- |
| `pulse.start` | Preserve four goals, exact dependency/source provenance and existing maintained Node Native/JavaScript starter choices; serving on Fastly does not invent Fastly starter templates |
| `pulse.search` | Selected exact-token sparse-vector contract, filters, counts, stable ranking and offset paging; encoder/application version explicitly changes |
| `pulse.read` | Exact record ID/version, original cited content and Unicode-safe UTF-16 continuation |
| `pulse.example` | Preserve the four starter IDs and exact allowed file choices; no path discovery or generated uncited templates |
| `pulse.explain_diagnostic` | Exact diagnostic code and cited content; unknown code remains explicit |

Every tool requires the exact bundled Pulse version; no nearest/latest fallback.
Metadata retains corpus schema/hash/status and gains retrieval/format identity.
Keep current input/output status distinctions and 24 KiB whole-tool reply cap.
05 must compile all five complete result shapes, including start's dependency
lists/configuration, through typed output validation. Large replies fail with
the bounded existing response-too-large guidance instead of truncating citations.
After 06, run official SDK, Codex and Claude lanes independently against Native
Fastly for each selected profile. A passing Node-host client lane is not that
receipt; actual Viceroy execution is owned by 10.
