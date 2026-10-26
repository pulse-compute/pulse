# Current architecture contracts

This page is the present-tense map of Pulse's architectural commitments. It
defines ownership and invariants; the linked concept, contributor, governance,
and release pages define the detailed behavior and evidence.

The current source, machine-readable catalogs, and executable acceptance suites
are authoritative together. Git and sealed release checkpoints preserve why the
contracts changed; numbered decision records are not part of the active
documentation system.

## Bounded computation calls

Selected plain HTTP handlers, reachable Router handlers and managed MCP
operations may synchronously call a named imported project computation through
`ctx.call(target, input, { inputSchema, outputSchema })`. Both IDs are literal
registered object schemas; a target identity has one pair. Node Native, Fastly
Native and explicit Node JavaScript support this boundary. Fastly JavaScript
and event contexts do not. The [canonical API](../../API.md#ctxcall) owns the
source-bound example and full restrictions.

The callee receives a recursively readonly validated input and only resource
and workspace authority. Output conversion returns an independently owned,
validated result. Existing pure helper admission, bounds, codec, resource,
workspace, request-budget and error owners apply. There are at most sixteen
reachable static occurrences, with no nested/recursive calls, call in a loop,
await, dynamic target, arbitrary package target, effect or context escape.
Entities uses this shared machinery; it owns only its invocation adapter.

`PulseComputationContext`, `PulseReadonly`, `PulseComputation` and
`PulseCallSchemas` belong to runtime declarations and are re-exported by Pulse.
Runtime authoring, handler types and context inventories are version 5.
Per-computation descriptors and JavaScript callable tables use
`pulse.computation-call.v1`; independent validators reject stale proof-era or
unversioned callable metadata even after a plan is rehashed. Optional callable
metadata leaves call-free Native plan version/identity unchanged. No-call and
imported-unused Wasm equality remains a gate; used calls pay conversion cost.
No new runtime registration, package export entry point, dependency, provider,
continuation ABI or release package-set change is introduced.

## Contract precedence

When two surfaces appear to disagree, use this order:

1. the public release manifest and its generated package/support policy define
   what is shipped and supported;
2. canonical runtime, compiler, package, and provider contracts define behavior;
3. executable conformance and release gates prove that behavior;
4. current public and contributor documentation explains the supported contract;
5. examples demonstrate the contract but do not widen it.

Generated references and installed CLI documentation must be regenerated from
their canonical owners. An internal module, resolvable export, retained fixture,
or historical implementation does not become a public compatibility promise.

Native `build` and `compile` may explicitly opt in to
`--elide-json-cache-arena`. The private build-support adapter changes only the
disabled-cache arena allocation in pinned json-as 1.5.0. Defaults, enabled-cache
behavior, schema semantics, GC policy and provider authority remain unchanged.
The setting propagates from portable compilation to provider realization and is
bound into retained report recipes; it is independent of scalar handle lifetime.

## MCP protocol and operation ownership

`@pulse-compute/mcp/pulse` owns static MCP admission, discovery and tool-result
framing. Its selected Entities router owns schema-bound operation invocation
inside the same request; shared `ctx.call` owns reusable computation. Node
Native, Fastly Native and explicit Node JavaScript support this facade. Fastly
JavaScript does not satisfy its request-deadline requirement. The binding
retains finite request/result limits, explicit protocol selection and no
internal HTTP hop. It adds no OAuth callback, dynamic registry or ambient host
authority.

The package root and `/node` are separate JavaScript host adapters. They project
an emitted catalog and schema registry and forward admitted calls to a fixed
governed HTTP endpoint. Their optional OAuth admission uses an external issuer,
resource audience/scopes and bounded introspection; backend credentials remain
separate from client tokens. These host options do not widen the static facade.

Both paths keep MCP protocol state outside runtime core. Their explicit legacy
protocol option does not permit automatic downgrade from modern framing.
Initialization creates no retained session or capability grant. Notifications
do not invoke tools. Neither path provides SSE, MCP Resources, Prompts or stdio.
[The package guide](../packages/mcp.md) owns the public construction and limits;
[Entities and adapters](../concepts/entities-and-adapters.md#mcptools-boundary)
explains the invocation boundary. Local installed and actual-host receipts are
separate from deployed-service qualification.

## Bounded effect collections (B10-06)

`ctx.effects<T>({ max })`, inline `add`, and awaited `ctx.parallel(collection)`
form one execution-owned, single-use collection contract. Literal capacity 1–32,
straight-line build/flush source admission, argument capture, ordered results,
whole-cohort effect-budget admission and cancellation are defined in
[effects and continuations](../concepts/effects-and-continuations.md#bounded-dynamic-collections).
This adds no arbitrary Promise scheduler, callback admission or target fallback.

JavaScript privately claims queued roots before provider dispatch. Native plan
v10 records `effect-collection` v1 with a fixed bank of unique slots and an active
prefix. The optional `effect_collection_count` host import binds input length,
capacity and continuation identity; old hosts reject that required import/plan.
Static groups keep exact-list validation. Empty collections do not suspend.
The same invocation-ticket owners authenticate completion and retire terminal
work. Code and slot metadata grow linearly with the declared maximum.

The CLI uses exact Native execution for collection plans in `test` and `dev`.
The registered collection corpora cover source/runtime and provider contracts;
clean-machine acceptance reuses its independently installed candidate packages
for the public example. Full release qualification remains a separate gate.

## One application contract and one compiler spine

`@pulse-compute/runtime` owns the low-level portable handler, context, effect,
body, and static `Router` contract. `@pulse-compute/pulse` owns the conventional
`Pulse` application root, project configuration helpers, schema declarations,
and runtime type re-exports. Applications import normal package roots and do not
select providers through application-package export conditions.

Plain handlers, the `Pulse` application root, and static Router authoring are
frontends to one deterministic whole-project compiler:

```text
root extraction
→ reachable-module graph
→ authoring and Router topology normalization
→ semantic classification and contract validation
→ canonical Handler IR
→ effects, continuations, schemas, and package operations
→ provider-neutral Native plan
→ selected provider realization
```

The compiler has one internal, fixed phase order. It does not expose a mutable
visitor framework or accept runtime rule registration. Frontends may retain
their own topology while normalizing handler bodies into the same canonical IR.
Provider realization begins only after the complete reachable program and its
capability requirements are known.

Explicit JavaScript Entities operations retain their original static source
graph, including ordinary helpers and callbacks. Declared-handler inspection
records recognized Pulse effects; it does not prove ordinary helper or dependency
internals. Schema admission, Pulse effect-await rules and static dispatch remain
in force. Native handler restrictions are separate eligibility blockers during
JavaScript inspection and remain errors when Native is selected. A JavaScript
inspection body is never substituted for a Native generator.

HTTP Router authoring supports static `get`, `head`, `post`, `put`, `patch`,
and `delete` registrations, inherited by `Pulse`. The owned Router API registry
defines compiler admission; topology and lifecycle method catalogs derive from
that registry. Each verb uses the existing route entry, exact-method dispatch,
terminal transfer and 404/500 exhaustion contracts. This expands ingress
registration without changing outgoing fetch methods or the effect/continuation
ABI.

An ordered mount can carry the static string descriptor
`mount(path, child, { state: 'key', equals: 'family' })`. The owned Router API
registry and extractor admit only that inline, literal form. Runtime dispatch
and canonical lowering read request state once at the matching mount entry;
false takes `parentContinueIndex`, true takes `childStartIndex`. The descriptor
participates in the mount's stable identity and retained topology. No child body
is duplicated, no callback is evaluated, and no new effect or continuation ABI
is introduced. Resumption stays inside the admitted child even if it changes
that state. Selection conveys no authorization. Historical table/harness
emission rejects this form because its compatibility scanner has no eligibility
contract. See [Selected groups](../guides/routing.md#selected-groups).

The compiler also recognizes root-only `Pulse.on(type, { schema }, handler)`
declarations as a separate static event topology. Event types and schema IDs
must be literal, schema IDs must resolve through the project registry, each
type has one owner, and event handlers receive the same checkout-independent
canonical handler identity used by HTTP handlers. The resulting event catalog
is inspectable and enters a plane-neutral application-entry table without
becoming a Router route. Event handlers use exact event selection,
schema-validated `ctx.event.payload`, shared non-HTTP context operations, void
completion, and execution-owned failure.

The transport-free JavaScript runtime host can directly execute one canonical
event frame against a live Pulse application. Provider-neutral Native plans can
lower the same eligible event handlers through the conditional
`pulse.native-event-abi.v1` extension. Event-only artifacts expose the event
entry; mixed artifacts retain the separate HTTP and event entries; HTTP-only
artifacts add no event imports, exports, code, catalog data, or byte changes.
The Native host validates and detaches the frame and schema payload before
entering the module, passes an artifact-local event runtime ID plus a host-owned
payload handle, and drives the existing effect/continuation state machine to
void completion or bounded failure. Event input never masquerades as an HTTP
request, no Promise or Asyncify runtime is linked, and no target probing or
fallback occurs. Node now supplies a bounded invocation-scoped reference
adapter around this entry for direct JavaScript/Native parity. It is not a
public listener, process-global bus, or production transport; Fastly, browser,
and ESP32 event realizations remain unclaimed.

Mixed Native applications may combine HTTP application-error handlers with
event entries. Compiler-owned HTTP cursor boundaries protect the HTTP error
lane; event records in the shared routing inventory are not HTTP cursor entries.
An event effect failure remains an event execution failure and cannot enter
HTTP middleware or application-error handlers.

Each JavaScript or Native event invocation owns its state, effects,
cancellation, redaction, logging, completion, and disposal. HTTP and event
handlers may await the shared one-way `ctx.emit(type, { schema, payload? })`
effect in JavaScript and Native runtimes. Compilation requires literal event and
schema identities, validates schemas against the project registry, records
deterministic callsite/capability requirements, and accepts emission inside an
awaited `ctx.parallel` group. Runtime dispatch validates and detaches the frame
before a trusted adapter sees it; public observations redact the payload. The
bounded Node reference adapter owns a FIFO ingress queue and an independent
exact-frame outbound acceptance ledger. It serializes instance entry,
propagates cancellation/failure categories, and never invokes a matching local
handler. Native `event.emit` lowers through the canonical effect and
continuation protocol with zero JavaScript/Asyncify imports. None of this
implies delivery, a receipt, persistence, retry, a public provider listener, or
automatic target fallback. Router lifecycle `on`, channel, and
connect/disconnect semantics remain retired.

The event contract reserves no `call` surface: event contexts have no `ctx.call`,
application call method, generic call effect, adapter operation, compiler
opcode, or runtime capability. `ctx.emit` is strictly one-way and cannot enter
local dispatch. Any request/reply or reflexive routing mechanism must arrive as
a separately reviewed host, lifecycle, recursion, and failure contract rather
than an interpretation of the current event plane. See [Static events and
outbound emission](../guides/events.md).

Project discovery is graph-based rather than substring-based. Module identity is
path-independent and deterministic, resolver inputs are fixed, and only
reachable project modules and package roots participate in compilation,
eligibility, and packaging. Static ESM links supported project modules; Pulse
does not become a general TypeScript bundler or execute arbitrary application
JavaScript during Native compilation.

See [Compilation and lowering](../concepts/compilation-and-lowering.md) and the
[architecture overview](./overview.md).

## Declared npm source exports (IMP9-01)

Native compilation can link installed, versioned npm exports into the same
static source graph as local handlers/helpers. Exact root or subpath `exports`
entries select one `.ts`, `.mts`, `.js` or `.mjs` source file. Conditional objects
use declaration order with `pulse`, `import` and `default` active; `types` and
unselected conditions confer no runtime eligibility. There is no `main`/`module`,
wildcard, array, directory or extension-substitution fallback. Explicit CommonJS
sources and declaration-only runtime exports are rejected.

Package-relative links must name exact files within the real package root;
package-root symlinks are supported, escaping source symlinks are not. Bare
imports resolve from the dependency's installation, including self-references
through its exports. Application tsconfig aliases do not redirect dependency
imports. Distinct physical roots with the same package identity are rejected
rather than silently conflated. Top-level source is limited to static imports,
re-exports, types and function declarations or immutable function bindings.
Module initialization, captured constants, factories, dynamic imports and
CommonJS loading remain unsupported. Existing Native syntax, helper, effect and
capability checks still apply; no source code is evaluated to obtain a handler.

Graph package nodes retain the imported export subpath and package/version/
manifest hash. Their explicit source edges point to attributed source nodes,
whose `packageSubpath` is the authored package-relative filename. Portable
`npm/<name>@<version>/<manifest-hash>/<file>` paths identify those source nodes
and diagnostics; source content hashes and edges enter the graph hash. Source
files and package manifests enter watch inputs. `static-source` package status
means source admission, not lowerer trust or proof that every function compiles.
Explicit JavaScript planning retains its existing opaque dependency graph.

Ordinary source imports grant no lowerer trust. A package that advertises a
`pulsewasm` manifest opts into the versioned trusted build-dependency contract
described under [Package-owned capabilities](#package-owned-capabilities). Its canonical
contained manifest, protocol versions and package ownership must validate;
malformed declarations are rejected rather than ignored. Package names and
versions need not match a first-party list or Pulse's release version.
Undeclared compiler files remain inert; declared `pulse.contract` product
metadata must be static JSON.
`npm-source-imports` covers resolver admission and rejection in repository
fixtures. `npm-source-installed-workflow` packs the candidate toolchain and an
independent dependency, installs exact versions outside the checkout, and tests
Node/Fastly Native handlers, middleware and directly awaited scalar helpers.
The installed cases combine fetch suspension with trusted Crypto digest effects,
check authored source attribution and executable Wasm identity, and repeat after
a pinned dependency update without copying or changing application source.
An unsupported dependency update or undeclared crypto capability must fail
explicitly. An installed malformed lowerer declaration must also fail before
its executable file is loaded.
Fastly execution uses the fixture ABI;
this qualification does not claim a deployed provider test.

## Native diagnostic artifacts

Executable Native Wasm and its verification do not depend on optional compiler
text output. Routine compilation omits diagnostic WAT; `pulse compile` and Native
`pulse build` opt in with `--emit-wat`. Manifest and file metadata distinguish
omission from an emitted artifact, and writers remove stale compiler-owned text
on reuse. Required guest-link disassembly audits remain mandatory. This changes
artifact policy, not handler admission, the effect ABI, optimizer posture, or
provider authority. See [optional Native text artifacts](../concepts/compilation-and-lowering.md#optional-native-text-artifacts).

## Native numeric loop regions

Non-guest-linked Fastly Native builds select a private canonical numeric-region
policy for both schema/incremental and schema-inactive/stub runtimes. Builds with
the selected linked crypto guest use a narrower policy that requires inactive
schema codecs. Schema-active linked builds retain boxed emission, including when
JSON cache arena elision is requested. Other linked guests are not opted in.
The provider-neutral `pulse_host` compiler used by Node Native selects its
separately qualified host policy for schema and stub builds without linked guests.
Provider writers retain authority over final emission; caller options or a
portable intermediate cannot bypass the Fastly runtime gate.
The canonical emitter proves numeric initialization and
all reaching writes around bounded pure loops, using stable local IDs rather
than type hints. Eligible regions use private f64 slots and box written values
into the existing local handles before generic consumers or effects. Boxes
already held by aliases, collections and state remain immutable. Zero-trip and
conditional writes preserve untouched handles. Arithmetic order, IEEE values,
loop caps, control-state IDs and guard weights remain unchanged.

The same proof applies to synchronous pure helper bodies and shared HTTP stages.
Helper parameters remain unknown live-ins regardless of their type annotations;
only independently initialized numeric regions are selected. Helper slots still
reset on each call and clear at returns. A helper loop containing an early return
keeps its existing emission. Shared-stage regions box before effects, transfers
or generic consumers, preserving invocation frames and continuation ownership.
Region write flags reset on every entry, including repeated calls/registrations.

Unlinked Fastly read-loop plans also admit these proven regions. Each eliminated
uncached numeric allocation pays the existing value/byte charge at its original
evaluation point, in evaluation order. Integer and boolean cache admissions use
the original host value operations, preserving cache state for later boxed code.
Region exits materialize already-charged numbers without a second charge. This
does not refund the cumulative budget or defer failures to the region boundary;
exhaustion still closes the invocation and traps. Charge and materialization
helpers check the latched failure even for cached values. The accounting policy,
effect cap, loop caps and linear-memory ceiling are unchanged. These private
Fastly helpers add no host import or public option. Manifests identify this path
with `accounting: fastly-read-loop-v1`.

Unknown live-ins, coercive operations, nested assignment results, generic calls
and collection writes decline this optimization. Effectful helper bodies,
package-owned application emitters, Node linked guests, Fastly schema-active
linked builds, Node budgeted plans, linked-guest budgeted plans, and entire
output/body-transform plans retain existing emission. Node's rotating scalar
cache needs separate accounting qualification; this Fastly realization does not
extend the `pulse_host` ABI. JavaScript is unchanged. Node collections
continue to store JavaScript values directly; numeric region exits allocate normal
host handles without mutating, releasing or reusing existing entries. Node host
handle counts, guest linear-memory capacity and process heap/RSS are distinct
measurement domains. Eliminating host entries is not a guest-byte or RSS claim.
Fastly stub allocation avoidance requires no collector. The selected linked
runtime retains its fixed 32-page memory, disjoint Rust/static/invocation-frame
ranges and unchanged allocator. Final-link audits remain mandatory; allocation
avoidance does not make a previously failing schema/guest combination eligible.
The numeric policy adds no host ABI, allocation ceiling, cache default, GC policy,
or reclamation protocol. Generic handle retention outside the separately qualified
ownership slice below remains; deliberately retained snapshots still require
storage. Generator manifests record the policy, selected regions
and declined loop reasons, and source hashes bind the emitted strategy.

## Fastly Native handle ownership

Unlinked, schema-enabled Fastly Native plans using the incremental managed runtime
select the private `fastly-handle-tracing-v1` policy only when their entire plan
passes the complete owner audit. The policy admits ordinary expressions,
pure loops, terminal HTTP handlers, request metadata/text/JSON, schema codecs,
responses, request state and logging, audited pure/async helpers, shared stages,
Router error lanes and the explicit Fastly effect allowlist. Events, package-owned
application emitters, unknown frames/expressions/statements/capabilities/effects
and all allocation-budgeted plans are excluded. Stub and linked runtimes, Node Native and JavaScript keep their existing
lifetime behavior. No public configuration or host ABI is added.

Compiler root descriptors enumerate the result, helper return, every declared
local and effect-result slot, and both request-state arrays from their declarations.
Effect results remain roots independently of ready/pending flags. The provider
validates that descriptor and adds its request-header snapshot, occupied caches,
all payload/ready slots, opaque-resource pins and forwarding marker/result when present.
Completed expressions and loop control boundaries may collect only after values
are rooted or discarded and no unregistered handle temporary remains. Numeric
regions checkpoint only after boxing their outputs. A latched error suppresses
collection. Parsers, codecs, host operations and expression evaluation never
invoke the tracer internally.

Pure helper calls defer collection until the complete caller expression returns;
earlier arguments and borrowed returns can remain on the native stack. Async helper
and shared-stage slots are global roots with their existing reset/transfer ordering.
Additional checkpoints follow rooted helper returns, stage exits, complete sibling
dispatch and resume result transfer. No collection occurs during payload construction,
provider settlement or between a borrowed result and guest acceptance. Router recovery
constructs and roots its error before collection can resume. Invocation tickets,
deadlines, pending resource IDs and mode flags are not value handles.

Fetch and opaque-body wrappers are pinned until invocation end. Existing provider
cleanup remains responsible for closing bodies and retiring/reaping requests;
tracing adds no destructor, cancellation, retry or resource reuse. This conservative
policy does not bound wrapper churn independently of the existing invocation limits.
Request-duration and fetch deadlines remain usable; allocation budgets retain their
separate retain-until-terminal behavior.

Eligible plans use a sparse map with monotonically increasing positive IDs.
Tracing follows collection handle edges and direct rope object edges independently,
using iterative worklists without flattening strings or allocating lazy backing
stores. A complete survivor map replaces the old table; invalid edges fail before
publication. IDs are never recycled; exhaustion fails through the existing value
error at stage 1 before wrapping. `__pulse_drop` remains a no-op. The existing
managed collector reclaims objects after their last strong reference disappears.

The initial private trigger is `max(1024, live mappings after the previous pass)`
new handles between safe points. Cache entries remain pinned and an occupied-slot
index avoids scanning empty cache capacity. Table and tracing storage track the
reachable graph plus allocations since a safe point, with old and survivor tables
coexisting during a pass. All local slots remain conservative roots, even after
their source scope ends. Live snapshots, caches and unflattened rope graphs still
require storage; a long operation without a checkpoint can allocate substantially.
Wasm memory need not shrink. This does not change cumulative budget accounting or
qualify general reclamation for excluded runtimes. See the measured first slice
and residuals in [MEM9-09](https://github.com/pulse-compute/pulse/blob/latest/docs/internal/mem9-09/README.md) and the
[frame/effect extension](https://github.com/pulse-compute/pulse/blob/latest/docs/internal/mem9-09b/README.md).

## Native internal helper sharing

Native generation may share byte-identical internal expression-helper bodies
after resolving child helpers and local slots. Every original call still
executes, including allocations, mutations, short-circuiting and budget charges.
Repeated multi-statement helpers and dispatcher partitions use compiler-owned
retention annotations. The build-support transform maps these to Binaryen's
no-inline flags before optimization; AssemblyScript alone ignores `@noinline`.
Small leaves remain eligible for inlining. This is internal direct-call sharing
with no public function-value syntax, effect or ABI change.

Expression helpers use private `__pulse_ex_<id>$k` (retained) and
`__pulse_ex_<id>$i` (inline-eligible) names so exact retention batching also
works for sparse helper IDs. The name alone grants no retention: compiler-owned
source and annotation checks still apply, with every matching module function,
including imports, checked before batching. Names preserve the length and
lexical ordering of `__pulse_expr_<id>` for dispatcher character budgets and
Binaryen function-ordering ties. Legacy names remain supported by the transform.

Routers with application-error handlers share one retained error-routing guard.
Each original guard site calls the helper, which consumes the pending error
once and returns a private no-error, routed-error or fatal status. It resolves the current plan's Router slots and preserves error-handle, mode,
cursor, pending, continuation, result and program-counter updates. Its caller
keeps the existing state-loop or chunk-return transfer and fatal status; sharing
adds no effect, continuation, allocation or charged dispatcher state. Routers
without application-error handlers do not emit the helper. Partition budgeting
charges the original inline guard footprint so sharing does not silently pack
more states into each optimizer unit.

Literal error-boundary `(cursor, next block)` pairs use deterministic retained
zero-argument wrappers around that same guard. Each distinct pair has one
private wrapper; the original sites still consume an error exactly once and
perform the same transfer. Shared-stage and helper boundaries keep their dynamic
cursor and return-block arguments. Binding does not change guard positions,
partition budgets, state IDs, run allowances or optimizer settings, and does not
require an experimental size flag.

For modules without guests, AssemblyScript runs Binaryen's similar-function
merge after its normal optimization. Guest-linked modules instead merge after
composition in the guest-link stage. In both cases the pass reuses function
bodies; it does not create a dynamic function table or change the value heap's
retention or accounting rules. The merge and inlining settings are heuristics,
not a hard limit on the number of parameters or on the size of every function.

## Synchronous pure source helpers (PF-02/PF-03/PF-04/PF-06)

The integrated Native plan compiler identity is
`pulse.canonical-native-plan-compiler.v11`. It combines the existing helper
lowering with terminal package applications and the bounded Node body/output
extensions. The plan schema, helper contracts and host ABI retain their own
versions; this compiler identity does not widen their admission rules.

Native plan v9 retains one `pulse.canonical-native-pure-helper.v2` body per
statically resolved synchronous function declaration. HTTP routes and middleware
may call it in bindings and expressions, including `if (!validator(value))`,
without `await` or `ctx`. JavaScript executes the original source graph.
Parameters and results are explicit; results remain `string`, `number` or
`boolean`, with a scalar return on every reachable path.

PF-03 adds `pulse.pure-borrow.v1` parameter descriptors for records with required
scalar fields, one nested record level, and numeric arrays. Records contain at
most 32 fields per level. Static named project type imports (including aliases),
local interfaces and type aliases resolve through the contained module graph.
Mutable source interfaces are allowed. Optional/nullable/union/index-signature,
recursive, generic, method/accessor and deeper record shapes are excluded.

The callee borrows existing i32 value handles synchronously. It cannot mutate
parameters or derived aliases, return a structured value, capture/retain it, or
pass it to another helper. Derived record/array locals must be `const`; scalar
locals may mutate. Field reads, array length/index reads, scalar operators,
branches and literal-capped loops are admitted. A pure helper can return its
scalar result early from its own loop. PF-04 admits pure calls inside existing
bounded caller loop bodies, including read loops. A pure callee requires no read
site. Each loop call carries `pulse.bounded-pure-loop-call.v1`; deserialized plans
independently multiply every enclosing caller cap by nested callee caps against
the existing 65,536 iteration-product limit. The existing conservative rule counts
a zero cap as one for static accounting. Sibling loops/calls are not summed.
Call inputs within loops are read-only; active caller counters cannot mutate.
Calls in loop headers remain excluded. Effectful helper eligibility is unchanged.

JavaScript inspects statically resolved pure calls in HTTP handler loops through
the same bounded source checks, then executes the original source graph. This
does not inspect ordinary dependency function internals or grant Native eligibility.
Pure helpers finish and clear their slots before a caller read can suspend; caller
state alone continues under the existing effect invocation contract.

PF-06 propagates caller field/index types from literal graphs, matching schema
boundaries and explicitly typed `ctx.kv<T>(name).getVersioned(key)` results.
Direct namespaces and local namespace aliases retain a bounded structural type
resolved from the contained project graph. `pulse.typed-kv-borrow.v1` belongs to
the existing KV read result; it adds no effect, decoder or runtime check. The
`.value` projection borrows the original stored value. The declaration describes
expected fields, not storage validity: callers still handle found/missing/failed
outcomes and validate corrupt payloads with their existing value semantics.
Untyped KV, `unknown`, schema-less JSON and type assertions do not establish shape.

Bindings, record/array aliases, scalar field reads, string length/index reads and
numeric array reads are proven independently. Optional schema strings require a
string default. Mutable caller bindings are admitted only when every initializer
and assignment has the same structural type; nullable schema locals additionally
need an explicit non-null guard or definite non-null assignment at the read.
S-02 preserves required scalar field facts across a bounded record spread when
the spread source and resulting record both satisfy the existing field/depth
limits and every assignment retains the same shape. A self-spread may use the
proven initializer shape as its recursive seed; all writes must independently
reconstruct that shape. Unknown spreads, changed or optional field types and
cyclic alias provenance do not establish a projection. The validator checks
the serialized definitions and writes rather than trusting producer field tags.
A zero-argument request text read supplies a definite string replacement in
this proof; it does not establish a type for schema-less JSON.
S-03 carries a proven optional string scalar from a schema field or a bounded
`ctx.state.get` read through an explicit strict `undefined` guard on a const
local. A branch-local call is admitted only on the
non-undefined path; after an early return, only the surviving path contributes
the fact. Both surviving paths must prove it at a join. The independent plan
validator reconstructs the guard, source schema field and control-flow join;
the state read's key and arity must also establish its optional string source.
the producer's narrowed value tag alone is insufficient. Mutable scalar locals,
unguarded or non-dominating calls, a null check on an optional string, and
optional fields in borrowed-record
signatures remain excluded. The earlier guarded nullable schema-local rule is
unchanged.
The validator follows aliases and rejects writes through the borrowed graph
anywhere in the handler, including after a call. Scalar copies do not retain a
record alias. Nested record/array reads preserve the original object identity.
There is no flow-sensitive recovery after a shape-changing write.

Arguments evaluate once, left to right; `&&`, `||` and conditional expressions
preserve skipped calls. Pure helpers cannot capture values, access context,
effects or Router authority, construct responses, accept callbacks, nest calls,
recurse, or use async/generator/exception syntax. Existing admitted value/error
semantics remain in force. Invocation slots reset at entry and clear on scalar
return. Failure follows existing request/Router failure handling; no suspension
or externally callable helper can expose its slots.

Calls add no payload copies, JSON encoding/decoding, host effects or continuations.
The existing value host still creates handles for property/operator reads; this
is not handle reclamation or a constant-memory promise. The focused Node host
fixture observes 207 additional handles per successful validation (including
three scalar call arguments), of which 15 reference existing structured objects.
For 0/1/2/16 calls, handles are 19/226/433/3331 and guest linear-memory capacity is
1,245,184 bytes in every cell. The nested record and numeric array retain identity;
there are no additional payload graphs. These are source-tree fixture observations,
not RSS, Fastly, packed-consumer or final-Wasm sharing claims.

After deserialization, the compiler independently validates descriptors, field
and index kinds, const aliases, scalar results, body/local ownership, arity,
non-nesting and loop bounds. A recomputed hash does not establish validity.
Effectful `pulse.canonical-native-helper.v1` keeps its suspension contract.
Plan/compiler v9 invalidate older cached plans; regenerate them from source.
Generator v9 and the guest ABI are unchanged.

`wasm/packages/compiler/src/pure-helper-values.js` owns the internal bounded
value vocabulary: scalar kinds, record depth/field limits, prohibited field
names, structural equality, field/index result facts and operator result facts.
The source type resolver translates contained TypeScript declarations using
those limits; the Native plan builder consumes the shared result rules. Neither
consumer owns a second binary/unary result-rule implementation.

The vocabulary preserves two inference boundaries. Dynamic plan kinds include
`in`; reconstructed type facts use structural equality. Optional-string defaults
are directional for `||`: an optional left operand with a definite string right
operand proves a string, while a definite string left operand with an optional
right operand does not. `??` proves a string in either order because a definite
string left operand cannot fall through. Inference does
not establish operation admission. `source-helper-plan.js` owns independent
validation, reconstructing caller provenance, helper operands and ownership after
deserialization before consuming shared result facts. Its explicit admission
policy excludes `in` and `void`, requires scalar callee operands and numeric
arithmetic operands, and preserves the caller's scalar coercion and sound
optional-string defaults. A numeric index into a scalar string is admitted in
a pure callee. It reads one UTF-16 code unit; empty, fractional, negative and
out-of-range indexes yield `undefined` under JavaScript indexing semantics.
The callee carries `string-or-undefined` for that read through const bindings
and admits comparisons against it, including adjacent surrogate-unit checks.
An unchecked index cannot be returned as a definite string or used as a
definite scalar in a property read, template, unary or arithmetic operation.
This internal kind does not widen helper signatures or the preexisting caller
projection policy. No producer tag, serialized hash or signature substitutes
for independent operand, result and ownership checks.

Run `node wasm/scripts/run-wasm-tests.cjs --task pure-helper-vocabulary --task pure-string-index --task pure-field-projection --task pure-guarded-arguments --task pure-helper-contract --task pure-source-helpers --task pure-record-helpers --task pure-loop-helpers --task pure-argument-helpers`
for scalar/record/loop parity, unchanged inputs, allocation evidence and negative
source/plan coverage. Fixtures and staged exclusions live in
`wasm/test/fixtures/pure-helpers/README.md`. Installed qualification remains PF-05.

## Static effectful source helpers (O-25)

Native plan v5 adds `pulse.canonical-native-helper.v1`: a separately owned
source-function body, scalar parameters, a value result and an invocation-owned
return continuation. Static project imports and same-file helpers are admitted
only through the resolved source graph. The initial shape is an immutable async
block function with `ctx` first and explicitly typed string, number or boolean
inputs. An HTTP route or middleware must bind a direct `await helper(ctx, ...)`;
arguments must have matching proven scalar kinds. JavaScript continues to execute
the original source graph.

Helpers cannot capture caller or module values, mutate inputs, recurse, nest
helper calls, accept function values, group effects,
construct responses or own Router transfers. Ordinary unrecognized calls remain
ineligible. Helper bodies use the existing bounded value, pure-loop, read-loop,
schema and trusted Pulse-effect rules. Importing a source function confers no
package-lowerer trust or host authority.

A directly bound helper may run inside an outer bounded read loop under
`pulse.bounded-read-loop-helper.v1`. It must contain at least one admitted read
site, and all its effects must be `s3.getText`, `kv.getVersioned` or
`crypto.digestText`. It may use schema/value operations and bounded pure loops,
but cannot hide context authority, an effect loop, another call or an effect
group. The combined 65,536 iteration-product limit includes pure loops in the
callee and the enclosing caller loop. Inputs remain proven scalars; neither inputs nor the result binding may
mutate the caller's counter. Serialized plans tag these calls with `loopContract`
and independently validate the callee. Ordinary helpers outside loops retain
their existing effect contract. JavaScript inspection recognizes directly bound
ctx-first source calls in these bounded loops, while executing the original
source graph. This does not prove their internals or grant Native eligibility.

The caller owns its loop counter and return continuation. Each visit resets the
callee frame; suspension preserves that invocation's locals. Early helper return
resumes the same caller iteration. The finite dispatcher allowance accounts for
the literal loop cap even when every helper visit returns without suspending.
Effect, deadline and retained-memory budgets remain cumulative and unchanged.

The linker retains one helper declaration. Handler IR produces one generator
body; the Native plan retains one body and one set of effect/continuation sites,
independent of caller count. Helpers own those sites explicitly; the calling
registration owns its result local and response/failure mapping. Plan validation
checks parameter/result kinds, local ownership, effect ownership, continuation
ownership and non-nesting after serialization and a recomputed hash.

One invocation-owned callee frame holds argument handles, local values, the
selected return program counter and error transfer destination. Entry resets
callee locals; suspension retains them. A normal return resumes only the selected
caller. Repeated sequential calls reset the same frame. Normalized application
errors use the selected caller's error lane; terminal host failures fence further
execution. Existing effect tickets, cancellation and cumulative read-loop memory
limits remain authoritative. The host ABI stays v2; the generator is v7.

The O-25 proof covers the retained history body at 1/2/16 callers, byte-matched
named companions for final-Wasm attribution, early results, corruption/failure,
65-pack traversal, middleware, re-entry and suspended request isolation. A
separate reduced-round fixture checks defensive work-limit return parity without
changing production bounds. These are portable Native/injected-host results,
not a full application adoption or deployed-provider qualification.

## Native terminal Router bodies

Generated Router package-call mappings are authoritative: an unmapped generated
call cannot fall back to an authored-source offset. Imported package effects
retain their authored diagnostic positions; a separate generated position
determines Router entry ownership without reinterpreting those source offsets.

Registering one handler at multiple Router entries creates separate generated
effect sites and continuations for those entries. Each site retains its original
source attribution. Package effects and intrinsics require complete coverage of
authored calls and a match for every call in each registration; source-call counts
need not equal generated-site counts. Reuse does not skip effect execution or
share request state across invocations.

Native plan v3 preserves terminal HTTP route handlers as separately owned bodies
(`pulse.canonical-native-handler-body.v1`). A terminal route has no `next()` or
`next(error)` transfer. Its stable Router entry ID owns the body, original source
span, statements, expressions and local namespace. The dispatcher contains one
private tail-call reference. Nested or recursive body calls and access to another
body's locals are rejected. Middleware, transfer-capable routes, error handlers
and inbound event handlers retain their current lowering in this bounded pass.

The private call completes a response, suspends for a recognized effect,
transfers a normalized application error to the existing error lane, or fails.
Native execution resumes at the owning body's program counter and requires no
live call stack. Local slots remain available across suspension. Generation
keeps body states in separate retained chunks, subject to the existing state and
source-character budgets. Call references introduce no charged state; effect
IDs, continuation IDs, allocation behavior and request budgets retain their
existing semantics. Read-loop memory containment and Fastly value/body analyses
inspect both the dispatcher and private bodies.

Plan and generator identities change; the host ABI remains v2. This is an
internal Router representation, with no public callable-function syntax or
change to JavaScript's original-source execution.

### Shared effectful HTTP stages (O-19)

Native planning automatically factors structurally equivalent registrations of
one transfer-capable HTTP route or middleware handler into a
`pulse.canonical-native-stage.v1` body and explicit dispatcher calls. The supported
family has 1..64 sequential, bound text-fetch, `time.now` or `crypto.digestText`
sites, local values, branches, bounded pure loops, early responses and terminal
`next()` / `next(error)` transfers. Multiple eligible stage families
and more than 16 registrations are supported. This introduces no public function
syntax or configuration switch. JavaScript keeps original-source execution.

Admission checks both statements and effect inputs after renaming local,
effect and continuation identities. The comparison includes package/contract,
declared result, decoder and provider descriptors. Captured locals, groups,
effect loops, nested calls, other effect kinds, error/event handlers and registration-specific
body differences retain their existing Native lowering. Ineligibility does not
reject previously supported source or introduce a JavaScript fallback. Effectful
and pure helper calls are explicitly excluded until stage-local helper ownership
is supported. The internal factoring function can report exclusion reasons
without changing the fallback plan or its hash.

Scoped middleware retains its original admission guard and occurrence-specific
continuation. Even one eligible registration can be outlined. MW-01 and MW-02
widen eligibility within the existing stage record representation; they do not
change the host ABI, terminal-next semantics, or the public size flags. Pure-loop
induction variables and nested locals belong to the stage frame. The existing
canonical loop validator still enforces literal and combined iteration caps,
pure bodies and read-only counter/test rules; no effects occur inside these loops.

Each stage declares its request context, Router inputs, read-only next-cursor
input, local namespace, effect sites and outputs: response, next, error,
suspension or terminal failure. Each registration binds its own next cursor,
effect slots and continuation IDs. Effects and continuations explicitly name
both the registration and stage site. Plan validation rejects crossed bindings,
captures, nested calls and calls outside the owning registration's admission
branch, including after serialization and a recomputed plan hash.

One invocation-owned frame selects the return program counter and registration
bindings. Locals reset on entry and survive suspension; no live call stack is
required. A stage can run again later in the same request. Terminal transfer
semantics permit one active stage at a time. Original static effect slots remain
registration-owned, including Fastly's direct pending-slot settlement. Host
invocation tickets, effect limits, deadlines and single-use resume rules retain
their existing authority.

The emitter consumes the validated stage records directly. It emits each body
once in retained, bounded chunks and adds small entry/exit states and lookup
wiring. The build-support transform explicitly retains annotated generated
shared-stage chunks and prepare/clear/ready/result accessors; a matching name in
a user source or an unannotated generated declaration grants no retention. The
dispatcher allowance accounts for registration multiplicity so
sharing cannot shrink the guard for paths with several stage visits. Fastly
request-body and value-failure analyses inspect stage bodies as well as ordinary
handlers. Plan and generator versions change; the host ABI remains v2.

The earlier [O-18 proof](https://github.com/pulse-compute/pulse/blob/latest/wasm/test/runtime/compiler-efficiency/o18-reusable-stage.md)
is now replayed through production lowering. The
[O-19 evidence](https://github.com/pulse-compute/pulse/blob/latest/wasm/test/runtime/compiler-efficiency/o19-production-stage.md)
records its production gates. This removes the proof-only emitter clone and
redundant plan bodies/locals; frontend source expansion and per-registration
metadata still cost space and time. Whole-application savings, arbitrary stage
composition and deployed acceptance remain separate qualifications.

## Bounded pure control flow

Canonical HTTP/event handlers admit a literal-capped pure `for` form shared by
JavaScript admission and Native planning. Counters start at zero, advance by
one, and test a literal cap first; per-loop and nested-product limits are owned
by the Native plan contract. Bodies cannot mutate active counters, read context
authority, call effects or helpers, capture closures, or transfer from the
handler. Unlabelled `break` and `continue` target the nearest pure loop. Native
plan validation rechecks caps, pure bodies and counter ownership before emitting
real loops, with no new continuation or effect-loop semantics.

Native string `.trim()` uses the additive `value_string_trim` value-handle
import. Node checks the string receiver; Fastly implements the same ECMAScript
whitespace set in generated AssemblyScript, without a new platform hostcall or
binding. Fastly plans using these value operations refuse to begin a later effect
after an observed value error.
This does not add rollback, preemption, a memory budget, arbitrary helper
lowering or uniform HTTP exception handling. See
[bounded application values](../concepts/compilation-and-lowering.md#bounded-application-values).

### Bounded sequential read loops (PS1)

The additional `pulse.bounded-read-loop.v1` contract admits non-nested `for`
loops whose `let` counter starts at zero, tests a literal cap from 0 through 64
as the first conjunct, and advances by one. Each loop contains at least one
directly bound or discarded sequential `s3.getText`, `kv.getVersioned`, or
`crypto.digestText` site, or a directly bound static helper satisfying the
read-only helper contract above. Dynamic keys and carried values survive suspension.
Schema text decoding/encoding and result construction are allowed alongside
the existing pure value operations. Other context authority is read before the
loop. Counters, the context parameter and inherited KV namespace aliases cannot
be rebound or shadowed inside it.

Unlabelled `break` exits the nearest loop; `continue` runs that loop's increment
before retesting. `return` exits the handler. Nested loops must satisfy the
existing pure contract, including the 65,536 combined iteration-product limit;
their transfers target the inner loop. Nested effect loops, parallel groups,
writes, arbitrary calls/awaits, closures and labelled transfers are rejected.
The public diagnostic is `PULSE_CANONICAL_READ_LOOP_UNSUPPORTED`.

Handler IR owns a read-loop operation containing the initializer, condition,
body and increment. The Native plan adds a versioned `read-loop` statement with
an explicit counter local, initial value and increment expression. Plan
validation independently checks the cap, counter ownership, admitted effects,
value operations and nesting before generation. Native emits initialization,
test, body/suspend/resume, increment and exit states, including across dispatcher
partitions. Effect and continuation tables contain static call sites, not an
unrolled entry per iteration. Original-source JavaScript retains its authored
loop; its target is selected explicitly and is never a Native fallback.

PS1 is the compiler foundation. PS2 supplies the invocation lifecycle below;
PS3 supplies Native retained-value memory containment below and PS4 owns
packed/provider/application qualification. Values remain retained for the execution.
Production qualification remains open. Applications must handle a continuing
chain at the cap as incomplete rather than conclude that the searched value is
absent.

### Shared lifecycle planning and driver sites (P02/P03/P09A)

The contracts package owns internal `executionLifecycle`, optional `httpLifecycle`
and `lifecyclePlanner` objects through its existing `provider/toolchain` subpath.
The six execution points extend the existing `pulse.effect-invocation.v1` policy:
authenticate before consuming a ticket, consume before delivery, and never reopen
a ticket after rejected or trapped delivery. Closure invalidates outstanding
delivery authority before cleanup requiring closed invocation state. Driver
storage and ABI representations remain provider/runtime-owned.

`pulse.lifecycle-bindings.v1` declares symbolic sites, exact semantic parameter
roles and provider-owned rejection/claim action IDs. The planner rejects malformed
versions, missing roles/sites, duplicate owner/order pairs and error-claim sites
without a preceding active response-authority fence. Its immutable
`pulse.lifecycle-plan.v1` output contains ordered dispatch data, never source,
ABI types, callbacks or a scheduler. Around after-notifications reverse order on
normal return, including rejected delivery; traps do not promise finalization.
Unselected contributions produce no dispatch sites. HTTP selection requires its
explicit contract version, not a provider/device name; uncertain host outcomes
never reopen authority or imply disposal, delivery or quiescence.

These are internal adoption contracts, not application hooks, package registration
or a new support tier. The shared AssemblyScript emitter in `runtime-core-as`
realizes the plan at explicit Fastly driver and canonical setter sites. Ticket
authentication precedes service guards and consumption; normal-return closure
notifications distinguish pre-invalidation from closed state. Forwarding uses
structural acquired/result/error/end points. Selected HTTP authority fences
ordinary, error and timeout responders outside legacy handlers and fences raw
send before the host call; nonzero or trapped outcomes never reopen authority.
Empty selection emits no lifecycle machinery. Provider-internal service bodies
are trusted generator inputs, not application or package hooks. Package-owned
driver emitters with selected services reject until explicitly bound.

Node Native binds the six execution points through a synchronous host adapter.
It retains the existing ticket ledger, guards the host-visible result setter,
runs reverse after notifications on normal accepted or rejected delivery, and
invalidates tickets even if a pre-close observer throws. Host cleanup preserves
primary errors. A managed host `finally` can close after a guest trap; this does
not promise guest finalizers. Selected services wrap the host export view without
changing guest bytes/imports; absent services retain the native export view.
The controller does not own socket sends and rejects HTTP lifecycle contributions.
Both driver styles run maintained common settlement/closure/trap cases; broader
application, host and packed-consumer promotion gates remain open. No host
handoff, accounting or support-tier change is exposed. The semantic owners are
[`execution-lifecycle.js`](../../wasm/packages/contracts/src/handler/execution-lifecycle.js),
[`http-lifecycle.js`](../../wasm/packages/contracts/src/host/http-lifecycle.js) and
[`lifecycle-planner.js`](../../wasm/packages/contracts/src/handler/lifecycle-planner.js).

### Read-loop invocation lifecycle (PS2)

`pulse.effect-invocation.v1` distinguishes reusable static effect/continuation
sites from each execution-owned invocation. The internal normalized-generator
host now records a distinct continuation for each visit, including concurrent
executions with the same caller-supplied execution label. Node Native effect and
continuation traces include invocation IDs while retaining static site IDs.
Original-source JavaScript continues to use its per-call effect identities.

The managed Native controller (`pulse.canonical-native-host.v6`) accepts a pending effect's opaque ticket in
`setEffectResult(ticket, result)`. Object identity authenticates the ticket;
copied fields, foreign executions, old loop visits and duplicate settlement fail
with `PULSE_EFFECT_INVOCATION_INVALID` before allocating a result handle or
entering the guest. The ticket is consumed before injection. Completion, failure,
explicit close and cancellation invalidate pending tickets. An incomplete resume
still preserves the current pending result set for a valid retry.

Terminal trusted Native package applications can use the optional
`pulse_host.value_json(handle)` data-copy import. The canonical Node host checks
a 1 MiB UTF-8 JSON limit before allocating a guest managed string. This adds no
effect authority and leaves opaque/streaming bodies outside this bridge. For a
plan declaring `effectFailure: 'package-completion'`, the host requires
`pulse_package_set_effect_failure(index)` and settles failures through the same
single-use ticket boundary. The guest receives failure status only and owns the
protocol response; cancellation and execution budgets still terminate at the host.
Node and Fastly declare this realization for Entities. The Fastly provider
binds the package application to its canonical platform runtime in ordinary
builds, preserving provider-owned authority, bounded value transfer and terminal
request budgets. Its test/dev fixture ABI and exact-artifact Viceroy replay are
separate evidence levels; neither implies live deployment acceptance.

Fastly's canonical Native platform driver uses request-instance-owned sequence
tickets, checks the captured ticket before injecting each result, and closes its
lifecycle on terminal return. A second entry into the same driver instance is
rejected. Native guest ABI v2 is unchanged: direct calls to
`pulse_set_effect_result(index, handle)` and other raw control exports remain
trusted-host operations. These exports do not authenticate an invocation epoch;
custom hosts must enforce freshness themselves. The managed ticket boundary is
not a guest-enforced sandbox against a malicious host.

Managed Node Native, internal-generator and original-source JavaScript hosts
default to 1,024 cumulative effect invocations and retain their host-only
`maxEffects` option. The canonical Fastly Native platform driver has a fixed
1,024 ceiling, advertised in its artifact's `effectInvocations` policy; it adds
no project configuration field. Each guest-requested group member counts,
including one suppressed by an earlier application error. Reaching the ceiling
is allowed; attempting the next invocation fails before provider dispatch
(Fastly state error 1007, stage 170). Invalid Fastly lifecycle use is stage 171.
Counts span loop visits, sequential loops, groups and error handling rather than
counting static table entries. An inherited monotonic request deadline is never
restarted on a loop visit; dispatch, settlement and resume remain fenced by it.
Late asynchronous success or failure cannot continue a cancelled execution.

### Native read-loop memory containment (PS3)

Plans containing a bounded read loop activate `pulse.native-read-loop-memory.v1`
for the entire Native execution, including work before and after the loop. The
artifact records this in `policy.readLoopMemory`. These fixed limits add no
authoring or provider configuration surface:

| Limit | Ceiling |
|---|---:|
| Cumulative accounted retention | 64 MiB |
| Cumulative value/edge units | 1,048,576 |
| Complete unlinked Wasm linear memory | 4,096 pages (256 MiB) |

Accounting charges a 32-byte base per retained value, UTF-16 text bytes, and
container growth (at least eight bytes per edge). Node Native also accounts for
trace entries, visits each object graph once, and charges guest mutations before
changing the container. Request-local indexes reuse up to 8,192 immutable
scalar handles and 8,192 object/array handles by identity. Each index entry costs
one unit and 16 bytes when its capacity grows. The scalar index replaces its
oldest mapping once full, reusing that charged capacity; every newly allocated
value handle remains charged and retained. Positive and negative zero remain
distinct. Different objects are never coalesced, and guest mutations remain
charged before changing an object. Cached reads still check latched terminal
failure. No handles are reclaimed and no charge is refunded. Fastly accounts for retained handles, text assignments,
container/header appends and a rope's eventual flat size. Cached values and
object representations differ between hosts, so the counters are conservative
runtime accounting rather than a portable measure of live heap bytes. They do
not bound Node process RSS, trusted provider implementation internals, or ordinary
original-source JavaScript. Existing structured input limits remain in force.

The budget never resets or refunds on iteration, suspension, sequential loops,
or Router error handling. Node rejects excess retention with
`PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED` and invalidates pending tickets before
inserting the rejected handle. Fastly records terminal memory error 1010 (stage
172 for bytes or 173 for value units), invalidates pending work, and traps. These
failures cannot enter an application error handler or dispatch a subsequent
read. The allocator can also trap at the Wasm memory ceiling, which covers
temporary codec, parser, crypto and container allocations beyond the accounting
model. Linked guests retain their separately owned, smaller fixed-memory ABI.

This is request-lifetime retention, without iteration-temporary reclamation or
a collector/guest ABI change. Carried aliases, pending effect payloads, decoded
schema values and response roots therefore remain valid. The executable
`bounded-read-loops` task exercises the Catalog receipt-page shape at 64 pages
of 57,344 bytes, with two awaits per page, nested pure loops and a carried schema
alias. It also checks exact budget boundaries, terminal limit failures and the
encoded linear-memory ceiling of complete target artifacts. PS4 still owns
packed-consumer, provider-engine and adopted application qualification.

## Execution ownership

Pulse-provided host authority is explicit. Fetch, config, secrets, KV, GRIP,
assets, and future host operations enter the program as canonical capabilities
or package operations. Pulse does not expose provider SDK objects, ambient
process state, or hidden host namespaces through the handler context.

Native execution erases managed async notation into explicit effects and
single-use continuations. JavaScript targets execute the same application
contract through an execution-owned effect adapter. An HTTP request and each
direct JavaScript or provider-neutral Native event invocation create one
isolated execution.
Cancellation, grouped settlement, deterministic failure selection,
continuation expiry, duplicate resume or completion rejection, secret
redaction, and completion are contained by that owner. Event contexts reuse the
shared state, logging, fetch, parallel, config, secret, KV, and outbound event
authority but do
not expose a Request, Response, route parameters, Router transfer, middleware,
or response builders.

Conditional KV is owned by the portable runtime authoring/host contract.
`kv.getVersioned`, `kv.insertIfAbsent`, and `kv.compareAndSwap` lower through the
ordinary effect and continuation machinery, including Native value handles.
The Node reference supplies one explicit local key authority; provider
preparation and the send boundary remain distinct so unconfirmed writes preserve
`unknown`. The Native host imports the existing workspace runtime owner rather
than duplicating its validation, snapshots, limits, or outcome normalization.
The Fastly Native provider realizes conditional KV directly through its host ABI,
with lossless generations, conditional options, bounded metadata/body reads and
readiness deadlines. Its AssemblyScript limits come from the runtime owner; the
shared corpus checks its wire and outcome semantics. Fastly JavaScript remains
incomplete capability mapping. Deployed acceptance remains a separate gate. See [conditional KV](../concepts/effects-and-continuations.md#conditional-kv).

The same bounded KV lifecycle owns `kv.list({ limit, prefix?, cursor? })` and
`kv.delete(key)`. Listing exposes exactly one provider page, at most 100 keys,
with an opaque continuation cursor or `null` at the end. It never traverses the
store implicitly. Delete distinguishes deletion, absence, explicit rejection and
uncertain acceptance without a preflight read. Both operations support Node
JavaScript/Native and Fastly Native; Fastly JavaScript reports them unsupported.
See [KV listing and deletion](../concepts/effects-and-continuations.md#kv-listing-and-deletion)
for bounds, live-page semantics and local versus hosted evidence.

`ctx.parallel({ ... })` is the explicit cross-target concurrency form. Router
`next()` and `next(error)` are terminal cursor transfers, not onion-style calls:
no application code resumes after the transfer. Normal exhaustion produces
404, error exhaustion produces 500, and effects keep the identity of the route
or middleware entry that owns them.

Schema registry IR v5 records object-property requiredness, bounded scalar
records, nested JSON markers, typed open objects and normalized per-schema JSON limits. A
question-mark property preserves absence through encode/decode, including nested
objects and array elements; a present value must satisfy its type. Nullability
is independent, present undefined is invalid, and optional fields receive no
default. Codecs project own data properties in declaration order. Native schemas
containing optional fields, scalar records, nested JSON or explicit JSON limits use schema-generated projections
over `json-as` values; other required-only schemas retain generated struct codecs.
Provider and host preflight preserve the same rules. This extends schema
semantics without widening effect authority or selecting a target fallback.

The public type-only `ScalarRecord` marker admits dynamic own string keys only
inside a declared object schema, with string, finite number, boolean or null
values. Each record permits 32 keys, 64 UTF-16 units per key, 1,024 per string
value and an 8 KiB conservative JSON byte budget. Budget accounting reserves 24
bytes per number and six per control code unit, includes JSON structure and
escaping, and uses UTF-8 size for other characters. This can reject an actual
encoding under 8 KiB but gives target-independent admission. The full boundary's
`maxBytes` remains independent. Limits are fixed, not user-defined generics.
Decoded records are immutable. Nested containers, unsupported values, accessors,
symbols and custom prototypes are rejected. Duplicate keys in schema-selected
records are rejected after unescaping; ordinary declared objects retain last wins.
JavaScript codecs, direct Native guest codecs and both Fastly Native preflight
paths enforce these rules. See [bounded scalar records](../guides/json-schemas.md#bounded-scalar-records).

The type-only `JsonValue` and `JsonObject` markers select bounded recursive JSON
inside an otherwise declared object schema. `JsonObject` requires an object at
its field root; `JsonValue` also admits arrays, scalars and null. Known enclosing
fields keep their validators and unknown-field projection. Arbitrary recursive
TypeScript types remain unsupported. Static
`schema<T>({ json: { ... } })` options select per-schema limits. Registry IR and
codec inputs use v5; authoring uses v3 and canonical codecs use v4. Effective
limits and the profile text bound contribute to codec identity.

The type-only `OpenObject<T>` marker wraps a finite declared object at the root,
a nested field or an array element. Its object IR carries
`additionalProperties: { kind: 'json-value' }`; this policy contributes to
registry and codec hashes and selects bounded admission and Native value
projection even without another dynamic marker. Known fields retain their
validators, presence and nullability; invalid known data never becomes an extra.
Other own string keys carry bounded JSON and survive projection as detached,
immutable values. All names at each open level are unique after unescaping;
closed nested objects retain their existing projection and duplicate policies.
Empty, numeric-looking, `__proto__` and `constructor` extension names are data.
JavaScript, direct Native guest codecs and both Fastly Native preflight paths
share these semantics. See [typed open objects](../guides/json-schemas.md#typed-open-objects).

The `pulse.json-admission.v1` machinery enforces the policy before parsing or
serialization. Schemas without markers or options retain prior admission;
ScalarRecord's fixed per-record limits remain unchanged. Normalized limits are
positive i32 values. They bound original UTF-8 text,
container depth, total value nodes, members per object, items per array, decoded
UTF-16 key/string lengths and a conservative JSON byte budget. Root containers
have depth one; scalar roots have depth zero. Every syntactic value counts,
including overwritten and unknown members. Keys do not count as value nodes.
Whitespace counts toward original text bytes, not the conservative budget;
numbers reserve 24 bytes and strings follow the existing scalar-record escaping
budget. Additions check remaining capacity before incrementing i32 counters.

One iterative reference scanner supplies JavaScript and generated AssemblyScript
semantics. It checks complete JSON syntax without building a JSON value tree,
and can allow, reject or report duplicate names after unescaping. Reports retain
the containing object's text offset and both key offsets for subsequent
schema-owned policy; admission itself does not project fields. Native composition
helpers precede parsing, and Fastly's helpers precede provider handle creation
or serialization. Defaults are 65,536 text bytes, depth 32, 4,096 nodes, 256
members per object, 1,024 items per array, 256 key units, 16,384 string units and
65,536 conservative JSON bytes. The existing profile `schemas.maxBytes` also
bounds full input/output. Native supports configured depth through 128; larger
settings fail compilation. Fastly parser/serializer capacity follows admitted
schema depth instead of retaining a hidden 64-level ceiling.

All six JSON boundaries select these codecs. Dynamic duplicate keys are rejected
after unescaping; ordinary closed object fields retain last-member-wins, including
selection of their final dynamic subtree. Both Fastly realizations apply the
selected schema to outbound `json` before creating/sending the request. The
shared corpus executes these paths with the real guest and provider parsers.

In-memory JavaScript and Fastly handle admission use explicit traversal stacks,
reject cycles and non-JSON values, and count shared references per occurrence.
JavaScript accepts enumerable own data properties of plain/null-prototype objects
and dense ordinary arrays; getters and serialization hooks are not invoked.
Projection copies and deeply freezes output without mutating or freezing input.
JavaScript own-key reflection
enumerates the already-created input before its key count can be checked, so the
value helper is not a bound on VM reflection allocation or arbitrary Proxy traps.
Text admission is the resource gate before eager parsing. Node retains its
schema encode/decode, malformed-JSON and body-size error categories; Fastly
retains schema/JSON errors and stages. See
[configurable nested JSON](../guides/json-schemas.md#configurable-nested-json).

`ctx.encodeJson(value, 'schema.id')` is a synchronous shared-context operation
that returns application-owned text through the existing compiled schema codec.
The compiler requires a literal registered ID in both strict and non-strict
mode. Encoding validates/projects declared fields and bounds returned UTF-8
bytes by the registry's `maxBytes`; failures precede subsequent effect dispatch.
The Native `schema.encode.text` intrinsic uses the additive `schema_encode`
value-handle import in the provider-neutral ABI; Fastly realizes it in generated
AssemblyScript without a new platform hostcall or provider binding. It grants
no general JavaScript serialization or ambient authority. Codec determinism is
scoped to the selected schema and target; cross-target numeric spellings are
not a portable canonical-hash contract.

`ctx.decodeJson<T>(text, 'schema.id')` is the complementary synchronous
application-text boundary. It requires a literal registered ID and string
input, bounds the original UTF-8 text before parsing, and returns a detached,
deeply immutable schema value. It has no content-type policy or effect and
does not cache repeated calls. Ordinary declared objects preserve existing
duplicate-member semantics (last wins); scalar records reject duplicates; this is not a canonical command-fingerprint parser.
The Native `schema.decode.text` intrinsic uses the additive `schema_decode`
value-handle import. Node uses the existing preflight and guest json-as codec;
Fastly uses its provider-owned parser and generated schema codec and freezes
the returned value tree. Decode failures block subsequent effect dispatch.
The application retains the original string for byte identity; shape validation
does not establish storage acceptance or an atomic S3/KV transaction.

The pinned json-as 1.5.0 backend uses its scalar (`NAIVE`) mode with strict
validation and generated-struct fast paths disabled. Its SWAR string path can
corrupt surrogate pairs. Before its slow struct parser receives normalized JSON,
generated codecs spell doubled backslashes as equivalent `\u005c` escapes;
that parser otherwise mistakes a closing quote after a trailing backslash for
an escaped quote. These are compiler-owned compatibility measures for the pinned
backend, exercised with single-field strings, escaping, Unicode and storage
consumers. They neither weaken schema validation nor execute application
JavaScript. Native build metadata records the selected mode.

Structured JSON and text bodies become bounded values. Binary and streaming
bodies remain opaque host-owned handles. An opaque body can be passed through or
returned by a supported operation, but it cannot be decoded, duplicated, or
independently consumed by application or package code.

STR-02A adds an opt-in Node JavaScript incoming-body capability
(`request.body.forward`). A synchronous `ctx.req.body()` marker can occur once,
inline as a literal POST fetch body. It reserves the request's single consumer
before provider dispatch and excludes structured reads. The in-process fetch
descriptor uses `bodyMode: 'incoming-request-v1'`; the marker is held in a runtime
WeakMap and carries no serializable provider identity or bytes. This does not
admit Fastly forwarding. STR-02B admits Node Native with the optional
`pulse_host.request_body() -> i32` import: the result is an execution-local
value handle to the opaque marker, not a byte pointer or invocation ticket.
Existing ABI fields retain their meaning; older hosts reject the unknown
import. Native fetch admission claims ownership while the guest constructs its
suspension group, before any provider dispatch. Native test/dev execute the
emitted Wasm for this capability. Native forwarding applications reject
structured request-read surfaces because those host calls remain synchronous.

FWD9-02 admits an experimental Fastly Native metered forwarding path with
`fastly.bodyForwarding: { requestMaxBytes, responseMaxBytes }` and
`fastly.maxDurationMs`. Both byte limits are explicit integers from 1 to
1,048,576; the total deadline is 1–30,000 ms. The application may contain one
terminal opaque POST fetch with inline `ctx.req.body()`, a static backend and
optional literal request headers. Effect groups, additional effects, body
inspection, transforms, duplicate consumers and dynamic backends are rejected.
Existing Native structured-read exclusion applies. Fastly JavaScript remains
ineligible, including its separate total-request-deadline restriction.

The provider reserves the marker before dispatch, creates a streaming upload,
and meters actual bytes through one reusable 16 KiB raw scratch buffer across
sequential upload and response phases. No payload chunk becomes an application
value. Reads follow writable demand; a partial write finishes before another
read. Pending origin headers participate in upload waits and are polled first;
early response closes incoming reads and abandons unfinished upload. Each cap
requires EOF, with a one-byte sentinel read that is never forwarded on overflow.
Declared oversize is rejected before transfer; declared length is not proof of
actual length. Outbound request headers are explicit and bounded. Response
header enumeration uses a 16 KiB raw arena with at most 64 pairs; hop-by-hop,
framing and Connection-nominated fields are removed. Encoded payload bytes are
preserved without automatic decompression or redirect following.

The cooperative request deadline and any earlier fetch `timeoutMs` continue
through response pumping and the final pre-close check. Successful streaming
close relinquishes the writable handle and hands queued completion to Fastly;
**it is not a drain receipt, client delivery guarantee, or retained cancellation
authority**. This explicitly accepts the FWD9-01 host-handoff alternative.
No pending-request cancellation ABI exists: cleanup polls once, discards late
handles and leaves unresolved host work to invocation teardown, without retries
or rollback claims. Before downstream commitment, upload overflow attempts 413,
deadline expiry 504, and origin/protocol/response-limit failure 502. After
commitment, failure abandons the stream and never sends a second response.
FWD9-03 qualifies normal builds and exact installed candidate packages with an
adversarial injected-ABI matrix and pinned Viceroy 0.21.1 HTTP replay. The
`fwd9-03-installed` task checks doctor/inspect/test/build/report, artifact identity,
independent byte caps, operation/total deadlines and repeated invocations. The
local wire cases include incremental input/output, early rejection, unknown
lengths, overflow, bodyless responses and post-header aborts. Injected faults
separately cover partial/failed writes, malformed ABI outputs and late results.
Payload storage uses one 16 KiB scratch buffer; guest linear memory stays flat
across tested payload sizes. Host queues and live Fastly resource accounting are
not bounded by that observation. Deployed Fastly qualification remains separate;
local and installed passes do not establish client receipt or live acceptance.

`node.bodyForwarding.maxBytes` and `node.maxDurationMs` are both required for
this path. Node adapts incoming HTTP lazily and keeps one provider read and one
source chunk per pump, with a 64 KiB source/backing-allocation ceiling and
16 KiB emitted chunks. Upload and response byte limits are independent. Provider
fetch authority remains injected; transport uses manual redirects and never
replays input. Upload ownership closes on early response; response ownership
transfers separately to the completion-aware HTTP writer. The request budget
and disconnect cancellation remain active through that writer. The optional
provider-driver `prepareNativeRequest` hook owns lazy local HTTP admission and
returns request metadata, execution options, a response signal and a close
operation; the generic CLI awaits the response pipeline before closing it. These bounds do
not claim total process memory or platform socket-buffer bounds. See
[incoming forwarding](../concepts/bodies.md#incoming-forwarding-on-node)
for the public configuration and restrictions.

### Experimental finite generated output

STR-03A adds `response.output` on explicitly configured Node Native and Node
JavaScript targets. `node.generatedOutput: true` requires `node.maxDurationMs`.
`await ctx.output.start(options)` commits validated status/headers;
`await ctx.output.write(text)` suspends the producer until the Node write callback
and, when required, drain complete. `return ctx.output.close()` creates a
request-local terminal marker. Successful handler completion must return that
exact marker; the provider then waits for local writer finish under the same
deadline. Finish does not prove client receipt. A missing/foreign close result,
producer error, limit violation, deadline or disconnect fails the response;
after commitment the transport is destroyed, with no error-handler replacement.

Each write is at most 16 KiB UTF-8; at most 64 writes and 1 MiB total are admitted.
One write can be outstanding. Framing/hop-by-hop headers, HEAD/bodyless statuses,
parallel output effects, event use and background production are excluded.
No provider stream object enters application code and opaque input cannot be
inspected through this API. Sequential output writes may use the existing
literal-capped loop form (at most 64 iterations); this does not admit arbitrary
generators, callbacks or unbounded loops on Native.

Native executes the emitted Wasm and uses ordinary single-use effect tickets for
`output.start` and `output.write`. The additive optional ABI-v2 import
`pulse_host.output_close() -> i32` returns an execution-local completion marker;
older hosts reject artifacts requiring the unknown import. All output plans,
including those without read loops, activate the existing cumulative 64 MiB
retained-value accounting and a 4,096-page linear-memory ceiling. Budget charges
are not refunded after writes, and are not RSS measurements. Linked-guest
composition needs separate memory qualification and is rejected for output
artifacts. JavaScript retains its existing unsandboxed source semantics; the
output caps do not bound arbitrary application allocations or preempt CPU work.

The optional provider-driver `createGeneratedOutput` hook gives the generic CLI
a request-owned writer. HTTP never buffers the entire generated output. The
explicit CLI test collector may materialize up to the same 1 MiB limit. Current
evidence covers workspace build/dev, actual Native lowering, real HTTP prefix
delivery, blocked-writer suspension, cancellation, deadline and bounds.

STR-03B's external `str03b-installed` task packs exact candidate packages and
installs them outside the checkout with lifecycle scripts disabled. It verifies
installed file bytes before and after ordinary CLI doctor/inspect/test/build/dev
workflows on both Node targets. Real HTTP covers prefix-before-completion,
1 MiB UTF-8 fidelity with a paused client, disconnect/deadline cleanup, producer
and post-header failures, limits, HEAD/bodyless/framing rejection and recovery.
Installed controlled writers separately prove suspension, late-callback fencing
and deadline coverage through final flush; the paused-client case alone is not
a deterministic backpressure proof. Native test/dev observations bind execution
to the emitted Wasm hash with no fallback and report guest-memory bytes. The
controlled full-output case also records cumulative retained-value accounting.
Neither counter is process RSS or an arbitrary-JavaScript allocation bound.

Qualification belongs to each terminal acceptance report's source, package,
fixture and Wasm identities. The artifact's `independentInstalledQualification`
field stays false: compilation cannot certify a later external test. The surface
remains experimental and the task is separate from the aggregate release seal.
Fastly output and MCP SSE remain unavailable. Node input transforms have the
separate experimental bounded request-transform contract below; installed output
qualification does not qualify that surface.

`ctx.time.now()` is an execution-owned `time.now` effect requiring the selected
provider's `time.wall-clock` authority. It returns one validated UTC wall-clock
sample or a bounded unavailable/invalid-clock result. The clock is sampled at
dispatch, remains distinct from monotonic deadlines, and may regress. It grants
no timers, scheduling, distributed ordering or exact commit-time guarantee.
Native retains effect/continuation lowering; Fastly owns the realtime hostcall.
The result and range contract is in [Wall time](../packages/runtime.md#wall-time).

Router `app.error` recovery has a finite portable data-error catalog documented
in [Static Router authoring](../guides/routing.md). Native code transfers only
at compiler-owned handler boundaries through the optional `router_error_take`
host import: zero means no failure, a positive handle carries a sanitized error,
and a negative result terminates execution. Failed handlers never resume;
already-started group members settle before recovery. A failed continuation
remains failed even when a later error handler returns a response. Cancellation,
VM traps and provider protocol faults do not gain application recovery. No
transfer retries effects, rolls back writes or converts uncertain KV outcomes
into proven non-writes.

Fastly Native additionally admits ordinary fetch send/wait transport failures as
`PULSE_FETCH_NETWORK`. The same settlement and forward-only recovery rules apply,
including failures in an error handler. Without a registered error handler the
provider sends an explicit `502 Bad Gateway`. An exhausted Router error lane
retains its `500 Internal Server Error`. HTTP response status codes do not become
transport failures; invalid ABI arguments and handles remain terminal. This
provider-specific contract does not widen the portable data-error catalog or
supply retry or rollback guarantees.

Fastly Native `timeoutMs` additionally bounds a fetch's response-header wait and
enters that error lane as `PULSE_FETCH_TIMEOUT` (unhandled: HTTP 504). It accepts
positive numeric safe integers, defaults to disabled when omitted, starts at
admission before preparation, and expires at `elapsed >= timeoutMs`. Invalid
values fail before dispatch with HTTP 400. The provider observes parallel fetch
headers independently, preserving timely later-slot responses while an earlier
slot is pending. Group recovery still waits for other admitted members. Header
arrival ends the fetch deadline; it does not implicitly read or await a body.
The earlier whole-request budget remains terminal and wins over recovery.

The Fastly pending-request ABI has no cancellation hostcall. Expired effects
settle once; their handles are retained in a bounded invocation-owned retirement
list and polled nonblocking at cleanup. Completed response/body handles are
closed; unready handles remain host-owned and origin work may continue after
the invocation. No guest background task, implicit retry, cancellation proof or
rollback guarantee is introduced. See the [operation deadline contract](../concepts/effects-and-continuations.md#timeouts-have-two-scopes).

See [Effects and continuations](../concepts/effects-and-continuations.md),
[routing](../guides/routing.md), and
[structured and opaque bodies](../concepts/bodies.md).

## Selected bounded HTTP deadline contract

P-01 selects the following implementation contract on 15 September 2026.
P-02 implements this contract in the source tree. **Exact-package acceptance
remains pending P-03.** This is not a published-release or deployed-service claim.
Catalog O2 remains closed until its separate C-06 consumer acceptance.

The selected profile option is `node.maxDurationMs` for Node Native and Node
JavaScript, and `fastly.maxDurationMs` for Fastly Native. Its value must be an
integer from 1 through 30000; omission preserves the existing behavior without
a total deadline. Catalog O2 selects **10000 ms**. Fastly JavaScript must reject
the option explicitly; it is outside this proof. Event invocations retain their
existing lifecycle. Configuration references are regenerated from their canonical provider owners.

### Budget and authority

One provider-owned monotonic budget starts at HTTP admission, before request
body consumption, binding resolution, authentication or application execution.
Admission means entry to the Node HTTP request callback or the Fastly Native
request entry point. Network connection setup, header reception and platform
queuing before that entry are outside this budget. Direct host invocation starts
at the host execution entry; it does not prove HTTP admission coverage.

Every managed operation and continuation inherits that same budget. An
operation uses the earlier of its own deadline and the request deadline; nested
execution, retries and effect groups cannot replenish it. Authentication,
config/secrets, fetched structured bodies, conditional KV, S3 preparation and
readback all consume it. Existing byte, count and operation limits still apply.
Inbound headers, JWT expiry, `ctx.time.now()` and receipt timestamps do not grant
or extend time. A failed or regressing monotonic clock fails closed.

At `now >= deadline`, stop admitting managed effects and continuations, including
checkpoint dispatch. Check before dispatch, after a result becomes available,
before resumption and before response handoff. Request cancellation must reach
provider-supported pending operations and body readers. Dispose of locally owned
results/bodies that arrive too late, observe asynchronous rejection, and remove
listeners/timers at terminal completion. Cleanup never resumes application work
or issues a compensating write. Normal completion must not cancel a response
body whose ownership has already transferred.

This is cooperative managed execution. An event loop stall, synchronous guest or
JavaScript work, or a noninterruptible hostcall can run past the nominal instant
of expiry. The next managed boundary must fence its result. No hard CPU
preemption or hard end-to-end latency guarantee follows from the timer.

### Target scope and response handoff

O2 uses bounded, fully materialized request and response bodies. Successful
handler return alone is not HTTP completion. The HTTP owner keeps the same
budget through response construction and the applicable handoff below.

| Boundary | Node Native | Node JavaScript | Fastly Native |
| --- | --- | --- | --- |
| Admission | HTTP callback, before reading the body | HTTP callback, before request adaptation or dynamic bindings | Request entry, before downstream body reads |
| Managed waiting | Shared request cancellation and remaining operation budget | Shared request cancellation and remaining operation budget | Monotonic checks and readiness waits capped by the remaining budget |
| Continuation/result fence | Recheck after settlement and before resume/dispatch | Recheck managed settlement and reject late dispatch/resumption | Recheck effect readiness, resume and next dispatch |
| Buffered response ownership | Through materialization and final check before `ServerResponse.end(buffer)`; successful return transfers the complete buffer to Node | Through body adaptation and the response writer: pipeline completion for a streamed Web Response wrapper, or successful `end()` for an empty response; retain cancellation while the writer is active | Through response construction and all body writes; final check immediately before nonstreaming `fastly_http_resp.send_downstream` |
| Handoff completion | `end(buffer)` returns successfully; socket drain/client receipt excluded | Response writer settles successfully; later network/client receipt excluded | `send_downstream` returns success; downstream delivery excluded |

Node JavaScript's writer may retain ownership longer than Node Native's buffer
enqueue. That additional local wait is not a portable network-delivery promise.
On Fastly, the final send hostcall is not preemptible: a successful handoff cannot
be withdrawn if the call itself spans expiry. An unsuccessful send is a transport
failure, not evidence of application write rollback. An embedder that bypasses
these HTTP owners must supply the admission budget and response lifecycle itself;
returning a Web Response or result snapshot from a direct execution API is not
equivalent evidence.

If expiry is observed before response headers are committed, the HTTP owner
attempts a bounded 504 response. If headers are already committed, terminate the
unfinished local response; do not send a second response or relabel it as 504.
Timeout error emission and cleanup are terminal paths with no application
effect authority. Direct Node execution rejects with
`PULSE_REQUEST_DEADLINE_EXCEEDED`; clock failure is distinguished by
`PULSE_REQUEST_CLOCK_INVALID`. HTTP delivery of either failure is best effort.

Opaque pass-through, streaming endpoints, post-handoff stream completion and
arbitrary CPU preemption are excluded from O2 acceptance. Existing streaming
behavior is not expanded by this contract. A requirement for those guarantees
reopens scope under P-10/P-11 before O2 can be accepted.

### Writes and Catalog O2 acceptance

Expiry proves neither rollback nor nonacceptance of a dispatched write. A
conditional write stopped before dispatch is not stored by that attempt; after
dispatch, an unconfirmed result remains unknown. The remote operation can finish
after local cancellation. Only positive authoritative evidence can resolve it.
A checkpoint already dispatched before expiry may therefore commit afterward;
the requirement is **no new checkpoint dispatch or late local continuation after
expiry**, not a promise that remote storage stops at ten seconds.

For O2, head compaction must be confirmed before a checkpoint is admitted, and
the shared deadline must still be live at that checkpoint boundary. A later
authenticated invocation can reconcile/replay the same sequence and exact body.
No fresh command identity, automatic rollback or acceptance claim is authorized
by a 504. Lost responses, overlap and retry remain application contract concerns.

The aligned O2 requirement is: **a 10000 ms provider-owned monotonic budget from
HTTP admission through the selected buffered-response handoff, with managed
effect/continuation fencing and honest uncertain write outcomes**. It does not
require arbitrary CPU preemption or delivery to the client within ten seconds.
This wording supersedes the earlier O2 proposal's unqualified “body streaming
and response completion” scope; inbound reads of the bounded O2 body remain
included. The service stays closed until the following evidence exists:

- P-02: terminal focused runtime/provider and repository checks cover delayed
  inbound bodies, cumulative KV/S3 delays, boundary expiry, late completion and
  body disposal, normal response close and response handoff on all three targets.
  Reproduce two individually valid 6000 ms waits against the one 10000 ms budget:
  the second wait cannot authorize another managed effect or checkpoint. Include
  preparation/commit uncertainty and independent overlapping requests. Use a
  monotonic fixture clock; wall-clock regression must not extend execution.
- P-03: fresh exact packages from the final validated source, complete closure
  hashes and clean-consumer deadline smoke evidence, including stale artifact
  rejection. Source-only success is insufficient.
- C-06: Catalog replays its existing safety corpus and deadline counterexamples
  against that exact closure, configures the actual HTTP owners, and proves no
  late local work/checkpoint dispatch. Scheduler provisioning, deployment and
  cross-location evidence remain separate gates.

P-01 freezes scope only. The older interrupted suite, earlier passing runtime
checks and pre-final package attempts cannot satisfy G-DL or G-O2.

## Report route behavior

Optional route `behavior` records `terminal` or `continuing` from validated
handler IR (`basis: canonical-handler-ir`), outside executable metadata/hashes.
Continuing includes conditional and error transfers; historical missing facts
stay unknown. Counts distinguish registrations from method/path pairs. Primary
body associations diagnose mixed dispatcher ownership versus missing mappings,
using the handler entry itself, never preceding composition entries. Diagnostics
preserve measurements and historical identity; one observed consumer is not
exclusive ownership. See [CLI guidance](../packages/cli.md).

The containing-body view projects primary-artifact dispatcher chunks associated
with the registration's own entry, independently of preceding composition entries.
Whole containing-body bytes remain separate from isolated handler measurements.
Route rows and filtered summaries deduplicate physical body IDs; summaries union
recorded chunks across shown registrations, never sum route sizes. Missing mappings
remain unknown. Known co-owners join consumers at each physical chunk/body boundary;
registration links use those entries directly, not their wider composition. Existing
helper/stage links use the entry's recorded chunk associations. These partial static
associations do not establish exclusive ownership or complete execution chains.
The projection preserves capsule identity, measurements, and artifact ledgers.

Viewer entry labels project recorded names, kinds and method/path metadata with
short entry-ID prefixes that expand on collision. Links resolve full IDs through
capsule-local indices; shortened labels are never canonical identities or
cross-capsule comparison keys. Entry details retain full entry, canonical and
handler identities, source locations when recorded, and static flow references.
Own registrations and wider composition references remain distinct. Search and
navigation do not alter the embedded or exported evidence capsule.

Compact route rows and responsive detail layouts preserve adjacent measurement
availability, coverage and non-additive qualifications. Evidence disclosures
group records by kind and exact producer identity without merging claims or
turning mixed record results into an overall pass. Full identities and scopes
remain available on expansion and in the unchanged capsule export.

The offline execution atlas projects retained registration order and mount
ancestry. Its edges mean immediate mount containment, never runtime sequencing.
Search includes matching registrations and their ancestors; scope follows exact
mount instances. Rendering is capped at 300 graph nodes, while 50-row table pages
retain all matches. Binding exploration groups consumers by enclosing mount and
authored definition, preserving each exact registration and association in the
details. Only retained associations establish consumer edges; authored use sites
may establish binding/operation references independently. No inventory declaration
manufactures a consumer or permission. Binding graphs page 12 consumer groups and
12 operations at a time, with association evidence in 20-row pages. Coverage and
unresolved binding identities remain explicit. Expansion, selection, filtering
and pagination change view state only, without changing the capsule or its export.


## Report storage normalization

AN9-09 adds the internal `pulse.report-data` envelope (`encodingVersion: 1`)
for retained inventory and offline report/comparison HTML. The semantic capsule
and comparison remain v1. `serializeCapsule`, `serializeComparison`, CLI `--json`
and offline JSON downloads retain the original expanded canonical format and
hashes. Readers accept both representations. Older readers reject the new
storage envelope; export canonical JSON when exchanging with an older reader,
subject to that reader's size and work limits.

The envelope has exactly `kind`, `encodingVersion`, `shapes`, `nodes`, and `root`.
Shapes are unique, sorted arrays of object keys. Nodes are JSON scalars,
`[0, ...childIndexes]` arrays, or `[1, shapeIndex, ...childIndexes]` objects.
Indexes are nonnegative safe integers; children precede their parent, the root
is last, and every node and shape must be used. Object keys cannot repeat or
contain prototype-sensitive names. Producers traverse sorted object keys and
preserve array order, interning exact values and subtrees. They emit the envelope
only when its complete UTF-8 representation is smaller and within wire limits.
Compact references are storage-local, never logical IDs or matching keys.

The shared Node/browser codec bounds both encoded data and expanded bytes,
nodes, depth, strings and records with report limits of 64 MiB for both input
and expanded data, 2,000,000 nodes, depth 64, 1 MiB strings and 100,000 array
records. These budgets admit Catalog-sized reports. Expanded costs
are checked before following references into a materialized tree; shared objects
remain immutable in the browser. Node admission then performs the existing
semantic schema, identity, graph and hash validation. Normalization neither
removes evidence nor makes an oversized semantic capsule admissible.

Completion inventory sidecar version 1 binds canonical JSON; version 2 binds the
normalized envelope. Admission checks the declared version against the bytes.
Completion file lengths and hashes cover the actual stored bytes; capsule and
comparison evidence hashes still cover canonical expanded semantics. Attribution
and source-input sidecars retain their existing encodings. The completion marker
itself remains v1, with an explicitly widened inventory-version enumeration.

Standalone HTML embeds one payload and the shared offline decoder under its CSP
hash. JSON export strings and comparison raw-data disclosures are generated on
demand. Search, filtering and navigation use the decoded model and cannot narrow
exports. Comparison summary/details remain readable without JavaScript; its full
JSON disclosure and download require JavaScript. No compiler, provider or network
activity is needed to decode or replay retained evidence.

## Retained build metadata

Optional Report v1 `build` metadata is captured during Native compile/build and
bound by the existing inventory/completion hashes. It records monotonic elapsed
stages from build entry through inventory capture, plus separate portable and
provider AssemblyScript invocation durations, effective flags and optimization
levels, compiler/toolchain versions, and observed provider artifact reuse.
Compiler observations reference the exact retained artifacts. Adjacent stage
intervals sum to the recorded total; compiler durations are nested within those
intervals, not additive overhead. The total excludes prior configuration
resolution, inventory serialization and final publication. No timing claim is
made for replay, internal asc subpasses, or unobserved caches. Node packaging
reuses portable Wasm without a second compilation. Filesystem flag values are
replaced with role placeholders; only compiler-owned flags are captured, never
arbitrary argv, environment or provider binding values. Qualified asc defaults
are resolved only for the known version; unknown defaults remain null. Metadata
is outside source, plan and executable Wasm identity. Historical capsules without
this optional block remain unchanged and display **Not recorded**.

## Report comparison contract

CMP8-01 owns the internal, pure `pulse.report-comparison` v1 result and
`pulse.report-matching.v1` identity policy. The CLI, HTML and MCP adapters must
consume that shared result rather than implement their own matching or arithmetic.
CMP8-02 adds the offline HTML presentation. Command/MCP adapters remain separate
integration work. No new public CLI option or package export is introduced here.

`compareCapsules(before, after)` admits two validated Report v1 capsules and
returns immutable evidence without IO, project loading, compilation or execution.
`parseComparison`, `validateComparison` and `serializeComparison` own bounded
wire admission, canonical JSON and the comparison hash. Both input capsule
hashes, project names, selected contexts, primary artifacts, producer versions,
provenance and recorded build metadata remain available in `sources`. These are
historical claims from the input capsules, not proof of current project freshness,
common repository lineage, signatures, or original artifact-byte verification.
Matching project names alone do not establish that two builds belong together.

The summary always preserves primary artifact bytes and all inventory counts,
including zero-net route/schema changes with separate added and removed counts.
Details contain only changed fields and added, removed, modified, coverage-changed
or unresolved records; unchanged records and empty sections are omitted. Build
timing and provenance changes remain separate metadata changes. Sparse records
retain full before/after capsule-local IDs for lookup in the original capsules.

| Inventory | Matching policy |
| --- | --- |
| Routes | Unique exact method/path slot. Duplicate slots require a unique exact canonical ID; otherwise retain ambiguity. No matching by row ordinal, shortened ID or handler display name. |
| Entries | Route entries follow the route match. Other entries use a unique recorded kind/name/source-file/router-scope/method/path key. Source line movement changes provenance without deleting the logical record. |
| Schemas | Unique declared schema ID. |
| Bindings and declarations | Unique kind/name pair. |
| Resources | Unique kind/generator-scope/producer-name/resource-name key. Numbered response-payload labels are excluded as unstable identities. |
| Implementations | Named compiler identity within artifact stage/host/target; dedicated bodies follow matched entries. Dispatcher chunk/function indices never establish cross-artifact identity. |
| References | Recorded kind/binding-kind/canonical reference identity; unresolved references without a canonical identity remain unmatched. |
| Evidence | Kind, producer name, method and exact corpus/cases/target scope. Result and producer-version changes are visible. |
| Observations | Code, producer name and resolved comparison subject keys; unresolved subjects cannot establish identity. |

A unique exact canonical ID may disambiguate a duplicated logical key, but never
supplies a fuzzy rename or source-code equivalence claim. For records without a
logical key, exact record IDs can join only inside the same primary artifact.
Ambiguous or unavailable identities remain explicit unresolved groups containing
every record ID. Relative ordering compares matched route/entry records, so
inserting a new registration does not manufacture modifications to all later
ordinals. Recorded composition, flow, consumers and declarations use the matched
keys, not artifact-bound IDs. Handler IDs, physical function indices, evidence
hash churn and timestamps on unrelated evidence do not imply code changes.
Comparison describes retained facts; equal reported size or behavior labels
cannot prove unchanged handler implementation.

A missing row is an addition/removal only when the opposite inventory is complete.
For generated resources, the exact producer scope may establish completeness even
when aggregate resource coverage is partial. Missing optional telemetry, ambiguous
identity, or partial inventories produce unresolved evidence, never a zero or a
proven deletion. Coverage state is retained even when no detail row changes.

Compatibility checks distinguish **compatible**, **different-build**,
**incompatible**, and **unknown**. Host, target, representation and artifact-stage
mismatches block size deltas. Profile, Pulse/reporter/toolchain versions, recipe
and effective compiler-setting changes qualify the result as different-build;
physical byte differences remain arithmetic, not attributed savings. Missing
settings or unsupported defaults stay unknown. Changed checks and unknown checks
remain individually visible even when another check determines the overall state.

Per-subject byte deltas require available exact evidence with matching basis,
method and stage, plus compatible artifact domains. Missing/conflicting measures,
bounds, incomplete ownership or incompatible artifacts retain both observations
and a null delta with its reason. Prelink-only evidence is never promoted to a
primary final measurement. Whole containing-body measurements remain non-additive;
the comparison does not sum route/helper deltas into an artifact total or infer
performance regressions from one build duration.

AN9-06 extends comparison to retained authored analytics. When either input has
an analytics block, `pulse.report-matching.v2` adds handlers, registrations, use
sites, helper calls and associations to the summary and changed sections. Each
semantic inventory has separate before/after `identityCoverage`: resolved
comparison keys out of observed records. This does not certify a complete source
inventory or prove unchanged implementation. Missing analytics keeps unavailable
coverage and cannot establish additions/removals. Comparing two legacy capsules
still emits the original matching-v1 result; existing v1 comparison bytes remain
readable and hash-preserving. V2 results require a reader that supports this policy.

| Authored inventory | Comparison policy after exact retained-ID matching |
| --- | --- |
| Definitions | Unique kind plus authored file and exact UTF-16 start/end offset slot. Names and similar bodies never establish a match. |
| Registrations | Authored source slot, kind, router path, resolved definition and ordered enclosing mount instances. Parent mounts match before children. |
| Use sites | Resolved definition owner and authored source slot; repeated operations stay distinct. Capability, operation and binding are compared values, not identity guesses. |
| Helper calls | Resolved caller/callee definitions and authored call slot; consumer registrations use resolved keys. |
| Associations | Resolved consumer, use site and ordered typed explanation hops. Lane, conditionality and coverage remain compared facts. |

`retained-identity`, `authored-source-slot` and `semantic-links` matching bases are
explicit in changed records. Source-slot matching is an exact location comparison,
not a claim that the same code survives an edit. Original source ranges/hashes and
package provenance remain visible as values. Ambiguous locations and missing
prerequisite identities remain unresolved. Bilateral unmatched source records
are conservatively unresolved, including moves/renames that cannot be connected;
they are not guessed deletion/addition pairs. One-sided records require complete
opposite inventory coverage before claiming an addition/removal. Association path
changes require resolved reference keys. Unavailable dependencies retain explicit
partial link coverage rather than acquiring identity from artifact bytes.

These semantic projections contain no byte measurements, execution counts or
inferred grants. Default/bounded-size recipe changes can affect the physical
artifact and build compatibility without changing authored capability/binding
inventories. A source hash change is provenance, not by itself a capability change.
Dynamic/unknown binding state, unavailable source/capability and lost control or
association coverage remain qualified evidence changes. Ordered mount and helper
paths, normal/error/event lanes and direct-versus-conditional ownership survive
comparison. Legacy physical entry and authored registration keys live in separate
namespaces so one cannot overwrite the other.

The offline comparison HTML adds authored inventory summaries, identity coverage,
matching bases and semantic changed fields. Existing search, local links, native
disclosures and complete JSON export include the new sections. It remains passive
and self-contained; command/MCP integration and graph visualization are separate.

The canonical schema and generated TypeScript declaration share the report fixture
writer. The report-capsule-contract task includes comparison regressions for
identity churn, ambiguity, coverage loss/gain, settings/provenance, exact and
unavailable deltas, sparse ordering, deterministic bytes and compiler-free replay.

The internal `renderComparison(result)` renderer consumes this validated result;
it does not perform matching, recalculate deltas, compile or load projects. The
self-contained HTML keeps project names, before/after artifact bytes, route and
schema counts, zero-net additions/removals and artifact provenance visible.
Both full capsule hashes, artifact identities, recorded recipes, compiler flags,
toolchains and build metadata remain available in native disclosures. Compatibility
is qualified next to the summaries, including unknown historical build settings.

Only changed inventories and fields appear in detail, with text and `+`/`−`
markers alongside color. Unresolved identities and coverage changes retain their
reasons; partial counts are labeled observed and missing measurements never read
as zero or measured savings. Whole-body measurements remain non-additive.
Changed settings and provenance appear separately from application records.
Unchanged details and empty inventory sections are omitted, while all inventory
coverage stays inspectable even in a no-change comparison.

The summary, provenance and native disclosure controls remain readable without
JavaScript. Optional search/status filters, local anchors and theme changes are
presentation state only; export retains the exact canonical comparison JSON,
including hidden and filtered evidence. This is a comparison export, not either
original capsule. Rendering escapes all retained text, admits a bounded validated
comparison, uses hash-bound inline assets and makes no network requests. Mobile
before/after fields stack in the same explicit order as the desktop columns.
The `cli-report-viewer` task covers this renderer alongside the single-capsule view.

## Report handler topology

The optional `analytics` block (new capture: `pulse.report-analytics.v2`; historical
materialized reports: `pulse.report-analytics.v1`) retains first-class
handler and linked-helper definitions plus distinct router registration/mount
instances. AN9-01 projects these from the live canonical router topology after
emission; no plan, executable source, runtime ID, recipe or Wasm bytes change.
Definitions reuse compiler identity (and existing report handler IDs); helpers
use a separate report ID derived from their canonical linker identity. Roles
belong to registrations, so one handler reused twice remains one definition with
two entries. Shared Native stages and dispatcher bodies are not authored handlers.

Definition and registration spans are separate, hash-bound authored file ranges
with UTF-16 offsets `[start,end)` and one-based line/column. They come from retained
source nodes/locations, never generated effect offsets. Imported source package
provenance joins exact reachable-graph module identities, without granting lowerer
trust. Missing source remains unavailable. Synthetic routing nodes have no
handler identity; implicit HTTP fallthrough does not invent an authored 404
handler. Unsupported/non-router topology remains unavailable rather than claiming
an empty definition universe.

Registration order is the canonical execution index. Ordered mount paths retain
instance identity through compiler child/parent-return boundaries, including a
router mounted more than once and nested mounts. Next/child/parent-return links
join existing report entries; HTTP termination never becomes an event entry.
Existing entry flow retains scope/conditional candidate facts. These are static
topology facts, not request traces or proof that every candidate middleware runs.
AN9-02 retains recognized operation nodes before normalization, including linked
helpers. Each authored use site belongs to one definition and carries the shared
compiler capability projection, canonical operation and original source span.
Repeated reads remain separate sites even when they share one binding. Resolved
binding uses join existing reference/binding identities by kind and canonical
name. Dynamic names remain unresolved; missing evidence is unknown. Synchronous
operations without named resources have not-applicable binding state.

Helper-call edges come from accepted frontend calls, with caller/callee identities
and all consumer registrations of that authored call. A shared helper owns its
own capability sites; each caller reaches them through its validated edge.
Calls expanded by reuse or mounting remain one authored call with distinct
registrations. Missing authored call locations never borrow generated offsets.
These observations live outside serialized recognition summaries and executable
metadata. Default and bounded-size recipes retain the same semantic inventory.
AN9-03 derives contextual use-site associations from those accepted calls and
canonical router control. Each registration can retain an optional control fact:
its normalized match pattern, whether a mount has an eligibility gate, and the
possible normal continuation, explicit error transfer and terminal outcomes.
These outcomes come from accepted canonical operations, not source text or a
report-owned control-flow parser. Eligibility values and branch predicates are
never serialized. Missing or unsupported control evidence remains unavailable.

Direct associations describe definition ownership, including shadowed entries;
`conditional: false` is an ownership fact, not a claim that a use executed.
Inherited associations are conditional candidates through explicit `next()` or
`next(error)` continuation and child/parent-return links. Disjoint scopes and
methods are excluded, terminal outcomes do not create a continuation, and error
recovery can resume normal dispatch. An explanation that traverses an error
handler retains the error lane even after recovery. Events retain only their
own definition/helper associations and never inherit the HTTP graph. Ordered
`via` hops preserve mount instances, registrations and accepted helper calls;
they explain dependencies rather than recording a runtime trace.

Pattern overlap is checked against the canonical sealed path grammar. Ambiguous
overlap is conservative and carries partial `unsupported-mapping` coverage;
missing control gives partial `not-recorded` coverage and unknown inherited
conditionality. Branch-predicate feasibility, implicit runtime failures and
transitive dependency internals are outside this explicit-control association
basis. A terminal response therefore does not acquire an error-handler
association merely because an operation might fail at runtime. Complete coverage
means complete within this static basis, never complete request execution.
Historical v1 derivation is deterministic and bounded to 250,000 work steps, 10,000 rows and
64 explanation hops; exhaustion preserves observed rows with partial
`graph-budget-exhausted` coverage. It never interprets missing evidence as zero.

Association identities bind consumer, use site, ordered explanation and lane.
Validation rederives the table from retained facts and rejects altered scope,
lane, conditionality, references or coverage even if an attacker recomputes a
row ID. The optional control field and unavailable association table preserve
AN9-01/02 capsule round trips. The older `routes.composition` rollup remains a
bounded candidate view; it does not gain this association table's scope proof.

VIS-07 captures only canonical facts in analytics v2: definitions, registration
instances with control and mount/continuation links, authored sites and validated
helper calls. It stores neither expanded associations nor an owner expansion
table. The shared Node/offline-HTML relationship query engine derives entry,
binding, exact-site and upstream-admission projections. Upstream admission does
not depend on the existence or availability of operation sites, so middleware
with no binding operation remains inspectable. Paths retain the same deterministic
static witness semantics, not all runtime paths. Queried association IDs retain
the v1 identity formula.

Queries index facts and compiled patterns, share lazy continuation witness tails,
and cache only the last entry result (plus one viewer binding projection).
They retain the existing 250,000-work safety budget per entry query, with explicit
partial exhaustion. V2 has no global materialized-row or 64-hop cutoff. Requested
pages are bounded by the existing reader record bound; HTML displays 20 rows per
page without changing query coverage. Missing evidence never becomes complete
zero. The reader's other security bounds are unchanged. JSON exports retain the
exact compact capsule independently of query/navigation state.

V1 validation/replay, IDs, hashes, retained rows and exports remain unchanged.
No replay silently upgrades old data. Semantic comparison compares v2 canonical
facts and links, and separately records representation changes in metadata.
Its retained association inventory is unavailable for v2; a v1-to-v2 row gap is
unresolved, never a semantic deletion. Control and binding changes remain visible
in registration and site comparisons. The internal query contract and pinned
full-oracle performance evidence are in `docs/internal/vis-07/README.md`.

The schema/projection/graph validator and retained inventory admit this block
together; passive artifact replay does not load the compiler or provider. Older
capsules without analytics retain their exact bytes and evidence hashes, and
absence means unavailable analytics. Older strict readers cannot consume the new
block. AN9-04 admits exact npm source inputs consumed by the canonical linker to
completion snapshots. A private read receipt binds each consumed manifest and
source to its content hash, physical target and file identity. The linker also
records missing nearer package manifests and source-link resolution; installing
a nearer package or retargeting a package/source symlink invalidates a current
report even when the old target's bytes remain unchanged. These observational
receipts never enter executable metadata, graph IDs, plans or Wasm.

The input sidecar stores only bounded relative locations within the existing
workspace boundary, source identities, sizes and hashes, with an optional digest
in the recorded recipe. It never stores source bodies or grants package/lowerer
trust. Only consumed files and resolution probes are bound; unrelated package
files are not scanned. Sources outside the workspace remain unavailable for
completion rather than expanding report read authority. Capture is bounded to
20,000 read/probe records and 256 MiB of observed source text; replay enforces
corresponding input bounds. Changed/restored file identities during a build
withhold completion. Every publication rechecks inputs before the final marker.

Artifact replay needs neither source files nor installed packages and loads no
compiler, provider or TypeScript. Current-project collection retains the existing
bounded configuration parser, then checks source receipts as data without source
compilation, provider execution or filesystem writes. Both modes validate the
same optional analytics graph and completion hashes. Old input sidecars without
source receipts retain their existing recipe hash and replay behavior. Missing
analytics remains unavailable and legacy capsules still render/export unchanged.
AN9-05 presents the retained graph in the offline report's **Handlers** view.
Authored definitions appear once, independently of registration roles and the
**Compiled helpers** physical-body view. Search covers definition/source identity,
owned capabilities and binding names; kind and registration-role filters do not
change the capsule or its full export. Definition details link each registration,
owned use site, validated helper caller and linked-helper call. Separate
registration details retain ordered mount instances, router paths, continuation
links and contextual associations, including middleware and error explanations.
Synthetic mounts remain registration records without invented handler definitions.

AN9-08 retains the first nonempty compiler handler name in `localName`,
`exportName`, `inlineName` order. Linked helpers keep their original source name;
import aliases and internal linker symbols do not replace a declaration's local
name. Inline names can be compiler-generated context labels, not authored function
names. The existing capsule `name` field carries the selected value through
completion, passive replay and comparison without a schema change. Missing names
remain null; readers do not reconstruct them from source or generated code.
The viewer leads with the retained name, shows source/kind separately, and includes
the name in registration links. Duplicate names remain separate definitions with
separate source locations and navigation targets. Names never establish identity
or comparison matches, and this display policy does not change executable output.

Use-site details show the authored owner, canonical operation/capability, binding
resolution state, logical binding and reference identity, and contextual consumers.
Source displays retain the file, exact range and hash; unavailable source is never
reconstructed from another record or fetched from disk/network. Imported package
provenance remains distinct from the caller's registration source. Coverage and
producer evidence accompany the drill-downs. Direct ownership, conditional static
candidates and unknown conditionality have distinct labels; normal/error/event
lanes stay explicit. These are static dependency explanations, not request traces,
effective grants or evidence of execution. Missing analytics in older capsules
renders unavailable, not an empty or zero-use claim. Route, entry and binding views
link into authored analytics using capsule-local navigation. There is no new
physical-size attribution. Semantic comparison is owned by AN9-06 below the
report comparison contract.

VIS-08 makes **Entry Points** and **Bindings** the two primary execution
inventories in offline HTML. Entry Points combines exact HTTP route and event
registration instances with explicit type labels and method/event filters; it
is a view taxonomy, not a compiler schema change. Historical route and event
entry records remain discoverable when authored analytics are unavailable.
Bindings shows possible entry-point consumers, authored operations and their
coverage, separately from retained inventory references. Dynamic/unknown binding
sites remain accessible without being promoted to invented named bindings.
HTTP size analysis, assets and sizes, evidence, authored records, all entry
records and compiled helpers remain under **More report sections**. VIS-10
promotes Schemas to primary navigation alongside Entry Points and Bindings. Simple
inventory questions do not require opening the Explorer.

Contextual **Explore execution** and **Explore consumers** actions open the
Execution Explorer. Exact details and **Back to Explorer** preserve its live
selection, scope, expanded set, mode, zoom, pan, and focus within the open report.
A new explicit exploration replaces that return context; page reload recreates
the focused context rather than persisting camera state. New entry-point, binding,
authored-definition, registration, use-site and Explorer links use percent-encoded
full capsule IDs. Historical numeric route, binding, entry, authored-record and
atlas hashes continue resolving by their original capsule-local indices.
Anonymous labels use retained source file:line and registration type/order/mount
context, never a fabricated name or a display label as identity. No navigation
change modifies the embedded capsule, evidence hash, exact export or comparison.

VIS-09 opens the Explorer as a fixed, full-window surface inside the offline
report, including on narrow screens. Compact controls leave the canvas available;
no native fullscreen API is used. Selection inspects an exact registration;
a separate **+** / **−** mount control reveals or collapses one neighborhood
without changing selection. Center explicitly reveals selected ancestry; ordinary
collapse does not reopen it. Containment curves and dashed binding-candidate
curves retain their distinct static meanings. Route paths and event types lead
compact labels; exact identities and source ranges remain in advanced details.

One dismissible inspector shows type, relationship and coverage, with links to
Entry Point, Binding and authored details. Table/help and scope/evidence panels
replace that inspector while open. The routing table remains an optional paged
alternative reaching every registration beyond the graph's 300-node display cap;
binding graph and exact evidence pages retain all consumers and associations.
Zoom never shrinks text below 65%; fit can therefore require scrolling. Search,
keyboard node navigation, focus containment, Escape dismissal, close-to-origin
focus restoration, pointer panning and modifier-wheel zoom work without network
access. Browser evidence for Catalog and small/mixed capsules is recorded under
`docs/internal/vis-09/`; these are presentation changes, with the strict CSP and
complete exported capsule unchanged.

VIS-10 adds a **Table | Explore** view switch to Entry Points and Bindings.
Compact HTTP/event rows share verb colors and columns with binding consumer
lists. Inventory search, type/method filters and table pagination remain in
memory; switching back to an unchanged exploration resumes the live canvas.
Contextual exploration remains available in record details. Exact recorded
schema and binding references are distinct from possible binding associations;
missing references never establish non-use.

**Assets & sizes** groups embedded assets and response payloads with recorded
entry/route associations by resource kind and media type. Group source-byte
sums count recorded construction sites and may include duplicate payloads;
unmeasured inputs remain explicit. These totals never imply retained Wasm size,
exclusive route ownership or deletion savings. Unassociated text, schema and
other technical resource records remain in a lazily rendered Advanced census.
The physical artifact ledger, complete capsule and JSON export are unchanged.

## Providers, targets, and eligibility

Target selection is explicit and never falls back automatically. Target support
and project eligibility answer different questions:

- target support records whether a provider/target lane satisfies its declared
  runtime, capability, packaging, tooling, and conformance gates;
- project eligibility records whether the reachable program can use that lane.

A generally available target can reject an ineligible project. A passing local
runtime does not claim that an external deployment, binding, service, or
provider control plane is healthy.

The selected target reaches project linking and handler validation explicitly.
For `javascript`, resolved static package imports and project-relative helper
imports remain source-runtime boundaries; they do not acquire Native lowerer
authority. Canonical application topology, schemas, effect-await rules, graph
containment and entry lifecycle checks still apply. An ordinary imported async
call may be awaited in a JavaScript handler. Native compilation continues to
reject unsupported imports and awaits, including when graph eligibility is
requested in record-only mode.

JavaScript compilation returns canonical inspection metadata without an
executable normalized generator. The provider's graph-backed loader and source
packager execute the original module closure with its JavaScript async semantics.
Router source linking requires counterparts for package effects and intrinsics
in normalized handlers. Recognized sites in JavaScript source-runtime helpers
remain in project package inspection and provider requirements without requiring
generated counterparts; Native still requires every reachable site to link.
Inspection describes recognized Pulse effects; it does not infer effects inside
ordinary dependency implementations or certify their isolation. An ordinary
JavaScript import gains no compiler/lowerer authority or Native guest sandbox
guarantee. Native inspection compiles the source
independently under Native rules. Its failure is advisory for a selected
JavaScript target; `pulse compile` still requires a real Native compilation.

Native build/compile orchestration retains optional Report v1 evidence without
changing executable emission. Safe-output orchestration invalidates previous
completion before work; completion is published last and binds exact inputs,
selected profile, recipe, toolchain and portable/final artifact hashes. Missing,
unsupported, stale or failed completion cannot be repaired by reporting. An
internal collector uses the existing static configuration parser for current
snapshot matching; artifact and historical replay do not import project code,
providers or compilers. Report inventories remain declaration/evidence records,
not authorization or parity claims. Unknown binding realization, generated
resource coverage and byte attribution stay explicit. See the [PRPT-02 packet](https://github.com/pulse-compute/pulse/blob/latest/docs/internal/prpt02/README.md) for lifecycle,
redaction, coverage and remaining integration gates.

Native compilation also returns an observational
`pulse.compiler-report-references.v1` projection after executable emission. It
retains allowlisted binding names, schema IDs, embedded-resource identities and
canonical entry consumers from validated compiler records. Resolved references
are deduplicated by semantic kind and identity; registrations remain distinct.
Schema ownership uses compiler-generated entry or helper ranges only in the
matching generated file. An unambiguous helper range joins its validated caller
entry IDs; repeated calls are deduplicated and shared-stage registrations remain
distinct. Missing callers, ambiguous ranges, and foreign or unassociated
references retain incomplete consumer coverage instead of borrowing an unrelated
source offset. This records static consumers, not runtime invocation counts.

Schema references may retain optional `externalPackages` names, joined by exact
reference identity from trusted package recognition. These label external
dependency use without claiming complete entry ownership. JWT consumer tracing
remains unresolved where the package reference lacks an entry join. Package names
are provenance, not new lowerer authority; arbitrary recognition data is excluded.
The schema viewer distinguishes known use, unresolved consumers, no observed use,
and historical records without usage tracing. No observed use does not prove a
schema unused or removable.

The required retained inventory can include an optional `references` collection
and its coverage. Resolved references join inventory rows; dynamic expressions
and unknown references remain observations with no target. Incomplete reference
coverage has a null expected count. Declarations and static references remain
separate from host binding realization, which stays unavailable. This allowlist
contains no binding values, resource bodies or arbitrary provider metadata.
Historical capsules without reference records keep their original identity.
The projection never enters the executable plan/hash, recipe or provider
configuration; replay reads the retained capsule without loading the compiler.
Final payload attribution remains a separate proof obligation.

Report retains optional `resourceProducers` coverage and per-resource `generator`
metadata. The build collector enumerates selected embedded-asset lookups, schema
codecs named by the Native generator, and package guest-unit contributions.
Each scope has its own observed/expected counts and producer. A complete empty
scope is `0 / 0`; a missing producer has a null expected count. Selected assets
do not enumerate unused files in an embedded manifest. Other generated support
remains unavailable, so the overall resource inventory is explicitly partial.
Package realization records can contain signing material: only the independent
manifest count is retained, without their IDs, hashes, values or descriptors.

The optional `pulse.report-text-responses.v1` projection observes canonical
`response.text` sites after emission in entry, handler, stage and helper bodies.
These become `response-payload` resources under `canonical-text-responses`.
Identity uses owner and expression location, never contents or payload hashes.
Literal strings and directly bound literal `const` strings have resolved UTF-8
byte counts, including empty strings. Dynamic expressions have unavailable
`dynamic-reference` sizes; unsupported non-string literals use
`unresolved-reference`. No expressions are evaluated. Custom/JSON responses,
arbitrary constant folding, execution frequency and reachability are excluded.
Only recognized static text media types are retained; dynamic or unsupported
header shapes remain unknown.

Producer coverage counts sites, including unresolved payloads, independently of
byte availability and consumer coverage. Stages retain registration consumers;
helpers use recorded callers. Generated dispatcher sites may lack known entries.
Routes follow existing bounded composition. Equal strings at separate sites do
not prove separate or shared storage. No body, expression text or header values
are retained beyond normalized allowlisted media types. Historical capsules
preserve bytes and identity: an absent producer means not recorded, not empty.

Resource inputs and representations are distinct from physical artifact bytes.
Embedded assets retain the original byte length and, when recorded, the UTF-8
length of their validated base64 build input. Schema-codec resources join the
existing allowlisted normalized descriptor and its byte count; source input size
is not applicable. Package guest units retain safe identity and producer fields,
with unavailable byte sizes and consumer coverage where no join exists. Known
entry consumers and reverse route references survive sharing without adding
bytes to the physical ledger. No asset bodies, raw schemas, generated source,
private realization contents or manifest paths enter this metadata.

The viewer labels input, packed/descriptor representation, and retained payload
separately, exposes producer coverage, and sorts available byte values numerically
with unknowns last. Schema structure remains expandable. Handler-body and
Reachable metrics measure code bodies, excluding CSS/JavaScript payloads and
schema data: a tiny handler can serve a large asset. Final retained payload values
stay unavailable without final-byte identity proof; source or encoded lengths
are never substituted. Historical capsules without producer metadata remain
readable without changes to their evidence identity. Collection only observes
completed compiler records; replay never loads a compiler or package generator.

For text-response sites the input metric is the resolved string's UTF-8 payload
length, not TypeScript source-file bytes or literal spelling. Native string
representation bytes and final retained Wasm payload bytes remain unavailable:
the collector does not infer AssemblyScript storage, optimizer deduplication,
encoding overhead or final data-segment identity from string length. Packed
embedded assets keep their existing base64 representation measurements. Neither
category adds bytes to the physical artifact ledger or changes route sizes.

Report size collection reads exact retained Wasm sections and function bodies.
A passive build-support observer of the same optimized final emission supplies
optional artifact-bound handler mappings and a bounded static direct-call graph.
The reader verifies function indices/lengths and joins canonical entry identities;
Report never compiles or disassembles. Missing/unsupported capture preserves the
physical ledger with unavailable attribution. Partial route measurements and
shared bodies are nonadditive; exclusive ownership and resource-payload mapping
remain unavailable. Final-link hash changes cannot reuse prelink indices. See the
[PRPT-03 packet](https://github.com/pulse-compute/pulse/blob/latest/docs/internal/prpt03/README.md) for the pinned observer, unchanged
byte proof and qualification ceiling.

The pinned graph adapter reconciles every defined function and direct-call site
against the final census before accepting edges. Module framing handles compact
and empty function bodies; quoted data and comments cannot introduce control or
calls. Tables/elements, indirect calls, function references and tail calls remain
outside this proof. No table target set is inferred. Unsupported instruction
categories take precedence over their supporting table declarations.

Attribution v1/v2 can retain an optional `graph.diagnostic`: an allowlisted reason
and code, optional function index, and observed/expected counters. Reasons
distinguish unsupported table, indirect, reference and tail control, unresolved
function identity, parser mismatch and budget exhaustion. Raw errors, names,
paths, WAT and payloads are excluded. The reader preserves these records in
`REPORT_GRAPH_UNAVAILABLE` observations with `graphDiagnostic`, and exposes the
reason on unavailable reachable measurements. Absent and prelink-only capture
remain distinct from a rejected graph. Historical sidecars without diagnostics
retain their previous generic reason; historical capsules remain readable.

Graph failure preserves verified direct-body metrics and the physical ledger.
Capture enforces 160 MiB graph text and 100,000 defined functions/direct edges;
the reader retains its one-million-operation traversal budget per artifact.
The text ceiling accommodates named WAT expansion; it is not an artifact-size
limit or support for indirect calls. Readers also accept historical 32 MiB
text-budget diagnostics without changing their counters or capsule identities.
Budget exhaustion never returns an unfinished reachable subset. Earlier complete
closures remain bounded, code-only, nonadditive measurements; cycles and shared
callees contribute each physical body once per closure. Parser/output bounds are
not a hard memory or time sandbox around Binaryen serialization. Capture timing
and sidecar size are recorded by the paired regression fixtures, not presented as
a production performance guarantee. Own/Shared and the complete execution-root
universe remain separate proof obligations.

Native generators retain observational `pulse.native-report-ownership.v1`
metadata separately from the executable plan hash. Attribution sidecar v2 joins
canonical entries to exact emitted symbols for terminal bodies, shared stages,
and shared state-machine helpers. Helper consumers come from validated canonical
call sites. One entry may map to several bodies, and distinct registrations may
share bodies; physical code is counted once by final artifact hash and function
index. Missing final symbols remain `final-symbol-not-surviving`; surviving
subsets have partial coverage and cannot establish complete reachability.

The Report capsule can retain an optional `implementations` inventory derived
only from verified attribution v2. Semantic `roles` and implementation `origin`
are separate: dedicated bodies, authored state-machine helpers, consolidated
stages, and dispatcher carriers do not change a registration's route,
middleware, or error role. A stage or carrier can have several roles; helpers
have the helper role and link to caller entries with their own roles. Empty role
sets on unassociated non-helper implementations mean no observed semantic role.

Each implementation is artifact-bound and retains its canonical implementation
identity, per-chunk consumer entries, and surviving physical `bodyIds`. Dispatcher
carriers have no canonical implementation identity and are keyed by artifact and
chunk. Reverse route links follow recorded route composition, including its
existing bounded coverage. `consumerBasis: compiler-entry-association` records
static associations, not call counts, direct-call reachability, or a complete
execution-root census; `entryCoverage` stays partial with a null expected count.
An empty consumer list does not prove an implementation unused. Missing symbols
remain explicit chunks with null body identity and partial `bodyCoverage`, never
zero-byte bodies. Body coverage counts mapped chunks, not distinct functions.

Several chunks or implementations may refer to the same physical body; sum only
the distinct body IDs when measuring their union. This inventory adds no bytes
to the physical ledger and establishes neither exclusive ownership nor a
per-route share of a dispatcher. Existing Handler-body/Reachable/Own/Shared
measurement semantics are unchanged. Overall implementation coverage remains
partial: pure helpers, package/runtime support, and other unclassified functions
are not inferred from names or sizes. Prelink identities cannot label final
bodies. Legacy v1 attribution supplies no origin classification, and historical
capsules without this optional inventory retain their serialized bytes and hash.

The offline Helpers view displays authored state-machine helpers and consolidated
stages from the primary artifact's implementation inventory. Semantic roles stay
separate from origin. Capsule-local labels link route details to the implementation
and its recorded entry/route consumers; canonical identities and chunk/evidence
records remain available in disclosure details. Search, role/origin filters, and
numeric sorting affect presentation only. Missing mapped sizes sort last in both
directions, and the exported capsule remains complete and unchanged.

Helper row sizes sum distinct mapped body IDs for that implementation. The shown
total is the union across visible rows, with cross-row overlap identified; it is
already included in physical artifact bytes and must not be added to route
Handler-body or Reachable measurements. Partial mappings show known bytes and
mapped/expected chunk counts. With no mapped bodies, size is unavailable, never
zero. These associations do not establish complete consumer coverage, exclusive
ownership, runtime execution cost, or deletion savings. Historical capsules
without implementation records and capsules with only prelink records show an
explicit unavailable state. Dispatcher carriers remain outside this Helpers view.

Route facts and size details expose associated dispatcher carriers from the
primary artifact's retained implementation inventory. Expandable rows show each
distinct physical function once, its whole-body bytes, carrier chunks, and known
associated entries and routes. Other implementations of the same body contribute
only the consumers recorded on that exact body/chunk association; consumers of
their other chunks are not borrowed. Missing carrier mappings keep their known
entries and explicit unavailable sizes. Historical or prelink-only inventory
cannot reconstruct final dispatcher associations.

The displayed dispatcher total is a union of known physical bodies, already
included in the artifact, and may overlap helper or other route totals. It is
never substituted for Handler-body, Reachable, Own, or Shared measurements.
Per-route bytes inside a mixed dispatcher remain unavailable. Consumer lists
are partial static associations through recorded composition, not invocation
counts or complete reachability; no observed association does not prove absence.

Inline transfer/error ownership identifies dispatcher carriers, whose whole-body
bytes cannot be presented as individual handler sizes. Those measurements remain
unavailable with `dispatcher-carrier`, or `entry-ownership-not-retained` when no
authoritative join exists. Non-route entry measurements retain their own subjects.
Completion binds the actual attribution version; v1 sidecars and v1 historical
capsules remain readable. This does not qualify package-root application bodies,
pure expression helpers, post-link aliases, or a complete execution-root universe.

`pulse report` exposes this retained collector as a bounded terminal overview or
one complete authoritative JSON capsule. Artifact replay preserves historical
identity without claiming current-input matching. Planning does not collect or
write; CLI startup and artifact errors do not load project/compiler/provider code.
`--html` writes the locked slate, route-first offline viewer with expandable
schema property/provenance views, explicit evidence qualifiers, and complete
capsule export. A fixed hashed content policy and text-node rendering keep
payload strings inert; no browser opens or remote assets load. HTML is bounded
to 64 MiB after context escaping, within the retained-file reader's limit.

For repeatable HTML generation, a bounded `.pulse-report-outputs` receipt beside
each destination records its basename and at most two content hashes (intended
and previously verified bytes). Only exact matching generated bytes are excluded
from project input records; ordinary or edited HTML remains an input. These
internal receipts are not build authority: recorded input comparison, graph
source hashes and compiler watch-file binding still fail closed. Package inputs
never use receipt exclusions. HTML cannot overwrite a recorded build input.
The existing 20,000-file/256 MiB scan budget includes generated HTML verification;
receipts are bounded to 256 per destination directory, 4 KiB each and 20,000 per
scan. See the [PRPT-05 packet](https://github.com/pulse-compute/pulse/blob/latest/docs/internal/prpt05/README.md) for implementation,
exact design-fixture identities and the outstanding real-browser qualification.


Provider packages own descriptors, configuration normalization, local
execution, target generation, source packaging, deployment bindings, and target
support policy. The compiler owns the neutral bootstrap, contract validation,
the compile-only `none` driver, and shared evidence composition. The compiler's
production dependencies contain no Node or Fastly provider. The CLI distribution
owns both bundled provider dependencies and binds built-in resolution to its own
package context; CLI orchestration carries provider identity as data and does not
import or branch on concrete provider implementations.

Provider bootstrap is exact and fail-closed:

- bare host ID `x` resolves by convention to `@pulse-compute/provider-x`;
- direct compiler consumers resolve the selected provider from `projectRoot`
  (the working directory when omitted); the CLI resolves its bundled `node` and
  `fastly` IDs from the CLI package, without retrying against the project;
- an exact scoped package name resolves from the project;
- `none` selects the internal compile-only driver;
- every package provider must export the versioned `./toolchain` contract.

Pulse does not scan dependencies, inspect keywords, run self-registration hooks,
try alternate package names, or substitute another provider or target. A
selected provider toolchain is trusted build code running in the Pulse process;
do not run it from an untrusted project tree.

Provider-neutral compiler loading and compilation do not load either provider.
Legacy proof commands load their selected provider lazily from the caller's
composition root. Repository proof scripts retain development dependencies only.
The canonical API compiler, Native plan builder and Native compiler facade use
declared package imports without checkout-relative recovery for missing or
unexported dependencies. This is a bounded facade migration, not a claim that all
historical loaders have been migrated.

`arc01-installed` qualifies exact packed compiler-only, Node-only and Fastly-only
installs outside the checkout, with the unselected providers physically absent.
It compiles real Wasm, executes the selected provider driver, verifies unchanged
installed package bytes, and checks the bundled CLI's doctor/test/build workflow
on both targets. Fastly Native execution uses its fixture ABI; this evidence does
not establish Viceroy or deployed service behavior.

The compiler-to-provider seam is exact. A selected package exports one
versioned toolchain whose zero-argument `createDriver()` returns a versioned
driver. Shared contracts validate the complete callable surface and normalize
every selected target descriptor before configuration, compilation, or
packaging uses it. A supported Native target must carry its final-Wasm policy;
an absent method, unknown field/version, provider/target identity mismatch, or
automatic-fallback claim fails during bootstrap.

Provider planning receives a versioned projection of canonical capabilities and
operations, never compiler metadata or lowerer output. Target realization then
receives one immutable invocation containing the canonical Native or JavaScript
application plan, canonical provider plan, selected target, normalized provider
configuration, explicit capability/binding/package requirements, explicit
project/package facts, and—when Native—the copied final Wasm whose hash and
guest-link packaging authorization have already been checked. It does not
contain a TypeScript AST/service, compiler cache, builder, mutable manifest,
compiled-program object, raw target option bag, or alternate target.

CLI Native test/dev execution that needs guest crypto or conditional KV uses
an optional provider-owned `prepareNativeExecution` driver hook. It receives the
same immutable, validated invocation with action `execute-native` and returns a
local request executor. The CLI never substitutes another provider's host.
Node executes the compiled neutral Wasm with its provider adapter. Fastly
realizes its own Native artifact and runs the existing fixture ABI, including
the conditional-KV authority. Its result identifies the artifact hash and fixture
kind; unavailable effect telemetry is reported as such. This does not establish
Viceroy or deployed Fastly acceptance. S3 fixtures preserve raw response streams
inside the provider transport while ordinary fetch retains its opaque response
contract. Dev retains a last-good Native executor if recompilation fails.

Native realization and JavaScript source packaging are normalized into
versioned, data-only results before the CLI consumes them. Provider packaging
must report the same artifact identity authorized by the final guest audit.
Provider-specific legacy proof builders are confined to an explicit
CLI/testing composition root and are not reachable from compiler internals or
the provider target invocation.

See [Contracts and providers](../concepts/contracts-and-providers.md) and
[Add a core provider](../contributing/adding-core-provider.md).

## Package-owned capabilities

Normal package roots are canonical for application authors. JavaScript targets
execute the package implementation; supported Native targets recognize the
same root symbols and lower the accepted subset into canonical package
operations. Compatibility subpaths do not define the recommended surface.

Product metadata, application exports, executable compiler authority, and
provider realization are separate owners:

- `pulse.package.json` describes product, target, ownership, and conformance
  metadata and cannot execute compiler code;
- a trusted compiler manifest and builder own static recognition, diagnostics,
  payloads, and optional sidecar ABI;
- shared contracts own versioned operation and result semantics;
- providers own host realization.

The feature-to-compiler seam is exact. The library kit constructs a versioned,
immutable builder invocation from documented source-recognition inputs; it
does not forward caller option bags. The builder's package-owned artifact and
contributions are normalized into a versioned result envelope before compiler
orchestration. Shared package contracts reject unknown fields, owner/version
mismatches, nondeterministic order, and mutable canonical operations.

Package builders emit provider-neutral capability and crypto requirements.
They do not receive provider drivers, target descriptors, runtime objects,
resolved secrets, raw CLI configuration, compiler caches, or arbitrary
TypeScript programs/services. Target eligibility begins after canonical
requirements exist.

Package effects require an explicit `PulseContext` and use the same
request-owned bridge as core effects. There is no ambient current request,
mutable global registration, or package-specific scheduler.

Package lowerers are trusted build dependencies. A resolved workspace or npm
package may declare static `pulse.package.json` product metadata and the
versioned `pulsewasm.manifest.cjs` compiler contract. Admission depends on
matching supported protocol versions and package ownership, not a package-name
allowlist, a monorepo registration, or equality with Pulse's release version.
Use `compiler.trust: 'build-dependency'` and matching `lowering.trust`;
`first-party` remains a compatible alias with the same execution authority.

The project graph discovers declarations from the package resolved at each
import, including nested dependencies. Unrelated installed manifests are not
executed by graph compilation. Explicit catalog inspection may enumerate
workspace and installed declarations. Recognition runs only for graph-selected
package contracts. Conflicting contract/import ownership fails closed.
Manifest, builder, sidecar, and product metadata paths must stay inside their
package after realpath resolution; package-root links such as pnpm's are valid.

Manifests and builders run ordinary CommonJS in the compiler process with its
filesystem, environment, and Node authority. This is an explicit trust model,
not sandboxing, signature verification, resource isolation, or failure
containment. Applications choose and maintain their build dependencies.
Protocol validation occurs after loading the trusted manifest and before
loading its builder. Unknown protocol versions are rejected, not guessed from
npm semver. Builder results, canonical operations, and provider requirements
still pass their existing versioned validators. Package admission does not
create a host capability or expand the separate prebuilt-guest contract.
A general compiler-plugin hook API remains deferred; the scoped external
lowerer contract is available independently of that readiness gate.

See [Package-owned lowering](../concepts/package-owned-lowering.md), the
[package lowerer contract](../contributing/package-lowerer-contract.md), and
[plugin readiness](../maintainers/plugin-readiness.md).

## Trusted package runtime Wasm

A reachable package may contribute a versioned private runtime Wasm artifact
and `package.invoke` effects without a monorepo registration. The managed
runtime accepts only the generic versioned definition, bounded string payload
and live request context. The compiler validates static artifact ownership,
operation/configuration, Wasm ABI and declared memory maximum. This is separate
from the internal prebuilt guest-link contract below.

Node implements the generic host binding for Native and JavaScript: explicit
package/operation grants, authoritative pre-normalization HTTP captures,
trusted time and provider-only named key lookup. Cryptography uses the existing
explicitly selected Crypto byte realization. Native protocol logic runs only
in package Wasm. Fastly has no implementation and fails capability planning.
Memory, input/output, crypto commands and request lifetime are bounded; trusted
code is not sandboxed or forcibly CPU-preempted. Package results and sensitive
HTTP/key data are excluded from effect traces. Applications and operators own
build dependency trust and the truth of their configured HTTPS termination
origin. See the exact [runtime binding contract](../contributing/package-lowerer-contract.md#trusted-package-runtime-bindings).

## Internal prebuilt guest units

Native compilation may select a synchronized first-party prebuilt core-Wasm
guest unit contributed by a trusted package lowerer. The compiler resolves the
selection and target policy, then delegates validation, content-addressed
materialization, static composition, post-link optimization, final binary
audit, provenance, and normalized diagnostics to
`@pulse-compute/wasm-guest-link`.

The guest-link stage owns its versioned invocation and result identities. Its
input contains one exact normalized guest contribution, a separately projected
package root, primary Wasm bytes, synchronized package versions, and explicit
profile, optimization, and final-Wasm policy facts. It does not receive a
compiler realization, target descriptor, option bag, provider object, AST, or
compiler service. Its result contains exact final Wasm/text bytes, normalized
plan/report/audit records, artifact identity, packaging authorization, and an
explicit no-fallback disposition. The compiler integration module only
projects and rejoins those exact values.

Guest linking runs after the primary AssemblyScript module is compiled and
before the exact audited artifact enters provider packaging. Its pinned final
Binaryen invocation runs size optimization and bounded similar-function
merging without memory packing. The final audit still requires every validated
static data segment, fixed-memory layout, feature restriction, and public
signature; packaging binds the bytes produced by that invocation to its new
receipt. The pinned recipe for the reviewed guest prebuilt remains separate.
The initial contract is deliberately closed: one package-prebuilt unit, one fixed
link-stage-owned memory, borrowed bounded input, MVP features, no start
function, no allocation or pointer retention, no undeclared imports, and no
fallback. `.pulse/guests/` is generated, content-addressed,
non-authoritative, and reproducible after deletion. Each entry lives at
`.pulse/guests/<unit-id>/<artifact-sha256>/<manifest-sha256>/`, keyed by the
exact artifact and manifest bytes. Upgrading a package whose Wasm is unchanged
creates a separate entry when its manifest changes. Legacy artifact-only cache
files remain untouched and are not reused. Reusing an exact entry still verifies
both files byte for byte and rejects corruption.

Only synchronized first-party package identity is trusted. Manifests contain
normalized metadata and hashes, never executable commands. A failed selected
unit stops compilation before provider packaging; it cannot choose a different
realization or substitute the primary or a JavaScript output. Source builds,
local guest overrides, dynamic loading,
self-registration, arbitrary guest imports, and public third-party guest APIs
do not exist.

This is an implementation seam rather than an application-author API. A future
component-model composition engine may replace the current core-Wasm linker
without moving package semantics into the compiler or widening the trust model.

## JWT verification

The synchronized `1.0.0-beta.10` JWT/crypto packages compose
`@pulse-compute/jwt` over the lower-level, provider-neutral verification
contract owned by `@pulse-compute/crypto`. The executable algorithm set is
HS256 and ES256. Crypto verifies a MAC or signature over caller-supplied bytes
and returns a closed status category; JWT owns compact-JWS structure, strict
protected-header and public-key rules, configured registered claims, optional
schema validation, and the detached immutable application result. Neither
layer exposes backend objects, raw error text, key material, messages,
authenticators, or unauthenticated claims.

Reachable package requirements are checked against the active profile's
`pulse.crypto` declaration and the selected target's exact realization.
Profile declarations replace the global declaration as a whole; arrays and
objects do not merge. An empty declaration enables no algorithms. An unknown,
missing, unavailable, or failed realization stops with a normalized diagnostic
and never authorizes fallback.

A provider-dependent JavaScript package with a declared runtime entry can enter
the source application plan. Loadability alone does not establish target
eligibility: the selected provider must classify every declared package
requirement and every recognized operation requirement as eligible. Missing,
pending or blocked requirements prevent source-package builds; importing a
package without a recognized operation does not erase its declared requirements.
The loader preserves the graph's public package import and resolves it through
package exports; a declared runtime file is not an additional exported subpath.

For JWT verification, JavaScript targets select `runtime-builtin` and use Web Crypto with explicit
HMAC/SHA-256 or ECDSA/P-256/SHA-256 parameters. The crypto boundary receives a
normalized 64-byte P-256 point; its JavaScript adapter validates that point and
constructs the runtime-private JWK used for import. Native HS256 selects
`guest-source:pulse-hmac-as`, compiling first-party AssemblyScript into the
primary module, while Native ES256 selects the audited
`guest-linked:pulse-es256-rustcrypto-p256` unit. Neither algorithm retries a
different realization.

Crypto also owns the public request-bound `crypto.digestText(ctx, text)`
operation. Its synchronized first-party lowerer emits `crypto.digestText`
capability demand and exact `SHA-256` selection; catalog membership alone
continues to grant no executable trust. The normal package bridge owns effect
lifecycle. Crypto validates scalar text before encoding at most 2097152 UTF-8
bytes, preserves exact bytes, and returns lowercase hexadecimal SHA-256 plus
byte length or a bounded failure. Native uses the existing Crypto guest source;
Node/Fastly JavaScript use selected runtime-builtin SHA-256. The compiler admits
an imported facade named `crypto` only for an exactly recognized package call;
ambient crypto calls and authority in its arguments remain rejected. HMAC/JWT
limits, fallback policy, and S3/Catalog capacity are separate contracts.

S3 operations require exact `SHA-256` and `HMAC-SHA256` selection. Native
composes the same Crypto-owned source once; Node JavaScript explicitly selects
Crypto's `runtime-builtin` Web Crypto byte realization through the trusted
`@pulse-compute/crypto/provider` export. Both return 32-byte results, cap SHA-256
data at 2 MiB, HMAC data at 64 KiB and HMAC keys at 8 KiB, and snapshot and wipe
staging inputs. Large host-staged hashes use a separate lazy digest frame. Native
also checks guest memory ranges. JWT verification retains its separate limits.
No target probes or falls back to a different realization.

The supported-extension `@pulse-compute/s3` package owns `head`, `getText` and `putText`,
literal binding/options authority, runtime key/text lowering, SigV4 composition
and bounded results. Node and Fastly own fixed endpoint/bucket/region mappings,
credential lookup, deadlines and transport. Fastly requires a static backend.
Reads and writes bypass cache, disable decompression and redirects, preserve
exact bytes and do not retry. PUT distinguishes pre-dispatch failure and
complete rejection (`not-stored`) from unconfirmed dispatched writes (`unknown`).
Only a complete 200 acknowledgement with a bounded empty body yields `stored`;
its digest describes sent bytes, not durability. Request cancellation retains
existing lifecycle behavior and does not fabricate a typed S3 outcome. Fastly
pending requests lack a cancel ABI; invocation termination owns their release.

AST-01 consolidates JavaScript SigV4 canonicalization, key derivation and RFC3986
segment encoding in S3's first-party `./signing` integration export. The existing
provider signer and Assets compatibility facade both delegate to that owner.
Assets depends on S3 within the exact release set, retains its public helper
types/defaults/error wrappers and Web Crypto selection, and continues to own
lookup, bucket URL policy and HTTP serving. Shared signing accepts resolved
credentials and explicitly supplied crypto primitives; no ambient secret or
network authority moves into S3. Direct helper compatibility does not weaken
portable S3 effect admission or extend Native eligibility. The Native
AssemblyScript implementation remains in S3; no lowerer or provider changes are
needed. Exact tarball acceptance checks dependency resolution, unchanged golden
signatures, public helper imports and installed type declarations.

S3 bindings can explicitly select up to 2 MiB text, retaining the 32 KiB default.
Only digest/S3 text effects admit the 12,648,448-byte escaped envelope; generic
package effects keep their existing bounds. Request/schema limits remain
explicit and owning KV stays at 64 KiB. Primary-memory Native modules with
these text operations enforce a 256 MiB maximum. Fastly joins JSON fragments
once and uses bounded caches for immutable scalar handles so repeated text
validation does not retain a new box for every scalar operation. The ES256 linked-guest fixed
memory ABI does not change or establish the larger text capacity profile.

One canonical consumer exercises Node Native, Node JavaScript and Fastly Native
PUT/HEAD/GET, integrity, bounded acknowledgements and cancellation. Fastly Native
runs compiled Wasm against a host ABI fixture. This is local evidence, not live
Object Storage proof. Fastly JavaScript remains ineligible: its SDK projects raw
response headers, losing multiplicity and aggregate-size evidence required by
O1. The provider-specific limitation is documented in `wasm/test/s3/O3.md` and
does not gate supported targets. O4 adds S3 to the synchronized release package
set and repeats the three-target read/write corpus against isolated exact
tarballs, including package-owned lowering. These are local candidate checks;
live origin acceptance follows T2. Assets alignment remains separate.

Package redaction declarations survive Handler IR projection into the Native
plan. Native host effect traces omit declared private payloads and results;
applications still control their own response and logging use of returned data.

All four target classes—Node JavaScript, Fastly JavaScript, Node Native, and
Fastly Native—execute the same HS256 semantics. ES256 adds exact default and
size-oriented Native artifact cells, producing a six-cell 38-case matrix:
Node JavaScript, Fastly JavaScript under Viceroy, two Node Native artifacts,
and two Fastly Native artifacts. Authenticity completes before clock capture,
registered claims run before schema validation, and failure never selects a
different algorithm, realization, target, or provider.

The observed proof is sealed by
`wasm/.test-results/jwt-d4/jwt-phase-d-seal.json` and
`wasm/.test-results/jwt-e4/jwt-phase-e-seal.json`; the aligned ES256 target
matrix is recorded in
`wasm/.test-results/boundary-h4/es256-six-cell-matrix.json`. The package
relationship is recorded in
`wasm/test/jwt/contracts/jwt-crypto-working-candidate.json`. Providers and the
runtime remain explicit integration inputs. Validation does not itself
publish, promote, deploy, or activate the release.

## Support, release, and authority

Pulse `1.0.0-beta.10` is a Beta intended for the `beta` channel.
Documented, evidence-backed behavior is intentional, but public surfaces may
change deliberately before a compatibility-bearing release. Unsupported
behavior fails explicitly, historical and implementation subpaths gain no
accidental guarantee, and released package names, versions, and artifacts are
immutable.

Package support comes from `release/pulse-release-manifest.json`; provider
support and project eligibility come from their versioned evidence. Local
validation prepares evidence but does not authorize merge, tagging, npm
publication, documentation promotion, provider deployment, or service
activation.

Publication uses sealed package candidates, protected human-approved
environments, npm trusted publishing, immutable exact-version documentation,
and resumable promotion without bucket-wide deletion. Human CODEOWNERS retain
architecture, merge, repository-setting, and release authority. Codex may
analyze, review, reproduce, and prepare bounded patches; deterministic checks
remain authoritative even when Codex is unavailable.

A protected-path match requires a boundary declaration and review; it does not
establish that the patch changes that boundary's semantics. Human direction
already supplied for a bounded task covers its necessary implementation, tests,
canonical documentation, regeneration and PR preparation. The PR records that
direction and any remaining decision. A new semantic or authority change beyond
the authorized scope requires new direction. Implementation approval does not
transfer merge, publication, deployment or self-approval authority.

Validation claims distinguish injected hosts, local Compute engines, standalone
live probes and deployed Pulse artifacts. SDK capability mappings and observed
provider discrepancies do not redefine Pulse's contract. Required acceptance
gates remain separate from the aggregate release command; their status and any
human-directed policy changes must be explicit before claiming release readiness.

See the [maintainer charter](../maintainers/maintainer-charter.md),
[release acceptance](../maintainers/release-acceptance.md),
[npm publishing](../maintainers/npm-publishing.md), and
[documentation deployment](../maintainers/documentation-deployment.md).

## Changing a contract

A material change to a protected boundary requires explicit human direction and
must update the current contract at its canonical owner. The same change must
update affected machine-readable catalogs, diagnostics, generated references,
tests, conformance evidence, and release acceptance. Do not add a chronological
decision file as a substitute for updating current truth.

The maintenance classifier reports whether a current contract update is
required for the inferred boundaries. The pull request must name those
boundaries, expose the human decision, and explain the resulting contract change
where reviewers can evaluate it. Git history and sealed checkpoints retain the
superseded state.

### JWT issuance and canonical guest linking

JWT signing supports HS256, ES256 and RS256 through request-owned secret and clock
effects. Private P-256 JWK parsing belongs to JWT; the private Crypto adapter
accepts bounded `x || y || d` bytes. Native ES256 uses the exact revised
`pulse.crypto.es256-rs256.verify-and-sign.v3` guest ABI, retaining the verification
frame and adding a distinct signing export. The caller clears the signing
frame and borrowed Rust stack. No public generic signing primitive, remote key
authority, dynamic lowerer, algorithm fallback, or provider discovery is added.

CLI canonical compilation checks its intermediate module against the fixed
Pulse host ABI owned by `canonical-native-runtime.js`. Provider packaging
separately checks the final artifact against its selected provider descriptor;
Fastly's final artifact must not retain `pulse_host` or crypto guest imports.
This separates the two artifact boundaries without widening either import set.
Historical G0/G3/G4/G5 reports do not attest the revised signing binary.


RS256 shares the exact first-party signature guest with ES256. Its separate
sign/verify exports use algorithm code 2 in the checked invocation envelope,
12288 input bytes, and 256/384/512-byte signatures. The original ES256 frame
semantics remain algorithm code 1. RSA uses vendored, pinned BearSSL 0.6 i31
arithmetic compiled with Zig 0.13.0's Clang and statically linked by Cargo;
source inventory, toolchain identity and final bytes are part of the trusted
package catalog. The existing module/path identifiers are retained, while the
ABI/build identities advance to v3. This expands neither linked-unit count
nor the fixed memory/host-import policy. Native SHA/HMAC source composition
remains rejected by that policy, and Fastly Native keeps one verification
algorithm per artifact.

JWT owns strict private/public RSA JWK metadata and deterministic static JWKS
selection. Crypto checks RSA/CRT consistency and signing output. No remote
key discovery, key generation, certificate/PEM parsing, PSS, or public generic
sign primitive is added. Native constant-time design assumptions and the
JavaScript BigInt key-validation timing limitation are documented in the
Crypto package guide. Existing secret/clock authority, cancellation,
redaction and application lifetime ownership are retained.

### Experimental bounded request transforms

STR-03C selects strict UTF-8 incoming request chunks, with `request.body.transform`
and explicit `node.bodyTransform: true` alongside generatedOutput/maxDurationMs.
The provider-neutral `ctx.req.readTextChunk()` surface lowers to an awaited
`output.readTextChunk` effect: the existing request-owned output controller owns
both sides so one reader/write may be outstanding. It uses ordinary single-use
Native effect tickets, rejects parallel grouping and exposes only `{ done, text }`.
Native executes the handler's existing pure expressions, including concatenation;
no callback, binary-view API or new string operation is admitted. Linked guests
remain excluded pending memory qualification. Fastly explicitly rejects transforms.

The finite contract is 65,536 input bytes, 262,144 output bytes, maximum 4× expansion
against UTF-8 bytes delivered to the handler, 4,093 raw bytes per fixed input block,
at most three decoder carry bytes and 4,096 encoded bytes per delivered text chunk.
BOMs are data; invalid/truncated UTF-8 fails. At most 18 reads include the distinct
EOF marker; close requires EOF. Existing 16 KiB/write, 64-write, cumulative 64 MiB
Native accounting, 4,096-page guest limit and shared request deadline still apply.
Input queue accounting is at most 69,632 bytes, separate from Node transport buffers,
materialized text, output buffers and retained guest/host values. Input source chunks
and backing allocations are bounded before retention. No application stream,
replay, tee, fetched input cursor or allocator reclamation is introduced.

Transform configuration excludes incoming forwarding and reserves structured body
reads. Native capability composition rejects structured reads; the shared host
ownership object also fences JavaScript admission conflicts. Reads are lazy and
writes wait for callback plus drain before the next pull. Errors, disconnect and
deadline cancel the input owner and fail the writer; post-header failures cannot
replace the response. The Native manifest records the finite transform policy,
not an installed qualification claim. Workspace acceptance measures 2× duplication,
accepts the 4×/256 KiB boundary, rejects over-expansion and validates actual Wasm
and both Node HTTP targets. See [bounded UTF-8 transforms](../concepts/bodies.md#experimental-bounded-utf-8-transforms-on-node).

### AST-02D Native embedded Assets

The trusted Assets lowerer admits a canonical serialized `embeddedManifest`
literal on `assets.lookup`. Contracts own manifest validation, deterministic
identity and the finite embedded HTTP subset; the lowerer owns authoring
admission and selects the contained literal path. All manifest records are
validated, including unselected files. The existing opaque package effect
carries only the selected admitted blob and manifest identity into the Native
artifact. Node and Fastly retain binary response ownership. The opt-in grants
no filesystem, store or network authority and adds no binary application ABI.
Ordinary Native compilation/builds are the supported path. JavaScript retains
the existing embedded middleware; the Native-only lookup option rejects direct
JavaScript execution. The older binary-buffer guest ABI remains reserved.

### AST-02A bounded S3 response ownership

S3 `getBody` is a Node Native/JavaScript opaque package effect. S3 owns signed
GET/HEAD and the narrow conditional/range metadata contract; Node owns origin
I/O, the existing binding byte limit and transfer deadline. The Native host
tracks registered response bodies until return or discard. Body bytes do not
enter application values or imply whole-object integrity. Fastly body-handle
integration and embedded assets are separate increments; existing S3 text
support does not imply support for this operation.

### AST-02C Fastly opaque S3 bodies

The Fastly Native provider realizes the existing `s3.getBody` effect with
provider-owned origin handles, strict raw metadata admission, and a 16 KiB
streaming copy. S3 owns Native signing and range interpretation. Literal read
options remain lowerer-admitted; bindings remain configuration-owned. Each
response copies its deadline so repeated effect slots cannot extend older body
ownership. Unselected handles close at invocation exit. The downstream handle
is finished only after exact-length EOF; an unfinished stream aborts at Compute
invocation exit. This adds no guest byte value or JavaScript fallback.
Fastly JavaScript remains blocked by raw-header limitations.


## Production Node integration (NODE-01)

`@pulse-compute/provider-node/server` is a supported host integration export.
`createNodeLauncher` admits only an explicitly selected Node Native or JavaScript
`pulse build` directory and bounded, host-owned configuration. Native startup
checks plan/Wasm/package identity and ABI, then executes exact Wasm per request.
JavaScript loads the packaged application and codecs; neither target recompiles
or reads development configuration at startup. Builds are trusted executable
inputs, not a sandbox or an authenticity signature.

The launcher owns readiness, connection/concurrency admission, request budgets,
bounded drain and restart of the same immutable build. Request cancellation
remains with the existing runtime budget and provider adapters. Shutdown revokes
request authority and destroys sockets at the configured deadline; it does not
promise CPU preemption or rollback. It installs no process handlers and exits no
process. Deployment owners wire signals and retain supervisor/release authority.
Reference KV resets for each host generation and is not durable production KV.
The core finite-response contract is separate from stream/blob launcher extensions.
See [Node build and execution](../guides/deploying-node.md) for defaults and limits.

## Embedded binary resource reads

`pulse.binaryResources` owns explicit build-time admission of an immutable
manifest and logical bindings, using mandatory finite application budgets.
The resource catalogue reuses embedded-manifest integrity validation without
changing HTTP Assets admission. `ctx.resources.map` creates an execution-owned
view with checked byte/scalar reads; it does not grant filesystem or network
authority. The [runtime contract](../../API.md#ctxresources) defines the source
subset, lifecycle, numeric rules and unchanged loop bounds.

Native plans carry `pulse.binary-resource-read.v1` expressions and a validated
`pulse.binary-resource-catalogue.v1` selection. An optional host extension checks
numeric offsets and execution deadlines before any i32 conversion. Wasm owns
raw immutable data and little-endian loads. No resource view is stored in a
continuation or exported as a general byte buffer. JavaScript uses private
snapshot backing and execution-branded views. Same-candidate artifact identity
includes the selected bytes; passing historical results never substitutes for
execution qualification. B10-MCP-02 adds strict bounded `readUtf8` expressions
(`pulse.binary-resource-utf8.v1`) and fixed-capacity request-local numeric
workspaces (`pulse.numeric-workspace.v1`). Plan/compiler v11 and AS generator
v10 invalidate earlier generated artifacts; guest ABI 2 has optional workspace
number/check imports. Node host v5 and Fastly Native implement those checks.
The independent plan validator proves allocation identity, initialization
ownership and checked operation shape. Each Native allocation uses raw f64
storage, zeroed on entry; no pointer or workspace handle escapes into effects.
JavaScript uses private zeroed numeric backing and execution-checked views.
The public bounds and source restrictions are in
[`ctx.workspace`](../../API.md#ctxworkspace). Existing pure-loop limits remain
unchanged. Workspace-only artifacts also retain synchronous deadline checks.

The isolated actual-corpus and capacity-bound query-to-citation proof is in
B10-MCP-02 (repository-only: `docs/internal/b10-mcp-02/README.md`). It uses injected Fastly ABI
execution, not CLI/Viceroy or a completed MCP transport.

`scripts/pulse-context-build.cjs` owns explicit offline context resource generation
and read-only reconstruction. It uses the existing corpus extractor/allowlist and
writes the corpus module, three v1 binary resources, scalar metadata and canonical
`pulse.context-build-manifest.v1`, with byte-identical installed CLI mirrors.
Generation requires the release-pinned Node producer. The manifest binds source
selections/citation blobs, finite producer source closure, config/lockfile,
version/status, row/dictionary identities, outputs and simultaneous byte budgets.
Its hash is external; no candidate tree, clock, cache or absolute path enters the
tracked output. Checks reconstruct into a fresh temporary directory, compare all
outputs, and reject drift without changing the checkout. The receipt identifies
the verifier Node separately from the pinned producer.

Repository build and documentation checks require fresh context outputs;
documentation synchronization copies emitted resources but never generates the
vectors. The focused PR test covers independent reconstruction and negative
format/freshness cases. The existing JavaScript host retains its v1 corpus module;
the new resources are the sparse lexical inputs for Native migration. See the
[explicit build workflow](../../examples/12-pulse-context-mcp/README.md#maintaining-the-snapshot).
The compiled application now uses these resources through shared `ctx.call`.
Its [current workflow](../../examples/12-pulse-context-mcp/README.md#compiled-application-workflow)
documents installed execution, reporting and local Fastly/client qualification.
These checks do not substitute for a fresh candidate-bound release seal or
deployed-service acceptance.

## Shared computation and binary resource reporting

The optional `pulse.report-computation.v1` inventory retains shared callee
definitions, original authored call-site and helper spans with source hashes,
schema pairs, and canonical entry consumers. Adapted computation coordinates
are never presented as original source. Repeated calls share one definition;
Router registrations remain distinct consumers. Managed callers and helpers
without a retained entry join stay partial. Per-callee final code-body bytes
remain unavailable: source ownership is not final instruction ownership.
These observations are collected outside executable plans and hashes, through
the ordinary callable source collection and report projection.

The optional `pulse.report-binary-resources.v1` inventory uses the existing safe
resource catalogue summary. It records admission budgets, original manifest
decoded/serialized sizes, logical bindings and shared backing identities.
Selection is Native plan selection, including callees; it is not execution
frequency. Unselected aliases may share backing with selected aliases. A unique
backing is counted once even when several callables or logical bindings use it.
The `binary-resources` producer can be complete while overall resource coverage
remains partial. No resource payloads or manifest paths enter the capsule.

Resolved selected backing bytes are separate from observed artifact bytes.
Build-time raw-data proof accepts only a single complete match per nonempty
selected backing in parsed Wasm data payloads, with disjoint ranges and at least
32 bytes per nonempty pattern. Empty backing adds zero bytes. Ambiguous, repeated,
overlapping, transformed or missing patterns, unsupported data expressions, and
exhausted scan budgets stay unavailable. The proof is bound to the exact artifact
hash and stage; retained-byte replay verifies ranges and hashes again. Its union
is subtracted once from that artifact's unattributed data ledger. Logical rows
never add their shared input lengths to physical totals. This is raw-data
placement evidence, not a runtime backing-copy count, heap census, initial
memory size or process measurement; instance/process memory stays unknown.

Existing JSON, terminal and resource-detail HTML projections expose these facts.
Historical capsules lacking the optional records preserve their identity; no
historical 06B/07B measurement is imported as fresh build evidence. Their bounded
performance/lifetime receipts remain separate; actual local Fastly observations also do not establish
deployed-service acceptance. This does not implement command-aware evidence
summaries from #440 or resolve the historical `REPORT_ARTIFACT_HASH` uncertainty.


## Native optimization recipe selection

New Native compilation uses `native-bounded-size`: O3, shrink level 2,
without convergence. `--native-shrink0` restores O3/shrink0/no convergence.
A Native profile may set `nativeOptimization` to either recipe or the existing
`experimental-native-size` and `experimental-native-bounded-size` modes.
An explicit compile/build flag overrides the profile. The three recipe flags
are mutually exclusive and JavaScript builds reject them; JavaScript profiles
reject `nativeOptimization`. Portable `compile` still explicitly compiles Native.

`--experimental-native-size` remains convergence-enabled opt-in.
`--experimental-native-bounded-size` retains its exact bounded behavior and
historical experimental recipe identity, although its optimizer settings now
match the ordinary default. All new Native manifests and retained evidence
record the explicit selected identity. Historical absent metadata and report
`default` identities keep their historical meaning; passive replay never
resolves them through the current build default or invents compiler measurements.
Guest linking retains its independent final optimizer, retention and merging
posture; bounded and shrink0 primary compilation both use `native-default`
link posture. This does not change the guest prebuilt recipe.
