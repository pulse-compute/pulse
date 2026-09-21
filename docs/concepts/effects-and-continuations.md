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
- declaring a GRIP channel;
- holding or publishing through GRIP.

Pure value construction, branching, property reads, and arithmetic are not effects.

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
helpers and counter mutation. The source fixture at
`wasm/test/fixtures/projects/bounded-read-loops/src/index.ts` exercises a
read/digest/decode traversal and inner pure collection processing.

A bound limits iteration count, not retained memory. PS2 invocation-lifecycle
work, PS3 memory containment and PS4 production qualification remain separate
gates. Do not treat PS1's compiler and fixture parity as production acceptance,
or a chain that reaches its cap as a complete search.

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

A fetch can have an operation timeout through `PulseFetchInit.timeoutMs`. The request runtime also owns a continuation lifetime configured by the execution environment or test case. These are different controls:

- the operation timeout bounds one host operation;
- the continuation TTL bounds how long compiled execution may remain suspended before resumption is rejected.

Project tests can set `continuationTtlMs` in a case inside the dedicated `tests/pulse.harness.ts` module for deterministic failure coverage.

## Managed async, not arbitrary async

Write managed handlers with `async` and await trusted Pulse effects. On Native targets, the compiler erases that notation into effects and continuations. On JavaScript targets, the live runtime executes the same async-shaped handler normally.

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
