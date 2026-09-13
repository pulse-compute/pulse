# Beta scope

Pulse `1.0.0-beta.2` is a Beta of one provider-neutral application contract
with explicit Native and JavaScript execution targets. The intended 1.0
surface is present, but deliberate corrections may still occur before the
stable `1.0.0` release.

The Beta is intentionally strict: Pulse builds the target selected by the
active `.pulse/config.ts` profile, and unsupported source stops at the exact
lowering boundary with a stable diagnostic. Pulse never silently switches
targets.

## Supported application behavior

- Async-shaped provider-neutral TypeScript handlers; trusted Pulse awaits lower
  into explicit effects and continuations without a Promise runtime.
- Static Router v2 with terminal middleware, route fallthrough, error
  middleware, GET/HEAD/POST/PUT/PATCH/DELETE routes, exact paths, named parameters, trailing
  wildcards, and acyclic mounts.
- Basic branching and structured object, array, and scalar manipulation.
- Request method, URL, path, headers, text, and JSON access.
- Bounded, memoized structured body decoding.
- Explicit TypeScript JSON schema declarations and literal schema IDs.
- GET, HEAD, and POST fetch effects.
- Independent Native effect grouping, dependent continuation chains, and
  explicit cross-target `ctx.parallel({ ... })` keyed groups.
- HTTP status and headers as ordinary response data.
- JSON, text, custom, and direct pass-through responses.
- Exact-name config and secret reads.
- Named KV `get` and `put`.
- Opaque host-owned binary and stream pass-through.
- Stateless package-root GRIP request classification, response subscription and
  handoff framing, and configured request-bound broadcast.
- Synchronous string logging through `ctx.log.error`, `warn`, `info`, and
  `debug`, with flat profile reporting thresholds and provider-owned output.
- Root-only static `Pulse.on` declarations, immutable schema-validated event
  contexts, and one-way `ctx.emit` acceptance through the bounded Node
  JavaScript/Native reference adapter.
- Provider-neutral portable Wasm and configured Native Node or Fastly builds.
- Direct JavaScript execution and deterministic source packaging for Node and
  Fastly.

## Execution contract

The Beta has two target classes and four explicitly selected
execution modes over one application model:

```text
source
├─ Node / Native        → canonical analysis → Pulse-owned Wasm → Node realization
├─ Node / JavaScript    → graph-backed loader → live packages → Node lifecycle
├─ Fastly / Native      → canonical analysis → direct-host-ABI bin/main.wasm
└─ Fastly / JavaScript  → deterministic source package → Fastly JS runtime candidate
```

Native source that crosses the supported lowering boundary fails visibly with a
stable diagnostic. JavaScript core Router execution, request/response lifecycle,
eligibility inspection, effects, package realizations, source packaging, schema
enforcement, target integrity, and bounded GRIP realization are implemented.
Native/JavaScript conformance covers Router context, body handling, fetch
projections, configuration, secrets, KV, schema codecs, GRIP framing, logging,
and target identity. All declared Node and Fastly full-target-support gates are
satisfied for the implemented four-mode contract.

Fastly JavaScript candidate evidence compiles the deterministic source package
with the exact pinned downstream toolchain and records a structurally deployable
runtime artifact. The final release candidate must additionally pass the
mandatory external Fastly CLI-managed reality lane. Neither result authorizes a
service deployment or activation.

There is no automatic fallback. An operator must select the target through
project configuration or an explicitly permitted CLI target selection. A
successful provider-neutral compile does not silently change a
JavaScript-selected project into a Native one.

## Deliberately unsupported

- Automatic fallback from Native lowering to JavaScript execution.
- Declaring general target availability without satisfying every declared
  full-target-support gate.
- Arbitrary Promise construction, arbitrary library awaits under Native
  selection, JSPI, or Asyncify semantics. Managed `async` wrappers and trusted
  Pulse awaits are supported notation, not a Promise runtime.
- Ambient `fetch`, environment variables, filesystem, process, sockets, or
  timers.
- Provider SDK objects or `ctx.fastly` / `ctx.cloudflare` namespaces.
- Capability enumeration or runtime provider introspection.
- Automatic discovery of arbitrary TypeScript types.
- Dynamic schema IDs.
- Arbitrary binary body inspection or mutation.
- Userland chunk iteration, transform streams, or manual backpressure.
- Background tasks and work that outlives the request.
- Raw TCP or UDP sockets.
- Dynamic GRIP channel, framing-option, or message shapes under Native
  selection.
- Onion-style post-`next()` middleware, assigning or awaiting `next()`, Router
  `throw` transfer, realtime hooks, channels, timeout scopes, `ctx.resolve`, or
  `ctx.resolved`.
- Third-party provider or lowerer self-registration.
- A public event listener, production event transport, delivery/retry
  guarantee, automatic loopback or reentrancy, generic bus, `ctx.call`, or
  request/reply event routing.
- Fastly, browser, or ESP32 event ingress/emit realization. Fastly fails closed
  with exact eligibility diagnostics; browser and ESP32 remain unclaimed.

## Compatibility authority

The single source-form, provider-binding, artifact, and deployment-boundary
table is [Provider and target compatibility](https://pulsecompute.io/v1.0.0-beta.2/reference/compatibility-matrix/).
It uses one public target order—Node JavaScript, Fastly JavaScript, Node Native,
and Fastly Native—and links every row to a focused proof or canonical contract.

The exact portable language subset and the JavaScript-only Native eligibility
boundaries are defined in
[Managed handler TypeScript and JavaScript](https://pulsecompute.io/v1.0.0-beta.2/reference/handler-authoring/).

## Body model

If a body is inspected as text or JSON, Pulse treats it as a bounded immutable
value. If a body is passed through as binary or a stream, it remains an opaque
host-owned capability handle.

```text
inspect it → bounded structured value
pass it through → opaque handle
```

## Compatibility and release signals

- Documented behavior is intentional and evidence-backed.
- Unsupported behavior fails explicitly.
- No execution target silently falls back.
- Public surfaces may still change deliberately before stable `1.0.0`.
- Implementation and historical subpaths do not gain accidental compatibility
  guarantees.
- Package names, release artifacts, and published versions are immutable once
  released.

The intended npm dist-tag for the Beta is `beta`. It becomes
active only through the atomic documentation-release transaction and an
explicitly authorized publication. The workflow never assigns `latest`
implicitly.
