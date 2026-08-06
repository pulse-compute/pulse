# Pulse Vision

> **Status:** North-star architecture and product direction.  
> This document describes the intended shape of Pulse from the Beta
> toward a compatibility-bearing 1.0. It is directional rather than a
> compatibility promise for every current release.

Pulse is a portable application contract for progressively constrained compute.

It lets developers begin with familiar TypeScript, choose an execution target deliberately, and move toward compact native WebAssembly without hiding where the source stops being eligible. Pulse does not attempt to make every host identical, compile the entire JavaScript ecosystem, or silently change deployment architecture. It makes boundaries explicit so teams can ship now and reduce execution debt over time.

The long-term goal is not merely “TypeScript to Wasm.” It is a disciplined path from familiar application code to small, host-realizable programs across servers, edge platforms, and constrained devices.

## The problem

Application code tends to accumulate host assumptions gradually:

- framework-specific request and response objects;
- implicit event-loop and Promise behavior;
- direct access to environment variables and secrets;
- provider SDKs embedded in business logic;
- large dependencies added for a single feature;
- opaque JSON contracts;
- deployment behavior that changes without a clear source-level milestone.

Those assumptions are easy to introduce and difficult to remove later. By the time a team wants a smaller artifact, a more constrained host, or a different provider, the application and execution environment may be inseparable.

Traditional approaches often force an all-or-nothing choice:

1. stay in a general JavaScript runtime and accept its operational cost; or
2. rewrite the application into a constrained language or platform-specific SDK before receiving any native benefit.

Pulse aims for a third path.

## The thesis

Pulse provides one stable application model and several explicit execution targets.

```text
familiar TypeScript application
        ↓
Pulse runtime semantics
        ↓
eligibility analysis
        ↓
explicitly selected target
        ↓
native Wasm, JavaScript runtime, or another host realization
```

The source remains recognizable. The target determines which parts can be lowered and how the host realizes capabilities.

Pulse should tell the operator:

- what target was selected;
- what was lowered;
- what could not be lowered;
- the first exact boundary where native eligibility ended;
- which alternate targets are available;
- what size, validation, or execution tradeoffs the selection introduces.

Pulse must not silently fall back from native Wasm to JavaScript. Changing the target is an operator decision expressed in configuration or an explicit CLI invocation.

## Familiar TypeScript is the migration surface

Pulse should feel like ordinary TypeScript application code, not a compiler DSL.

The intended handler shape is async:

```ts
app.get('/users/:id', async (ctx) => {
  const user = await ctx
    .fetch(`/origin/users/${ctx.param('id')}`)
    .json<User>('app.User')

  return ctx.json({ user })
})
```

The same source has different mechanics under different targets.

### Native target

```text
async wrapper
    → erased by lowering

await trusted Pulse effect
    → effect emission
    → state-machine suspension
    → host completion
    → continuation resume

Promise runtime
    → absent
```

### JavaScript target

```text
async wrapper
    → ordinary async JavaScript

await trusted Pulse effect
    → Promise-backed runtime operation

continuation
    → JavaScript runtime
```

The mechanics differ, but Pulse-visible semantics must not:

- route and middleware order;
- capability ordering;
- error-lane behavior;
- status and headers;
- body ownership;
- schema results;
- redaction;
- completion and fallthrough.

All Pulse handlers should be async-shaped even when a particular handler contains no `await`. That keeps the source stable when capability work is added later.

## A small control-flow grammar

Pulse intentionally keeps routing control separate from capability suspension.

```text
await effect      → suspend for external capability work
return next()     → permanently transfer Router control
return response   → complete the request
```

Terminal middleware avoids onion-style resumption:

```ts
app.use(async (ctx, next) => {
  const session = await ctx.kv.get('sessions', ctx.req.header('x-session'))

  if (!session) {
    return ctx.json({ error: 'unauthorized' }, { status: 401 })
  }

  return next()
})
```

`next()` is not awaited and does not return control to the middleware. This removes suspended middleware frames, post-response mutation, ambiguous cleanup order, and accidental double responses.

The constraint simplifies native lowering, JavaScript execution, inspection, and cross-target conformance.

## Explicit execution targets

Pulse should classify execution honestly.

```text
native
    fully lowered into Pulse-owned Wasm

javascript
    executed by a JavaScript runtime using the same Pulse semantics

sidecar
    executed across an explicit serialized boundary

rejected
    unsupported for the selected target
```

Not every target must exist for every provider.

A native build that encounters unsupported code should fail precisely:

```text
PULSE_NATIVE_AWAIT_UNSUPPORTED

Route:
  POST /reports

Handler:
  createReport

Unsupported boundary:
  await reportingLibrary.render(data)

The selected native target supports await only on trusted Pulse effects.

Available paths:
  - remove or isolate the dependency;
  - replace it with a Pulse capability;
  - provide package-owned lowering;
  - explicitly select the JavaScript target;
  - move the operation behind a sidecar boundary.
```

The failure is useful product output. It records the moment architectural debt entered the stack.

An operator can then deliberately choose a different target and continue shipping:

```ts
export default defineConfig({
  execution: {
    target: 'javascript',
  },
})
```

Pulse still reports native eligibility while building the JavaScript target, so the path back toward native remains visible.

## Hosts are not equal

Pulse can target multiple hosts, but it must not pretend that every host has the same capabilities, execution models, or escape routes.

```text
Node
  native target:      available
  JavaScript target:  available
  host strengths:     broad local and server integration

Fastly
  native target:      available
  JavaScript target:  available as an explicit larger-runtime choice
  host strengths:     edge HTTP, named backends, config, secrets, KV

ESP32
  native target:      architectural goal / reference host
  JavaScript target:  unavailable
  host strengths:     GPIO, timers, sensors, constrained event processing
```

This is not “write once, run anywhere.”

It is:

> Use one application contract, then let each host state clearly what it can realize.

A provider owns the concrete ABI and lifecycle. Pulse owns application semantics.

### Pulse owns

- Router topology and matching;
- terminal middleware;
- normal and error lanes;
- effects and continuations;
- request and response semantics;
- schema and JSON contracts;
- capability identities;
- eligibility diagnostics;
- portable inspection artifacts.

### The host owns

- sockets and HTTP stacks;
- interrupts and event queues;
- GPIO and sensors;
- clocks and timers;
- storage engines;
- concrete network APIs;
- process lifecycle;
- resource handles;
- ABI realization.

Host sovereignty is a feature. It prevents the runtime contract from becoming a lowest-common-denominator abstraction.

## Containment reduces friction later

Pulse is intentionally disciplined at boundaries:

- capability access goes through `ctx`;
- Router control uses terminal transfers;
- native suspension occurs only at trusted effects;
- schemas provide runtime truth;
- provider mechanics stay outside application logic;
- target changes are explicit;
- unsupported lowering stops at the first exact boundary.

This can feel stricter at the point of authoring, but it reduces friction later.

Containment gives the project:

- smaller native artifacts;
- deterministic lowering;
- simpler host adapters;
- better cross-target testing;
- clearer security and secret boundaries;
- visible dependency debt;
- less provider lock-in inside business logic;
- a practical path from general code toward constrained execution.

The goal is not maximal permissiveness. The goal is to make the cost and ownership of every escape understandable.

## Schemas are optimization and validation artifacts

TypeScript generics help the author but disappear at runtime. Pulse schemas provide runtime identity across targets.

```ts
const input = await ctx.req.json<CreateUser>('app.CreateUser')
```

### Native execution

The schema can drive:

- specialized decoding;
- projection;
- bounded layouts;
- smaller artifacts;
- predictable memory use;
- precise validation.

### JavaScript execution

The same schema can drive generated validation after `JSON.parse`.

Validation policy should be explicit:

```ts
export default defineConfig({
  schema: {
    validation: 'strict', // strict | warn | off
  },
})
```

- `strict`: reject invalid values;
- `warn`: continue but record a contract violation;
- `off`: parse only, while retaining schema visibility for tooling and eligibility analysis.

Schemas should specialize and verify JSON; they should not become the price of admission for JSON.

Pulse should support a gradient:

```text
strict projected schema
→ status-indexed schema variants
→ generic native JSON
→ explicit JavaScript parse-only behavior
```

Response contracts should be status-aware rather than forcing unrelated success and failure payloads into one artificial shape:

```ts
responses: {
  200: 'app.User',
  404: 'app.NotFound',
  '5xx': 'app.ServerError',
  default: 'json',
}
```

Tooling should help observe, diff, propose, and verify these contracts over time.

## Eligibility is a first-class artifact

A Pulse build should produce more than a deployable binary.

It should also produce an architectural ledger:

```json
{
  "selectedTarget": "javascript",
  "nativeEligibility": {
    "eligible": false,
    "eligibleRoutes": 12,
    "blockedRoutes": 1,
    "firstUnsupportedBoundary": {
      "route": "POST /reports",
      "handler": "createReport",
      "kind": "unsupported-import",
      "specifier": "large-reporting-library"
    }
  }
}
```

Teams should be able to see when a release moved from fully native-eligible to partially blocked, why it happened, and what must change to recover eligibility.

This turns constraint into feedback rather than punishment.

## Cross-target semantics must be enforced

Native and JavaScript targets must share one conformance corpus.

The same application cases should run through every supported realization:

```text
native Node
native Fastly
JavaScript Node
JavaScript Fastly
```

The contract suite should compare Pulse-visible behavior:

- response status;
- ordered and repeated headers;
- structured and opaque bodies;
- route and middleware ordering;
- terminal `next()` behavior;
- error-lane transitions;
- capability ordering;
- schema success and failure;
- transport errors versus HTTP errors;
- redaction;
- compiler-owned 404 and 500 behavior.

Provider mechanics may differ. Pulse semantics may not.

Drift should fail CI and block release.

## ESP32 as a boundary witness

The ESP32 reference host exists to test whether Pulse is genuinely a constrained-compute model or merely an HTTP compiler.

Reference repository:

[pulsecompute/pulse-esp32-host](https://github.com/pulsecompute/pulse-esp32-host)

A device-oriented application might look like:

```ts
app.on('gpio:button', async (ctx) => {
  const enabled = await ctx.kv.get<boolean>('device', 'enabled')

  await ctx.gpio.write('status-led', !enabled)
  await ctx.kv.put('device', 'enabled', !enabled)
})
```

On an ESP32 host, those `await` expressions would not require a Promise runtime. They would lower into host operations and continuation states.

The event path must remain host-controlled:

```text
native interrupt service routine
→ host event queue
→ Pulse event frame
→ Wasm handler
```

Pulse should never make reentrant calls from an interrupt directly into Wasm.

The ESP32 host is not a promise that every Pulse application runs on a microcontroller. It demonstrates that the abstractions still make sense when these assumptions are removed:

- no JavaScript fallback;
- no abundant memory;
- no cloud runtime;
- no HTTP-centric lifecycle;
- no generic operating-system services.

Fastly proves native edge execution. ESP32 tests the larger architectural claim.

## Product milestones

### Beta: explicit execution fluidity

The Beta proves:

- the public runtime and conventional Pulse application contracts;
- Router and terminal middleware;
- async-shaped handlers and trusted `await` lowering;
- effects, continuations, schemas, and package-owned capabilities;
- compact portable and provider-native Wasm;
- explicit Node and Fastly JavaScript execution and packaging;
- deliberate target selection with native-eligibility diagnostics;
- a shared four-mode conformance corpus;
- explicit failure at unsupported Native boundaries;
- no silent fallback.

The preview remains a deliberate pre-compatibility release. Passing its
technical gates does not authorize publication or deployment.

### 1.0: compatibility-bearing runtime contract

The first stable release begins when the Beta contract has been
exercised publicly and the runtime, CLI, target-selection, and conformance
policies are ready to carry compatibility obligations.

Sidecar partitioning, richer observability, additional hosts, and higher-order `@pulse-compute/pulse` ergonomics can continue after 1.0.

## What Pulse refuses to promise

Pulse does not promise:

- that arbitrary JavaScript becomes native Wasm;
- that every npm package is supported by every target;
- that every provider has the same capabilities;
- that JavaScript and native targets have identical size or startup cost;
- that TypeScript generics provide runtime validation;
- that unsupported code silently changes the deployment target;
- that a host abstraction erases host ownership;
- that all Pulse applications run on every device.

These refusals protect the useful promises.

## North star

Pulse should let a team say:

> We began with a familiar TypeScript application.  
> We shipped it using an explicit execution target.  
> Pulse showed us exactly where native eligibility ended.  
> We removed dependencies, introduced trusted effects and schemas, and progressively constrained the program.  
> The application model stayed stable while the artifact became smaller, more portable, and easier to host.

That is the vision:

```text
familiar TypeScript
+ explicit host capabilities
+ visible eligibility boundaries
+ deliberate execution targets
+ progressive containment
= constrained compute without an all-or-nothing rewrite
```
