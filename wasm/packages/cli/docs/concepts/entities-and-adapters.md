# Entity engine, adapters, and facades

Pulse Entities separates governed operation semantics from the protocol that
selects an operation and from any facade that presents those operations to an
external ecosystem.

<a id="the-four-layers"></a>

## The three layers

| Layer | Owns | Does not own |
|---|---|---|
| Entity engine | Static operation names, schema declarations, handler identity, governed execution, deterministic catalog | HTTP/JSON-RPC syntax, MCP lifecycle, provider SDKs |
| JSON-RPC adapter | Bounded envelope parsing, request/notification selection, named params, stable JSON-RPC result/error framing | Handler semantics, schema registry authority, direct provider access |
| Tools or MCP facade | Catalog projection, external tool naming/annotations, transport-facing invocation policy | Direct handler calls, runtime registry mutation, hidden Pulse authority |

The entity engine is therefore not a server. `EntityRouter` records a static
registry and binds it to one governed request. `jsonRpc()` is the only current
adapter. A facade may read the emitted `entities-catalog.json` and construct a
request for that adapter, but it cannot enumerate live handler functions or
call them outside a Pulse request context.

## Why the catalog is protocol-neutral

The catalog contains operation names, schema IDs, static metadata, and target
eligibility. It excludes handlers, raw requests, request IDs, provider objects,
secrets, and runtime values. That makes it suitable for build-time discovery
without making discovery a new ambient runtime authority.

The inspection artifact is richer and maintainer-facing: it adds redacted
handler-effect summaries and measured target evidence. Neither artifact is a
mutable service registry.

## Authority flow

1. Project configuration owns declared schemas and provider selection.
2. The trusted first-party lowerer extracts entity declarations without
   evaluating application code.
3. The selected adapter owns bounded protocol decoding and operation selection.
4. The selected schema codecs decode only the chosen input and encode only the
   chosen output.
5. The handler receives the normal request-owned `PulseContext`; every fetch,
   config, secret, KV, log, or package effect remains governed by that context.
6. The adapter frames completion. A facade sees only the framed boundary.

No layer may silently choose another target. Native ineligibility fails closed;
it never authorizes JavaScript fallback.

## MCP/tools boundary

[`@pulse-compute/mcp`](../packages/mcp.md) provides two explicit ways to expose
governed tools. Both keep protocol framing outside the entity engine.

| Binding | How a tool is invoked | Where it runs |
| --- | --- | --- |
| Static `@pulse-compute/mcp/pulse` facade | Admits the MCP request and dispatches the selected Entities operation inside the same invocation. | Node Native, Fastly Native or explicit Node JavaScript. |
| Host `@pulse-compute/mcp` or `/node` adapter | Projects an emitted catalog and sends one request to a fixed governed Entities HTTP endpoint. | Ordinary JavaScript host code. |

The static facade is the path used by the
[compiled Pulse context server](../../examples/12-pulse-context-mcp/README.md#compiled-application-workflow).
It dispatches a statically declared set of tools without an internal HTTP hop. Entities
owns input/output validation and operation invocation; MCP owns admission,
discovery and result framing. Reusable computation runs through the same
[`ctx.call`](../../API.md#ctxcall) boundary available to admitted HTTP handlers,
with shared request budgets and no extra host authority.

The separate host adapter retains optional external OAuth admission and
backend credentials. Those options do not apply to the static facade. Its
fixed endpoint, matching catalog/schema artifacts and deployment protection
are application responsibilities. See the [MCP package guide](../packages/mcp.md)
for exact imports, limits and authorization boundaries.

The [Entities tools example](../../examples/10-entities-tools/) remains a small
JSON-RPC/tool-projection example. Use the context server for a complete bounded
MCP application. Neither binding introduces a mutable runtime registry or
provider authority through tool metadata.

<a id="future-adapters"></a>

## Adapter scope

`jsonRpc()` is the supported Entities adapter. Queue, scheduled-event and other
adapter shapes require separately defined selection, completion and lifecycle
contracts; there is no third-party adapter registration surface. Pulse's
[static event handlers](../guides/events.md) are a separate application entry
plane, not an Entities adapter.

See the [Entities package guide](../packages/entities.md) for current behavior
and [Entities lowering](../contributing/entities-lowering.md) for the trusted
maintainer boundary.
