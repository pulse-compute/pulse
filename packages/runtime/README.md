# `@pulse-compute/runtime`

<!-- pulse-package-status:start -->
> **Support tier:** Canonical application surface<br>
> **Audience:** Pulse application authors and library authors who type portable handlers and static routers.<br>
> **Install directly:** Yes. Install it in every Pulse application.<br>
> **Supported entry points:** `@pulse-compute/runtime`<br>
> **Stability:** Supported application authoring and execution contract.<br>
> **npm:** [`@pulse-compute/runtime`](https://www.npmjs.com/package/@pulse-compute/runtime)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/runtime/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

`@pulse-compute/runtime` is the low-level, provider-neutral Pulse application contract.

```ts
import { Router } from '@pulse-compute/runtime'

const app = new Router()

app.get('/health', async (ctx) => {
  return ctx.json({ ok: true })
})

export default app
```

The source grammar distinguishes:

- synchronous metadata, route parameters, response construction, and `ctx.state`;
- awaited request-body and capability effects;
- terminal unawaited `return next()` and `return next(error)` transfers.

`ctx.state` is a request-local string map exposed through `get` and `set`. Canonical Node and native Wasm execution preserve it across effect continuation resume and isolate it between requests.

## TypeScript semantic authority

The package-internal JavaScript dispatcher and the native compiler implement the
same public authoring contract. The public root does not publish `handle()`,
lifecycle, raw host access, or provider authority. Both realizations retain route
ordering, path/mount behavior, request-local state sharing, Web Request/Response
boundaries, and error recovery under the current contracts:

- `next()` is terminal and forward-only;
- authored throws and implicit fallthrough remain rejected;
- lifecycle belongs to providers;
- dynamic context decoration and generic session/gateway state do not return to
  the portable core;
- effects, package operations, and provider requirements remain owned by their
  sealed contracts.

The active package remains the one core type authority. Pulse-prefixed handler
aliases refer to the existing handler algebra rather than introducing parallel
interfaces.


## Package-internal JavaScript realization

The package contains a live Router/context implementation used by package-local
contract tests and the explicit Node and Fastly JavaScript targets. It supports registration,
scoped middleware, mounts, parameters, terminal forward transfer, error recovery,
request-local string state, response helpers, and provider-injected effects.

This is deliberately not a new public application execution method. `Router` still
exposes only the portable authoring surface, and providers remain responsible for
request adaptation, lifecycle, and capability injection.

The provider-maintainer subpath `@pulse-compute/runtime/host` validates and executes
a Router, Pulse application, or managed handler without adding `handle`, `bind`,
`listen`, or `serve` to the application object. JavaScript providers plan and
load source applications, adapt their request boundary, and own their development
lifecycle. The runtime root still exposes no lifecycle methods.


## Synchronous logging

Every context exposes string-only `ctx.log.error`, `warn`, `info`, and `debug`
methods. The flat profile `reporting` threshold defaults to `info`. Native
lowering removes disabled calls and emits enabled messages through `pulse_log`;
JavaScript targets filter through the same level contract at runtime. Logging is
not an effect, never suspends a handler, and a provider sink failure does not fail
the request. Known request secrets are redacted before managed emission.


## Shared effect adapter and portable concurrency

JavaScript host operations route through one request-owned effect adapter. The
adapter owns deterministic request-local identities, cancellation,
settlement, pending-work containment, bounded observations, and one-time cleanup.
Provider and package implementations use this internal boundary; applications do
not import it.

Use a fixed keyed object with `ctx.parallel({ ... })` when concurrency itself is
portable application behavior:

```ts
const { profile, flags } = await ctx.parallel({
  profile: ctx.fetch('https://api.example.test/profile').json<Profile>(),
  flags: ctx.fetch('https://api.example.test/flags').json<Flags>(),
})
```

The initial contract requires a nonempty inline object literal with fixed,
non-index string keys and Pulse effect expressions as values. Property order owns
dispatch identity, result reconstruction, trace order, and deterministic primary
failure selection. Every member settles before continuation. Arrays, spreads,
computed keys, methods, accessors, dynamic records, arbitrary promises, reused
effect roots, and nested groups are outside the portable shape.

Separate JavaScript awaits retain ordinary sequential JavaScript behavior. Native
lowering may still group adjacent eligible effects for performance; that implicit
grouping is not the portable concurrency contract. General JavaScript target
availability is owned by the explicit target-support gates.

## Provider-maintainer host bridge

`@pulse-compute/runtime/host` is a non-root provider-maintainer subpath. It
validates managed application exports and executes the same live
Router implementation through Web `Request`/`Response` boundaries. The root
runtime export remains unchanged, and application objects still expose no
`handle`, `bind`, `listen`, or `serve` methods.

The host bridge is substrate for provider realizations. It is not a public
application lifecycle API. Node and Fastly request adapters and provider-owned
development servers use it under the current four-mode parity and target-support
gates.
