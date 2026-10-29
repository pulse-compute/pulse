# Effects and continuations

A Pulse handler is written as async-shaped TypeScript. Host operations such as fetch, KV, secrets, and GRIP are awaited in source, but Native targets do not link a JavaScript Promise runtime. The compiler erases the managed async wrapper and trusted Pulse awaits into **effects** and the code that follows into **continuations**. JavaScript targets execute the same source through the live runtime and provider-owned effect adapter.

Application authors do not create or resume continuation objects. They write canonical TypeScript; the compiler and provider runtime own the lifecycle.

## Effect

An effect is an explicit request for host authority. Each effect has an identity, capability, operation, resource, source position, and result shape. Common examples include:

- dispatching an outbound fetch;
- reading config or a secret;
- sampling provider-owned wall time through `ctx.time.now()`;
- getting or putting a KV value;
- accepting one outbound event through `ctx.emit`;
- broadcasting through `grip.broadcast(ctx, message)`.

Pure value construction, branching, property reads and arithmetic are not effects.
Neither are synchronous logging or the GRIP root framing helpers (`isWebSocket`,
`subscribe` and `handoff`). Older channel/hold/publish forms belong to the
[compatibility facade](../guides/compatibility-imports.md#grip).

## Continuation

A continuation identifies the compiled work that can proceed after one effect—or one effect group—settles. It carries no application-accessible provider object. The runtime resumes it with a normalized result or failure.

```text
compiled values
    │
    ├── effect request ──► provider/runtime
    │                         │
    └── continuation ◄────────┘ normalized result or failure
```

A continuation is single-use and time-bounded. Expired or duplicate resume attempts fail with stable diagnostics such as [`PULSE_CONTINUATION_EXPIRED`](../reference/diagnostics.md#pulse-continuation-expired) and [`PULSE_CONTINUATION_DOUBLE_RESUME`](../reference/diagnostics.md#pulse-continuation-double-resume).

### Bounded sequential reads

The [PS1 compiler contract](../architecture/current-contracts.md#bounded-sequential-read-loops-ps1)
supports dependent storage traversal with an explicit literal bound:

```ts
let key = ctx.req.header('x-page') || ''
for (let page = 0; page < 64 && key !== ''; page++) {
  const stored = await ctx.kv<{ next: string; match: boolean }>('pages').getVersioned(key)
  if (stored.status !== 'found') return ctx.text('unavailable', { status: 503 })
  if (stored.value.match) return ctx.text('found')
  key = stored.value.next
}
return ctx.text(key === '' ? 'not found' : 'incomplete', { status: key === '' ? 404 : 503 })
```

Each iteration can call `s3.getText`, `kv.getVersioned` and `crypto.digestText`
sequentially, decode registered JSON, update carried values, and exit early.
The literal cap is checked first and cannot exceed 64. `continue` advances the
counter; `break` exits the nearest loop. Existing bounded pure inner loops are
allowed, with the combined iteration-product limit still enforced. Read-loop
diagnostics reject parallel groups, writes, nested effect loops, arbitrary
helpers and counter mutation. Directly awaited, result-bound static helpers are
allowed when their bodies contain only these read effects and admitted value
operations, without nested effect loops or helper calls. Each call resets the
helper frame while preserving the caller loop across suspension.
Synchronous pure validators can also run in loop bodies without a callee read
site. Their own bounded loops count toward the same 65,536 combined product;
call inputs cannot mutate values, and calls in loop headers remain excluded.
The validator completes before the caller's next read suspends. The source fixture at
`wasm/test/fixtures/projects/bounded-read-loops/src/index.ts` exercises a
read/digest/decode traversal and inner pure collection processing.

Each visit has a distinct execution-owned invocation, even though Native reuses
the same static effect slot. Managed hosts reject stale or duplicate settlement
and invalidate pending work at termination. The cumulative effect limit defaults
to 1,024; canonical Fastly Native fixes that ceiling at 1,024. An inherited request
deadline covers the whole traversal. See the
[PS2 lifecycle contract](../architecture/current-contracts.md#read-loop-invocation-lifecycle-ps2).

A loop bound limits iteration count, not retained memory. Native read-loop plans
also activate [PS3 retention and linear-memory ceilings](../architecture/current-contracts.md#native-read-loop-memory-containment-ps3).
Those counters do not bound process RSS or ordinary JavaScript dependency memory.
PS4 still owns packed-consumer and production qualification. Compiler/fixture
parity is not production acceptance; a chain that reaches its cap is incomplete.

## Bounded HTTP deadline work

The [selected deadline contract](../architecture/current-contracts.md#selected-bounded-http-deadline-contract)
defines one provider-owned monotonic budget across HTTP admission, bounded body
reads, managed effects, continuations and buffered response handoff. Catalog O2
selects ten seconds on Node Native, Node JavaScript and Fastly Native.
P-02 implements the source paths; exact-package acceptance remains pending P-03.
This is not an available-release claim. The linked target matrix owns the handoff
exceptions and O2 acceptance wording.

Cancellation fences subsequent managed work. A write already dispatched may
still commit remotely, so a timeout cannot establish rollback. CPU preemption
and client delivery after handoff are outside this bounded contract.

## Independent effects form a group

The multi-fetch example declares three independent fetch values before consuming any of them:

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

```bash
pulse inspect examples/03-fetch-composition --json
```

The compiler can issue those fetches as one effect group because none depends on another result. The continuation becomes eligible only after the group settles.

Grouping provides concurrency without linking a general Promise runtime into Native artifacts. Source declaration order remains deterministic for identities and result binding, but providers may perform independent operations concurrently.


## Bounded dynamic collections

Use a collection when the number of requests is known only at runtime:

```ts
const input = await ctx.req.json<ProbeInput>('probe.Input')
const effects = ctx.effects<ProbeResult>({ max: 32 })
for (const endpoint of input.endpoints) {
  effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
}
const results = await ctx.parallel(effects)
return ctx.json({ results }, { schema: 'probe.Output' })
```

The [dynamic probe example](https://github.com/pulse-compute/pulse/tree/latest/examples/03-fetch-composition/dynamic-probes)
includes the bounded input/output schemas and four explicit target profiles.

`max` is a literal integer from 1 through 32. The portable build region is one
local `const` collection, one direct `for...of` over an available array local or
property, and one immediately following awaited flush bound to a `const` result.
Each iteration contains one inline `add` of the same recognized effect template.
No awaits, filtering, nested loops, mutations, helper calls or escaping collection
handles are admitted inside that region. A homogeneous generic result type is
optional; the default element type is `unknown`.

Adding captures fresh effects owned by this execution without dispatching them.
The explicit flush seals membership and releases the group. Results preserve
insertion order even when completion order differs. An empty input returns `[]`
without external effects or Native suspension. Overflow fails before dispatch;
there is no truncation. Collection capacity does not replace request, schema,
response-byte or cumulative effect limits. Roots count once against the existing
1,024-effect default. A second flush, duplicate root, foreign member or add after
flush fails. A nonempty unflushed collection fails at handler completion.

Ordinary failures settle the group before continuation; no partial result array
is delivered. Terminal failures take priority over application failures, then
insertion order selects the primary failure. Cancellation invalidates outstanding
work and suppresses continuation, including late completions. A per-fetch timeout
starts at flush dispatch; the request deadline also includes construction time.
Fastly Native retires pending handles but cannot promise remote wire cancellation.

Node and Fastly retain their provider capability restrictions. Fastly Native
runtime URLs use existing static bindings unless
`fastly.bindings.dynamicBackends: true` explicitly enables bounded multi-origin
selection. Configured origins take precedence; a request may attempt at most 32
dynamic registrations across all collections, with canonical-origin reuse.
The [Native dynamic-backend policy](../packages/provider-fastly.md#native-dynamic-backends)
defines URL eligibility, Host/TLS behavior and service prerequisites. A collection
does not independently grant origin authority. Static keyed
`ctx.parallel({ ... })` remains available.

## Explicit portable groups with `ctx.parallel`

Native Pulse may discover independent adjacent effects and place them in one group
for performance. Direct JavaScript execution does not rewrite ordinary `await`
semantics, so separate awaits remain sequential there. Use `ctx.parallel({ ... })`
when concurrency is required application behavior across targets:

```ts
const { profile, flags } = await ctx.parallel({
  profile: ctx.fetch(profileUrl).json<Profile>(),
  flags: ctx.fetch(flagsUrl).json<Flags>(),
})
```

The first contract accepts a nonempty inline object literal with fixed,
non-index string keys and Pulse effect expressions as values. Property order owns
dispatch identity, trace order, deterministic primary-failure selection, and keyed
result reconstruction. Providers may complete members in any order, but every
member settles before the continuation resumes.

On JavaScript, all members execute through one execution-owned shared effect adapter.
On Native, lowering erases `ctx.parallel`, emits the member operations into one
canonical effect group, and reconstructs the ordinary keyed result object after
one continuation. Arrays, spreads, computed keys, dynamic records, arbitrary
promises, reused roots, and nested groups are outside the initial portable shape.

## One-way outbound events

HTTP and event handlers share the direct JavaScript `ctx.emit` effect:

```ts
await ctx.emit('device.led.set', {
  schema: 'events.DeviceLedSet',
  payload: { enabled: true },
})

await ctx.emit('system.tick', { schema: null })
```

The event type and schema are static compiler inputs. A non-null schema requires
`payload`; `schema: null` forbids it. The runtime schema-validates and detaches
the canonical frame before dispatch, and the effect resolves only when the
configured host adapter accepts that frame. It returns `undefined`: there is no
delivery receipt, correlation ID, handler result, retry guarantee, or local
loopback.

`ctx.emit` may be awaited directly or used as a fresh member of an awaited
`ctx.parallel` group. It consumes the same execution effect budget, cancellation,
redaction, and disposal boundary as fetch, config, secret, and KV effects. The
JavaScript dispatch uses the execution-owned effect adapter. Native lowering
emits the same canonical `event.emit` descriptor, suspends on the ordinary
continuation protocol, and resumes after host acceptance; it adds no JavaScript,
Promise, or Asyncify runtime. The Node provider has a bounded, invocation-scoped
FIFO reference adapter for direct JavaScript/Native ingress and exact accepted
frame evidence. Its outbound ledger never loops back into ingress, and its
success still promises no delivery, persistence, retry, receipt, or public
event-bus behavior. No other provider realization or automatic fallback is
claimed.

One-way acceptance is also the recursion boundary. Pulse exposes no
`ctx.call`, generic request/reply effect, automatic local dispatch, or reserved
call opcode. A future reflexive mechanism cannot be inferred from `ctx.emit`;
it requires a separately specified host and lifecycle. See [Static events and
outbound emission](../guides/events.md).

## Dependencies split continuation stages

When later control flow or a later host operation depends on an earlier result, the compiler creates another continuation stage. For example, inspecting a first response and choosing a second URL is dependent work; it cannot be moved into the first independent group.

The rule is semantic rather than stylistic:

- independent operations may share one group;
- operations that need prior values start in a later continuation;
- pure computation between effects stays in the continuation that owns it;
- returning a final response completes the request lifecycle.

Use `pulse inspect --json` to see the actual grouping rather than inferring it from line spacing.

## Failure behavior

An effect failure is normalized into a stable public error. Examples include:

- [`PULSE_FETCH_TIMEOUT`](../reference/diagnostics.md#pulse-fetch-timeout);
- [`PULSE_FETCH_NETWORK`](../reference/diagnostics.md#pulse-fetch-network);
- [`PULSE_PROVIDER_CAPABILITY_UNSUPPORTED`](../reference/diagnostics.md#pulse-provider-capability-unsupported);
- [`PULSE_FASTLY_BACKEND_REQUIRED`](../reference/diagnostics.md#pulse-fastly-backend-required).

For an independent group, the runtime settles the group and reports the normalized failures through the owning continuation boundary. Userland does not receive partially live provider handles or background tasks that can outlive the request.

## Wall time and deadlines

`ctx.time.now()` returns a fresh provider wall-clock sample, with integer Unix
milliseconds and the corresponding UTC string. It follows the same execution
ownership, grouping, cancellation and effect-budget rules as other host work.
It can report an unavailable or invalid clock. It does not replace the
monotonic clock used for deadlines and can move backward. See the
[public time contract](../packages/runtime.md#wall-time).

## Timeouts have two scopes

A fetch can have an operation timeout through `PulseFetchInit.timeoutMs`.
The enclosing execution can have a total `maxDurationMs` budget. These controls
have separate lifetimes: a member timeout fails that operation; request expiry
revokes execution authority, including later managed body reads and continuations.
The separate test/host `continuationTtlMs` bounds suspension freshness; it does
not replace either transport timeout or total execution budget.

### Existing fetch timeout boundaries

`timeoutMs` is an optional positive integer number of milliseconds. Omission
adds no Pulse member timeout; provider/backend limits and an enclosing request
budget still apply. Zero, negatives, fractions and unsafe numeric integers are
invalid. Timeout support does not promise millisecond scheduling accuracy or
preemption of synchronous work.

| Execution path | Timer starts | Timer ends |
| --- | --- | --- |
| Node/Fastly JavaScript, ordinary fetch | Effect dispatch, before the provider adapter runs | Provider response/status/headers settle; before `.text()` or `.json()` consumes the body |
| Fastly Native, ordinary fetch | Fetch admission, including outbound request preparation | Response headers are observed before expiry |
| Node Native, live opaque fetch | Provider transport dispatch | Response headers are available; the stream remains opaque |
| Node Native, live structured fetch | Provider transport dispatch | Bounded body acquisition and provider text decoding finish |

Node Native's existing structured transport consumes the body before returning
its snapshot. Its member timer therefore includes that acquisition; it is not
the same header-only lifetime as Fastly Native or JavaScript. Guest JSON parsing
and application transforms happen later. This distinction is preserved, not
silently changed by adding metadata. Opt-in incoming-body forwarding has its
own longer completion-aware deadline on Node and Fastly Native; see
[body transport contracts](./bodies.md#incoming-forwarding-on-node).

An effect descriptor or collection member does not start a transport timer by
being constructed. A collection starts its members at flush; outbound provider
preparation may consume their timeout. The request budget also covers time spent
constructing the collection. Group join never resets a member timer or extends
the enclosing budget. A later invocation of a reusable effect site gets a new
member timer but inherits the same enclosing request deadline.

### Precedence and failure ownership

An earlier applicable deadline wins. If the enclosing deadline is also expired
when a member result or failure is delivered, enclosing expiry is terminal and
takes precedence over member recovery. No successful late result, application
error handler or group join can restore execution authority. Checks occur at
managed boundaries; this is not hard CPU preemption. Fastly JavaScript rejects
the total `maxDurationMs` configuration rather than claiming support it lacks.

Without collected outcomes, a failed group delivers no partial result. The
per-fetch `errors: 'collect'` option makes an operational member timeout
a rejected member while retaining successful siblings. Enclosing cancellation,
request expiry and runtime integrity faults remain execution failures. HTTP
error statuses remain response data. The outcome and future timing boundaries
are [recorded separately](../architecture/current-contracts.md#selected-fetch-outcome-and-transport-timing-boundaries).

### Fastly Native observation and cleanup

On Fastly Native, `timeoutMs` must be a positive numeric safe integer. Omission
leaves the per-fetch deadline disabled; it does not disable a configured
`maxDurationMs`. Invalid values terminate with HTTP 400 before dispatch.
The deadline starts at fetch admission, includes outbound preparation, and
expires at `elapsed >= timeoutMs`. It bounds arrival of response headers.
Once headers arrive, status/header inspection does not wait for the body;
explicit body reads remain separate work under the whole-request budget.

A Fastly Native fetch deadline enters `app.error` as `PULSE_FETCH_TIMEOUT`; without an error
handler it returns `504 Gateway Timeout`. The earlier whole-request deadline
remains terminal and takes priority over application recovery. Parallel fetches
keep independent admission times and header outcomes. Recovery waits for the
other admitted group members to settle, so one member's timeout does not bound
the entire group; configure each member or use the whole-request budget.

Fastly's pending-request ABI has no cancellation operation. Pulse retires an
expired pending handle, settles the effect once, and never waits on it again.
Invocation cleanup polls retired handles once without blocking and closes any
completed response/body handles. Unready handles remain host-owned; already
sent origin work may continue after the timeout or invocation. Pulse starts no
background guest task and issues no automatic retry. A timeout is neither an
ACK nor proof that a remote write did not happen.

Project tests can set `continuationTtlMs` in a case inside the dedicated `tests/pulse.harness.ts` module for deterministic failure coverage.

## Managed async, not arbitrary async

Write managed handlers with `async` and await trusted Pulse effects. On Native targets, the compiler erases that notation into effects and continuations. On JavaScript targets, the live runtime executes the same async-shaped handler normally.

Static source helpers can return values across recognized effect suspensions under the bounded [source-helper contract](../architecture/current-contracts.md#static-effectful-source-helpers-o-25). Their caller retains response ownership.

Arbitrary Promise construction, ambient asynchronous APIs, and unrecognized library awaits remain outside Native eligibility. They must not be mistaken for Pulse effects or silently trigger target fallback.

This design keeps:

- effects visible to the compiler;
- provider capability checks complete before execution;
- failures and timeouts normalized;
- request completion bounded;
- Node and Fastly behavior comparable.

## Inspect and test the lifecycle

A useful workflow is:

```bash
pulse inspect ./my-app --json
pulse test ./my-app --json
```

`inspect` proves compilation, effects, grouping, continuations, and provider lowering without executing application test cases. `test` executes configured cases through the selected provider’s local conformance runtime.

## Related documentation

- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Compilation and lowering](./compilation-and-lowering.md)
- [Structured and opaque bodies](./bodies.md)
- [Fetching and composing data](../guides/fetching-and-composition.md)
- [Project configuration](../reference/project-config.md)
- [Troubleshooting](../guides/troubleshooting.md)

## Conditional KV

`ctx.kv<T>('name')` exposes `getVersioned(key)`, `insertIfAbsent(key, value)`, and
`compareAndSwap(key, generation, value)` as direct awaited or keyed parallel
effects. The Node reference implements the contract for JavaScript and compiled
Native control flow. Fastly Native implements it through direct KV hostcalls;
Fastly JavaScript conditional KV remains explicitly incomplete.

The condition and mutation are atomic at one key's authority. A versioned read
returns a value and an opaque generation from the same observation, which may be
stale. Generations are strings, not numbers, hashes or application versions.
Create conflicts when present; CAS conflicts when absent or when its token is
stale. Equal-byte replacement is still a write and changes its generation.
Existing unconditional `get` and `put` remain available.

A write returns `stored`, `conflict`, `not-stored` with a bounded reason, or
`unknown` with a bounded reason. Unknown may have committed. A complete explicit
provider rejection establishes no write; an exception from a send primitive
does not. Pulse does not retry, reread-and-rebase, or invent a generation from a
write acknowledgement. A subsequent missing or stale read cannot resolve an
ambiguous write by itself.

Admission detaches and freezes the candidate before provider preparation. The
host's monotonic ten-second deadline starts at admission and is shortened by an
owning request deadline. Preparation may resolve bindings and stage data but
cannot send. Entry into the returned provider primitive marks dispatch even if
it throws synchronously. Timeout before that boundary is `not-stored`; timeout
or transport loss after it is `unknown`. Cancellation suppresses delivery to an
inactive execution and records whether dispatch occurred; it promises no rollback.

Exact keys are bounded Unicode scalar strings; generations are bounded visible
ASCII strings. Values retain the portable KV JSON limits. Conditional storage
uses a strict UTF-8 JSON envelope with exactly `__pulseKv: 1` and `value`, rejecting
duplicate members, invalid values, and oversized bodies. The wrapper is not
recursively unwrapped. Legacy raw JSON requires explicit migration. Keys, tokens,
and values are omitted or redacted from runtime evidence and managed errors;
application responses are not silently rewritten.

Node reference instances retain nonreused generation identities for their own
lifetime. Host code can explicitly reuse one reference across requests and target
runners; independent instances isolate their state. Deterministic identities,
clocks, and failure hooks belong to host evidence, not handler authority. This
local model does not establish durability, global visibility, cross-key
transactions, or a portable physical-delete/recreate guarantee. Fastly SDK
limitations cannot redefine this contract or gate other targets.

Fastly Native preserves all 64 generation bits in an opaque string. ADD and
generation-conditioned overwrite remain distinct operations, including an explicit
condition for zero bits. The adapter stages the complete envelope before dispatch,
uses monotonic deadlines and readiness selection before pending waits and body
reads, and closes acquired bodies. It accepts up to 65,560 wire bytes, including
wrapper overhead. Provider key restrictions return `invalid-key` without changing
the key. Pending KV operations have no cancellation hostcall; an expired operation
is abandoned to invocation teardown and may still commit. Host termination never
resumes an inactive handler. Local Wasm evidence is separate from K4's deployed
cross-location acceptance.

## KV listing and deletion

`ctx.kv('catalog').list({ limit: 10, prefix: 'user/', cursor })` requests exactly
one page. `limit` is required and must be an integer from 1 through 100. Omit
`cursor` for the first page; pass back the returned opaque string for the next
page with the same store, prefix and provider. A successful result is
`{ status: 'listed', keys: [...], cursor: string | null }`. `null` marks the final
page. An empty page is valid; use the cursor to determine completion. Pulse
never fetches another page automatically or decodes/translates provider cursors.

```ts
const page = await ctx.kv('catalog').list({ limit: 10, prefix: 'user/' });
if (page.status === 'listed') {
  return ctx.json({ keys: page.keys, nextCursor: page.cursor });
}
return ctx.json(page, { status: 503 });
```

Listing failure is `{ status: 'failed', reason }`. Invalid option shapes, limits
or prefixes return `invalid-options`; malformed or provider-rejected cursors
return `invalid-cursor`. Keys and prefixes have a 1,024-byte UTF-8 ceiling
(prefix may be empty), and cursors have an 8,192-byte ceiling. Strings must be
Unicode scalar text without control characters. Each returned page contains at
most the requested number of distinct keys matching the prefix. Acquired response
bodies are bounded to 262,144 bytes, checked as strict UTF-8/JSON, and closed on
success or failure. Oversized or malformed provider responses return `too-large`
or `protocol`; they never produce a partial successful page. Cursors, prefixes
and returned keys are redacted in managed traces and errors.

Ordering and visibility are provider-defined. Node's local reference maintains
a UTF-8 byte-ordered key index and seeks after the cursor key, including when
that key was deleted. Its signed cursors are scoped to the reference instance,
store and prefix. Fastly Native requests the provider's strong list mode and
passes its cursor through unchanged. Neither target promises a snapshot across
pages, globally ordered results, or stable visibility under concurrent mutation.
An insertion before the current cursor can be missed; later pages may reflect
deletions and new writes. Do not use a listing to establish absence, perform an
atomic bulk operation, or prove a cross-location consistency guarantee.

```ts
const result = await ctx.kv('catalog').delete('user/123');
return ctx.json(result);
```

Delete returns `deleted` when the provider acknowledges deletion and `not-found`
when it explicitly reports absence, including repeated deletion. An idempotent
provider may acknowledge an already absent key as `deleted`; that acknowledgement
does not prove the key previously existed. A definite validation/binding
failure or provider rejection is `not-deleted` with a reason. Timeout or transport
failure after dispatch is `unknown`: deletion may have happened. There is no
preflight get, retry, rollback, generation condition, or physical-delete/recreate
guarantee. Existing versioned and conditional operations retain their semantics;
deleting a key invalidates the prior current value, and later creation receives
a new Node generation.

Both methods are awaited effects and may be keyed members of `ctx.parallel`.
They share conditional KV's monotonic ten-second/request deadline, cancellation
and pending-handle cleanup rules. Expired Fastly pending handles are left to
invocation teardown; acquired list bodies are closed, and no late completion
resumes an inactive handler. Fastly-specific key restrictions remain explicit
`invalid-key` failures.

Node JavaScript and Native implement both methods. Fastly Native uses direct
`fastly_kv_store.list/list_wait` and `delete/delete_wait` hostcalls. Fastly
JavaScript blocks these capabilities during target-support evaluation rather
than substituting get/put or silently returning an empty page. Final-Wasm ABI
fault tests and installed-package Viceroy tests are local evidence. Production
acceptance still requires a configured Fastly KV binding: verify multi-page
prefix listing, rejected cursor handling, present/absent/repeated deletion and
observed concurrent-mutation behavior on the deployed service. Local Viceroy
does not qualify hosted consistency, propagation or cross-location visibility.
Viceroy 0.21.1's `delete_wait` discards its internal existence boolean and returns
success for absent keys. Its installed-package receipt records that limitation;
explicit host `NotFound` normalization is exercised by the enforcing ABI host
and must be checked on the deployed binding.

## Native dispatcher containment

The Native emitter keeps small plans in one guarded dispatcher. Larger plans use
internal functions grouped by up to 64 states or 24,000 rendered source characters.
Selection uses a balanced tree, and chunks are marked `@noinline` so optimization
cannot reconstruct the original large function. These are internal partition
budgets, not public request, route, or Wasm-byte limits. A single pure-loop state
remains whole and may exceed the character budget; the generated manifest reports
that case instead of truncating or rejecting admitted work.

One shared guard decrements once per original state. The private continue status
is consumed inside the dispatcher and never crosses the host ABI. Program-counter
values, effect and continuation identities, pending-result checks, application
error transfers, and pure-loop `break`/`continue` behavior are unchanged. Generator
identity and source hashes record the emitter change; plan identity and host ABI
remain unchanged. This contains optimizer work for large dispatchers without
introducing user-callable functions, new effects, or a JavaScript fallback.
