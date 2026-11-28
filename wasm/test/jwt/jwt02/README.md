# JWT-02.1 — initialization diagnosis and implementation design

JWT-02.2 now implements this design; see [implementation evidence](IMPLEMENTATION.md).
The findings below describe the JWT-02.1 historical checkpoint, not current behavior.

This was a design and evidence checkpoint, not the Native composition fix.
Production compiler, provider, crypto and guest-link owners are unchanged.
The generic reductions extend the existing [JWT-02 card](../JWT-02-guest-composition.md).

## Reproduce the historical diagnosis

```sh
# Run from historical revision 41f4b4e2865f6d1dcecdeed075d95d2343e34350
node wasm/test/jwt/jwt02/diagnose.cjs
# Optional: retain generated sources, primary Wasm, disassemblies and probes.
node wasm/test/jwt/jwt02/diagnose.cjs --out /absolute/path/to/new-directory
```

The standalone task is deliberately outside release profiles. It characterizes
current failures and uses isolated counterfactuals; it is not an acceptance gate
that counts a blocked composition as working. `evidence.json` records exact owner
hashes, generated-source and artifact identities, selected memory limits and
terminal observations. Keys and tokens used for injected-host requests remain
in memory. All consumer source and data are synthetic.

[The retained checkpoint](evidence.json) records the clean tested source and
owner hashes. Each replay generates fresh independent signing keys, so artifact
hashes can differ across runs; the expected semantic observations remain fixed.
The receipt is development evidence, not an installed or release qualification.

## Findings

1. **The ordinary build fails at the provider-neutral primary.**
   `cli/src/project-execution.js::compileNativeProjectInMemory` compiles the
   canonical host artifact before the provider writer emits its final artifact.
   `compiler/src/canonical-native-compiler.js` selects the ordinary `stub`
   runtime for the MAC reduction and `incremental` for schemas, even with a
   signature guest selected. Both produce an implicit Wasm start section.
   The existing guest-link rejection is correct. The RS256 baseline has no
   start section and no `memory.grow`; it builds.
2. **Exporting the initializer alone is insufficient.** The MAC primary also
   contains two `memory.grow` instructions; the schema primary contains three.
   With only `--exportStart`, the schema initializer succeeds but overwrites all
   16,640 sentinel bytes in the reserved signature frame. The standard allocator
   starts after the primary's own data/shadow stack and has no knowledge of that
   independently reserved frame. Static data itself stays inside its reservation.
3. **The MAC reduction eagerly retains an oversized digest allocation.**
   `crypto/as/pulse-hmac-as.ts` contributes the 73,760-byte byte-operation frame
   and a 2,097,184-byte digest frame. The exported digest accessor keeps the
   `@lazy` global reachable; the pinned AssemblyScript output allocates it in
   the initializer. `@lazy` is not a runtime first-call guard. The digest buffer
   alone exceeds the entire fixed 2,097,152-byte memory, before other ownership
   reservations. Replacing the allocator cannot make it fit.
4. **The schema has separate startup allocation pressure.** Pinned json-as
   creates a 1,048,576-byte cache arena even with `JSON_USE_FAST_PATH=0` and
   `JSON_MODE=NAIVE`. The existing exact-source cache-elision transform is an
   independent counterfactual; it must not be confused with a repaired primary
   allocator or automatic qualification of larger schema workloads.
5. **Fastly already supplies part of the intended mechanism.** Its linked path
   uses `fixed-memory-runtime.as.ts`, `--exportStart __pulse_initialize`, and a
   Wasm `_start` wrapper that initializes once before the handler. Direct
   provider-stage compilation passes its real final-link audits for all four
   reductions, while the ordinary MAC/schema/combined builds are still blocked
   earlier. Injected execution is checked separately: a successful final build
   does not establish initialization or request success.

| Generic cell | Ordinary canonical build | Direct Fastly final build | Injected Fastly request |
| --- | --- | --- | --- |
| RS256 alone | Builds | Builds and audits | 200, independently signed identity verified |
| RS256 + HMAC text | Forbidden start | Builds and audits | Traps before the first hostcall |
| RS256 + explicit schema | Forbidden start | Builds and audits | Traps before the first hostcall |
| RS256 + HMAC + schema | Forbidden start | Builds and audits | Traps before the first hostcall |
| Schema cell, existing cache-elision option | Not used as ordinary-build acceptance | Builds and audits | 200, decoded value returned |

The cache-elision comparison holds the schema plan and input fixed. It removes
the disabled 1 MiB arena and makes this direct-provider request pass. The normal
Fastly scalar caches alone reserve 524,292 bytes of integer/character slots;
those slots plus the schema arena already exceed the 1,556,224-byte primary
heap before other allocations. The comparison demonstrates a concrete startup
budget problem, not an absence of other schema size/lifetime risks.

The initializer probes use throwing host/signature stubs and make no request
or cryptographic correctness claim. Moving the generated schema source onto
the existing fixed runtime eliminates `memory.grow` and preserves every frame
sentinel. Moving the MAC source onto it still traps. An additional generated-
source-only probe makes the oversized digest allocation genuinely demand-driven:
initialization then succeeds without touching the signature frame, but requesting
the large digest frame still traps. This is evidence for bounded staging, not a
candidate runtime patch.

## Recommended implementation decision

**Retain the existing fixed 32-page signature memory ABI and forbidden implicit
start policy.** Use explicit initialization and a shared reserved-heap runtime,
then remove eager unused allocations and stage large crypto inputs in bounded
chunks. Do not enlarge memory or rebuild the Rust guest just to accommodate an
unconditionally retained buffer. A simple start-section removal, allocator swap,
or delayed allocation by itself is rejected by the probes above.

This recommendation preserves the byte layout and signature guest ABI. It does
require reviewed changes to the private primary initialization/crypto-source
contracts, build identities and audit evidence. It is not approval to bypass
those boundaries. If the chosen implementation cannot preserve existing input
limits within this layout, return for an explicit memory-contract revision;
do not silently reduce those limits.

| Region | Byte range, end exclusive | Ownership |
| --- | --- | --- |
| Rust stack/scratch | 0–65,536 | Signature guest |
| Stack/static guard | 65,536–131,072 | Reserved |
| Rust static data | 131,072–262,144 | Signature guest |
| Primary static region | 262,144–524,288 | Primary data; explicitly account for its shadow stack |
| Signature invocation frame | 524,288–540,928 | Caller-owned, cleared after scalar capture |
| Primary dynamic heap | 540,928–2,097,152 | 1,556,224 bytes; existing Fastly fixed allocator |

### A. Explicit initialization, before any managed export use

- Generate one private initializer export with an exact `() -> ()` type and
  versioned build metadata. Keep implicit starts forbidden in every input and
  the final module; retain the independent final audit.
- The canonical host must initialize after instantiation and before binding or
  using managed schema/crypto exports, HTTP entry, or event entry. Fastly keeps
  its provider-owned entry wrapper. Initialization is once per instance, not
  once per request or effect; it must not reset suspended or reusable state.
- Guard uninitialized/initializing/initialized/failed states. Reentry and failed
  initialization poison the instance; never retry initialization in that
  instance. Do not invoke provider effects or signature operations during startup.
- Keep the lifecycle owner responsible for discarding failed instances and
  clearing request-owned secrets. Initialization does not grant new host authority.

### B. One allocator implementation and explicit layout evidence

- Move the existing fixed allocator to a provider-neutral runtime-core owner
  and consume that exact source from both primary generators. Do not make the
  compiler depend on the Fastly package or copy two independently drifting
  allocators. Preserve unlinked runtime selection.
- Preserve fixed min/max pages, frame offsets and forbidden growth/bulk-memory
  instructions. Keep allocation, collection, coalescing and exhaustion bounded.
- Extend primary realization/audit evidence to bind the selected runtime source,
  heap bounds, static/shadow-stack bounds and initialization strategy. Static
  segment disjointness alone does not prove dynamic allocation safety.
- Prove allocation/reallocation/collection cannot touch Rust reservations or the
  invocation frame, including exhausted and failed executions. No raw heap reset
  while managed roots or an execution remain live.

### C. Crypto-owned bounded staging, without shrinking accepted input limits

- Make scratch allocation truly demand-driven and selected by reachable crypto
  operations. Preserve constant-time tag comparison, input validation and all
  published byte/text limits. Do not merely remove an export still required by
  the host binder.
- Replace the single large digest staging allocation on linked artifacts with a
  versioned private init/update/final bridge using bounded chunks (at most the
  existing 65,536-byte staging capacity). Crypto owns hashing and state; the
  host binder stages bytes within the existing effect invocation. No extra Pulse
  effects, ambient crypto fallback, or secret-authority transfer is introduced.
- Bind scratch and incremental state to the owning instance/invocation. Wipe
  state, key material and temporary input/output on success, failure and
  cancellation; copy the final result before release. Do not reuse failed state.
- Version the private contribution/binder contract and invalidate affected build
  caches coherently. Retain unlinked compatibility and qualify advertised maxima,
  including 2 MiB digest input, independently from small HMAC smoke cases.

### D. Disabled schema cache and recipe identity

- For linked schema artifacts, select the existing exact-source,
  fail-closed json-as cache-elision transform when the cache is disabled. Keep
  its pinned-source/AST checks; never patch installed dependency files.
- If selected, record this linked-only recipe in artifact/cache identity and
  qualification. Preserve enabled-cache semantics and unlinked defaults. Confirm
  valid/invalid schema behavior with and without the transform; do not make the
  memory plan depend on a user remembering an undocumented optimization flag.

## Owners and implementation order

| Work | Owners |
| --- | --- |
| Primary initializer and recipe | `wasm/packages/compiler/src/canonical-native-compiler.js`, runtime-core generation, canonical host lifecycle |
| Shared runtime and layout evidence | runtime-core, guest-link contracts/pipeline, Fastly build owner |
| Scratch and bounded crypto staging | `packages/crypto/as/pulse-hmac-as.ts`, `pulsewasm.native.cjs`, crypto source contract and host binder |
| Pinned schema recipe | build-support cache transform, primary/provider build recipes |
| Qualification | JWT-02 installed matrix, generic composed consumer, existing crypto/schema/guest-link adversarial suites |

JWT-02.2 should implement A–D as separately reviewable changes, keeping blocked
cells explicit until the applicable contracts and execution checks pass.
JWT-02.3 then owns exact installed Node/Fastly Native acceptance, all original
ES256/RS256 crypto/S3 cells, the independent schema cell, the combined artifact,
and the generic composed consumer. Include ordinary build paths, not just direct
provider calls; repeated lifecycle, init failure/reentry, frame canaries,
allocator exhaustion, input limits, invalid signatures/schemas, cancellation,
secret cleanup and deterministic artifacts all remain required.

No consumer version migration, application-specific qualification, new syntax,
new algorithm, selector relaxation, publication or deployment is part of this
checkpoint. Downstream records and proofs stay outside Pulse.
