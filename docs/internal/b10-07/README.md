# B10-07 — portable binary resource mapping

Issue [#380](https://github.com/pulse-compute/pulse/issues/380), target `latest`.
Investigation baseline `f393e238a529212c8e8217a4ccd41d1646fd4f6b` includes B10-06.
This is a **proposed contract and private executable proof**, not a shipped API.
Production implementation belongs to [B10-08 #381](https://github.com/pulse-compute/pulse/issues/381).
No compiler, runtime, provider, package export or release setting changes here.

**Result:** 28 private contract/proof cases and 72 fresh-process memory samples
passed. The existing four Assets runtime/lowering/Native tasks also passed.
The recommendation is raw embedding; the local Fastly-server check has no
terminal receipt, and deployed qualification is not claimed.

## Recommendation

Start with **declared, immutable, embedded resources and bounded scalar reads**.
Reuse the existing embedded Assets manifest for byte admission and content
identity; add a small core mapping contract for application access. Emit decoded
raw bytes into Native data segments instead of retaining base64 as guest strings.
On JavaScript, decode and verify a private immutable backing store during
application initialization. Map only execution-owned opaque views to handlers.

Keep the first slice to `byteLength`, `readU8`, `readU32LE` and `readF32LE`.
These are generic binary parsing primitives. They are sufficient for a small
vector input and arbitrary binary headers/payload inspection without teaching the
compiler a search algorithm, arbitrary typed arrays, pointer arithmetic or mmap.
Ordinary bounded application/library loops own vector scoring and selection.

Do not implement packaged runtime files, remote fetch, host-supplied resource
bindings, writable buffers, slice materialization or a new public package in
B10-08. They have different availability, ownership and transport costs and can
be added behind explicit realizations later. None should silently replace an
unavailable embedded resource.

## Existing mechanisms and the actual gap

| Existing owner | Established behavior | Implication |
| --- | --- | --- |
| `packages/assets/src/embedded.ts` | Explicit input-byte snapshots, canonical base64, SHA-256, deterministic manifest identity, full admission and copy-on-response | Reuse its build-time manifest constructor; no new directory scanner or remote loader |
| `wasm/packages/contracts/src/assets/embedded.js` | Canonical serialized-manifest admission, all-file integrity/bounds validation, selected-entry metadata | Share this authority; do not weaken unselected-file validation or reinterpret HTTP paths as arbitrary filesystem paths |
| Assets package lowerer and `embedded.as.ts` | Selected embedded blob becomes an opaque HTTP response, including range/ETag handling | Existing transport does not expose application-readable bytes; adapting HTTP range lookups into scalar reads would be the wrong abstraction |
| Native value/handler contracts | Managed scalar/JSON handles; existing binary response ownership; older binary-buffer guest ABI remains reserved | `value_binary` is the binary-expression operator, not a public byte-buffer interface. A new bounded view contract must be declared and versioned |
| Package-owned lowerers/guest units | Trusted, explicitly admitted build dependencies | Keep existing trust and reachability rules. Mapping must not grant arbitrary Wasm memory or package discovery authority |
| Report resource producers | Selected embedded asset identities, sizes and producer coverage; partial inventory is explicit | Extend current producers and attribution, not a second report inventory |

Sources: [Assets contract](../../packages/assets.md#native-embedded-blobs-ast-02d),
[current architecture](../../architecture/current-contracts.md#ast-02d-native-embedded-assets),
and the source owners above. Existing asset response behavior remains unchanged.

## Proposed declaration and authoring

Illustrative configuration (requires B10-08; not accepted today):

```ts
// The manifest is produced by the existing createEmbeddedManifest build helper.
// Serialized canonical manifest bytes are resolved during the ordinary build.
pulse: {
  binaryResources: {
    manifest: serializedEmbeddedManifest,
    bindings: { vectors: '/vector.bin', payload: '/payload.bin' },
  },
}
```

```ts
const vectors = ctx.resources.map('vectors')
const dimensions = vectors.readU32LE(8)
const firstCoordinate = vectors.readF32LE(16)
```

Proposed view shape (not an exported type in this PR):

```ts
interface BinaryResourceView {
  readonly byteLength: number
  readU8(byteOffset: number): number
  readU32LE(byteOffset: number): number
  readF32LE(byteOffset: number): number
}
```

`map` and scalar reads are synchronous local operations over already admitted
bytes. They do not dispatch an external effect or suspend the continuation.
They remain observable to resource accounting and cannot be memoized or hoisted
across execution lifetime/budget checks. Future loading from a host or network
must use separately declared asynchronous admission; it must not hide I/O in map.

`ctx.resources` belongs to core execution context because a handler needs the
same local bounded access on all applicable targets. Assets continues to own the
existing manifest builder and HTTP asset facade. B10-08 must make this ownership
explicit in current contracts; it should not add a separate resource package or
allow arbitrary `DataView` construction in canonical source.

## Portable contract

| Concern | Proposed first-slice rule |
| --- | --- |
| Logical name | Literal ASCII ID matching `[a-z][a-z0-9.-]{0,63}`; unique per application. A name is not a URL, filesystem path or host pointer |
| Declaration | One canonical embedded manifest and a bounded ID-to-manifest-path binding table; validate every manifest record before selecting reachable bindings |
| Identity | Preserve manifest v1 identity, per-file SHA-256 and exact decoded length. Catalogue identity is SHA-256 over a versioned, ID-sorted tuple of logical ID, path, length, content hash and manifest identity. Reordering declarations changes nothing; renaming, rebinding or changing bytes changes identity |
| Integrity | Checksums detect corruption and mismatch, not publisher authenticity. Candidate/package/artifact authority stays with the existing build and release contracts |
| Bounds | Reuse 256 records, 256 KiB/file, 1 MiB aggregate decoded manifest bytes, 2 MiB serialized manifest and existing path/media-type limits. At most 256 logical bindings. Count unique backing bytes once, track alias/consumer counts separately |
| Build ownership | Build scripts may supply explicit bytes through existing manifest construction. B10-08 adds no implicit filesystem traversal, network fetch or directory scan. The normal build snapshots the validated manifest and embeds selected bytes; source files are not needed at invocation |
| Reachability | Every mapped logical ID is literal and declared. Include reachable bindings only; deduplicate equal immutable backing blobs by content identity and length inside the same artifact. Record unused declarations honestly |
| Availability | Embedded resources are present before handler entry; missing/corrupt declarations fail build or application initialization, before any application work. No best-effort empty resource, lazy remote fallback or silent truncation |
| Lifetime | Backing bytes may live with an application/module instance. A mapped view is private and execution-owned, valid only during its request/event. Return, cancellation and failure invalidate it; no escaping through JSON, state, globals, closures, another request or serialized continuation payload |
| Mutability | No raw pointer, backing ArrayBuffer, writable view or transferable buffer. Never alias caller-owned mutable input. JS uses private state; Native offsets are compiler-owned and inaccessible through the public view |
| Offset validation | Finite safe-integer byte offset; nonnegative; require `offset <= byteLength` and `width <= byteLength - offset` before conversion/addition. Never validate a wrapped `offset + width`. Scalar widths are 1 or 4 |
| Empty/end boundary | Empty resources are valid. Scalar reads at EOF fail. A future zero-length range may use `(byteLength, 0)`; this is range arithmetic, not a promised slice API |
| Byte order/alignment | U32 and F32 reads are explicitly little-endian and allow unaligned offsets. They never depend on host byte order. `readU8` preserves all byte values, including NUL and invalid UTF-8 |
| Float behavior | Decode IEEE-754 binary32 and return the corresponding JS/Native numeric value. Preserve signed zero; reject NaN/infinity with a deterministic nonfinite-value error. `readU32LE` remains available to inspect arbitrary raw bits |
| Budgets | Charge 1 or 4 bytes per admitted scalar read against a proposed 4 MiB cumulative resource-read budget per execution; no reset by remapping or creating an alias. Budget exhaustion invalidates access. Bound source/loops with existing language rules and preserve inherited deadlines |
| Memory accounting | Reserve unique decoded backing length at application/instance admission, not per alias. Track execution views and any copies separately. Existing host/guest memory policies remain in force; the resource cap does not bound the whole process |
| Composition | Reads must work in existing proven bounded loops and applicable helper/handler paths, with schema validation, middleware and application error handling. Do not widen general loop, callback, Promise or pointer semantics to make a vector example compile |
| Errors | Proposed stable families: declaration, integrity, missing, length, bounds, owner/lifetime, read-limit, unsupported-realization and nonfinite-value. Distinguish build admission from execution failure. Error payloads contain logical ID and bounded numeric metadata, never payload bytes or arbitrary host paths |

The 4 MiB read budget is a conservative proposal, not a measured optimum or a
network/response budget. The private proof enforces it; B10-08 must integrate it
with terminal failure/cancellation and the existing request budget owner.
An implementation may choose internal handles differently from the experiment,
but must preserve ownership, non-escape and failure behavior.

For vector scale, a 256 KiB resource holds at most 65,536 float32 values before
format overhead: roughly 512 vectors of 128 dimensions. The 1 MiB manifest cap
allows a small explicitly partitioned corpus, not an unbounded vector database.
Do not raise these limits silently to fit a larger dataset.

## Realizations and target capability matrix

The columns below distinguish existing product behavior from proposed support.

| Target | Existing embedded HTTP assets | Proposed local mapping | Evidence in this investigation |
| --- | --- | --- | --- |
| Node JavaScript | Supported middleware with private decoded bytes | Admit embedded manifest at initialization, request-owned private scalar view | Executable JS semantic model and memory samples; no public `ctx.resources` or installed application proof |
| Node Native | Supported through Assets lowerer and binary response ownership | Validated raw data segment with managed bounded scalar reads | Actual import-free Wasm, boundary/lifecycle checks, vector oracle and memory samples; direct AS seam, not canonical compiler lowering |
| Fastly JavaScript | Do not infer all middleware support from package imports | Same embedded byte-view contract, provider-neutral initialization | JS model only; actual Fastly JS packaging/execution remains B10-08 acceptance |
| Fastly Native | Supported ordinary build artifact with injected ABI qualification | Same raw mapped bytes plus existing provider HTTP realization | Actual private mapped guest through injected Fastly ABI; production frontend and installed provider integration remain B10-08 work |

| Storage form | Candidate implications | Disposition |
| --- | --- | --- |
| Raw embedded bytes | Artifact grows with payload; data occupies guest linear memory. JS decoding/snapshotting has its own initialization cost. No runtime transport or filesystem dependency | Recommend first |
| Base64 embedded strings | Reuses serialized transport, but representation expansion and decoding are material in a Native guest. Serializing input as base64 does not require keeping base64 in the final artifact | Build input only; decode before Native embedding |
| Packaged sidecar file | Smaller guest, but artifact closure, loader, path containment, availability, exact version and installed-consumer integrity become runtime obligations. Fastly cannot be assumed to have Node's filesystem | Defer; Node harness experiment only |
| Host-supplied immutable snapshot | Small guest artifact; whole-object hash verification and copies add admission and memory costs. Binding authority, retention, missing data and host parity need a separate contract | Defer; explicit capability, never automatic fallback |
| Zero-copy/mmap | Depends on engine/provider realization, lifetime, isolation and memory ownership | No portable promise |

## Executable proof and measurements

Run from the repository with its lockfile-pinned dependencies restored and
`npm run build` completed:

```sh
node docs/internal/b10-07/proof.cjs
```

The script emits a result path under `wasm/.test-results/b10-07-*`, retaining
generated `vector.bin`, generic binary payloads, manifests, guest sources,
Wasm artifacts and raw memory samples. `model.cjs` is a private semantic model;
`guest.as.ts` is compiled directly with the repository's AssemblyScript toolchain.
Neither is a supported public implementation or a substitute for B10-08's
canonical source, installed-package or composed-provider acceptance.

The vector fixture has a 16-byte header (`PVB1`, little-endian row count,
dimension count and payload length), followed by 32 rows × 8 float32 values.
A fixture-owned squared-distance loop must select row 7, and all 32 scores
must agree with an independently computed mathematical oracle. The generic
fixture preserves NUL, high-bit and invalid UTF-8 bytes without text decoding.
Seeded high-entropy payloads drive the 0/16/64/256 KiB size sweep.

Six representations run in three fresh processes at each size (72 samples):
Native raw/base64/host-copy and JavaScript embedded/packaged/host-supplied.
Native samples check exact checksums and unchanged guest capacity after 100,000
additional reads. Read-only scalar access must not allocate per read. Packaged
and host-supplied JS samples intentionally use the same ownership path, with
different provenance; their timings would not establish different I/O behavior.

The report separates artifact bytes, gzip bytes, guest memory capacity, host-owned
bytes, before/loaded/retained process memory and process peak RSS. `--expose-gc`
is used only for sample comparability; no GC or RSS guarantee follows. Inputs and
artifacts remain retained deliberately, so host snapshots and guest copies are
visible. Guest capacity is allocated linear-memory bytes, not resident pages.
RSS includes the JS engine, compiler/runtime loading and buffers; subtracting a
baseline median is descriptive, not an isolated resource allocation measurement.

See [measurements](MEASUREMENTS.md) and [raw results](results.json) for the exact
recorded candidate, toolchain, proof hashes, samples and limitations.

An optional `--fastly-reality` path uses the existing local Compute launcher and
a bodyless loopback request. It deploys nothing. The hosted production capability
is not established by that optional test; inspect the recorded status, not the
presence of the command. During this investigation automatic approval review
blocked observing that local launcher, interpreting it as possible third-party
payload disclosure. The run did not produce a terminal reality receipt. The
recorded passing result uses injected Fastly ABI execution instead; local server
and deployed Fastly qualification remain explicitly unclaimed.

## Report and build metadata

Extend existing resource producers with versioned records for logical ID,
catalogue/content identity, decoded byte length, declared limit, realization,
availability phase and consumers. Keep source transport bytes, physical artifact
contribution and runtime backing bytes separate. Alias and multiple-consumer
records must not multiply physical bytes; equal source bytes alone do not prove
deduplication. Unknown physical mapping stays unavailable, not zero.

Expose declared/selected/embedded/unused counts and producer completeness.
Report finite read-budget configuration; observed read counts are optional runtime
telemetry, not a compiler estimate. Never include binary content, base64, absolute
source paths or host binding values. This embedded contract is not a secret store;
its bytes ship in the application. Resource hashes identify declared build inputs,
not authenticity or confidentiality guarantees.

## B10-08 implementation owner map and gates

| Owner | Bounded implementation responsibility |
| --- | --- |
| Assets manifest builder and `wasm-contracts/assets/embedded.js` | Reuse canonical byte admission and limits; factor shared validation only if necessary, preserving existing HTTP semantics |
| Core contracts and project configuration | Versioned resource catalogue, literal bindings, normalized identity and explicit target requirement; public configuration/types/diagnostics |
| Runtime context and lifecycle owners | Private JS backing, execution-branded views, bounds/endian/float checks, read budget, cancellation and non-escape |
| Compiler spine and Native plan validator | Recognize only declared literal mapping and bounded scalar reads; verify ownership/provenance independently, diagnose unsupported uses, preserve proven loops and helpers |
| Runtime-core Native generator | Reachable raw data emission, deduplication, checked reads and accounting; no raw pointer or general byte-buffer fallback |
| Node/Fastly providers | Applicable initialization/memory limits and execution lifetime; explicit unsupported targets/realizations, real provider fixtures |
| Existing build/package and installed acceptance | Complete immutable resource closure, hash verification, deterministic independent builds, missing/corrupt/truncated files and source deletion after build |
| Report producers and CLI | Identity/size/realization visibility, physical attribution and completeness, no payload disclosure |

Required acceptance extends this proof: canonical source execution on every
claimed target; zero/last/unaligned/overflow reads; corrupt and unselected records;
wrong identity; repeated aliases; stale/foreign/forged/escaped views; repeated
maps without budget refunds; timeout/cancellation before and during computation;
composition with schemas/middleware/error handling; independent installed
consumer; deterministic artifacts; unused-resource elimination and no-resource
artifact overhead. Confirm only the intended new capability/version is admitted.

## Decisions and residual risks

- Recommend the embedded realization and limits above for B10-08. Public naming
  (`pulse.binaryResources` / `ctx.resources`) and exact diagnostic suffixes remain
  review decisions; the substantive ownership/bounds contract is concrete.
- The proof shows byte access and representation economics, not canonical
  frontend integration. B10-08 must prove view affinity and bounded loop/helper
  composition without widening arbitrary TypeScript support. If that needs a
  general byte-value ABI, stop and split that architectural decision.
- Local checksums do not authenticate an untrusted host. External loading,
  runtime replacement, signatures or stronger isolation are outside this slice.
- The Native proof's numeric generation handle is instance-local. The production
  adapter must enforce cross-instance ownership and never expose it as a user-
  forgeable integer. The JS model's private view test is not proof of that adapter.
- Snapshots and per-instance data can multiply under concurrent requests/isolates.
  A 1 MiB declaration limit is not a process/cgroup/POP memory guarantee. Measure
  real provider concurrency before raising limits or promising sharing.
- Human review of this proposal authorizes the B10-08 contract selection. This
  evidence PR neither implements that feature nor authorizes merge or release.
