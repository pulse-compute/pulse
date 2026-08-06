# Architecture overview

Pulse keeps the user model small by separating semantics from realization.
The [current architecture contracts](./current-contracts.md) are the
authoritative present-tense map of the ownership and invariants summarized
below.

```text
handler source
→ canonical compiler analysis
→ schema and trusted package lowering
→ explicit effect and continuation program
→ provider capability contract and lowering plan
→ provider runtime or target
```

## Canonical API

`@pulse-compute/runtime` contains the provider-neutral application contract, plain handler types, and the static `Router` authoring marker. `ctx` is the sole user authority. Start with the [runtime package guide](../packages/runtime.md).

## Whole-project compiler

The project compiler analyzes the handler, compiles explicitly declared JSON schemas, invokes trusted first-party package-owned lowerers such as GRIP and assets, links literal references, and emits one canonical program. It does not run arbitrary user JavaScript. See [Compilation and lowering](../concepts/compilation-and-lowering.md).

## Lifecycle

Host operations become explicit effects. The runtime owns continuation creation,
grouped joins, resume, failure, expiry, and completion. Handlers are
async-shaped across targets: Native lowering erases managed wrappers and lowers
trusted awaits into effects and continuations, while JavaScript targets execute
the same contract through an execution-owned runtime that isolates each HTTP
request or direct event invocation. Eligible event handlers also lower into a
provider-neutral Native application entry with exact event selection, a
schema-validated host-owned payload handle, void completion, and the same
effect/continuation state machine. The conditional event ABI appears only in
event-reachable artifacts and remains separate from the HTTP entry.

The runtime treats `ctx.emit` as a schema-bound, one-way acceptance effect: it
is execution-owned, parallel-eligible, and never loops back into local event
dispatch. Native uses the same effect/continuation protocol without JavaScript
or Asyncify imports. Node declares explicit event ingress/emit capabilities and
owns a bounded FIFO reference adapter for direct JavaScript/Native parity; this
is not a public event bus or production transport. Other provider realization
and ordinary workflow eligibility remain separate work. The event plane
reserves no call/request-reply operation and cannot route an emitted frame back
into local handlers. See [Static events and outbound
emission](../guides/events.md) and [Effects and
continuations](../concepts/effects-and-continuations.md).

## Bodies

Structured text/JSON bodies become bounded values. Binary and streaming bodies remain opaque host-owned handles and may only be routed or returned through supported operations. See [Structured and opaque bodies](../concepts/bodies.md).

## Providers

Providers validate and realize canonical operations. They do not add SDK objects or provider namespaces to user scope.

- Node provides explicit Native and JavaScript execution, build, local lifecycle
  evidence, and an invocation-scoped reference event ingress/acceptance adapter.
- Fastly provides explicit Native and JavaScript packaging and execution
  candidates, plus a mandatory external `fastly compute serve` reality gate for
  the final release candidate.
- `none` is compile-only and cannot execute handlers.

A descriptor, local runtime, target build, external reality gate, and remote
deployment are different proof levels. Target selection is explicit and never
falls back automatically. See
[Contracts and providers](../concepts/contracts-and-providers.md).

## Package extensions

Domain packages own their narrow package-root facade-to-contract mapping and
compiler builder. Shared contracts own payload/status semantics. Compiler core
owns trusted discovery and orchestration; providers own realization.

The current release accepts only first-party builders and does not expose an
external plugin API. Older `/pulsewasm` imports are isolated in the
[compatibility migration guide](../guides/compatibility-imports.md). See
[First-party package-owned lowerer workflow](../contributing/adding-first-party-lowerer.md).


## Maintenance authority

`release/maintenance-policy.json` classifies change intent, protected boundaries, validation, and resident-maintainer authority. Deterministic checks remain authoritative; Codex can analyze, review, and prepare bounded patches, while human CODEOWNERS retain architecture, merge, repository-setting, and release authority. See [Maintainer governance](../maintainers/README.md).

## Current architecture and extension readiness

The current compilation, effect, provider, and trusted-lowerer boundaries are
documented in the [current architecture contracts](./current-contracts.md) and
the linked concept pages. The generated [public plugin API readiness
record](../maintainers/plugin-readiness.md) keeps third-party plugin design deferred until
trust, discovery, negotiation, security, compatibility, and isolated loading
are implemented and release-gated.
