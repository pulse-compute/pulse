# Entity engine, adapters, and facades

Pulse Entities separates governed operation semantics from the protocol that
selects an operation and from any facade that presents those operations to an
external ecosystem.

## The four layers

| Layer | Owns | Does not own |
|---|---|---|
| Entity engine | Static operation names, schema declarations, handler identity, governed execution, deterministic catalog | HTTP/JSON-RPC syntax, MCP lifecycle, provider SDKs |
| JSON-RPC adapter | Bounded envelope parsing, request/notification selection, named params, stable JSON-RPC result/error framing | Handler semantics, schema registry authority, direct provider access |
| Tools or MCP facade | Catalog projection, external tool naming/annotations, transport-facing invocation policy | Direct handler calls, runtime registry mutation, hidden Pulse authority |
| Worker/event adapter (future) | A separately specified event/request binding and response/acknowledgement mapping | Changes to entity declarations or handler effect authority |

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

The [Entities tools example](../../examples/10-entities-tools/) demonstrates a
small facade that projects static metadata and invokes JSON-RPC. It is
intentionally not a complete MCP implementation. Pulse runtime core does not
gain SSE, sessions, tasks, resources, prompts, sampling, authorization,
transport negotiation, or MCP lifecycle state from this candidate.

A complete MCP server could be built outside the entity engine if it preserves
these rules: static discovery comes from an emitted catalog, invocation crosses
a governed adapter boundary, external protocol state stays outside runtime
core, and MCP behavior never becomes a source of provider or schema authority.

## Future adapters

A Worker, queue, scheduled-event, or other event adapter would be a new
first-party adapter contract. It would define bounded selection and completion
for that event shape while retaining the same static declaration, schema,
handler, effect, catalog, and no-fallback rules. The current package does not
open third-party adapter registration or claim those adapters exist.

See the [Entities package guide](../packages/entities.md) for current behavior
and [Entities lowering](../contributing/entities-lowering.md) for the trusted
maintainer boundary.
