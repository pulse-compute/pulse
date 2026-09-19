# Compilation and lowering

Pulse handlers are async-shaped TypeScript, but native targets do not execute them with a JavaScript Promise runtime. The `pulse` CLI compiles the whole project into a provider-neutral program, records every trusted host operation the program requires, and then asks the selected provider to realize those operations.

This page explains that process. Start with [Getting started](../getting-started.md) when you only need to run an application.

## The compilation path

```text
async Pulse or Router application + .pulse/config.ts profile
            │
            ▼
project normalization and schema loading
            │
            ▼
canonical authoring lowering
  routes • values • branches • effects • continuations
            │
            ▼
provider-neutral native execution plan
            │
            ├── pulse compile → compact Pulse-owned Wasm
            │
            ▼
capability requirements and provider operations
            │
            ▼
provider lowering plan
            │
            ├── Node execution/build output
            └── Fastly Compute source + bin/main.wasm
```

**Lowering** means translating a higher-level source operation into a smaller, explicit representation that later stages can validate and execute. It is not minification and it is not merely TypeScript-to-JavaScript transpilation.

The compiler must be able to answer four questions before provider execution begins:

1. Which values and branches are part of the portable program?
2. Which operations need host authority, such as fetch, secrets, KV, or GRIP?
3. Where does execution continue after each host operation completes?
4. Can the chosen provider satisfy every required capability and binding?


## Router topology and middleware use the same downstream plan

Static Router authoring is normalized before canonical handler analysis:

```text
Router registrations, middleware, error handlers, and mounts
→ retained topology extraction and path normalization
→ flat ordered execution-entry graph
→ terminal normal/error cursor transfers
→ canonical route and middleware branches
→ the same effects, continuations, native plan, and providers
```

`return next()` does not call another JavaScript function and later unwind. It ends the current state and advances the normal Router cursor. `return next(error)` does the same for the error cursor. Middleware effects before that transfer use the same suspend/resume states as effects inside ordinary handlers; only the Router cursor determines where execution continues afterward.

Router dispatch is not a separate runtime or compiler. `pulse inspect` reports `compiler.routing.entries`, `compiler.routing.routes`, and terminal semantics. Host operations carry the stable identity of the route or middleware entry that owns them. See the [Router lowering example](../../examples/09-router-lowering/) and [routing guide](../guides/routing.md).

## Bounded application values

HTTP and event handlers can process variable-length collections with a
literal-capped pure `for` loop. Check the application's collection budget before
the loop; the cap is an execution bound, not permission to truncate commands.

```ts
if (input.items.length > 64) return ctx.text('too many items', { status: 400 })
let selected = []
for (let i = 0; i < 64 && i < input.items.length; i++) {
  const item = input.items[i]
  if (item.id === 'skip') continue
  selected = [...selected, { id: item.id.trim(), version: item.version + 1 }]
}
```

The initializer must declare one `let` counter at zero. The first condition is
`counter < N`, where `N` is an integer literal from 0 through 1,024. Additional
`&&` conditions can stop the scan early. The increment is `counter++`,
`++counter`, or `counter += 1`. Nested literal caps have a maximum product of
65,536 (a zero cap counts as one for this static check).

Bodies admit local values, assignments, existing value expressions, `if/else`,
nested bounded loops, and unlabelled `break`/`continue`. Counters cannot be
assigned, updated or shadowed inside the body. Conditions cannot mutate values.
Read context data before entering the loop and perform effects after leaving
it. Context operations, logging, arbitrary calls, helpers, callbacks, closures,
`return`, other loop forms and labelled transfers are rejected in loop bodies.
This subset applies to both target selections. Native emits real bounded loops
over its value handles; JavaScript retains the original admitted source.

Zero-argument string `.trim()` also lowers on Native. It removes ECMAScript
whitespace and line terminators from the two ends, preserves interior text and
UTF-16 code units, and does not normalize Unicode. Native requires a string
receiver without coercion. These value operations create no effect or
continuation. An observed value failure blocks subsequent effect dispatch;
application-visible error response parity remains a separate contract.

Admitted string comparisons (`<`, `<=`, `>` and `>=`) compare UTF-16 code
units when both operands are strings. Indexed string reads return one UTF-16
code unit; missing indices return `undefined`. This supports bounded character
checks and deterministic set ordering without callbacks. Numeric `%` retains
remainder semantics, including fractional and negative finite operands. These
value operations are realized in both Fastly Native build paths as well as Node;
they do not add effects or permit ambient JavaScript helpers. Applications must
still validate their numeric domain and reject malformed scalar text before
hashing it.

Loop caps do not establish a request memory, byte, latency or cancellation
budget. Collection and encoded-byte budgets still belong to the application;
immutable schema inputs must be projected into new values when changed. Keep
original encoded text separately when its bytes identify stored content. These
operations do not make re-encoded JSON a portable command fingerprint or create
transactional guarantees across effects.

The executable `bounded-app-logic` fixture covers member selection, independent
grant scans, retained-result lookup, Unicode trim and exact original text
through a following write. Its supplied actor and receipt records exercise
value processing only; they are not a trusted identity or accepted-state model.

## From source to an effect

The single-fetch example uses the portable async authoring shape:

<!-- pulse-doc-source: examples/03-fetch-composition/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

interface User {
  id: number
  name: string
}

interface Stats {
  score: number
}

interface Flags {
  enabled: boolean
}

const app = new Pulse({ auto: true })

// One structured origin.
app.get('/user', async (ctx) => {
  const user = await ctx
    .fetch('https://users.example.test/users/123')
    .json<User>()
  return ctx.json({ found: true, user })
})

// Multiple origins with explicit sequential awaits.
app.get('/user-summary', async (ctx) => {
  const user = await ctx
    .fetch('https://users.example.test/users/123')
    .json<User>()
  const stats = await ctx
    .fetch('https://stats.example.test/users/123')
    .json<Stats>()
  const flags = await ctx
    .fetch('https://flags.example.test/users/123')
    .json<Flags>()
  return ctx.json({
    id: user.id,
    name: user.name,
    score: stats.score,
    enabled: flags.enabled,
  })
})

// Multiple origins with explicit portable concurrency.
app.get('/user-summary-parallel', async (ctx) => {
  const { user, stats, flags } = await ctx.parallel({
    user: ctx.fetch('https://users.example.test/users/123').json<User>(),
    stats: ctx.fetch('https://stats.example.test/users/123').json<Stats>(),
    flags: ctx.fetch('https://flags.example.test/users/123').json<Flags>(),
  })
  return ctx.json({
    id: user.id,
    name: user.name,
    score: stats.score,
    enabled: flags.enabled,
  })
})

export default app
```
<!-- /pulse-doc-source -->

Run the compiler inspection without building a target:

<!-- pulse-doc-run {"args":["inspect","examples/03-fetch-composition","--json"],"display":"pulse inspect examples/03-fetch-composition --json"} -->
```bash
pulse inspect examples/03-fetch-composition --json
```
```json
{
  "status": "ok",
  "provider": {
    "id": "node"
  },
  "compiler": {
    "effectCount": 7,
    "continuationCount": 3,
    "groupedContinuationCount": 2,
    "opaqueReturnCount": 0
  }
}
```

The selected fields below are copied from that inspection result. Paths, hashes, source offsets, and unrelated schema detail are intentionally omitted so the example remains stable and readable.

<!-- pulse-doc-source: docs/fixtures/inspect-fetch-composition.selected.json -->
```json
{
  "status": "ok",
  "project": {
    "provider": "node",
    "entry": "src/index.ts"
  },
  "compiler": {
    "version": "pulse.canonical-api-compiler.v7",
    "capabilities": [
      "fetch",
      "response.json",
      "response.text"
    ],
    "effects": [
      {
        "id": "fetch-1",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://users.example.test/users/123",
          "origin": "https://users.example.test"
        },
        "grouped": false
      },
      {
        "id": "fetch-2",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://users.example.test/users/123",
          "origin": "https://users.example.test"
        },
        "grouped": true
      },
      {
        "id": "fetch-3",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://stats.example.test/users/123",
          "origin": "https://stats.example.test"
        },
        "grouped": true
      },
      {
        "id": "fetch-4",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://flags.example.test/users/123",
          "origin": "https://flags.example.test"
        },
        "grouped": true
      },
      {
        "id": "fetch-5",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://users.example.test/users/123",
          "origin": "https://users.example.test"
        },
        "grouped": true,
        "groupKey": "user"
      },
      {
        "id": "fetch-6",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://stats.example.test/users/123",
          "origin": "https://stats.example.test"
        },
        "grouped": true,
        "groupKey": "stats"
      },
      {
        "id": "fetch-7",
        "kind": "fetch",
        "operation": "dispatch",
        "capability": "fetch",
        "resource": {
          "kind": "literal",
          "value": "https://flags.example.test/users/123",
          "origin": "https://flags.example.test"
        },
        "grouped": true,
        "groupKey": "flags"
      }
    ],
    "continuations": [
      {
        "id": "continuation-1",
        "kind": "single-fetch",
        "effectIds": [
          "fetch-1"
        ]
      },
      {
        "id": "continuation-2",
        "kind": "fetch-group",
        "effectIds": [
          "fetch-2",
          "fetch-3",
          "fetch-4"
        ]
      },
      {
        "id": "continuation-3",
        "kind": "parallel-group",
        "effectIds": [
          "fetch-5",
          "fetch-6",
          "fetch-7"
        ]
      }
    ],
    "providerLowering": {
      "version": "pulse.canonical-provider-plan.v1",
      "contractVersion": "pulse.canonical-provider-contract.v1",
      "provider": "node",
      "requirements": [
        "fetch",
        "response.json",
        "response.text"
      ],
      "operations": [
        {
          "id": "fetch-1",
          "lowering": "node.fetch.dispatch",
          "binding": "https://users.example.test"
        },
        {
          "id": "fetch-2",
          "lowering": "node.fetch.dispatch",
          "binding": "https://users.example.test"
        },
        {
          "id": "fetch-3",
          "lowering": "node.fetch.dispatch",
          "binding": "https://stats.example.test"
        },
        {
          "id": "fetch-4",
          "lowering": "node.fetch.dispatch",
          "binding": "https://flags.example.test"
        },
        {
          "id": "fetch-5",
          "lowering": "node.fetch.dispatch",
          "binding": "https://users.example.test"
        },
        {
          "id": "fetch-6",
          "lowering": "node.fetch.dispatch",
          "binding": "https://stats.example.test"
        },
        {
          "id": "fetch-7",
          "lowering": "node.fetch.dispatch",
          "binding": "https://flags.example.test"
        }
      ],
      "providerSpecificUserland": false,
      "providerSdkUserland": false,
      "capabilityDiscoveryFromUserland": false
    }
  }
}
```
<!-- /pulse-doc-source -->

The source call becomes a canonical `fetch-1` effect. The code after the call becomes `continuation-1`. The provider plan then maps that effect to `node.fetch.dispatch`. Application source does not import Node APIs, a Fastly SDK, or provider objects.


## Keyed parallel lowering

`ctx.parallel({ ... })` is the explicit portable concurrency form. The compiler
requires one nonempty static object literal with fixed non-index string keys and
recognized Pulse effects as values. It rejects dynamic records, spreads, computed
keys, methods, accessors, arbitrary promises, reused effect roots, and nested
parallel groups with stable diagnostics.

Native lowering erases the call, emits its members into one canonical effect group,
records the source key on each effect site, suspends once, and reconstructs an
ordinary keyed object on resume. Property order remains authoritative even when
provider completion order differs. The JavaScript target executes the same source
through the request-owned shared effect adapter and implements the same all-settle,
keyed result and failure contract.

This does not remove Native implicit grouping. Adjacent independently lowerable
effects may still be grouped as a performance optimization, while separate awaits
executed directly as JavaScript retain ordinary sequential semantics. Authors use
`ctx.parallel` when concurrency itself must be portable.

## Synchronous logging lowering

`ctx.log.error`, `warn`, `info`, and `debug` share one numeric level contract
across all four provider/target modes. Logging is synchronous and is not added to
the effect or continuation graph.

For Native targets, the resolved flat profile `reporting` threshold participates
in the build identity. Disabled statements are erased during lowering and enabled
statements call the compact `pulse_log(level, ptr, len)` ABI. JavaScript targets
retain ordinary expression evaluation and filter through the same threshold at
runtime. Provider formatting and destination may differ; level identity,
enabled/disabled decisions, redaction, and request-contained sink failure are the
portable conformance surface.

## What the compiler owns

The whole-project compiler owns:

- discovering the authoritative workspace, loading `.pulse/config.ts`, and selecting one flat profile;
- parsing the canonical handler and its explicitly declared JSON schema sources;
- rejecting unsupported ambient authority, asynchronous syntax, and dynamic forms that cannot be represented safely;
- assigning stable effect and continuation identities;
- deriving capability requirements from the program;
- invoking trusted package-owned lowerers for supported facades;
- asking the provider contract to validate and map required operations;
- emitting canonical metadata used by `inspect`, `test`, `dev`, `compile`, and `build`;
- lowering the canonical program into the versioned provider-neutral native plan used by `pulse compile`.

The compiler does **not** make network requests, read deployment secrets, or invent provider bindings while analyzing source.

## Canonical lowering and package-owned lowering

Pulse has two related lowering paths.

### Canonical handler lowering

Calls on `PulseContext`, such as `ctx.fetch`, `ctx.config.get`, `ctx.secret.get`, `ctx.kv.get`, and response constructors, are part of the canonical API contract. The central compiler recognizes them and emits canonical operations.

### Package-owned lowering

A supported package can own a normal application root, manifest, contract
mapping, and compiler builder. Assets is the converged example:
`@pulse-compute/assets` executes as the real JavaScript package and the same
supported `assets.lookup(ctx, ...)` shape lowers into `pulse.assets` operations
on Native targets. The package keeps its domain-specific validation rules; the
generic loader handles reachable-graph discovery and trusted invocation. Older
`/pulsewasm` imports are isolated in the
[compatibility migration guide](../guides/compatibility-imports.md).

In Pulse `1.0.0-beta.5`, package-owned builders must declare `compiler.trust: 'first-party'` and ship in the synchronized release set. This is an internal contributor mechanism, not a general third-party plugin API. See [Add a first-party package-owned lowerer](../contributing/adding-first-party-lowerer.md).

## Provider lowering is a second contract

Canonical effects describe **what** the program needs. A provider lowering plan describes **how** a selected provider realizes those needs.

For example:

```text
canonical capability: fetch
Node lowering:         node.fetch.dispatch
Fastly lowering:       fastly.fetch.dispatch
```

Provider validation is fail-closed. A build or execution command stops with a stable diagnostic when a required capability or binding is missing rather than silently substituting provider-specific behavior. See [Contracts and providers](./contracts-and-providers.md).

## Why source restrictions exist

The compiler accepts a deliberately bounded TypeScript subset because every accepted construct needs deterministic lowering and equivalent provider behavior. In particular:

- managed handlers are async-shaped; only trusted Pulse awaits lower natively, while arbitrary Promise construction and arbitrary library awaits remain outside native eligibility;
- ambient `process.env`, global `fetch`, timers, and randomness do not become hidden authority;
- package facade calls use statically recognizable imports and supported argument shapes;
- opaque bodies can cross the boundary but cannot be inspected or transformed in userland;
- provider SDK objects never enter handler scope.

These restrictions are compatibility guarantees, not temporary parser
accidents. The complete boundary is in the
[Beta scope](../preview-scope.md).

## Reading `pulse inspect`

Use `pulse inspect` before target compilation when you need to answer:

- Is the selected target's core execution lane ready, and is the target generally available under its declared support policy?
- Is this project eligible for the selected target's implemented commands? If not, which stable capability or package reasons and owners apply?
- Which target descriptor, command matrix, application graph, loader observation, and parity evidence produced that decision?
- Which capabilities did this source require?
- Which source calls became effects?
- Which effects are grouped?
- Which continuations resume after them?
- What native plan hash and portable Wasm import/export surface will `pulse compile` produce?
- Which provider lowering and deployment binding was selected?
- Did package-owned lowering run?
- Is any provider-specific userland entering the program?

For a Node or Fastly JavaScript profile, `provider.targetSupport` is separate from
the provider-neutral compiler plan. General availability is defined as full
target support: both current declarations report `coreExecutionReady: true`,
`fullTargetSupportReady: true`, and `generalAvailable: true` because every
declared gate is satisfied. The project-level status (`eligible`, `pending`, or
`blocked`) is still derived from the JavaScript application plan, reachable
capability, provider-requirement, and package evidence. Loader state is a
separate observation: it changes the `observationHash`, not the static
`evidenceHash` or project eligibility. Native eligibility independently controls
whether the provider-neutral `compile` command can lower the project.
`automaticFallback` remains false; a Native compiler observation in the same
inspection does not change the selected JavaScript target.

A JavaScript-configured `pulse compile` still emits provider-neutral Pulse-owned
Wasm. Its manifest records the configured target and plan-only eligibility
evidence. `pulse build` is separate: Node JavaScript emits a deterministic
executable CommonJS package, while Fastly JavaScript emits a deterministic ESM
source/deployment closure with exact `esbuild` and `@fastly/js-compute` pins. The
offline release gate compiles that Fastly closure to a runtime Wasm and binds the
artifact by SHA-256; it does not deploy or publish it. Neither JavaScript build
emits a Pulse Native artifact or falls back to Native.

A healthy canonical plan reports all three provider isolation flags as `false`:

```json
{
  "providerSpecificUserland": false,
  "providerSdkUserland": false,
  "capabilityDiscoveryFromUserland": false
}
```

## Related documentation

- [Effects and continuations](./effects-and-continuations.md)
- [Structured and opaque bodies](./bodies.md)
- [Contracts and providers](./contracts-and-providers.md)
- [CLI reference](../reference/cli.md#pulse-inspect)
- [Diagnostics](../reference/diagnostics.md)
- [Architecture overview](../architecture/overview.md)

## Optional Native text artifacts

`pulse compile` and Native `pulse build` emit executable Wasm and generated
source. Diagnostic WebAssembly text is omitted by default, including during
ordinary Native test, dev, doctor, and inspect compilation. Use `--emit-wat` with
compile or build when a textual module is needed:

```sh
pulse compile --emit-wat
pulse build --profile fastly --emit-wat
```

The compiler does not request AssemblyScript text emission when the option is
absent. This avoids materializing a potentially very large Stack IR text string
just to obtain executable Wasm. Text remains a diagnostic with its own compiler
capacity limits; requesting it can still fail for large applications. The option
does not change optimizer settings, Wasm bytes, import/export checks, guest-link
audits, or execution budgets. Required independent guest-link disassembly audits
remain enabled; they are separate from optional output artifacts.

Native manifest `wat` metadata always reports `emitted`. When omitted it reports
`emitted: false`, `bytes: 0`, and `sha256: null`; build/compile file metadata reports
`file: null`. An emitted artifact has `emitted: true` and its actual byte count and
hash. Reusing an output directory removes the previous compiler-owned WAT file
when the new build omits text, including with `--no-clean`. JavaScript build
profiles reject `--emit-wat`; `pulse compile` still explicitly targets Native.
