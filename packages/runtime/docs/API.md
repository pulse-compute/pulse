# Pulse runtime contract

Write an async handler, read its invocation-owned context, await explicit effects,
and return a response. Choose the Native or JavaScript target in project
configuration; the provider realizes that choice.

## Read this reference

| Task | Start here |
|---|---|
| Understand the application shape | [Handler](#handler), [Router](#static-router), [events](#static-event-handlers) |
| Find a context member | [Context at a glance](#context-at-a-glance) |
| Read inputs and return outputs | [Request](#ctxreq), [fetch](#ctxfetch), [responses](#response-builders) |
| Coordinate work and bindings | [Parallel effects](#ctxparallel), [config and secrets](#config-and-secrets), [KV](#kv) |
| Validate or inspect a project | [Project workflow](#project-workflow) |

For source eligibility, use [Managed handler TypeScript and
JavaScript](https://pulsecompute.io/v1.0.0-beta.10/reference/handler-authoring/). For provider and target
differences, use the [compatibility
matrix](https://pulsecompute.io/v1.0.0-beta.10/reference/compatibility-matrix/). For CLI and runtime failures,
use the stable codes in the [diagnostics
reference](https://pulsecompute.io/v1.0.0-beta.10/reference/diagnostics/).

This document describes the provider-neutral TypeScript application contract compiled by Pulse. Low-level authoring types and the static `Router` come from `@pulse-compute/runtime`. The public `@pulse-compute/pulse` package owns the conventional `Pulse` application root, deferred project configuration, and schema declarations, while `@pulse-compute/cli` owns workspace orchestration.

`@pulse-compute/runtime` is the low-level portable application surface and
`@pulse-compute/pulse` is the conventional project surface. Both belong to the
[public release catalog](https://pulsecompute.io/v1.0.0-beta.10/maintainers/release-manifest/). Native and JavaScript execution remain
explicitly selected targets over the same canonical runtime contract.

## Context at a glance

`ctx` is the complete application authority. There is no ambient request,
process, provider SDK, or global network surface behind it.

| Member | Category | Available in | Purpose |
|---|---|---|---|
| [`ctx.req`](#ctxreq) | Context | HTTP handlers and middleware | Method, URL, path, ordered headers, and bounded body reads. |
| [`ctx.req.header(name)`](#request-metadata-and-headers) | Context | HTTP handlers and middleware | Case-insensitive first-value header lookup. |
| [`ctx.param(name)`](#ctxparam) | Context | Matched route handlers | Named parameters from the static route pattern. |
| [`ctx.state`](#ctxstate) | Context | HTTP and event handlers | Invocation-local string state shared across one execution. |
| [`ctx.call`](#ctxcall) | Context | Selected HTTP handlers | Synchronous imported computation with registered input/output schemas. |
| [`ctx.workspace`](#ctxworkspace) | Context | HTTP and event handlers | Fixed-capacity execution-owned numeric scratch cells. |
| [`ctx.resources`](#ctxresources) | Context | HTTP and event handlers | Execution-owned views over explicitly embedded immutable binary data. |
| [`ctx.time.now()`](#ctxtime) | Context | HTTP and event handlers | Provider wall-clock sample with matching Unix milliseconds and UTC text. |
| [`ctx.fetch`](#ctxfetch) | Effects | HTTP and event handlers | Explicit outbound HTTP effect and structured or opaque response ownership. |
| [`ctx.parallel`](#ctxparallel) | Effects | HTTP and event handlers | Join keyed effects or a bounded collection. |
| [`ctx.effects({ max })`](#bounded-effect-collections) | Effects | HTTP and event handlers | Collect a bounded runtime number of effects before one explicit flush. |
| [`ctx.encodeJson`](#ctxencodejson) | JSON codecs | HTTP and event handlers | Synchronous schema-bound, size-limited JSON text. |
| [`ctx.decodeJson`](#ctxdecodejson) | JSON codecs | HTTP and event handlers | Synchronous schema-bound decode of bounded application text. |
| [`ctx.emit`](#ctxemit) | Effects | HTTP and event handlers | One-way, schema-bound event acceptance effect. |
| [`ctx.log`](#ctxlog) | Context | HTTP and event handlers | Synchronous thresholded logging. |
| [`ctx.config`, `ctx.secret`](#config-and-secrets) | Bindings | HTTP and event handlers | Explicit configured binding reads. |
| [`ctx.kv(name)`](#kv) | Effects | HTTP and event handlers | Bound reads, writes, conditional operations, listing and deletion on supported targets. |
| [`ctx.json`, `ctx.text`, `ctx.response`](#response-builders) | Responses | HTTP handlers and middleware | Synchronous response construction. |
| [`ctx.output`](#experimental-generated-output) | Responses | Opted-in Node HTTP handlers | Finite incremental UTF-8 output; experimental and deadline-bound. |
| [`ctx.event`](#static-event-handlers) | Context | Event handlers only | Exact event type and immutable validated payload. |

## Handler

```ts
import type { Handler, PulseContext } from '@pulse-compute/runtime'

const handler: Handler = async (ctx: PulseContext) => ctx.json({ ok: true })
export default handler
```

Every managed handler is async-shaped:

```ts
type Handler = (ctx: PulseContext) => Promise<PulseResult | PulseFetchResponse>
```

For native targets the compiler erases the async wrapper. Awaited Pulse effects lower into the existing explicit effect and continuation state machine; no Promise runtime or Asyncify transform is linked. Awaiting a proven synchronous `ctx` expression is redundant and may warn, while arbitrary non-Pulse awaits mark the native eligibility boundary. The canonical [handler authoring reference](https://pulsecompute.io/v1.0.0-beta.10/reference/handler-authoring/) defines the static language subset; the [compatibility matrix](https://pulsecompute.io/v1.0.0-beta.10/reference/compatibility-matrix/) owns the tested four-mode claims.

## Static `Router`

```ts
import { Router } from '@pulse-compute/runtime'

const api = new Router()
const app = new Router()

api.use(async (ctx, next) => {
  if (ctx.req.header('authorization') === undefined) {
    return ctx.text('Unauthorized', { status: 401 })
  }
  return next()
})

api.get('/health', async (ctx) => ctx.json({ ok: true }))
api.get('/users/:id', async (ctx, next) => {
  if (ctx.param('id') === '0') return next()
  return ctx.json({ id: ctx.param('id') })
})
api.get('/users/:id', async (ctx) => ctx.json({ fallback: ctx.param('id') }))

api.error(async (error, ctx, next) => {
  const routedError = error as { code?: string }
  if (routedError.code === 'NOT_FOUND') return ctx.text('Missing', { status: 404 })
  return next(error)
})

app.mount('/api', api)
export default app
```

`Router` is a compile-time marker. Canonical v2 supports `get`, `head`, `post`, `put`, `patch`, `delete`, exact paths, named parameters, a trailing wildcard, static mounts, global/path-scoped/mounted middleware, route fallthrough, and error middleware. `Pulse` inherits these registrations. `ctx.param(name)` returns the matched named parameter inside route handlers.

`next()` is a terminal control transfer. `return next()` advances the normal Router cursor and permanently ends the current handler scope. `return next(error)` enters or advances the error lane. There is no onion-style downstream return or post-`next()` resume. Normal and error exhaustion produce compiler-owned 404 and 500 responses respectively.

The flattened execution graph, route table, and entry-owned effects/continuations are reported by `pulse inspect`. See the [routing guide](./guides/routing.md).

## Static event handlers

`Pulse.on` declares an exact event entry beside, not inside, Router topology:

```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.on('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const mode = await ctx.config.get('MODE')
  ctx.state.set('mode', mode)
  void ctx.event.payload
})

app.on('system.tick', { schema: null }, async (ctx) => {
  void ctx.event.type
})
```

The type and schema are literal compiler inputs, every type has one owner, and
non-null schemas resolve through the project registry. `ctx.event.type` is the
exact registered type; `ctx.event.payload` is an immutable schema-validated
value, or `null` for a no-payload registration. Event handlers share state,
logging, fetch, config, secret, KV, and keyed-parallel authority, but expose no
request, route, response, middleware, or Router-transfer surface and complete
with `void` unless `resultSchema` declares a returned application value. Result
schemas use the same project registry as HTTP JSON responses. The host receives
a bounded, validated `result` separately from completion metadata; see the
[events guide](https://pulsecompute.io/v1.0.0-beta.10/guides/events/#returned-application-data).

Eligible handlers lower into plane-neutral application entries and execute
through the conditional provider-neutral `pulse.native-event-abi.v1`
extension. Event-only and mixed HTTP/event artifacts are supported, while
HTTP-only Native output remains byte-identical and has no event ABI. This does
not by itself activate a provider transport. The Node provider now has an
invocation-scoped bounded FIFO reference ingress/acceptance adapter for direct
JavaScript and Native parity evidence; it is not a public event bus or a
deployment listener.

Conventional project harnesses can exercise this reference boundary with an
explicit `kind: 'event'` case, a canonical input frame, and an ordered exact
`expect.emitted` frame list. Node JavaScript and Node Native support that test
workflow. `pulse inspect` and `pulse doctor` report the event catalog,
registrations, schemas, outbound callsites, host requirements, and selected
target support; eligible build and compile output includes `event-catalog.json`
and `event-inspection.json`. Compile-only `none` reports inspection-only
eligibility. Fastly targets fail closed because no event ingress/emit adapter is
claimed. There is no public event injection command, no event-aware development
listener, no HTTP/GRIP translation, and no automatic target fallback.

The [static events guide](https://pulsecompute.io/v1.0.0-beta.10/guides/events/) owns the complete frame,
queue, target-eligibility, diagnostic, and Native-extension contract. The
source-bound [event example](https://pulsecompute.io/v1.0.0-beta.10/examples/11-events/) runs the same mixed project
on Node JavaScript and Node Native.

## `ctx.req`

```ts
interface PulseRequest {
  readonly method: string
  readonly url: string
  readonly path: string
  readonly headers: readonly [string, string][]
  header(name: string): string | undefined
  body(): PulseIncomingBody
  readTextChunk(): PulseEffect<{ readonly done: boolean; readonly text: string }>
  text(): PulseEffect<string>
  json<T = unknown>(schemaId?: string): PulseEffect<T>
}
```

Structured request bodies are bounded runtime-owned snapshots. Repeated `text()` and `json()` reads are memoized immutable transforms.

`body()` is an opaque incoming handle under the Node `bodyForwarding` opt-in;
it grants no reader or binary inspection. `readTextChunk()` belongs only to the
experimental Node `bodyTransform` opt-in, with generated output and a finite
deadline. It excludes forwarding and structured body reads. Both Fastly targets
reject these capabilities. The [bodies guide](https://pulsecompute.io/v1.0.0-beta.10/concepts/bodies/) owns the
byte/read/write limits and separates installed output qualification from pending
installed transform qualification. The production `/server` launcher remains
qualified for finite HTTP, as described in [Node deployment](https://pulsecompute.io/v1.0.0-beta.10/guides/deploying-node/).

### Request metadata and headers

```ts
const requestId = ctx.req.header('x-request-id')
const authorization = ctx.req.header('Authorization')
```

`header(name)` compares names case-insensitively, returns the first matching
value, and returns `undefined` when the header is absent. Use
`ctx.req.headers` when order or repeated fields matter: it is an immutable,
ordered array of `[name, value]` pairs and preserves repeated pairs. Pulse does
not expose an ambient `Request` or mutable `Headers` object to application
code.

`method` is normalized to uppercase, `url` is the complete request URL, and
`path` is its pathname.

When a schema ID is supplied, it must be a literal declared by the selected `.pulse/config.ts` profile:

```ts
const input = await ctx.req.json<Input>('app.Input')
```

## `ctx.param`

```ts
app.get('/users/:id', async (ctx) => {
  const id = ctx.param('id')
  return id === undefined
    ? ctx.text('missing route parameter', { status: 500 })
    : ctx.json({ id })
})
```

`ctx.param(name)` is synchronous and is available only to a matched route
handler. It returns the decoded value owned by the static route match or
`undefined` when the named parameter is not present. Middleware and event
handlers do not receive route-parameter authority.

## `ctx.state`

```ts
ctx.state.set('request-id', 'r1')
const requestId = ctx.state.get('request-id') // string | undefined
```

State is a synchronous, invocation-local string map. One HTTP execution shares
it across forward middleware, mounted Routers, error recovery, and effect
continuation resume. An event handler retains its state across continuation
resume. State is isolated between requests and event invocations; it is not
durable storage and does not cross an invocation boundary.

## `ctx.fetch`

```ts
interface PulseFetchInitBase {
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  readonly headers?: Readonly<Record<string, string>> | readonly [string, string][]
  readonly timeoutMs?: number
  readonly errors?: 'collect'
}

type PulseFetchInit = PulseFetchInitBase & (
  | { readonly body?: never; readonly json?: never; readonly schema?: never }
  | { readonly body: string | PulseIncomingBody; readonly json?: never; readonly schema?: never }
  | { readonly body?: never; readonly json: unknown; readonly schema?: string }
)

ctx.fetch(url: string, init: PulseFetchInit & { errors: 'collect' }): PulseFetchOperation<true>
ctx.fetch(url: string, init?: PulseFetchInit & { errors?: undefined }): PulseFetchOperation
ctx.fetch(url: string, init: PulseFetchInit): PulseFetchOperation<boolean>
```

Outbound methods are `GET`, `HEAD`, `POST`, `PUT`, and `PATCH`. `GET` and
`HEAD` cannot carry a body. `POST`, `PUT`, and `PATCH` accept text or JSON
bodies; Native JSON requires a registered schema. Incoming opaque-body
forwarding retains its separately admitted `POST`-only shape.

Choose text/opaque `body` or `json`, never both. `schema` describes a JSON
request body; it is invalid without `json`. `PulseIncomingBody` is the opaque
request-forwarding handle under the explicit Node opt-in, not an arbitrary
stream or buffer. See [incoming forwarding](https://pulsecompute.io/v1.0.0-beta.10/concepts/bodies/#incoming-forwarding-on-node).

HTTP status is response data. Network and timeout failures are runtime failures
unless that operation selects `errors: 'collect'`.
The [Router recovery contract](./guides/routing.md#next-is-a-terminal-transfer)
owns which failures enter application error handling; the
[deadline contract](https://pulsecompute.io/v1.0.0-beta.10/concepts/effects-and-continuations/#timeouts-have-two-scopes)
distinguishes per-fetch timeouts from terminal request deadlines.

```ts
const user = await ctx.fetch('https://api.example.test/user').json<User>('app.User')
return ctx.json({ found: true, user })
```

Consecutive independent fetches may lower into a deterministic effect group. Results are presented in declaration order, not host completion order.


### Collected fetch outcomes

Select `errors: 'collect'` on an individual fetch to turn transport failures and
member timeouts into bounded data. This works under direct await,
`ctx.parallel({ ... })`, and the existing bounded effect collection syntax.
Text/JSON projections produce an outcome around the selected payload:

```ts
const { primary, secondary } = await ctx.parallel({
  primary: ctx.fetch(primaryUrl, { errors: 'collect', timeoutMs: 1000 }).text(),
  secondary: ctx.fetch(secondaryUrl, { errors: 'collect' }).text(),
})
return ctx.json({ primary, secondary })
```

```ts
type PulseFetchOutcome<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: {
      readonly code: 'PULSE_FETCH_NETWORK' | 'PULSE_FETCH_TIMEOUT'
    } }
```

Without a projection, `value` remains the opaque response. After narrowing on
`status`, return `result.value` to forward it; the envelope does not acquire,
decode or serialize its body. HTTP error statuses still produce fulfilled
outcomes. Error objects contain no provider message, URL, credentials or cause.
Malformed JSON, schema failures, size bounds, invalid options, enclosing
cancellation/deadline expiry and runtime integrity failures remain failures.
A failing ordinary member still fails a mixed group. No retries or group policy
changes are introduced. Omission preserves existing shapes and failure behavior.

For Native, use an inline named literal `errors: 'collect'`; dynamic selectors,
computed names and selectors hidden in aliases/spreads are rejected. Existing
projection/schema and collection admission rules still apply. Timing metadata
remains separate work; this option does not change `timeoutMs` lifetimes.

## `ctx.resources`

Configure `pulse.binaryResources` in `.pulse/config.ts` with a canonical serialized
embedded `manifest`, a `bindings` record mapping logical IDs to manifest paths,
and explicit `budgets`: `files`, `fileBytes`, `totalBytes`, `serializedBytes`, and
`bindings`. Each budget is a nonnegative safe integer. These are build admission
budgets, independent of HTTP Assets limits. All manifest records are checked
before selection. No file or network loading occurs during execution.

```ts
const vectors = ctx.resources.map('vectors')
const bytes = vectors.byteLength
const component = vectors.readF32LE(12)
```

A mapping requires one declared literal ID and a local `const` binding. Views
expose only `byteLength`, `readU8(offset)`, `readU32LE(offset)`, and
`readF32LE(offset)`, and `readUtf8(offset, byteLength)`. Offsets are nonnegative safe integers measured in bytes;
unaligned little-endian reads are supported. The entire scalar must fit before
any address conversion. Float reads preserve signed zero and reject NaN and
infinity; use `readU32LE` to inspect those bit patterns. Invalid declarations,
views or reads fail with `PULSE_BINARY_RESOURCE_INVALID` (a terminal provider
failure in Fastly Native).

Views cannot be aliased, returned, stored, serialized, passed to helpers, or
captured by another function in canonical source. Pass scalar results to helpers
instead. Runtime views are branded and become unusable when their owning
execution closes or aborts. JavaScript dependency execution remains ordinary
JavaScript, not a sandbox guarantee. Reads are synchronous local operations,
with no effect dispatch, implicit flush, or cumulative read-byte quota.
Configured request deadlines are checked on each read; Fastly JavaScript retains
its existing unsupported-deadline diagnostic.

Native emits selected immutable raw bytes and checked scalar loads, without a
public pointer or general byte-buffer ABI. Unused Native resources emit no bytes.
JavaScript snapshots the configured binding backing once per application store;
repeated mappings in an execution reuse views. Existing loop and helper work
bounds still apply: 1,024 iterations per pure loop and 65,536 combined nested
iterations. Admitting a large vector file does not authorize a larger loop.
Numeric regions avoid per-read boxing when their existing proof succeeds;
other expressions retain the ordinary target value-allocation rules.

`readUtf8` returns at most 12,288 bytes of strictly validated UTF-8 per call.
Both arguments must be nonnegative safe integers. The slice must start and end
at scalar boundaries, including zero-length slices. Malformed, overlong,
surrogate and out-of-range encodings fail without replacement decoding. BOM,
NUL and supplementary characters are preserved. Validation checks the owning
execution and deadline at every scalar.

## `ctx.call`

Invoke an imported, synchronous project computation from a plain HTTP handler,
a reachable Router handler or a managed MCP operation:

```ts
const result = ctx.call(target, input, {
  inputSchema: 'example.Input',
  outputSchema: 'example.Output',
})
```

The supported targets are Node Native, Fastly Native and explicitly selected
Node JavaScript. Fastly JavaScript and event handlers do not support this
boundary. Native compiles the computation; Node JavaScript executes its admitted
source. Neither target falls back to the other.

`PulseComputationContext` grants only `resources` and `workspace`.
`PulseReadonly<Input>` recursively marks input fields and arrays readonly;
`PulseComputation<Input, Output>` describes the synchronous function type.
These types and `PulseCallSchemas` are exported by both `@pulse-compute/runtime`
and `@pulse-compute/pulse`. Input and output schemas must have object roots.
The caller receives an independently owned, schema-validated result, which it
can mutate without changing the computation's input or workspace.

Keep schema shapes in a type-only project module, such as `src/types.ts`:

<!-- pulse-doc-source: wasm/test/fixtures/projects/callable-public/src/types.ts -->
```ts
export interface Input { value: number }
export interface Output { value: number }
```
<!-- /pulse-doc-source -->

Register both shapes in `.pulse/schema.ts`:

<!-- pulse-doc-source: wasm/test/fixtures/projects/callable-public/.pulse/schema.ts -->
```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { Input, Output } from '../src/types'

export default defineSchemaRegistry({ schemas: {
  'example.Input': schema<Input>(),
  'example.Output': schema<Output>(),
} })
```
<!-- /pulse-doc-source -->

Define the named computation in `src/compute.ts`:

<!-- pulse-doc-source: wasm/test/fixtures/projects/callable-public/src/compute.ts -->
```ts
import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'

import type { Input, Output } from './types'

export function double(ctx: PulseComputationContext, input: PulseReadonly<Input>): Output {
  const cells = ctx.workspace.numbers(1)
  cells[0] = input.value * 2
  return { value: cells[0] }
}
```
<!-- /pulse-doc-source -->

Import it directly at the call site in `src/index.ts`:

<!-- pulse-doc-source: wasm/test/fixtures/projects/callable-public/src/index.ts -->
```ts
import type { PulseContext } from '@pulse-compute/pulse'
import { double } from './compute'
import type { Input } from './types'

export default async function handler(ctx: PulseContext) {
  const input = ctx.decodeJson<Input>(ctx.req.header('input') ?? '{"value":2}', 'example.Input')
  const result = ctx.call(double, input, {
    inputSchema: 'example.Input',
    outputSchema: 'example.Output',
  })
  return ctx.json(result, { schema: 'example.Output' })
}
```
<!-- /pulse-doc-source -->



Compilation enforces the contract beyond TypeScript assignability:

- The target is a statically resolved named project import. Import aliases and
  project re-exports preserve identity; runtime registration, target selection,
  factories and arbitrary package targets are not admitted.
- The third argument is an inline object with literal registered `inputSchema`
  and `outputSchema` IDs. Every use of one target identity uses the same pair.
  TypeScript infers the function's result type; it does not infer schema IDs or
  prove that a registered schema matches a TypeScript annotation.
- There are at most sixteen reachable static call occurrences per application,
  including reused Router occurrences. Calls cannot be awaited, nested, placed
  in loops or made recursively. Dormant targets do not emit callable machinery.
- Computations use the existing bounded pure language, static constants and
  admitted pure helpers. They cannot capture caller authority or use HTTP,
  state, logging, codecs, effects, another `ctx.call`, context escape or arbitrary
  JavaScript. Helper and loop admission remains compiler-owned.
- Input conversion creates a readonly computation view; output conversion
  validates and detaches the result before returning it. Resources retain their
  existing access rules and numeric workspaces are fresh per invocation.

Calls share the enclosing request's deadline and cumulative Native allocation
budget. A conversion or computation failure returns no successful partial result;
existing handler, MCP and provider error owners frame the failure. A failed Native
invocation cannot resume; recovery uses a fresh request. JavaScript closes the
computation frame and rejects further calls on the failed request boundary.
An escaped view does not extend frame lifetime. These rules do not create a
sandbox for arbitrary JavaScript or a cross-provider identical error-body promise.

The boundary has input/output conversion cost when used. Call-free and
imported-unused Native artifacts retain byte-identical output. Callable metadata
uses `pulse.computation-call.v1`; stale callable descriptors or JavaScript binding
tables require rebuilding through the normal compiler. This optional metadata
has its own version so call-free plan formats remain unchanged.

## `ctx.workspace`

```ts
const scores = ctx.workspace.numbers(512)
scores[0] = 42
const score = scores[0]
const capacity = scores.length
```

Create a local `const` with a literal capacity from 1 through 1,024 outside
loops. At most four workspaces are admitted per Native plan and per JavaScript
execution. Cells start at zero; indexed reads and simple indexed assignments
require in-range integer numeric indices and finite numeric values, preserving
signed zero. Length is read-only. Every access checks execution ownership and
its deadline. Invalid construction/access fails with
`PULSE_NUMERIC_WORKSPACE_INVALID` (terminal provider failure on Fastly Native).

Workspaces cannot be aliased, captured, returned, serialized, passed to helpers,
or stored in ordinary objects. Pass scalar reads to helpers instead. Compound
assignments and increment/decrement are unsupported; use a simple indexed
assignment. Native owns bounded raw f64 cells; this does not enable general
array mutation. Ordinary JavaScript dependency execution remains outside the
canonical source proof. Existing 1,024/65,536 loop bounds still apply.

## `ctx.parallel`

Use `ctx.parallel({ ... })` to make concurrent Pulse effects an explicit,
key-preserving cross-target contract:

```ts
const { user, permissions } = await ctx.parallel({
  user: ctx.fetch('https://api.example.test/user').json<User>(),
  permissions: ctx.fetch('https://api.example.test/permissions').json<Permissions>(),
})
```

Its TypeScript result preserves every input key and the independently inferred
result type of that effect. The initial portable form accepts exactly one nonempty
inline object literal with fixed identifier or string-literal keys and directly
recognizable Pulse effects as values. Array-index keys, `__proto__`, arrays,
spreads, computed keys, shorthand properties, methods, accessors, dynamic records,
arbitrary promises, reused effect roots, and nested parallel groups are rejected.

Source property order defines effect registration, deterministic identity, result
reconstruction, trace order, and primary-failure ownership. Operations may finish
in any order, but all settle before the continuation proceeds. When multiple
members fail, the first failure in property order is primary and bounded keyed
failure evidence identifies the others.

The JavaScript runtime executes every member through one execution-owned shared
effect adapter. Native lowering erases the call into one canonical effect group
and reconstructs an ordinary keyed object after one continuation. Separate awaits
remain sequential in direct JavaScript execution; the Native compiler may still
implicitly group adjacent eligible effects as a performance optimization.

### Bounded effect collections

`ctx.effects<T>({ max })` collects effects for `await ctx.parallel(collection)`.
The literal capacity is 1–32. Adding captures a fresh execution-owned effect;
only the single flush dispatches it. Results preserve insertion order, overflow
fails before dispatch, and an empty collection returns an empty array. Collection
capacity does not replace schema, request or cumulative-effect limits.

The portable source shape is deliberately bounded: one local collection, one
direct `for...of` with one inline `add`, then one awaited flush. Keep the full
[collection grammar, ownership and failure rules](https://pulsecompute.io/v1.0.0-beta.10/concepts/effects-and-continuations/#bounded-dynamic-collections)
with their owner rather than treating this as an arbitrary Promise collection.

## `ctx.emit`

HTTP and event handlers share a one-way outbound event effect:

```ts
await ctx.emit('device.led.set', {
  schema: 'events.DeviceLedSet',
  payload: { enabled: true },
})

await ctx.emit('system.tick', { schema: null })
```

The event type and schema are literal compiler inputs. A non-null schema must
resolve through the project registry and requires `payload`; `schema: null`
forbids it. JavaScript and Native runtimes validate and detach the same
canonical frame before passing it to the execution-owned adapter. Public effect
evidence redacts the payload.

The effect is valid as a fresh member of an awaited `ctx.parallel` group and
resolves to `undefined` after bounded host acceptance. It does not return a
delivery receipt, correlation ID, or handler result, and it never invokes a
matching local event handler. Native lowering uses the ordinary canonical
effect/continuation protocol and adds no JavaScript or Asyncify imports. The
invocation-scoped Node reference adapter provides bounded host acceptance and
exact-frame evidence in JavaScript and Native modes; it provides no delivery,
retry, persistence, public event bus, or automatic loopback. Other provider
realizations remain unclaimed.

Event contexts expose no `ctx.call`, `app.call`, generic call effect or
request/reply bus. `ctx.emit` cannot observe or invoke a local handler. The HTTP
[`ctx.call`](#ctxcall) computation boundary does not dispatch events or provide
reflexive routing; that would require a separate host and lifecycle contract.

## `ctx.log`

Logging is synchronous, string-only, and provider-neutral:

```ts
ctx.log.error('failed to publish event')
ctx.log.warn('retrying origin request')
ctx.log.info('user created')
ctx.log.debug('decoded request body')
```

The fixed levels are `error = 1`, `warn = 2`, `info = 3`, and `debug = 4`.
`off = 0` is configuration-only. A statement emits when its level is less than
or equal to the selected profile’s resolved `reporting` level; the default is
`info`.

`ctx.log` is not an effect, continuation, or asynchronous operation. Native
lowering erases statements disabled by the resolved build threshold. JavaScript
targets filter at runtime, so a disabled JavaScript call may still evaluate its
message expression; application-significant side effects do not belong in log
expressions. Provider formatting and destination are intentionally outside the
portable contract.

Logging failures do not fail the request. Known request secrets pass through the
same redaction boundary before provider emission and evidence capture. The
initial contract accepts only strings; structured logging and dynamic level
registration are not supported.

## Fetch responses

Structured responses expose:

```ts
response.status
response.ok
response.headers
response.header(name)
response.text()
response.json<T>(schemaId?)
```

`response.header(name)` uses the same case-insensitive, first-value lookup as
`ctx.req.header(name)`. `response.headers` retains immutable ordered pairs when
repeated response fields must be observed. HTTP status is always response data;
only transport and timeout failures reject the fetch effect.

Opaque responses preserve a host-owned body handle and may be returned directly:

<!-- pulse-doc-source: examples/07-opaque-proxy/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/archive', async (ctx) => {
  return ctx.fetch('https://assets.example.com/archive.bin')
})

export default app
```
<!-- /pulse-doc-source -->

Opaque bodies cannot be decoded, copied into Wasm, mutated, iterated, or transformed in user scope.

## Response builders

```ts
ctx.json(value, options?)
ctx.text(value, options?)
ctx.response({ status?, headers?, body? })
```

JSON responses may use an explicit output schema:

```ts
return ctx.json(output, {
  status: 201,
  headers: { 'x-schema': 'app.Output' },
  schema: 'app.Output',
})
```

### Experimental generated output

On an explicitly opted-in Node HTTP profile, `ctx.output.start(options)` and
`ctx.output.write(text)` are awaited effects; return `ctx.output.close()` directly.
This is finite UTF-8 output with a required request deadline, not a general stream
API. Writes cannot join `ctx.parallel`; Fastly output and Native output with linked
guests remain unsupported. After start commits headers, failures terminate the
transport rather than sending a second response.

The [generated-output contract](https://pulsecompute.io/v1.0.0-beta.10/concepts/bodies/#experimental-generated-output-on-node)
owns opt-ins, byte/write limits, lifecycle and qualification. The separate input
transform has its own [experimental boundary](https://pulsecompute.io/v1.0.0-beta.10/concepts/bodies/#experimental-bounded-utf-8-transforms-on-node).

## `ctx.time`

`await ctx.time.now()` returns one provider-owned wall-clock sample. On success,
`status` is `'ok'`, `unixEpochMs` is integer Unix milliseconds and `iso8601` is
its matching UTC string. A failed sample has `status: 'failed'` and reason
`'unavailable'` or `'invalid-clock'`. Direct awaited calls and keyed parallel
members are supported on Node/Fastly Native and JavaScript. Wall time can regress
and is separate from monotonic deadlines and exact commit timestamps. See the
[complete result contract](https://pulsecompute.io/v1.0.0-beta.10/packages/runtime/#wall-time).

## Config and secrets

```ts
ctx.config.get(name: string): PulseEffect<string | undefined>
ctx.secret.get(name: string): PulseEffect<string | undefined>
```

Reads use exact, provider-injected names. Missing values resolve to `undefined`; Pulse does not enumerate bindings, consult inherited properties, or fall back to `process.env`. Names and returned strings are UTF-8 byte-bounded.

Resolved secret values are registered with the execution-owned redaction boundary. Pulse removes known secret substrings and sensitive fields from its own observations, traces, diagnostics, and managed errors. This is not taint tracking: application responses are never silently rewritten, and ordinary config values are not automatically treated as secrets.

## KV

```ts
const sessions = ctx.kv<Session>('sessions')
const value = await sessions.get('current')
if (value !== undefined) await sessions.put('last', value)
```

The existing `get` and `put` operations remain available. Store names and keys are
provider-neutral logical bindings. Values are bounded, detached, deeply frozen
JSON-compatible trees; accessors, symbols, sparse arrays, repeated references,
cycles, class instances, nonfinite numbers, and nested `undefined` are rejected.
`put` resolves to an explicit boolean acknowledgement. Durability, consistency,
and cross-request lifetime remain provider capabilities rather than properties
of the common API.

### Conditional operations

The Node reference on JavaScript and Native, and the Fastly Native adapter,
realize these operations through direct await or keyed `ctx.parallel`:

| Method | Result |
| --- | --- |
| `getVersioned(key)` | `found` with one observed `value` and opaque `generation`, `not-found`, or `failed` with a reason. |
| `insertIfAbsent(key, value)` | Atomically creates an absent key. |
| `compareAndSwap(key, generation, value)` | Atomically replaces the value only when its current generation matches. |

Conditional writes return `stored`, `conflict`, `not-stored` with a reason, or
`unknown` with a reason. `unknown` may have committed; Pulse never automatically
retries or rebases. A write acknowledgement carries no new generation. An absent
CAS conflicts. A read may be stale, but its value and token describe the same
observation. Tokens are bounded opaque strings, never JavaScript numbers or
application revision counters.

### Listing and deletion

`ctx.kv('catalog').list({ limit: 10, prefix: 'user/' })` requests one bounded
page. `limit` is required (1–100); `prefix` and an opaque continuation `cursor`
are optional. Success returns `{ status: 'listed', keys, cursor }`; a null
cursor ends pagination. Empty pages can still have a continuation. Ordering
and visibility are provider-defined; Pulse does not promise a snapshot or
fetch another page automatically.

`ctx.kv('catalog').delete(key)` returns `deleted`, `not-found`, `not-deleted`
with a reason, or `unknown` with a reason. `unknown` may have committed; there
is no retry, rollback, or generation condition. An acknowledged delete does
not prove the key previously existed.

Both are awaitable effects and keyed `ctx.parallel` members on Node JavaScript,
Node Native and Fastly Native. Fastly JavaScript rejects them during eligibility
inspection. See [KV listing and deletion](https://pulsecompute.io/v1.0.0-beta.10/concepts/effects-and-continuations/#kv-listing-and-deletion)
for byte limits, cursor ownership, deadlines and failure semantics.

### KV limits and ownership

Namespaces must be literal bindings; keys, generations, and candidates are runtime
data. Candidates are snapshotted at admission. Keys are exact Unicode scalar
strings of 1–1,024 UTF-8 bytes without C0/C1 controls; tokens are 1–256 visible
ASCII bytes. Values retain the 65,536-byte JSON, depth-64 and 10,000-entry bounds.
The host owns the ten-second operation deadline, shortened by a request deadline.
Timeouts before dispatch are `not-stored`; unconfirmed writes after dispatch are
`unknown`. Request cancellation follows the existing managed lifecycle and
never implies rollback.

### Provider realization

The Node realization is an explicit in-memory reference instance, not a durable
storage guarantee. Fastly Native uses lossless 64-bit generation metadata and
conditional host operations with bounded readiness and body acquisition. Deployed
cross-location acceptance remains a separate gate. The Fastly JavaScript SDK is
incomplete capability mapping and does not define or block
Pulse's contract. Conditional wire values use the strict
`{"__pulseKv":1,"value":...}` envelope; legacy raw JSON requires explicit migration.

## `ctx.encodeJson`

```ts
const text = ctx.encodeJson(candidate, 'app.Candidate')
```

Requires a literal registered schema even in non-strict mode. Validates and
projects the value, then returns detached JSON text bounded by `schemas.maxBytes`
in UTF-8 bytes. It does not create a response or dispatch an effect. Invalid
values and oversized text fail before subsequent writes. Declaration order and
array order are preserved; cross-target parity is semantic, not a universal
canonical-byte format. See [application-owned encoding](https://pulsecompute.io/v1.0.0-beta.10/guides/json-schemas/#encode-application-owned-text).

## `ctx.decodeJson`

```ts
const candidate = ctx.decodeJson<Candidate>(stored.text, 'app.Candidate')
```

Requires a literal registered schema even in non-strict mode. The input must
be a string within `schemas.maxBytes` UTF-8 bytes. Decoding returns a detached,
deeply immutable value with declared fields only. It performs no effect and
does not apply HTTP content-type policy. Keep the original text for hashing,
verification and retries; decoding does not establish byte canonicalization or
storage acceptance. See [application text decoding](https://pulsecompute.io/v1.0.0-beta.10/guides/json-schemas/#decode-application-owned-text).

## Explicit JSON schemas

<!-- pulse-doc-source: examples/02-request-schema/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    schemas: { contentTypePolicy: 'require-json', maxBytes: 1024 },
  },
}))
```
<!-- /pulse-doc-source -->

Pulse compiles declared TypeScript interfaces and type aliases into a registry and direct codecs. It does not discover arbitrary types automatically.

## GRIP

The canonical GRIP application surface is the package root:

```ts
import { grip } from '@pulse-compute/grip'
```

Pure request classification and response framing use `grip.isWebSocket`,
`grip.subscribe`, and `grip.handoff`. Configured outbound work is the
request-bound `await grip.broadcast(ctx, message)` effect. Supported Native
forms lower into canonical package operations; JavaScript targets execute the
real package implementation.

Older `/pulsewasm` imports are compatibility-only and are isolated in the
[migration guide](https://pulsecompute.io/v1.0.0-beta.10/guides/compatibility-imports/). See the
[GRIP package guide](https://pulsecompute.io/v1.0.0-beta.10/packages/grip/) for the complete current surface.

## Entities API

`@pulse-compute/entities` is part of the synchronized `1.0.0-beta.10` package
set. The application surface has two runtime values:

```ts
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'

const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })

rpc.on('customer.lookup', {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
}, lookupCustomer)

export default function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
```

```ts
interface EntityRouterOptions {
  readonly adapter: JsonRpcAdapter
}

interface EntityDeclaration {
  readonly input: string | null
  readonly output: string | null
  readonly metadata?: StaticEntityMetadata
}

type EntityHandler<Input, Output> = (
  ctx: PulseContext,
  input: DeepReadonly<Input>,
) => Output | Promise<Output>

class EntityRouter {
  constructor(options: EntityRouterOptions)
  on<Input, Output>(
    discriminator: string,
    declaration: EntityDeclaration,
    handler: EntityHandler<Input, Output>,
  ): this
  handle(ctx: PulseContext): Promise<Response>
}

interface JsonRpcOptions {
  readonly namedParamsOnly?: true
  readonly acceptEmptyObjectForNoInput?: boolean
}

function jsonRpc(options?: JsonRpcOptions): JsonRpcAdapter
```

`StaticJsonPrimitive`, `StaticJsonValue`, `StaticJsonObject`,
`StaticEntityMetadata`, `EntitySchemaId`, `DeepReadonly`,
`EntityHandlerResult`, `EntityAdapter`, and `JsonRpcAdapter` are also exported
as types. The package exposes no public runtime registry, schema codecs, raw
JSON access, provider objects, or third-party adapter registration.

Registrations and the terminal binding must use the supported static form. The
first-party JSON-RPC adapter accepts bounded JSON-RPC 2.0 request objects and
named params, validates declared schemas, uses stable error framing, and
acknowledges notifications with HTTP `204`. See the [package
guide](https://pulsecompute.io/v1.0.0-beta.10/packages/entities/), [entity/adapter
model](https://pulsecompute.io/v1.0.0-beta.10/concepts/entities-and-adapters/), and [executable
example](https://pulsecompute.io/v1.0.0-beta.10/examples/10-entities-tools/).

## Project workflow

```text
pulse init
pulse doctor
pulse test
pulse dev
pulse build
```

These normal lifecycle commands resolve the same authoritative workspace,
selected profile, handler entry, schema declarations, provider bindings, and
output directory through `.pulse/config.ts`. `pulse inspect` is optional
observability, and `pulse compile` is the advanced provider-neutral Native
artifact command; neither is required before `pulse build`. See the [project
lifecycle guide](https://pulsecompute.io/v1.0.0-beta.10/guides/project-lifecycle/) and [CLI
reference](https://pulsecompute.io/v1.0.0-beta.10/reference/cli/).
