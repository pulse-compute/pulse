# Pulse MCP HTTP adapter — private candidate

MCP-02/03/04 implement the bounded protocol shell and tools facade for **MCP 2026-07-28** outside the
entity engine. This package is private, version `0.0.0`, and excluded from the
release manifest. Its interfaces are repository candidate interfaces, not
supported Pulse guest imports. It has no runtime dependencies.

`server/discover` always works. Configuring `tools` enables `tools/list` and
`tools/call`, and advertises `{ tools: { listChanged: false } }`. Otherwise the
capabilities remain `{}`. MCP-04 adds optional OAuth resource-server admission
and per-operation scope policy. Without `authorization`, the candidate remains
unauthenticated and suitable only for local/private integration.
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
handler callback. `backendBearerToken` supplies a separate service credential
bound to this fixed endpoint; authenticated tools require it. The backend must
validate it independently and deny public/client-token access.

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

## OAuth authorization

The selected integration is an **external OAuth 2.1 authorization server with
RFC 8414 (or OIDC) metadata and RFC 7662 introspection**. Pulse is the resource
server, not an authorization server. This profile supports opaque access tokens
and JWT access tokens through authenticated introspection; it does not parse
JWTs, fetch token-selected issuers/JWKS or fall back to unverified claims.

```js
const handler = createMcpNodeHandler({
  tools: {
    catalog, schemas, routerId: 'rpc', target: 'node-javascript',
    endpoint: 'https://private-backend.example/rpc',
    backendBearerToken: process.env.PULSE_MCP_BACKEND_TOKEN,
  },
  authorization: {
    resource: 'https://mcp.example/mcp',
    issuer: 'https://issuer.example',
    introspectionEndpoint: 'https://issuer.example/introspect',
    clientId: process.env.PULSE_MCP_INTROSPECTION_CLIENT_ID,
    clientSecret: process.env.PULSE_MCP_INTROSPECTION_CLIENT_SECRET,
    scopes: ['mcp:access'],
    operations: { 'system.status': [], 'customer.lookup': ['customers:read'] },
  },
});
```

These `.example` URLs are placeholders, not a configured production issuer.
The deploying application supplies the issuer, credentials and backend protection;
this library does not read environment variables itself. Configure an issuer that:

- serves validated RFC 8414 or OIDC discovery metadata, authorization-code/PKCE
  S256, and RFC 8707 `resource` binding for the exact resource URI;
- preregisters the MCP client and its exact redirect URI (dynamic registration
  is not required by this profile);
- registers a separate confidential resource-server client allowed to introspect
  these access tokens using `client_secret_basic`;
- returns `active`, exact `iss`, resource `aud` (string or array), integral-second
  `exp`, nonempty `sub`, and space-separated `scope`; optional `nbf` must already
  be valid, and optional `token_type` must be Bearer.

The fixed introspection endpoint must share the configured issuer origin.
Resource and issuer identities are compared exactly; the resource URL path must
match the handler path. All configured authorization URLs require HTTPS.
`allowInsecureLoopback: true` permits only literal loopback IP HTTP for controlled
tests. The application/reverse proxy owns incoming TLS, trusted routing, header
limits, rate limiting and private backend reachability. No Host/forwarded header
can select the issuer, audience, metadata URL or backend destination.

The adapter serves unauthenticated GET/HEAD protected-resource metadata at
`/.well-known/oauth-protected-resource` plus the resource path, for example
`/.well-known/oauth-protected-resource/mcp`. This document advertises the exact
resource, configured issuer, baseline scopes and header-only bearer transport.
The issuer owns its own authorization-server metadata endpoint. Every MCP POST,
including notifications and discovery, must authenticate before body parsing or
catalog disclosure. Query-string tokens are rejected.

Baseline `scopes` must be nonempty. Each configured operation requires those
scopes plus its explicit additional scope list; an empty list grants baseline
access deliberately. Unmapped operations default to deny. Unknown policy names
fail construction. Tool listing contains only permitted operations. Grants and
policy are copied, scoped to each request, and never cached across principals.
Expiry is checked again after body admission and immediately before dispatch.

| Authorization outcome | HTTP result |
|---|---|
| Missing credentials | 401; Bearer challenge with `resource_metadata` and baseline `scope` |
| Invalid/inactive/expired token, wrong issuer/audience | 401; `invalid_token` challenge |
| Missing baseline or operation scopes | 403; `insufficient_scope`, with required scope union for mapped operations |
| Unmapped/unknown operation | 403; default deny, no tool execution |
| Query-string token | 400; `invalid_request` |
| Verifier unavailable, malformed, redirected or oversized response | 503; `temporarily_unavailable`, no anonymous fallback |
| Request deadline/disconnect | 408; request interrupted |

Introspection has a three-second ceiling inside the existing end-to-end deadline,
a 16 KiB/eight-level response bound, no redirects and no retries. Token headers
are capped at 8192 characters. Resource-server credentials go only to the fixed
introspection endpoint. Client access tokens never go to the backend. The backend
service credential must be separately provisioned for this endpoint and its
operation set; the backend owns validation of that credential and any audience
claim. Authorization success does not make a public unprotected backend safe.

Metadata and errors contain no tokens, client secrets, backend credentials,
issuer exception text or raw introspection claims. All responses remain no-store.
The independent client owns authorization redirects, PKCE and callback state;
its issuer check must precede code redemption. Browser CORS integration and live
identity-provider/deployment qualification are not claimed by this Node fixture.

## Evidence

```sh
node wasm/scripts/run-wasm-tests.cjs --task mcp-http --report /tmp/mcp-http.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-http-sdk --report /tmp/mcp-sdk.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-tools --report /tmp/mcp-tools.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-tools-sdk --report /tmp/mcp-tools-sdk.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-authorization --report /tmp/mcp-auth.json
node wasm/scripts/run-wasm-tests.cjs --task mcp-authorization-sdk --report /tmp/mcp-auth-sdk.json
```

`mcp-http` covers T01–T06 and HTTP admission in T07 from MCP-01, including negative
envelopes/headers, concurrent isolation, byte/depth limits, stalled streams,
disconnects and real chunked Node requests. It belongs to the unit profile and
historical-contracts evidence shard. MCP-03 tool-count and invocation bounds are covered by `mcp-tools`.

`mcp-http-sdk` installs the locked official client **2.2.0** independently and
performs repeated discovery over TCP against this adapter. The reference server
SDK is not used. Source/fixture identities, wire records and terminal status are
saved under `wasm/.test-results/mcp-http-sdk-*`. It remains explicit external
evidence. Node JavaScript is measured; Native/Fastly MCP and complete
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

`mcp-authorization` covers metadata/challenges, audience/issuer/expiry/scope
rejection, deny-before-effects, catalog isolation, revoked tokens, verifier
failures, cancellation, expiry during upload, configuration bounds and backend
credential separation. It runs in the unit profile. `mcp-authorization-sdk`
uses the pinned independent client, actual adapter, a controlled OAuth issuer
and an independently credential-protected backend. It proves metadata discovery,
preregistration, PKCE, resource parameters, issuer mismatch rejection before code
redemption, scoped listing/calling and deny-before-effects. Its retained reports
contain checks/counts and source digests, never token/secret wire dumps. This is
controlled local evidence, not a configured live issuer or deployment claim.

Authority: dated [base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic),
[versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
[HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
[authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html),
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html)
and [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
