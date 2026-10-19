# B10-08 — binary resource implementation

Parent [#381](https://github.com/pulse-compute/pulse/issues/381), target `latest`.
The reviewed [B10-07 contract](../b10-07/README.md) treats embedding as intentional
data hoisting, with application-configured admission budgets and no fixed
cumulative read-byte quota.

## Implementation boundaries

Inspection of the existing owners demonstrated three independently reviewable
changes, as required by the parent issue's split rule:

| Slice | Owner and outcome | Status |
| --- | --- | --- |
| [08A #410](https://github.com/pulse-compute/pulse/issues/410) | Internal build admission, manifest integrity, immutable catalogue and deterministic identity | Merged in #413 |
| [08B #411](https://github.com/pulse-compute/pulse/issues/411) | Public configuration, JS views, Native plan/value contract, raw emission and execution limits | Implemented; evidence below |
| [08C #412](https://github.com/pulse-compute/pulse/issues/412) | Real MCP fixture, installed/package closure, provider receipts, reports and canonical docs | Pending |

The parent remains open until all three slices are qualified.

## 08A contract

`wasm/packages/contracts/src/resources/embedded.js` is an **internal build-time
module**, without a public package export, CLI option or `ctx.resources` API.
Its input is explicit bytes; it performs no filesystem or network discovery.

- `createResourceManifest(inputs, budgets)` snapshots explicit `Uint8Array`
  inputs into the existing embedded-manifest v1 wire shape. Paths, media types,
  base64, SHA-256 and manifest identity retain existing semantics. Numeric size
  checks and exact serialized-size accounting precede private byte/base64
  allocation. Source metadata and bytes are not retained as mutable aliases.
- `admitResourceCatalogue(serialized, declarations, budgets)` validates every
  manifest record, including unselected records, then resolves unique literal
  logical IDs. It produces a deeply frozen `pulse.binary-resource-catalogue.v1`
  with immutable encoded blobs, sorted logical records and deterministic identity.
  Equal content hashes and lengths share one backing record within the catalogue.
- `resourceCatalogueSummary(catalogue)` accepts only a catalogue admitted by this
  module instance and returns explicit metadata. Payloads and manifest paths are
  excluded. This is preparation for report integration, not a shipped report tab.
  Serialized catalogues must be admitted again before being trusted.

All five budgets are explicit nonnegative safe integers: `fileBytes`, `totalBytes`,
`serializedBytes`, `files`, and `bindings`. There is no default inherited from
HTTP Assets, no read-byte quota, and no claim that a selected budget is a host
memory guarantee. Zero permits empty sets/resources subject to serialized framing
size. Application/host defaults and target caps remain 08B/08C work.

Manifest admission counts all declared decoded bytes, including equal content
under different paths, to bound preparation. `backingBytes` counts selected unique
content once; logical binding and source record counts remain separate. Catalogue
identity includes the complete manifest identity and sorted logical mappings.
Changing unselected bytes still changes source authority; alias order does not.
Admission budgets are configuration metadata, not content identity.

The integrity parser was extracted to `assets/embedded-manifest.js`. The existing
HTTP Assets caller still supplies exactly its previous fixed limits and failure
message. The public Assets constructor, response policy, package exports and
Native HTTP guest are unchanged. A resource budget cannot relax HTTP Assets.

## Evidence and reproduction

Base: `9b6b279ef41a161e80241141158adaff477dc822`, the merged B10-07 proposal.
These are focused development checks, not a release seal.

```sh
npm run build
node wasm/scripts/run-wasm-tests.cjs --task binary-resource-admission \
  --task assets-native-embedded --task assets-javascript-runtime \
  --task assets-lowering-plan --task assets-package-owned-lowering --no-report
```

The registered admission task covers eleven named groups: generated inputs at
0/1/256 KiB/256 KiB+1/768 KiB/1 MiB/1 MiB+1/2 MiB, independently constructed
identity, agreement with the existing Assets builder, mutation isolation, all
budget boundaries, alias accounting, corrupt/unselected records, ambiguous
declarations, precise escaped/UTF-8 serialization accounting and summary privacy.
HTTP Assets rejects larger inputs even when resource admission accepts them.
The task is included in the unit profile and therefore the release selection.

These generated inputs are **not the actual MCP `vector.bin`**. It was not found
in the current Pulse checkout or the scoped GitHub search. The operator's rough
700 KiB–1 MiB recollection is not a measured fixture size. 08C must locate it,
record exact provenance/hash/size and qualify its real access pattern and growth
headroom. No read throughput, raw resource guest, new host support or installed
resource acceptance is claimed by 08A.

## 08B execution contract and evidence

Base: `1f53a7fc06ab946ece2926b8a23127382a823c5c` (`latest`, merged 08A).
The operator approved proceeding with 08B. Protected scope includes the public
API/configuration, Native expression and optional host ABI, runtime lifecycle,
provider realization and package/export transport. Human review/merge remains
required. No deployment or release authority is exercised.

The configured manifest is explicit serialized data in the static project
configuration; arbitrary build-time calls, directory scanning and runtime I/O
are not added. JavaScript stores private snapshots once and caches views within
one execution. Native resolves views lexically, validates serialized catalogue
bytes again, and emits raw data in little-endian u64 words (up to seven padding
bytes), then performs checked unaligned scalar loads. No new pointer or buffer
value can escape into state, effects or continuations. Per-file Native address
checks use the actual signed-i32 byte-length boundary, not an HTTP payload cap.

The optional ABI functions are `resource_offset_value(i32) -> f64` and
`resource_check(f64, i32, i32) -> i32`. The first strictly extracts a numeric
handle; the second checks lifecycle/deadline, integer/range and subtraction-based
bounds before casting. Failed Fastly checks return a negative sentinel and latch
the existing terminal failure path. Application-error instrumentation preserves
that sentinel. Deadline clock storage is reused, avoiding a fresh clock-buffer
allocation on each synchronous read.

No general loop limit is increased. The compiled proof uses 256×256 bounded
loops, including seventeen sequential scans in one execution (>4 MiB of scalar
reads). Existing numeric-region proof avoids per-read handles for this shape.
Other source shapes retain existing boxing and allocation behavior. A full
1 MiB float32 scan contains 262,144 elements and exceeds one 65,536-iteration
nested loop; actual MCP algorithm/windowing remains an explicit 08C question.

`binary-resource-execution` covers four target realizations, generated nonzero
1 MiB+1 payload, unaligned reads, unsigned range, negative zero, rejected nonfinite
floats, invalid offsets, forged/foreign/stale/serialized views, source escapes,
corrupt plans, zero-byte Native overhead for unused mappings, synchronous Node
and Fastly deadlines, project configuration and source packaging, and composed
schema text codecs/middleware/application-error handlers. Fastly evidence uses
an injected ABI fixture, not Viceroy or a deployed service. The fixture is not
the real MCP `vector.bin`. Package installation and full report work stay in #412.

Reproduce with the registered `binary-resource-execution` task. Full profile and
repository validation results are recorded in the implementing PR; these remain
development evidence, not a release seal.

### Measured development costs

Generated dense pseudo-random input (seed 12345), with known scalar test cells:
1,048,577 decoded bytes. Node Native Wasm is 1,050,020 bytes; Fastly Native Wasm
is 1,079,398 bytes. The original mostly-zero probe was replaced because zero data
elision would have understated ordinary payload growth. The 65,536-read numeric
scan uses at most eight Node host value handles; seventeen sequential scans in
one execution also pass, with at most forty handles. These are shape-specific
allocation checks, not a general throughput or vector-search forecast.

Native compilation of the same no-resource handler with and without an unused
catalogue produces identical Wasm bytes. The common JavaScript runtime does gain
helper code: bundling `packages/runtime/src/host.js` with esbuild 0.28.1,
`bundle:true`, `platform:neutral`, `format:esm`, `target:es2022`, `minify:true`
measured 122,975 → 125,453 bytes and gzip 35,129 → 35,998 bytes against the base.
That is about 2.5 KB minified / 0.9 KB gzip in the shared runtime, with no binary
payload added unless configured. This measures the runtime entry, not every
provider's final packaging or a downstream Fastly JS runtime Wasm artifact.
