# `@pulse-compute/pulse`

`@pulse-compute/pulse` is the conventional application-authoring package for a
Pulse project. It owns the project-aware `Pulse` application root, deferred
configuration factory, and static schema declarations while reusing the
provider-neutral runtime contract.

## Install

```bash
npm install @pulse-compute/pulse@1.0.0-beta.3
```

The package exposes two supported entry points:

- `@pulse-compute/pulse` for `Pulse`, `defineConfig`, and runtime-owned
  authoring types;
- `@pulse-compute/pulse/schema` for `schema`, `response`, and
  `defineSchemaRegistry`.

## Application root

```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => {
  return ctx.json({ ok: true })
})

export default app
```

`Pulse` extends the same live `Router` implementation exposed by
`@pulse-compute/runtime`; it does not introduce a second routing or execution
system. Compiler analysis normalizes the application into the canonical Router
IR before target selection and provider realization.

`Pulse` also owns root-only static event registration:

```ts
app.on('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const reading = ctx.event.payload
  await ctx.config.get('MODE')
  void reading
})

app.on('system.tick', { schema: null }, async (ctx) => {
  void ctx.event.type
})
```

Event types and schema IDs are literal compiler inputs, every type has one
owner, and non-null schemas must resolve through the project registry. Event
handlers receive a non-HTTP context and complete with `void`. The compiler
places HTTP and event handlers in separate planes of one application-entry
table. Eligible event handlers can lower through the conditional
provider-neutral Native event ABI. Node has a bounded invocation-scoped
reference ingress and outbound-acceptance adapter for direct JavaScript/Native
parity, but no public event bus, deployment listener, delivery guarantee, or
other provider target support is implied.

The complete authoring, frame, queue, target, diagnostic, and no-call boundary
is documented in [Static events and outbound emission](../guides/events.md).

The statically analyzable root forms are:

```ts
new Pulse({ auto: true })
new Pulse(configFactory)
```

Aliases, subclasses, factories returning `Pulse`, mounted `Pulse` instances, and
re-exported application roots remain outside the initial single-entry grammar.
Use `Router` for mounted and child applications.

## Project configuration

Canonical configuration is one synchronous deferred factory:

```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
    reporting: 'info',
  },
  local: {
    host: 'node',
    target: 'native',
    apiBase: scope.config('API_BASE'),
    token: scope.secret('API_TOKEN'),
  },
}))
```

The scope produces symbolic configuration and secret references only. It does
not expose selected-profile state, resolved values, commands, or ambient
environment authority.

## Schema declarations

```ts
import {
  defineSchemaRegistry,
  response,
  schema,
} from '@pulse-compute/pulse/schema'

interface User {
  id: number
  name: string
}

export default defineSchemaRegistry({
  schemas: {
    'app.User': schema<User>(),
  },
  responses: {
    'app.UserResponse': response(200, 'app.User'),
  },
})
```

Schema calls are static declarations consumed by the compiler. They do not add
runtime reflection or generic JSON parsing to the guest module.

## Async-shaped handlers and execution state

Conventional projects require async-shaped handlers. Native lowering erases the
wrapper and lowers only recognized Pulse effects; it does not add Promise or
Asyncify runtimes.

See [Managed handler TypeScript and
JavaScript](../reference/handler-authoring.md) for the canonical static source
rules and JavaScript-only boundary, and the [compatibility
matrix](../reference/compatibility-matrix.md) for four-mode support.

`ctx.state` is an execution-scoped string map. HTTP executions share it across
the forward Router cursor, mounted routers, error recovery, and Native
continuation resumption; event executions share it across their continuation
resumption. It is reset between HTTP requests and event invocations and does
not expose enumeration, object values, or persistence.

## Ownership boundary

This package owns application ergonomics and declarations. It does not own
Handler IR, effects, continuations, Native lowering, provider lifecycle, or
provider-specific bootstraps. Fastly and other host realization remains in the
corresponding provider package.

For the lower-level static Router and complete context contract, see
[`@pulse-compute/runtime`](./runtime.md). For project orchestration, see
[`@pulse-compute/cli`](./cli.md).
