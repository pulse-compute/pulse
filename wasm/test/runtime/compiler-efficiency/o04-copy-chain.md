# O-04 — Select the unescaped JSON string staging copy

**Proceed with O-05 on `__PulseJsonParser.string()` in
`packages/provider-fastly/src/build/native-platform-capabilities.js`.** Limit
the first change to unescaped string tokens: after the existing bounded scan
and control-character validation, copy the source span directly into an owned
string. Keep the current escaped-string decoder as the fallback.

This is an evidence decision, not an implemented optimization. Entry point:
none, ordinary root/Wasm evidence chain. Additional owners are the test registry
and suite-shape exclusion list. The provider and schema sources were read only.
Base is `latest` at `254e89f222892a66c46c24285302953f1f536780`.

After O-05, `copy-chain-o04` remains a historical replay: it loads the original
provider owner from O-04's merge `5bdc28aafab76c87abea4320154768e6277fbea9`
and uses the checkout's other dependencies. Git history containing that commit
is required. Reports record both the checkout hashes and the baseline owner
hash; the checked-in O-04 evidence remains unchanged.

## Trace from O-02 to the owner

The O-02 fixture performs bounded S3 reads, verifies the digest, and explicitly
decodes each page. The relevant call path is:

1. `host_schema_decode` parses the original text with `__PulseJsonParser`.
2. `__pulse_fastly_schema_apply` projects into fresh containers, serializes,
   invokes the portable codec, then reparses its normalized text.
3. `host_schema_decode` deeply freezes the resulting graph.

Both parses use `__PulseJsonParser.string()`. It allocates a `Uint16Array` sized
to the source token, fills it with decoded UTF-16 units, and calls
`String.UTF16.decodeUnsafe` to allocate and copy the owned result. The typed
array and its backing allocation stay local to that call. The returned string
is stored in the value table; no view into the scratch array is returned.

The new trace reproduces O-02's production source and Wasm hashes exactly:
`5faee9ca4a9955dbe0dfe9141c92fe0addd468648f4f5b4f80125a272ba44c8c` and
`fa695a33be62922960d5179ed17e9429c46a0c895ed239613c1c0a28277a1c26`.
The ordinary compiler control is byte identical to production. Allocator-only
and staged builds agree exactly on cumulative allocation, peak, collection
events, terminal allocation and post-collection allocation for all four cases.
Production, allocator-only and staged runs also agree on response, complete
hostcall trace hash, outbound count, and cumulative byte/value charges.

## Attribution

Bytes include allocator alignment and headers. Decode allocation is measured
from immediately before the first parse through the final deep freeze; the
earlier input/type/UTF-8-size checks are outside that interval.

| 4 KiB pages | Decode allocation | Parser scratch, both parses | Whole invocation allocation |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 3,914,656 |
| 1 | 87,248 | 16,896 | 4,166,416 |
| 16 | 1,253,408 | 270,336 | 7,775,648 |
| 64 | 5,001,536 | 1,081,344 | 19,327,168 |

At 64 pages there are 640 completed parser-string calls: five keys/values per
page, parsed twice. All those tokens are unescaped in this fixture. The scratch
allocation is **21.6% of decode allocation and 5.6% of whole-invocation
allocation**. These are candidate upper bounds, not measured savings.
Owned result strings still need storage, and changing code can affect GC and
other allocations. Post-collection retention need not improve because this
proposal preserves the same returned roots.

The O-02 schema-entry interval decomposes as follows at 64 pages:

| Stage | Allocated bytes |
| --- | ---: |
| Fresh projection | 38,912 |
| Provider serialization | 1,614,848 |
| Portable codec | 1,063,872 |
| Reparse normalized text | 1,150,432 |
| **Total inside schema apply** | **3,868,064** |

Provider quoting contributes another 541,712 bytes of temporary UTF-16 scratch
inside serialization. Parser scratch across the two parses is about twice that
amount and has a simple no-escape case with an existing owned-string operation.
Do not add these primitive counts to their containing stages. This selection
does not claim a census of every temporary allocation: S3 header/body buffers,
crypto and codec internals remain separate candidates.

Removing the entire normalized-text reparse would affect graph identity,
normalization and charged handles; it is not selected. MEM03 already removes
an eligible explicit-encode materialization. MEM11/MEM12 address the separate
conditional-KV reader/encoder. This proposal targets the shared provider parser
still exercised by O-02.

## Minimal generic reproducer

The harness exports a test-only call to the **unchanged production parser** from
a temporary module. It passes JSON string tokens directly, without executing
the HTTP application or dispatching effects. Eighteen cases cover empty/small,
4 KiB and 59,000-character ASCII, all short escapes, explicit Unicode escapes,
BMP/non-BMP text, lone surrogates, dense escaping, and malformed/trailing tokens.
Success cases check exact UTF-16 output after mutating the test-owned input and
forcing collection. Rejections assert JSON error 1004 at stage 3. The same cases
and cumulative allocation match a module without stage callbacks.

| Token | Parse allocation | Temporary scratch | Owned result allocation |
| --- | ---: | ---: | ---: |
| 4,096 ASCII characters | 16,624 | 8,256 | 8,224 |
| 59,000 ASCII characters | 236,240 | 118,064 | 118,032 |
| 4,096 escaped newlines | 24,816 | 16,448 | 8,224 |

The escaped-newline case is a fallback control, not part of the proposed first
optimization. Direct invocation bypasses schema/body admission, so it creates
no new public input limit or acceptance promise.

## O-05 implementation contract and O-06 gate

- Change only the owning generated parser method. Retain its escaped fallback,
  closing-quote scan, parser index, raw-control rejection, trailing-token checks,
  and failure category/stage. An unescaped string containing a control character
  must not become accepted by returning early.
- Keep returned strings independently owned, scalar/value-handle construction
  and caching unchanged, and object/array identity distinct. Preserve deep
  freezing, projection order, duplicate-key rules and codec normalization.
- Preserve effect order, suspension/resumption roots, cumulative policy charges
  and terminal budget failure behavior. Do not add a shared mutable scratch
  buffer or change allocator/optimizer settings.
- O-05 must compare baseline/candidate exact outputs and errors across this
  corpus, schema fixtures, parser consumers (including conditional KV), carried
  aliases and request isolation. Include byte bounds, failure before a following
  effect, and escape fallback controls.
- Lock the primary metric now: cumulative allocation in the measured
  parse-through-freeze decode interval for the 64-page O-02 fixture. Require at
  least **10% reduction** and exact semantic/charge/trace parity. Report whole
  invocation allocation, peak, retained estimate, pages, host RSS and Wasm size
  independently; no whole-invocation 10% claim is implied.
- O-06 uses at least three independent builds per mode and five serial,
  alternating fresh request processes per mode. Require no more than 5% median
  runtime regression beyond noise in the same harness. Stop or narrow the
  candidate if identity, error, charge, fallback or performance checks fail.

## Reproduce and evidence identity

```sh
node wasm/scripts/run-wasm-tests.cjs --task copy-chain-o04 --report .test-results/o04-selection.json
```

The opt-in task has a 300-second timeout and is excluded from the release
profile. It writes `wasm/.test-results/compiler-efficiency/o04/measurements.json`.
The [preserved report](./o04-evidence.json) records the exact base, dirty evidence
files, harness/owner/fixture/lockfile hashes, artifacts, all cases and limits.
It is one baseline attribution run, not the repeated candidate qualification.
The terminal registered task passed in 28.59 seconds; 4 integration cases and
18 parser cases completed. Earlier exploratory runs informed the checkpoint
layout; this registered run backs the recorded decision.

Dependencies were restored from the pinned lockfile with lifecycle scripts
disabled. pnpm reported `ERR_PNPM_IGNORED_BUILDS` for esbuild; the installed
dependencies supported the successful workspace TypeScript build and this run.
The PR records maintenance, unit, documentation and CI results separately.

Evidence is limited to the injected Fastly ABI host and pinned incremental
AssemblyScript runtime. Capacity is reserved memory; post-collection allocation
is a diagnostic retained estimate. No production memory saving, Node guest
result, Viceroy result, deployed latency or release acceptance is claimed.
