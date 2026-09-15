# Current architecture contracts

This page is the present-tense map of Pulse's architectural commitments. It
defines ownership and invariants; the linked concept, contributor, governance,
and release pages define the detailed behavior and evidence.

The current source, machine-readable catalogs, and executable acceptance suites
are authoritative together. Git and sealed release checkpoints preserve why the
contracts changed; numbered decision records are not part of the active
documentation system.

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

HTTP Router authoring supports static `get`, `head`, `post`, `put`, `patch`,
and `delete` registrations, inherited by `Pulse`. The owned Router API registry
defines compiler admission; topology and lifecycle method catalogs derive from
that registry. Each verb uses the existing route entry, exact-method dispatch,
terminal transfer and 404/500 exhaustion contracts. This expands ingress
registration without changing outgoing fetch methods or the effect/continuation
ABI.

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

The event contract reserves no `call` surface: there is no `ctx.call`,
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

`ctx.parallel({ ... })` is the explicit cross-target concurrency form. Router
`next()` and `next(error)` are terminal cursor transfers, not onion-style calls:
no application code resumes after the transfer. Normal exhaustion produces
404, error exhaustion produces 500, and effects keep the identity of the route
or middleware entry that owns them.

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
does not cache repeated calls. Existing duplicate-member semantics (last wins)
are preserved; this is not a canonical command-fingerprint parser.
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

See [Effects and continuations](../concepts/effects-and-continuations.md),
[routing](../guides/routing.md), and
[structured and opaque bodies](../concepts/bodies.md).

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
Inspection describes recognized Pulse effects; it does not infer effects inside
ordinary dependency implementations or certify their isolation. An ordinary
JavaScript import gains no compiler/lowerer authority or Native guest sandbox
guarantee. Native inspection compiles the source
independently under Native rules. Its failure is advisory for a selected
JavaScript target; `pulse compile` still requires a real Native compilation.

Provider packages own descriptors, configuration normalization, local
execution, target generation, source packaging, deployment bindings, and target
support policy. The compiler owns the neutral bootstrap, contract validation,
the compile-only `none` driver, and shared evidence composition. The CLI carries
provider identity as data and does not import or branch on concrete provider
implementations.

Provider bootstrap is exact and fail-closed:

- bare host ID `x` resolves by convention to `@pulse-compute/provider-x`;
- an exact scoped package name resolves from the project;
- `none` selects the internal compile-only driver;
- every package provider must export the versioned `./toolchain` contract.

Pulse does not scan dependencies, inspect keywords, run self-registration hooks,
try alternate package names, or substitute another provider or target. A
selected provider toolchain is trusted build code running in the Pulse process;
do not run it from an untrusted project tree.

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

The Beta executes lowerers only from synchronized first-party
packages. Explicit provider toolchains are the narrow exception that may load a
selected project package; they do not enable dependency scanning or plugin
self-registration and do not widen lowerer trust. A general plugin API remains
unavailable until the machine-readable readiness gates for provenance,
discovery, negotiation, security, compatibility, and isolated loading are
implemented and release gated.

See [Package-owned lowering](../concepts/package-owned-lowering.md), the
[package lowerer contract](../contributing/package-lowerer-contract.md), and
[plugin readiness](../maintainers/plugin-readiness.md).

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
before the exact audited artifact enters provider packaging. The initial
contract is deliberately closed: one package-prebuilt unit, one fixed
link-stage-owned memory, borrowed bounded input, MVP features, no start
function, no allocation or pointer retention, no undeclared imports, and no
fallback. `.pulse/guests/` is generated, content-addressed,
non-authoritative, and reproducible after deletion.

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

The synchronized `1.0.0-beta.4` JWT/crypto packages compose
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
data at 2 MiB, HMAC data at 32 KiB and HMAC keys at 8 KiB, and snapshot and wipe
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

Pulse `1.0.0-beta.4` is a Beta intended for the `beta` channel.
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
