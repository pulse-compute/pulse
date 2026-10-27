# P08 — Bounded cache contract and Fastly Native adapter

Status: **draft implementation; blocked on incomplete-body host qualification**.
P08 is not complete or approved for production. The independent injected-host
suite passes, but pinned Viceroy can turn an abandoned entry into a successful
empty hit. The reproducible blocker below must be resolved before promotion.
Base: merged P07 #554, `534acd58fb8afaeb7cb33cf4cb03866698668816` on `latest`.
Human direction: “Implement P08.” Entry point: `provider-fastly`. Additional
owners are the private cache package and lowerer, canonical provider capability
vocabulary, maintained test registry/evidence mapping and this decision record.
The workspace lockfile change also regenerates the two context manifests using
their pinned Node 24.18.0 producer. No published package set is changed.

## Operation and exposure decision

`packages/cache` contains the private `@pulse-compute/cache` adoption candidate.
It is a real package-owned lowerer and facade, independently packable and usable
through the existing canonical project/compiler/provider pipeline. It is marked
`private`, uses `0.0.0-private`, and is outside the release manifest. This keeps
public package admission behind review and P13/P14; a resolvable package is not
a support promise. Its JavaScript facade throws `PULSE_CACHE_TARGET_UNSUPPORTED`.
The Node provider does not advertise the capability. There is no fallback.

| Operation | Inputs admitted in P08 | Successful result |
| --- | --- | --- |
| `cache.getText(ctx, key, {maxBytes})` | Literal valid Unicode key, 1–4096 UTF-8 bytes; literal bound 1–1,048,576 bytes | `{status: 'found', text}` after bounded valid UTF-8, EOF and successful reader/lookup disposal; otherwise `{status: 'miss'}` only for a ready, non-usable lookup |
| `cache.putText(ctx, key, text, {ttlMs})` | Same key; literal valid Unicode text, 0–1,048,576 UTF-8 bytes; literal TTL 1–86,400,000 ms | `{status: 'stored'}` only after all writes and successful writer completion under the original deadline |

Calls are awaited into a local or used as direct keyed `ctx.parallel` members.
One plain handler may perform sequential cache operations and mixed read/write
cache groups, up to the existing group width 32 and 64 static sites. The entire
canonical control tree must prove each site is visited at most once. The provider
independently validates package identity, literal payloads and bounds after
lowering. A finite original Fastly request duration is mandatory.

Unsupported shapes fail compilation: dynamic key/text/options, repeated sites,
loops, helpers/stages, Router placement, collections, application-owned emitters,
callables, mixed non-cache effects and child graphs. These are explicit P08
limits, not silent paths without accounting. P06 owns compiler-proved cache →
fetch → insert composition; P10 owns wider placements, P09B other targets.
There is no loader callback, transaction, revalidation, range, streaming result,
metadata API, purge, retry or automatic miss-to-insert operation in this facade.

## Failure and host contract

The initial implementation adopts P01's conservative policy without modification.
A read failure, including an incomplete entry whose state says FOUND/USABLE,
fails the invocation. It is never reinterpreted as a miss. A stale but usable
entry may be read; a non-usable entry is a policy miss. Unknown state bits and
USABLE without FOUND fail closed. Only core-cache v1 state bits are admitted.

| Boundary | Required transition | Failure or uncertainty |
| --- | --- | --- |
| Lookup / insert / body acquisition | Preregister the exact namespace/slot before the call; zero is a valid handle | Failed acquisition retains its claim even if an output was written; invalid-handle sentinel on success also fails closed |
| Lookup readiness | Existing driver waits under the original deadline before state inspection | Cleanup makes at most one nonblocking readiness probe; never closes an unready/uncertain lookup |
| Read body | One buffer of `B+1` bytes; progressing bounded reads through EOF; strict UTF-8 | Oversize, malformed counts, invalid UTF-8 and incomplete/read errors remain failures; known reader and ready lookup are disposed independently |
| Read close | Body close, then ready cache close | Each attempt is fenced before entry; failure stays charged and is never retried or reported as a hit |
| Write | Original-deadline readiness waits and positive bounded partial writes | Known unfinished writer is abandoned during cleanup; cleanup never commits |
| Commit | Explicit writer close after all bytes and readiness | A failed commit is unknown; never retry it or follow it with abandon |
| Invocation closure | Existing driver invalidates tickets; service cleans known resources once | Trap has no promised guest finalizer. Late readiness never reopens delivery or cleanup |
| Error delivery | Separate reserved response/body and bounded text, under original time and existing HTTP authority | No new grace deadline or guaranteed post-deadline 504; uncertain downstream send is not retried |

A successful write is not atomic with handler success. An earlier commit remains
committed after a later sibling error or request deadline. Abandoning a writer
may leave a found/usable entry with a failing body. No rollback, global durability,
client delivery, host reclamation or cancellation promise follows from disposal.

These rules adapt the pinned RA-06 and RA-10 evidence cited by P00/P01; no research
source is fetched or imported by maintained build/test/pack paths. Official
[Fastly core-cache documentation](https://www.fastly.com/documentation/reference/compute/sdks/rust/fastly/cache/core/struct.Found/)
provides state/stream context; current-candidate local observations and injected
faults are separately identified. Hosted qualification remains P13.

## Derived resource inventory

Let `R` be selected reads, `W` writes and `N = R + W`. Each read owns one lookup
and one body slot; each write owns one writer slot. Two additional slots protect
execution exit. Slots are assigned by the canonical static site inventory, never
recycled, and coupled to the existing execution-owned tickets. No second effect
counter, scheduler, module registry or new author-controlled budget is added.

- Handles: `2R + W + 2`.
- Records: handles + 5 (scratch, encodings, readers, exit bytes and metadata).
- Protected cleanup steps: `3R + W`; exit steps: 2.
- Reserved effects: `N`, checked against the existing driver admission.
- Ledger storage bound: `1024 + 128 * records`.
- Service scratch backing: `256 + 16 + N` bytes (fixed ABI area, clock/wait
  outputs and per-site readiness flags).
- Encoding backing: sum of UTF-8 key bytes and written UTF-8 text bytes, each
  encoded once. Literal source strings are application values.
- Reader backing: sum of `3B + 1` per read, covering `B+1` bytes and at most `2B`
  UTF-16 decode bytes. No repeated chunk decoding or prefix concatenation.
- Exit backing allowance: 64 bytes. The ABI scratch area is shared serially by
  the existing driver; no suspended host call borrows its contents.

P05 independently computes and checks every dimension before generation. P04
stages and atomically commits the entire invocation inventory before the first
cache host acquisition or dynamic key/text encoding. Fixed module bootstrap
storage and the ledger itself are distinct from operation payload allocations.
All backing reservations remain charged through teardown, even after logical
handles retire. Result value objects, application values, incoming context,
driver identity storage, successful response construction/serialization,
allocator metadata, engine pages and host memory are excluded explicitly.
This is not total invocation memory or a platform capacity guarantee.

## Qualification and stopping point

### Blocking local-engine observation

Viceroy 0.21.1 (binary SHA-256
`881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9`,
source revision `ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f`) passes ordinary
reads/writes, Unicode, empty/exact bodies, oversize/invalid UTF-8 rejection and
32-wide groups. However, after the fixture abandons a writer, the production
reader returns HTTP 200 (on both the seeding and subsequent request) with `{status: 'found', text: ''}` instead of failing. A subsequent request after writer trap has the same defect.
The injected host delivers the body error to `read`, so its passing case does
not qualify this actual-engine behavior.

At that revision, [`Body::await_ready`](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/body.rs)
matches only `Some(Ok(chunk))` from `self.data().await`. A pending error is
consumed by readiness, then the following `body.read` sees EOF. The adapter must
wait under the original deadline; removing that wait permits a blocking read.
Cache length is not a completion proof: an unfinished writer may supply an
expected length. Neither is an acceptable workaround. The historical direct
read probe did not cover this intervening readiness call.

Reproduce without modifying the reader or changing the failing expectation:

```bash
node wasm/test/provider/assert-fastly-cache.cjs --artifacts-dir /tmp/pulse-cache-artifacts
node wasm/test/provider/assert-fastly-cache-wire.cjs --artifacts-dir /tmp/pulse-cache-artifacts --viceroy /path/to/viceroy
```

The second command records all outcomes and exits nonzero on a contract
violation. A passing mock run or ordinary wire roundtrip cannot clear this
blocker. Resolution requires a host that preserves read errors through
readiness, exact-artifact replay of abandon and trap cases, and human review.
Production behavior has not been inferred from the Viceroy defect.

`fastly-cache` is the maintained Native task. It compiles authored package calls
through the production compiler and executes the emitted Wasm with an independent
ABI authority. Coverage includes incomplete entries, Unicode/empty/exact/oversize
bodies, invalid counts/state/handles, partial I/O, acquisition with and without
host outputs, commit/close/abandon uncertainty, one-shot cleanup readiness, traps,
zero handles, widths 1/8/16/32, sibling failures and original-deadline fences.
Each one-short resource dimension is denied by the independent P05 calculator.
The maintained P04 task supplies compiled kernel shortage/exhaustion coverage.

Plain and lifecycle-observed service artifacts have matching responses and host
traces. Read-only artifacts omit insertion/abandon; write-only artifacts omit
lookup/state/body retrieval. Imported-unused code has no cache imports or ledger
and no size growth; its one embedded canonical plan hash changes with source
identity, and comparison normalizes only that independently identified field.
Matched unchanged-source controls must retain their exact base bytes.

The test-only `cache-wire-fixture.cjs` seeds complete or incomplete entries through
the trusted lifecycle seam before service admission. Its setup operations are
explicitly outside the cache service's accounting claim. It exercises the actual
production reader and permits exact installed-artifact local-engine replay;
it is not a production fault switch or an application hook API.

The PR records terminal complete-run coverage, source/tree identities, packed
consumer checks, exact artifact hashes and pinned Viceroy results. Development
failures are retained separately. This provider regression selection is not a
release seal. P06 composition, P09B parity, P10 broad placements, P11B costs,
P12B reporting and P13/P14 host/public promotion remain separate units.
