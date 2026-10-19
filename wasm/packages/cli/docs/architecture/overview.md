# Architecture overview

Pulse separates what an application does from how a host executes it. You write
handlers, routes and schemas in TypeScript, then select a **target** (Native or
JavaScript) and a **provider** (such as Node or Fastly) in a project profile.
Changing the target is an explicit choice; unsupported Native source never
silently runs as JavaScript.

> For detailed ownership rules and invariants, see the
> [Architecture contracts](./current-contracts.md).

The two execution paths share the application contract, but produce different
artifacts:

| Selected target | Path from source to execution |
|---|---|
| Native | Eligible source → canonical operations and continuations → Pulse-owned Wasm → provider realization. |
| JavaScript | Validated application topology and resolved source graph → provider source package → JavaScript execution with the Pulse runtime. |

Both paths validate recognized Pulse capabilities against the selected provider.
JavaScript inspection describes recognized Pulse behavior; it does not inspect
arbitrary dependency internals or establish a sandbox. Start with
[Targets and host work](../concepts/targets-and-hosts.md) for the target matrix.

## Canonical API

`@pulse-compute/pulse` owns the conventional `Pulse` application root, project
configuration helpers and schema declarations. `@pulse-compute/runtime` owns
portable handler/context types and the static `Router` contract. These are
frontends to the same application model, not separate execution systems.

Handlers request managed host work through `ctx`: fetch, config, secrets, KV,
time and supported package effects. Provider bindings supply the implementation
and authority; handlers do not receive provider SDK objects. Schemas define
bounded structured input and output. See the [Pulse](../packages/pulse.md) and
[runtime](../packages/runtime.md) package guides.

## Whole-project compiler

The compiler resolves the reachable source graph, checks static application
topology and schemas, and identifies supported operations. Native compilation
must prove the admitted source shapes before producing its effect/continuation
plan and Wasm. Trusted package lowerers can contribute narrow operations.

An explicit JavaScript target retains the original source graph and ordinary
JavaScript dependency calls. Native eligibility is checked separately: a Native
rejection can be advisory for JavaScript inspection, but `pulse compile` still
requires a real Native compilation. Use `pulse build` to produce the selected
provider/target output. See [Compilation and lowering](../concepts/compilation-and-lowering.md).

## Lifecycle

Each HTTP request or direct event invocation owns its state, effects and pending
work. A managed effect asks the provider to perform an operation; its result
allows the waiting work to continue. Native represents that continuation
explicitly. JavaScript uses the execution-owned runtime and effect adapter.
Application code does not create or resume continuation objects.

Use `ctx.parallel` when independent work must be concurrent across targets.
Completion, failure, expiry and cancellation are execution boundaries: late
results cannot resume terminated work. Cancellation does not roll back an
already dispatched remote write. See [Effects and continuations](../concepts/effects-and-continuations.md).

HTTP and event handlers share execution authority, but event handlers have no
HTTP request/response surface and complete with `void`. Native event entries
are conditional on event reachability and separate from HTTP entries.
`ctx.emit` accepts a schema-bound one-way frame; it provides no delivery receipt,
retry, request/reply call or automatic local loopback. Node's bounded reference
adapter proves direct ingress/acceptance behavior, not a public event bus or
production transport. Other provider eligibility remains separate. See
[Static events and outbound emission](../guides/events.md).

## Bodies

Network text/JSON can become bounded, request-owned structured values. Opaque
binary or streaming responses remain host-owned and cross only supported
boundaries. The [bodies guide](../concepts/bodies.md) owns the distinctions,
provider limits and experimental forwarding/output exceptions.

Explicitly admitted embedded resources are a separate source of immutable data,
not a way to inspect opaque network bodies. Current source exposes bounded
[resource reads](../../API.md#ctxresources) and request-local
[numeric workspaces](../../API.md#ctxworkspace). These primitives do not by
themselves qualify an MCP service, retrieval product or deployed application.

## Providers

A target chooses the execution model. A provider supplies host capabilities,
bindings, local execution and target packaging. Node and Fastly each have Native
and JavaScript paths; `none` is compile-only and cannot execute handlers.

**Target support** describes a provider/target lane's declared gates.
**Project eligibility** asks whether this application's reachable source,
capabilities and bindings fit that lane. A supported target can reject a
particular project. Missing capabilities fail closed, without another target
or provider being selected automatically.

Local tests, a completed build, external engine acceptance and a deployed
service prove different things. A passing doctor or inspection is not deployment
evidence. See [Contracts and providers](../concepts/contracts-and-providers.md)
and the [compatibility matrix](../reference/compatibility-matrix.md).

## Package extensions

Ordinary application imports, executable lowerers and providers are distinct
boundaries. Importing a package grants no compiler-plugin authority. A declared
lowerer executes as a trusted build dependency with the compiler process's
authority; it is not sandboxed. Admission checks protocol versions and package
ownership, without a publisher allowlist or matching Pulse release version.

Domain packages own their API-to-operation mapping; shared contracts own the
operation/result semantics; compiler core orchestrates lowering; providers
realize the operations. Provider packages are explicitly selected through the
versioned `./toolchain` export, without scanning or self-registration.

See [Package-owned lowering](../concepts/package-owned-lowering.md) and
[Pulse-aware package authoring](../contributing/pulse-aware-packages.md).
Older `/pulsewasm` imports retain their bounded
[compatibility migration guidance](../guides/compatibility-imports.md).

## Maintenance authority

For repository changes, [Maintainer governance](../maintainers/README.md) and
`release/maintenance-policy.json` own classification, checks and authority.
Agents can prepare bounded patches; humans retain architecture, merge,
repository-setting and release authority.

## Current architecture and extension readiness

Continue with [targets](../concepts/targets-and-hosts.md),
[providers](../concepts/contracts-and-providers.md),
[effects](../concepts/effects-and-continuations.md),
[bodies](../concepts/bodies.md), then
[compilation](../concepts/compilation-and-lowering.md).
[Entities and adapters](../concepts/entities-and-adapters.md) explains how
protocol-facing facades preserve governed operation boundaries.

The [Architecture contracts](./current-contracts.md) retain implementation-level
invariants. [Vision](./vision.md) is directional, not a support promise.
General compiler hooks and untrusted plugin isolation remain deferred in the
[plugin readiness record](../maintainers/plugin-readiness.md).
