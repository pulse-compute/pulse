# @pulse-compute/pulse

<!-- pulse-package-status:start -->
> **Support tier:** Canonical application surface<br>
> **Audience:** Pulse application authors using the conventional project root, configuration factory, and schema declarations.<br>
> **Install directly:** Yes. Install it in every conventional Pulse project.<br>
> **Supported entry points:** `@pulse-compute/pulse`, `@pulse-compute/pulse/schema`<br>
> **Stability:** Supported conventional application, project-configuration, and schema-authoring contract.<br>
> **npm:** [`@pulse-compute/pulse`](https://www.npmjs.com/package/@pulse-compute/pulse)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.2/packages/pulse/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.2` package policy.
<!-- pulse-package-status:end -->

This package owns the project-aware authoring layer above the low-level
`@pulse-compute/runtime` contract. It currently exports:

- `defineConfig((scope) => ({ ... }))`;
- symbolic `scope.config()` and `scope.secret()` references;
- the conventional `Pulse` application root;
- the project-level TypeScript contract used by `.pulse/config.ts`.

`Pulse` extends the TypeScript `Router` surface for authoring convenience, but it
does not create a second routing system. Compiler analysis normalizes a direct
`new Pulse(...)` root to the existing Router IR and attaches project/profile
metadata beside that IR. Router registration order, matching, terminal `next()`,
error lanes, 404/500 ownership, effects, continuations, and provider realization
remain unchanged.


## Generated project contract

`pulse init` generates the conventional application package directly:

```text
.pulse/config.ts
.pulse/.gitignore
src/index.ts
tests/pulse.harness.ts
```

The generated application uses `new Pulse({ auto: true })`, async managed
handlers, the default `local` native profile, and strict schema policy. The
generated project depends on this package explicitly; it does not rely on an
undocumented transitive application root.

## Application root

```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => {
  return ctx.json({ ok: true })
})

export default app
```

The compiler accepts only direct, statically legible construction forms:

```ts
new Pulse({ auto: true })
new Pulse(configFactory)
```

Aliases, subclasses, factories returning `Pulse`, mounted `Pulse` instances, and
re-exported application roots remain outside the single-entry grammar.
Mounted and child applications continue to use `Router`.

`auto: true` does not perform filesystem or environment discovery inside deployed
application code. Project tooling supplies the normalized workspace/profile plan.
The explicit config-factory constructor is the deterministic semantic reference.


## Profile composition token

`app.profile()` returns an opaque token intended only for direct passage to a
composition helper. Package metadata gives each profile fragment one unique
owner and an explicit helper/re-export ownership vocabulary. Assets and GRIP do
not yet claim a realized helper, so passing the token to those packages remains
unsupported until their composition contracts are implemented. The token cannot
be inspected, stored, destructured, branched on, or returned.

## Async-shaped handlers

Conventional `.pulse` projects require managed handlers to be async-shaped. A
synchronous handler is rejected with `PULSE_HANDLER_ASYNC_REQUIRED`. The only
remaining synchronous-compatibility mode is an explicit migration surface for
legacy root-config projects and sealed internal compiler evidence.

Managed handlers are async-shaped for TypeScript and future explicit JavaScript
execution:

```ts
app.get('/users/:id', async (ctx) => {
  const user = await ctx
    .fetch(`/origin/users/${ctx.param('id')}`)
    .json<User>('app.User')

  return ctx.json({ user })
})
```

For native targets, `async` and trusted `await` are authoring notation only:

- the async wrapper is erased;
- awaited Pulse effects lower to the existing effect and continuation state machine;
- awaiting a synchronous `ctx` surface is erased with a warning;
- `await next()` remains invalid because `next()` is terminal Router transfer;
- arbitrary library awaits remain native-ineligible;
- no Promise runtime, Asyncify, or automatic target fallback is added.

## Request state

`ctx.state` is a small request-scoped string map:

```ts
app.use(async (ctx, next) => {
  ctx.state.set('request-id', 'r1')
  return next()
})

app.get('/health', async (ctx) => {
  return ctx.json({ requestId: ctx.state.get('request-id') })
})
```

State is shared across the forward Router cursor, mounted Routers, error recovery,
and native effect suspension/resumption. It is reset for the next request. The
contract does not expose object-valued state, enumeration, deletion, or persistence.

## Configuration

Canonical configuration is one synchronous deferred factory:

```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'dev',
    strict: true,
  },
  dev: {
    host: 'node',
    target: 'native',
    apiBase: scope.config('API_BASE'),
    token: scope.secret('API_TOKEN'),
  },
}))
```

The scope is symbolic only. It never exposes resolved values, selected-profile
state, commands, or ambient environment access.

With `pulse.strict: true` (the default), schema-less request JSON is rejected.
With `pulse.strict: false`, `await ctx.req.json<T>()` selects the byte-bounded
`host-generic-json` Pulse capability and records its ownership, inclusion reason,
limit, and dynamic-host cost class in compiler/build metadata. The parser is not
embedded in the guest Wasm. Declared schema calls remain specialized and validated
in either mode.

## Current boundaries

`@pulse-compute/pulse` is the public conventional application surface. It does not expose
mixed targets or a public compiler/plugin API, and it does not own Handler IR,
effects, continuations, native lowering, or provider lifecycle.

## Shared runtime type contract

The current project and execution contracts exclude ambient environment resolution,
nested profiles, readable active-profile state, runtime-option merging, and
`listen()` delegation from the wrapper.

`@pulse-compute/pulse` now re-exports the **types** owned by
`@pulse-compute/runtime` for authoring convenience. It does not export a second
Router value, define another handler/context/effect algebra, or own provider
lifecycle. The live wrapper uses the same package-internal Router implementation
while preserving the symbolic configuration factory and opaque profile token. No
public `handle()`, lifecycle method, or profile introspection is added.


## Live wrapper boundary

`Pulse` is now backed by the same live Router implementation as `Router`. Its
application mode and stable opaque profile token are retained in package-private
state for later tooling and package composition. The wrapper still performs no
workspace discovery, profile selection, configuration evaluation, or provider
lifecycle inside application code.
