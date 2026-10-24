# Host extensions — design pass 1: authoring shapes

Status: **design-only, ready for discussion; no new supported API**.
Date: 2026-10-24 (America/Denver).
Inspected base: `a7dba12d985765bc15faacf306c7ff446ee29c11`, `hex-integration`.
Human direction: “I think pass 1 is important. Proceed,” including the requirement
that every async operation be considered as a direct call, a `ctx.parallel`
member, and an effect-builder member. This applies to all async operations,
including those with loaders; `getOrSet` receives no special exemption.

This repository-only proposal is not public documentation, an executable example,
an ABI implementation, or approval of a contract change. No single named Entry
Point covers internal authoring research; the ordinary root/docs instructions
apply. Changes are confined to internal design notes. Package names, methods,
types and options introduced below are proposed spellings, not available exports.

## 1. The experience to review

An author imports a capability, supplies the current request context, and gets a
typed value. The same operation expression works in each execution form:

```ts
// Proposed package operation; existing Pulse grouping/collection spellings.
const item = await cache.get<Product>(ctx, 'products', key, { schema: 'catalog.Product' })

const { item, settings } = await ctx.parallel({
  item: cache.get<Product>(ctx, 'products', key, { schema: 'catalog.Product' }),
  settings: ctx.kv<Settings>('settings').get('public'),
})

const effects = ctx.effects<CacheRead<Product>>({ max: 8 })
for (const key of keys) {
  effects.add(cache.get<Product>(ctx, 'products', key, { schema: 'catalog.Product' }))
}
const items = await ctx.parallel(effects)
```

These are three alternative fragments, not sequential uses of the same effect.
Each call creates a fresh execution-owned operation. Collection construction
captures inputs without dispatch; the flush starts work. A loader must not run
while its parent operation is being added. No `.effect()`, package-specific
parallel runner, arbitrary Promise wrapper, or new method on `ctx` is proposed.
Whether a package can deliver this behavior on each target is a later proof,
not something its TypeScript return annotation can establish.

Keep the existing collection shape: one literal `max` (1–32), one direct bounded
`for...of`, one inline homogeneous effect expression per iteration, then an
immediate awaited flush. Examples assume the iterated arrays have already been
decoded with bounded project schemas. They do not propose filtering, `await`
inside construction, nested groups, escaping collections, or reused effect roots.
Collection capacity is not a replacement for the request's cumulative budget.

## 2. Current vocabulary and corrections to the conversation sketches

| Source at the inspected base | Existing contract | Consequence for these sketches |
| --- | --- | --- |
| [Runtime declarations](../../../packages/runtime/src/index.d.ts) | `PulseEffect<T>` and the narrower `PulseParallelEffect<T>` are different; `effects.add` accepts the latter. | Async syntax alone does not confer parallel eligibility. Proposed operations need all three forms evaluated explicitly. |
| [Effects and continuations](../../concepts/effects-and-continuations.md#bounded-dynamic-collections) | `ctx.effects<T>({ max })`, inline `add`, `ctx.parallel(effects)`; stable result order and execution ownership. | Reuse these spellings and expectations rather than introduce another builder. |
| [Current computation contract](../../architecture/current-contracts.md#bounded-computation-calls) | `ctx.call(target, input, { inputSchema, outputSchema })` is synchronous and schema-bound; its callee has resources/workspace, not effects. | Earlier `await ctx.call(...)` sketches and suggestions of an async `ctx.call` loader were inaccurate. No such widening is proposed here. |
| [Host contribution contract](../../contributing/package-lowerer-contract.md#operation-level-host-contributions) | The proven service admits one direct terminal operation, not ordinary async composition. | None of the shapes here is enabled by HEX merely because it uses package calls. |

The events prose in the effects concept page still broadly says there is no
`ctx.call`; the current architecture and runtime declarations distinguish the
HTTP computation surface from event contexts. This note follows those owners.
Reconciling that pre-existing documentation inconsistency is separate work.

### Illustrative imports and results

```ts
// DESIGN ONLY: these proposed modules and exports do not exist.
import { metrics, downstream } from '@pulse-compute/fastly-observations'
import { cache, httpCache } from '@pulse-compute/fastly-cache'
```

These names make host dependence visible. They do not decide package layout:
generic and host-specific operations may coexist in one package or subpath,
as in GRIP. No automatic portable replacement is implied by changing targets.

Use explicit result discriminants, consistent with existing time and storage
surfaces. Working shapes for discussion:

```ts
type Observation<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: string }

type RuntimeSnapshot = {
  vcpuMs: Observation<number>
  memoryMiB: Observation<number>
}

type TlsObservation = Observation<{ protocol: string; cipher: string }>
type ClientObservation = Observation<{ ip: string }>

type CacheRead<T> =
  | { status: 'hit'; value: T }
  | { status: 'miss' }

type CacheWrite = { status: 'stored' }
```

`reason: string` is a sketch placeholder, not an approved open-ended diagnostic
contract. Unavailable metadata is a domain outcome; unsupported targets,
malformed returned data and host-operation failures are not silently converted
to unavailable, zero or cache miss. The working preference is to use the owning
application error boundary for failures. Exact error codes and any necessary
ambiguous-write result remain open. A timeout never promises that a write did
not happen. A schema argument binds runtime validation; a TypeScript generic
alone does not validate external data. All schema IDs below are illustrative
literal IDs assumed registered by the application.

## 3. Runtime observations: explicit sampling

Preferred candidate: `metrics.snapshot(ctx)` is an awaited operation, even if
the host implementation is synchronous. It reads observations at dispatch,
following the precedent of `ctx.time.now()`, rather than appearing to be pure
computation. The two fields are not promised to be an atomic simultaneous sample.

```ts
// Handler fragment. rankProducts is a named imported synchronous computation.
const before = await metrics.snapshot(ctx)
const ranking = ctx.call(rankProducts, { query }, {
  inputSchema: 'catalog.RankInput',
  outputSchema: 'catalog.RankOutput',
})
const after = await metrics.snapshot(ctx)

if (before.vcpuMs.status !== 'available' || after.vcpuMs.status !== 'available') {
  return ctx.json({ ranking, measured: false })
}
return ctx.json({
  ranking,
  measured: true,
  vcpuMs: after.vcpuMs.value - before.vcpuMs.value,
})
```

The intended dependency is sample → computation → sample. The compiler must not
hoist, fold or parallelize these samples across the computation. Sampling itself
has cost; this is not an exact profiler of only the computation.

| Form | Proposed expression | Meaning |
| --- | --- | --- |
| Direct | `const sample = await metrics.snapshot(ctx)` | One dispatched observation. |
| Keyed parallel | `const { sample, settings } = await ctx.parallel({ sample: metrics.snapshot(ctx), settings: ctx.kv<Settings>('settings').get('public') })` | Independent work; sample timing relative to the KV read is not fixed. |
| Collection | See below. | Multiple fresh observations, with no implied temporal spacing. |

```ts
const effects = ctx.effects<RuntimeSnapshot>({ max: 4 })
for (const request of sampleRequests) {
  effects.add(metrics.snapshot(ctx))
}
const samples = await ctx.parallel(effects)
```

This collection form tests uniform eligibility, not a recommendation to collect
time-series samples in parallel. Meaningful before/after observations remain
sequential. Automatically recording every request's final metrics is a different
authoring use case and is not smuggled into `snapshot`.

Fastly's vCPU value is instance elapsed CPU time, excludes I/O waits, and includes
hostcall execution; the SDK cautions against benchmarking across runs. Memory is
a rounded snapshot including some host allocations, not peak or process RSS.
The API should preserve those meanings rather than relabel them request latency.
See [vCPU](https://docs.rs/fastly/0.13.1/fastly/compute_runtime/fn.elapsed_vcpu_ms.html)
and [memory](https://docs.rs/fastly/0.13.1/fastly/compute_runtime/fn.heap_memory_snapshot_mib.html).

**Failure and evidence expectation:** distinguish unavailable fields from failed
operations; identify runtime observation capability, selected target, units,
source sites and sequential/grouped placement. No measured values belong in a
build-only report. Comparing a build should reveal added observation capability.

## 4. Downstream facts: useful values, no exposed request handle

Preferred candidate: `downstream.tls(ctx)` uses the same explicit effect form.
A separate `downstream.client(ctx)` returns a deliberately selected client fact
shape, rather than one omnibus inspection that implicitly reads certificates,
fingerprints and security verdicts. The grouping form should not determine which
facts the application gains access to.

```ts
const tls = await downstream.tls(ctx)
if (tls.status !== 'available') {
  return ctx.text('Connection information unavailable', { status: 503 })
}
if (tls.value.protocol !== 'TLSv1.3') {
  return ctx.text('This endpoint requires TLS 1.3', { status: 403 })
}
return ctx.text('Connection accepted')
```

Here the rejection policy is authored by the application. The package supplies
host facts, not a default authorization decision. An absent observation is not
evidence that a connection is insecure; the application chooses how to handle it.
Client headers are not an automatic fallback for host-observed facts.

```ts
const { tls, client } = await ctx.parallel({
  tls: downstream.tls(ctx),
  client: downstream.client(ctx),
})

// Alternative collection fragment; repeated reads refer to this same request.
const effects = ctx.effects<TlsObservation>({ max: 4 })
for (const request of inspectionRequests) {
  effects.add(downstream.tls(ctx))
}
const inspections = await ctx.parallel(effects)
```

`downstream.client(ctx)` must independently satisfy the same three-form check:

```ts
const client = await downstream.client(ctx)
// Keyed form appears above. ClientObservation is a proposed client-result type.
const effects = ctx.effects<ClientObservation>({ max: 4 })
for (const request of inspectionRequests) {
  effects.add(downstream.client(ctx))
}
const clients = await ctx.parallel(effects)
```

Repeated metadata reads have limited practical value; uniform construction is
still worth assessing. Neither form switches the active request or enables
subsequent-request instance reuse.

**Failure and evidence expectation:** unavailable/unanalyzed is not a negative
verdict. A future certificate API must preserve certificate presence separately
from verification status. Reports identify the requested fact categories and
request-bound capability, not captured IPs, certificate bytes or fingerprints.
Changing from TLS protocol inspection to certificate/security inspection must
be visible in capability comparison. Field names, protocol vocabulary and the
exact available/unavailable granularity need review.

## 5. Value caching: explicit operations and conditional work

The working API uses a logical cache binding, separate from the runtime key:

```ts
const cached = await cache.get<Product>(ctx, 'products', key, {
  schema: 'catalog.Product',
})
if (cached.status === 'hit') return ctx.json(cached.value)

const product = await ctx.fetch(productUrl).json<Product>('catalog.Product')
await cache.put(ctx, 'products', key, product, {
  schema: 'catalog.Product',
  ttlSeconds: 60,
})
return ctx.json(product)
```

`'products'` denotes an application-owned logical identity, not a claim that
Fastly provides a physical named cache store or an isolation guarantee. Binding
configuration, key separation and codec/version identity remain design questions.

A miss is ordinary control flow. A cache read failure is not a miss, and a write
failure does not silently produce a cached success. This sequence offers no
request collapsing or single-producer promise: concurrent callers may compute
and insert independently. Cache contents are non-durable, not a KV-store alias.
The simple read candidate returns only an entry usable under its freshness
policy; it does not silently serve stale data. Explicit stale reads would need a
distinct policy/result discussion. A stored result confirms this operation's
acceptance, not persistence until TTL or immunity from eviction.

```ts
const { first, second } = await ctx.parallel({
  first: cache.get<Product>(ctx, 'products', firstKey, { schema: 'catalog.Product' }),
  second: cache.get<Product>(ctx, 'products', secondKey, { schema: 'catalog.Product' }),
})

const reads = ctx.effects<CacheRead<Product>>({ max: 8 })
for (const key of keys) {
  reads.add(cache.get<Product>(ctx, 'products', key, { schema: 'catalog.Product' }))
}
const products = await ctx.parallel(reads)
```

Writes must pass the same shape test, with independent inputs already available:

```ts
await cache.put(ctx, 'products', key, product, { schema: 'catalog.Product', ttlSeconds: 60 })

const { first, second } = await ctx.parallel({
  first: cache.put(ctx, 'products', firstKey, firstProduct, { schema: 'catalog.Product', ttlSeconds: 60 }),
  second: cache.put(ctx, 'products', secondKey, secondProduct, { schema: 'catalog.Product', ttlSeconds: 60 }),
})

const writes = ctx.effects<CacheWrite>({ max: 8 })
for (const item of items) {
  writes.add(cache.put(ctx, 'products', item.key, item.product, {
    schema: 'catalog.Product', ttlSeconds: 60,
  }))
}
const stored = await ctx.parallel(writes)
```

These are alternative fragments. Keyed results preserve declared keys and
collection results preserve insertion order, not commit order. Repeated keys
do not gain a deterministic winner from source ordering. A parallel group is
not an atomic multi-key transaction; some writes may commit before another fails.

**Evidence expectation:** separate cache-read and cache-write capabilities under
`products`, schema identity and TTL policy, plus the origin capability on the
miss branch. Identify conditional reachability without claiming a runtime miss,
hit or write occurred. Dynamic keys need bounded identity expressions, not their
runtime contents. A TTL/schema/binding change must remain visible to comparison.

## 6. Operations with a loader use the same three-form review

A coordinated operation is an authoring candidate, not a bypass of parallel
requirements. Compare these two spellings before choosing a loader vocabulary:

```ts
// Candidate A: one inline, recognized effect expression; no async wrapper.
const product = await cache.getOrSet<Product>(ctx, 'products', key, {
  schema: 'catalog.Product',
  ttlSeconds: 60,
  load: () => ctx.fetch(productUrl).json<Product>('catalog.Product'),
})

// Candidate B: imported named loader with explicit input; NEW loader concept.
const product = await cache.getOrSet<Product>(ctx, 'products', key, {
  schema: 'catalog.Product',
  ttlSeconds: 60,
  loader: loadProduct,
  input: { url: productUrl },
})
```

Candidate A is a deferred expression, not an arbitrary async callback containing
loops or effects. Candidate B needs its own admitted loader declaration and
input contract; `loadProduct` is not an existing `PulseComputation` and cannot
be assumed executable through today's `ctx.call`. Neither is implemented.
Prefer A for the first visual review because the conditional origin is visible
at the call site; B is worth comparing for reuse, not presumed cheaper machinery.
The options and success result must define what “getOrSet” promises; whether
this operation coordinates concurrent fills remains an explicit decision.

```ts
const { product, settings } = await ctx.parallel({
  product: cache.getOrSet<Product>(ctx, 'products', key, {
    schema: 'catalog.Product', ttlSeconds: 60,
    load: () => ctx.fetch(productUrl).json<Product>('catalog.Product'),
  }),
  settings: ctx.kv<Settings>('settings').get('public'),
})

const effects = ctx.effects<Product>({ max: 8 })
for (const item of requests) {
  effects.add(cache.getOrSet<Product>(ctx, 'products', item.key, {
    schema: 'catalog.Product', ttlSeconds: 60,
    load: () => ctx.fetch(item.url).json<Product>('catalog.Product'),
  }))
}
const products = await ctx.parallel(effects)
```

The candidate must capture each iteration's own inputs without executing the
loader during construction. A future named-loader variant must work in these
same positions; a separate `.parallelLoader()` API is not the preferred shape.

**Failure and evidence expectation:** a loader failure must not silently insert
a placeholder or disappear behind a cache miss. A sibling failure, deadline,
duplicate key and nested cache use must have understandable outcomes. Reports
must retain conditional loader capabilities and their relation to the parent
operation/group. A cache-only binding is insufficient if the loader can fetch.
Adding the operation to a collection does not authorize unbounded child effects.
The accounting, transaction lifetime, cancellation and nested-work decisions
belong to pass 2; this example does not claim they have been solved.

## 7. HTTP cache policy stays next to the request

Value caching and HTTP caching should not share a misleading `get` abstraction.
Fastly distinguishes read-through HTTP caching from simple/core cache operations;
HTTP policy includes origin cacheability and revalidation semantics. A value
cache wrapper does not recreate those semantics automatically. See the
[SDK cache interfaces](https://docs.rs/fastly/0.13.1/fastly/cache/index.html).

Preferred candidate for review: a package-owned fetch-shaped operation that
retains the familiar body projection. This does not authorize a second fetch
implementation; pass 3 must test reuse of the existing transport owners.

```ts
const product = await httpCache.fetch(ctx, productUrl, {
  cache: { mode: 'origin' },
}).json<Product>('catalog.Product')

const { first, second } = await ctx.parallel({
  first: httpCache.fetch(ctx, firstUrl, { cache: { mode: 'origin' } }).json<Product>('catalog.Product'),
  second: httpCache.fetch(ctx, secondUrl, { cache: { mode: 'bypass' } }).json<Product>('catalog.Product'),
})

const effects = ctx.effects<Product>({ max: 8 })
for (const url of urls) {
  effects.add(httpCache.fetch(ctx, url, {
    cache: { mode: 'origin' },
  }).json<Product>('catalog.Product'))
}
const products = await ctx.parallel(effects)
```

`origin` is proposed to preserve origin-directed HTTP cacheability; it does not
promise a hit or force caching of a private response. `bypass` needs a precise
host mapping. Forced TTL, custom keys, stale serving and revalidation callbacks
are deliberately not folded into one vague `enabled: true` option.

Compare the alternative of a package-owned policy value on `ctx.fetch`:

```ts
// Alternative only: this option is not in today's PulseFetchInit.
const product = await ctx.fetch(productUrl, {
  cache: httpCache.origin(),
}).json<Product>('catalog.Product')
```

The alternative keeps one authored fetch surface, but introduces a core option
and an admission path for package-owned policies. Prefer neither mechanism on
implementation convenience alone: assess readability, target errors and binding
visibility first. Do not expose both spellings without a clear benefit.

**Failure and evidence expectation:** ordinary transport and schema failures stay
visible; stale-on-error is not inferred. Reports retain origin/backend authority,
HTTP-cache policy and response projection together. Changing origin to bypass
must show a policy change; a build report cannot claim a cache hit, collapse or
successful revalidation. Returning the HTTP response directly, rather than
decoding JSON, remains a separate body-ownership review before promising parity.

## 8. Shape decision sheet

| Operation | Await | Keyed `ctx.parallel` | `effects.add` + flush | Proposed evidence |
| --- | --- | --- | --- | --- |
| Runtime snapshot | Shown | Shown | Shown; limited practical value | Runtime observations, units, sampling order/group |
| Downstream TLS/client facts | Shown | Shown | Shown; current request only | Requested fact categories; no runtime personal data |
| Value-cache read | Shown | Shown | Shown | Logical binding, read, schema, conditional flow |
| Value-cache write | Shown | Shown | Shown | Logical binding, write, schema, TTL; no atomic group claim |
| Operation with deferred loader | Shown | Shown | Shown | Parent capability plus conditional child capabilities |
| HTTP-cache fetch with JSON projection | Shown | Shown | Shown | Origin/backend, cache policy, schema/body projection |

“Shown” means proposed source shape only, **not compiled, admitted or qualified**.
All six rows require a later three-form proof if selected. The same result and
failure vocabulary should apply in each form. Existing terminal GRIP operations
remain outside this nonterminal proposal and retain their explicit restrictions.

The evidence column is a review requirement, not a proposed report JSON schema.
Use existing capability bindings, operation/source identities and topology where
they fit; pass 2 determines missing representational support. Preserve declared
versus observed ABI attribution and unknown coverage. Neither authored syntax nor
admitted imports prove runtime execution. An imported-unused package must add
neither selected capability bindings nor emitted host-extension machinery.

### Preferences to review, not approvals

1. Keep functions in package exports with `ctx` as the request binding. Avoid
   broad host SDK objects on `ctx` and authored raw handles.
2. Prefer explicit awaited observations over synchronous getters for now;
   consistent evidence and sampling order outweigh saving one `await`. Immutable
   request snapshots are an alternative worth evaluating, not ruled out.
3. Use one operation expression in all three forms; construction is not execution.
4. Make cache binding, schema and units explicit. Keep miss, unavailable, failure
   and uncertain side effects distinct. Do not infer rollback or silent fallback.
5. Review loader syntax with every other operation, including parallel and
   collections; do not retrofit async behavior into `ctx.call` by assumption.
6. Require evidence to explain the authority and conditional work an API hides.

### Questions that should survive into pass 2

- Which observation fields and unavailable states are actually useful to authors?
- Is a mandatory logical value-cache binding worth the extra argument, or should
  a package-owned bound facade remove repetition without adding hidden authority?
- What exact result/error vocabulary handles failed and ambiguous cache writes?
- Is an inline deferred effect sufficient, or is a named async loader justified?
- What does coordinated fill promise under parallel siblings and duplicate keys?
- Which HTTP-policy spelling reads better without disguising transport ownership?
- How are child effects, cancellation, resource lifetime and binding topology
  represented uniformly for all compound operations?

Pass 1 stops at these shapes and tradeoffs. It does not define provider services,
hook ordering, cache transaction machinery, compiler admission or new report
schema fields. The next pass traces the selected examples through those owners;
it is not permission to implement them.
