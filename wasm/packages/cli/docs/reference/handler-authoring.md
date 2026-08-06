# Managed handler TypeScript and JavaScript

This is the canonical language reference for managed Pulse handlers. It defines
the shared TypeScript/JavaScript authoring shape, the subset that can lower to
Native, and the extensions available only under an explicitly selected
JavaScript target.

The authoritative four-mode support table is
[Provider and target compatibility](./compatibility-matrix.md). Target
selection never silently rewrites the application or falls back to another
target.

## One source model

Pulse accepts `.ts`, `.mts`, `.js`, and `.mjs` project modules through the
reachable project graph. TypeScript annotations, interfaces, type-only imports,
generic arguments, and `as const`-style authoring metadata do not become
runtime capabilities. JavaScript and TypeScript use the same managed handler,
Router, context, effect, and result contract.

Portable handler code should stay inside the subset the Native plan can encode:

- scalar, array, and object literals, including supported literal spreads;
- simple local declarations and assignments;
- property and element reads;
- template strings;
- arithmetic, comparison, equality, boolean, bitwise, and nullish operators;
- prefix unary operators, updates, and conditional expressions;
- `if`/`else`, blocks, expression statements, and explicit returns;
- static calls to the documented `ctx`, Router, and supported package-root
  surfaces.

The compiler, not the file extension, decides Native eligibility. A `.js` file
can be Native-eligible, and a `.ts` file can cross the Native boundary.

## Native language boundary

Native lowering requires source that resolves to the bounded canonical plan.
The current Native subset rejects or records a boundary for:

- `for`, `for...of`, `for...in`, `while`, and `do...while` loops;
- `switch`, `try`/`catch`/`finally`, and authored `throw`;
- classes, constructors, `new`, `this`, generators, and optional chaining;
- nested function or closure execution in a managed handler;
- general destructuring declarations, except the recognized static result
  binding produced by `await ctx.parallel({ ... })`;
- dynamic imports, CommonJS `require`, runtime module discovery, and dynamic
  calls the compiler cannot resolve;
- recursion, top-level mutable runtime state, or capture of module-evaluation
  values;
- arbitrary Promise construction or library awaits;
- ambient authority such as global `fetch`, timers, process/environment,
  filesystem, sockets, randomness, or provider SDKs.

An explicitly selected JavaScript application may keep ordinary
provider-compatible JavaScript packages, Promise construction, and library
awaits. Those forms are recorded as Native eligibility boundaries. They do not
permit ambient host authority, do not become Pulse effects, and cannot be used
inside `ctx.parallel`.

## Why handlers are async-shaped

Every managed handler returns a promise-shaped result in TypeScript:

```ts
type Handler = (
  ctx: PulseContext
) => Promise<PulseResult | PulseFetchResponse>
```

JavaScript targets execute that shape through a provider-owned request
lifecycle. Native targets treat the wrapper as authoring notation. The compiler
turns trusted host operations into explicit effects and the following code into
continuations, then removes `async` and `await` from generated Native code.

This gives one familiar source shape without pretending that Native contains a
general JavaScript Promise runtime.

Static event handlers use the same managed notation with a non-HTTP context and
void completion:

```ts
app.on('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const mode = await ctx.config.get('MODE')
  ctx.state.set('mode', mode)
  void ctx.event.payload
})
```

`ctx.event.type` is the exact registered type and `ctx.event.payload` is the
immutable schema-validated payload, or `null` for a no-payload registration.
Event handlers cannot access request metadata, route parameters, response
builders, Router transfer, middleware, or a response result. Eligible handlers
lower through the conditional provider-neutral Native event entry and reuse the
existing effect/continuation state machine. This does not activate a provider
event transport or target-support claim.

See [Static events and outbound emission](../guides/events.md) for the complete
frame, queue, harness, target, Native-extension, and explicit no-call contract.

## Trusted awaits

The portable awaited forms are Pulse-owned operations:

- `ctx.req.text()` and `ctx.req.json(schemaId?)`;
- `ctx.fetch(url, init)` and its `.text()` or `.json(schemaId?)` projections;
- `ctx.config.get(name)` and `ctx.secret.get(name)`;
- `ctx.kv(namespace).get(key)` and `.put(key, value)`;
- `ctx.parallel({ ... })`;
- request-bound effects from supported package roots, such as
  `grip.broadcast(ctx, message)`.

Response construction, request metadata, route parameters, `ctx.state`, and
`ctx.log` are synchronous. Awaiting a proven synchronous value is redundant and
may produce a warning.

The canonical synchronous context forms include `ctx.req.method`,
`ctx.req.url`, `ctx.req.path`, immutable `ctx.req.headers`, the
case-insensitive `ctx.req.header(name)` helper, `ctx.param(name)` inside matched
route handlers, `ctx.state.get` / `ctx.state.set`, response builders, and fixed
`ctx.log` methods. The [context API map](../../API.md#context-at-a-glance)
separates HTTP-only, route-only, event-only, and shared execution authority.

Arbitrary library awaits and Promise construction are JavaScript-only. They are
not Pulse effects, do not enter `ctx.parallel`, and make the same source
ineligible for Native compilation.

`ctx.emit(type, { schema, payload? })` is a recognized Pulse effect for direct
JavaScript execution and Native lowering. It requires literal event/schema
identities and direct await, or placement as a fresh member of an awaited
`ctx.parallel` group. Native emits the same canonical effect descriptor and
resumes its ordinary continuation after host acceptance; no Promise runtime,
JavaScript import, Asyncify transform, or fallback is added. Node has a bounded
reference ingress/acceptance realization for direct parity evidence. It is not
a public bus or a delivery guarantee, and other provider eligibility remains
separate.

## `ctx.parallel` is an explicit portable group

Use `ctx.parallel` when operations must begin together across all four modes:

```ts
const { profile, flags } = await ctx.parallel({
  profile: ctx.fetch(profileUrl).json<Profile>(),
  flags: ctx.fetch(flagsUrl).json<Flags>(),
})
```

The accepted shape is deliberately narrow:

- one nonempty inline object literal;
- fixed, unique, non-index string keys;
- no spreads, computed keys, getters, methods, arrays, or dynamic records;
- one fresh execution-owned `PulseParallelEffect` per value;
- no arbitrary promises, reused roots, cross-request effects, or nested groups.

Property order owns effect identity, trace order, deterministic primary-failure
selection, and keyed result reconstruction. Every member settles before the
continuation resumes.

Separate awaits retain normal sequential behavior on JavaScript. Native may
also group adjacent independent trusted effects internally, but that
optimization is not a portable concurrency promise. Use `ctx.parallel` when
concurrency is application behavior.

## Static application boundaries

Beyond the expression and statement subset above, Native eligibility requires
an application graph the compiler can prove:

- a statically reachable project entry and module graph;
- async-shaped managed handlers with a simple `ctx` identifier;
- static Router construction, route methods, paths, mounts, and handler
  references;
- root-only static `Pulse.on` registrations with literal event/schema identities,
  one exact owner per event type, and void event-handler completion;
- literal schema and response-case identities;
- supported `ctx` call shapes and bounded object options;
- supported package-root imports with the package's documented static
  arguments;
- no dynamic import, generator handler, nested async handler, provider SDK, or
  ambient authority.

JavaScript targets preserve a broader ordinary package and async surface, but
the provider's runtime and packaging environment still decide whether a
dependency is compatible. A Node-only dependency does not become Fastly
compatible merely because both targets are JavaScript.

## Router topology and terminal transfer

`Router` is a compile-time authoring marker. The v2 surface supports static
`get`, `head`, and `post` routes; exact, named-parameter, and trailing-wildcard
paths; global and path-scoped middleware; acyclic mounts; fallthrough; and
error middleware.

`next()` is terminal:

```ts
app.use(async (ctx, next) => {
  if (!authorized(ctx)) return ctx.text('unauthorized', { status: 401 })
  return next()
})
```

The current handler never resumes after `return next()` or
`return next(error)`. Assigning, awaiting, or calling `next()` without returning
it is rejected. Pulse does not provide onion-style post-`next()` work.

## JSON and body ownership

With the default `pulse.strict: true`, request, fetch, and response JSON
boundaries use static schema or response-case IDs declared by the project.
Setting `pulse.strict: false` deliberately enables bounded generic JSON and
records that parser requirement in the plan.

Structured bodies may be read as bounded text or JSON. Opaque bodies remain
host-owned. Return an opaque fetch or package result directly; do not inspect
its bytes, iterate chunks, transform it, or retain it beyond the request.

## Supported imports and extension boundaries

Canonical source may import:

- `@pulse-compute/pulse` and `@pulse-compute/runtime`;
- supported package roots such as `@pulse-compute/assets` and
  `@pulse-compute/grip`;
- ordinary JavaScript dependencies when the explicitly selected JavaScript
  target can package and execute them.

Native lowering recognizes only the core contract and synchronized trusted
package-root lowerers. Compatibility `/pulsewasm` subpaths are not the preferred
authoring surface. Arbitrary third-party lowerer loading and provider SDK
imports are unsupported.

See [Pulse-aware package authoring](../contributing/pulse-aware-packages.md),
[Compatibility imports and migration](../guides/compatibility-imports.md), and
the target cells in the [compatibility matrix](./compatibility-matrix.md).

## How Native ineligibility is reported

For a Native-selected profile, `doctor`, `inspect`, `compile`, and `build`
report source-located eligibility diagnostics and stop before target
realization. Common classes include unsupported awaits, ambient authority,
dynamic topology, unresolved package ownership, and unsupported package call
shapes.

For an explicitly selected JavaScript profile, inspection records Native
eligibility separately from JavaScript target support. A JavaScript build may
proceed when its own project, package, capability, and provider requirements
are eligible. A Native failure never triggers automatic JavaScript fallback,
and Pulse does not choose Native after an explicit JavaScript selection.

Use:

```bash
pulse doctor --json
pulse inspect --json
```

Then follow the stable diagnostic and its source location. See
[Troubleshooting](../guides/troubleshooting.md), [Diagnostics and
remediation](./diagnostics.md), [Static Router authoring](../guides/routing.md),
[Effects and continuations](../concepts/effects-and-continuations.md), and
[Structured and opaque bodies](../concepts/bodies.md).
