# MCP-01: protocol profile and boundary proof

Decision date: 2026-09-29. Status: design pinned; reference wire proof available.
Owner: Pulse MCP adapter lane. PR base: `beta`.

Implementation follow-up: the private [MCP-02 adapter](../../../packages/mcp/README.md)
now implements the HTTP shell and T01–T06 plus the admission portion of T07.
MCP-03 now adds catalog/schema-backed tools through the governed HTTP boundary;
discovery advertises tools only when configured. See the adapter README for
projection limits and measured evidence.
The reference fixture and original requirement allocation below remain MCP-01
evidence; they do not substitute for the adapter's own tests.

Correction found during MCP-02 interoperability: this revision removes `ping`
([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).
The original design incorrectly retained it. The pinned SDK rejects it in modern
mode; T06 and the profile below now require a method-not-found response.

This is repository evidence for MCP-01, not a supported Pulse MCP server. The
production adapter, complete catalog projection, remote authorization and
independent installed application remain MCP-02, MCP-03, MCP-04 and MCP-05.
No production package gains an SDK dependency from this proof.

## Pinned choices

`profile.json` is the machine-readable companion used by the proof. Changes to
these choices require updating this document and rerunning the evidence.

| Item | Decision |
|---|---|
| Protocol | MCP **2026-07-28**, modern request envelopes |
| Reference client | Official TypeScript `@modelcontextprotocol/client` **2.2.0**; explicitly pin the modern revision (the SDK default is legacy) |
| Reference server | `@modelcontextprotocol/server` **2.2.0** |
| Reference Node HTTP bridge | `@modelcontextprotocol/node` **2.1.0**; independently versioned |
| Dependencies | Private fixture with exact direct versions and pnpm integrity lock; frozen install with lifecycle scripts disabled |
| Transport | Streamable HTTP, one `/mcp` endpoint, finite JSON responses |
| Discovery | `server/discover`; advertise only tools, explicitly disabling `listChanged` |
| Tool methods | `tools/list`, `tools/call`; `ping` is removed in this revision |
| Deferred capabilities | Resources, prompts, subscriptions, tasks, sampling, elicitation, logging and multi-round interaction |
| Compatibility | Reject legacy request revisions; no `initialize` handshake, protocol sessions, session DELETE, GET event stream or legacy SSE transport |
| Reference application | Emitted catalog from example 10; only its no-input/no-output `system.status` operation is exposed in this proof |

The SDK server is a disposable reference peer. Its extra implementation behavior
does not define the future Pulse adapter. In particular, JSON response mode alone
does not disable every SDK subscription method. MCP-02 must implement an explicit
method/capability allowlist and reject unsupported methods.

The initial product profile chooses a 64 KiB request limit, 1 MiB response limit,
10 second end-to-end deadline, 128 exposed tools and no pagination until a bounded
cursor contract is implemented. Oversized input is rejected before invocation;
catalog overflow fails configuration rather than silently hiding tools. These are
Pulse profile decisions, not universal MCP limits. The fixture exercises only the
request cap configuration and a small successful response, not limit enforcement
or deadline cancellation. Those adversarial cases belong to MCP-02/03.

No cache reuse is authorized initially: advertise zero TTL when supported and
send `Cache-Control: no-store`. Later caching must key by authenticated principal,
policy revision and catalog hash. Tool annotations are descriptive hints, never
authorization grants. MCP-03 must resolve schema IDs from the canonical schema
artifacts into JSON Schema 2020-12; the current catalog's IDs alone are insufficient
tool schemas. Unsupported schema shapes fail projection explicitly.

## Ownership and the Pulse seam

| Owner | Responsibility |
|---|---|
| MCP facade/adapter (MCP-02/03) | HTTP admission, revision and envelope validation, discovery, static catalog projection, protocol errors, MCP completion framing |
| Authorization boundary (MCP-04) | Token validation, identity, discovery challenges, per-operation decisions before invocation, principal-safe catalog visibility |
| Entities | Static entity declarations, schema selection, catalog identity and governed operation execution |
| Pulse runtime/provider | Request lifetime, effects, budgets, cancellation and provider bindings |
| Compiler/schema owners | Static lowering and schema codecs; no protocol state or runtime registration |

The proof uses an **existing seam**: a separate facade posts JSON-RPC to the
ordinary Entities HTTP endpoint. The endpoint remains the only executor. The
facade imports neither application handlers nor private runtime entry points.
One successful MCP call results in exactly one governed Pulse HTTP request.

The existing same-request binding cannot simply be reused after MCP parsing:
`EntityRouter.handle(ctx)` is one terminal binding and owns the body. Parsing an
MCP envelope and then handing the consumed context to `jsonRpc()` violates that
ownership. Synthetic contexts and direct handler calls would bypass the boundary.

MCP-02 should start with the external HTTP composition demonstrated here. A
same-artifact Native adapter, if selected, needs a separately reviewed first-party
binding: bounded protocol selection feeding the existing entity/schema/effect
execution plan, with one owner of request decoding and completion. The owning
paths are Entities' compiler binding and the compiler/library-kit application
contract. It must retain target eligibility, request ownership and fail-closed
lowering. It must not add a general `invoke(name, args)` public escape hatch,
mutable runtime registry, third-party lowerer trust or MCP state to runtime core.
MCP-01 makes no change to those protected contracts.

The external HTTP composition also has a deployment constraint: the governed
backend must be private or independently protected. Exposing an unprotected
Entities endpoint beside an authenticated MCP endpoint would bypass MCP policy.
Do not forward a client's bearer token blindly; a backend hop needs separately
scoped credentials and a defined audience/trust policy in MCP-04.

## Authorization profile

Remote service admission is mandatory for the selected product profile. Use the
revision's OAuth 2.1 resource-server model (OAuth draft 13), an explicitly
configured external authorization server and preregistered reference client.
Pulse does not become an authorization server. Client registration/discovery is
configuration, not arbitrary issuer fetching from an incoming token.

MCP-04 owns RFC 9728 protected-resource metadata, authorization-server metadata
(RFC 8414 or OIDC), RFC 8707 resource audience binding and RFC 6750 challenges.
Missing/invalid credentials receive 401; insufficient scope receives 403. Verify
issuer, resource audience, expiry and granted scopes; token format is not assumed
to be JWT. Require HTTPS outside the loopback fixture. Authorization-code clients
use PKCE and validate issuer responses. Dynamic registration is outside this
initial profile; preregistration satisfies the reference-client path.

Default deny by operation. Authenticate before catalog disclosure and authorize
each call before effects. Cancellation, retries and catalog caching must not
transfer authority between principals. MCP-04 must prove deny-before-effects and
challenge/discovery behavior using a controlled issuer fixture, then document the
configured production issuer. This proof is deliberately unauthenticated on
`127.0.0.1`; it is not remote-auth evidence.

## Target matrix

| Target | Existing Entities foundation | MCP-01 evidence | Later acceptance |
|---|---|---|---|
| Node JavaScript | Governed JSON-RPC application | Real reference SDK → facade → `pulse dev` HTTP exchange | Production adapter + installed app, MCP-02/05 |
| Node Native | EN-05 installed Entities workflow | Not measured for MCP | Repeat protocol corpus against Native backend; separately prove any same-artifact adapter |
| Fastly JavaScript | EN-05 local installed workflow | Not measured for MCP | Provider-local adapter acceptance; deployed reality separately |
| Fastly Native | EN-05 local installed workflow | Not measured for MCP | Native no-fallback proof and provider-local acceptance; deployed reality separately |
| Other clients/transports | No compatibility claim | Not measured | Add named client, exact version and evidence before claiming support |

EN-05 is evidence about Entities, not MCP compatibility. Neither this proof nor
the local target rows imply deployment, remote authorization or performance
qualification. No target silently falls back to JavaScript.

## Requirement-to-test matrix

**Proof** means asserted by `mcp-wire-proof` against the reference SDK fixture.
**Planned** means an acceptance requirement, not a passing Pulse implementation.
Case names below are stable names for the owning ticket's future corpus.

| ID | Required behavior / named case | Owner and evidence |
|---|---|---|
| P01 | `modern-discovery`: pinned revision, tools-only discovery, no handshake | Proof; production repeat MCP-02 |
| P02 | `finite-json-envelope`: POST, matching revision/method headers and metadata, echoed IDs, `resultType: complete`, no session | Proof for three successful exchanges; production repeat MCP-02 |
| P03 | `catalog-no-input-tool`: discovery from emitted artifact, object input schema and static title | Proof for one no-input tool; general schema projection MCP-03 |
| P04 | `governed-http-call`: `Mcp-Name`, one backend request, null completion becomes text content | Proof; output schemas and error mapping MCP-03 |
| T01 | `revision-errors`: missing/mismatched headers → 400/-32020; unsupported revision → 400/-32022 with version data | Planned MCP-02 |
| T02 | `http-admission`: media types, Accept handling, malformed JSON, GET/DELETE 405, disallowed Origin 403 | Planned MCP-02 |
| T03 | `envelope-errors`: string/integer IDs, reject null IDs and batches, unreadable ID omitted in errors, unknown method 404/-32601 | Planned MCP-02 |
| T04 | `notifications`: accepted notification 202 with empty body; never emit a JSON-RPC response to it or invoke a tool lacking a call ID | Planned MCP-02; Entities' notification 204 is not MCP framing |
| T05 | `name-headers`: body/header agreement and required base64 name-header decoding, including sentinel edge cases | Planned MCP-02 |
| T06 | `capability-negative`: no legacy lifecycle, sessions, SSE stream, subscription/task/MRTR/resource/prompt methods; removed `ping` is rejected | Implemented MCP-02 shell |
| T07 | `bounded-lifetime`: body/response/tool-count bounds, deadline, disconnect, cleanup and no duplicate invocation | Planned MCP-02/03; cancellation must not claim rollback of effects |
| C01 | `catalog-projection`: deterministic full schemas, eligibility, metadata allowlist, duplicate/invalid names, schema rejection and hash invalidation | Planned MCP-03 |
| C02 | `tool-errors`: unknown tools/malformed params are protocol errors; input validation and execution failures are tool errors (corrected against the pinned tools specification) | Planned MCP-03 |
| C03 | `cache-isolation`: no-store initially; no stale or cross-principal discovery/call state | Planned MCP-03/04 |
| A01 | `oauth-discovery`: protected-resource and AS metadata, resource parameter, PKCE, challenge handling with independent client | Planned MCP-04 |
| A02 | `deny-before-effects`: absent/expired/wrong-issuer/wrong-audience token, insufficient scopes, catalog filtering, backend protection | Planned MCP-04 |
| X01 | `independent-installed-app`: production adapter through pinned independent client, all claimed targets and bounded errors | Planned MCP-05 |

## Reproduce and inspect

With the repository's lockfile-pinned workspace dependencies installed:

```sh
node wasm/scripts/run-wasm-tests.cjs --task mcp-wire-proof --report /tmp/mcp01-run.json
```

This manually selected external-evidence task installs the locked reference SDK
into a temporary directory with lifecycle scripts disabled. It builds example
10 using a source-checkout Entities package, starts `pulse dev --once`, and runs
the independent official client over TCP against the reference server. The
reference server crosses HTTP into Pulse. All processes have finite deadlines;
temporary applications/dependencies are removed on completion.

The task prints a `wasm/.test-results/mcp-wire-*/proof.json` path. It retains source
identity, fixture digests, exact package pins, CLI outputs and `wire.json` with
the three exchanges plus the backend invocation. Verify both the suite's terminal
report and `proof.json` status. Failed runs remain failed; absence of evidence is
not a pass. This task is deliberately excluded from release acceptance until it
tests a production adapter. It is not a clean-installed-consumer claim (MCP-05).

## Primary references

Reviewed 2026-09-29; the dated revision, not `latest`, owns this decision.

- [2026-07-28 base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic)
- [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Official SDK modern-revision migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- Exact published SDK implementations and integrity hashes: [reference lockfile](reference/pnpm-lock.yaml)
- Current Pulse boundary: [Entities and adapters](../../../docs/concepts/entities-and-adapters.md), [current contracts](../../../docs/architecture/current-contracts.md)
