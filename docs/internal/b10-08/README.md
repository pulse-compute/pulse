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
| [08A #410](https://github.com/pulse-compute/pulse/issues/410) | Internal build admission, manifest integrity, immutable catalogue and deterministic identity | Implemented in this change |
| [08B #411](https://github.com/pulse-compute/pulse/issues/411) | Public configuration, JS views, Native plan/value contract, raw emission and execution limits | Pending |
| [08C #412](https://github.com/pulse-compute/pulse/issues/412) | Real MCP fixture, installed/package closure, provider receipts, reports and canonical docs | Pending |

Native currently has managed scalar/JSON handles, but no admitted opaque resource
view or checked numeric-offset operation for raw guest reads. That integration
needs its own plan validation, ownership and target parity evidence. Keep it
separate from manifest admission. Do not substitute a generic byte-buffer ABI.
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
