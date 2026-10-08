# PRPT-03: physical size ledger and retained attribution

Implements A07/A08 and bounded A14 evidence from the [v2 plan](../prpt00/feature-spec-v2.md),
using the [00C ceiling](../prpt00c/README.md), [01 contract](../prpt01/README.md), and
[02 completion lifecycle](../prpt02/README.md). The [locked design fixtures](../prpt00/README.md#00a-exact-design-contract)
remain authoritative, including the size selector and expandable schema views.
Schema descriptor bytes remain distinct from Wasm validator bytes.

Entry point: none; ordinary root/wasm/CLI/compiler/provider/docs instructions.
Human direction: implement PRPT-03 against `latest`, after merged PR #223 at
`c77ca98f394a0f49dee897ef25af3ea3021fc850`. Classification: scope-expansion.
Additional owners: build-support's passive emission observer, Native compiler
result plumbing, Fastly's existing generator ownership/result plumbing, and CLI
completion/replay. No executable lowering, authority, provider ABI, dependency,
package export, command, optimization pass, or guest retention flags change.
Sizing recommendation remains **Sol / high**. No delegation was used.

## Measurements and interpretation

The reader validates actual retained Wasm and reconciles its eight-byte header
plus every physical section, including section identifiers/length encodings and
custom sections. It enumerates each defined body once, using function-import
count plus code-body ordinal. Body bytes include locals and instructions;
code framing includes vector count, body-length prefixes and section framing.
The optional additive `Artifact.ledger` fields preserve v1 golden capsules.

Data payload counts support passive segments and i32 constant-offset segments.
Other valid offset expressions retain exact section sizes with unavailable data
payload counts. Every observed payload remains explicitly unattributed: original
asset length and redacted schema descriptor length cannot establish final payload
identity. No substring search, proportional allocation, zero-for-unknown value,
or inferred resource ownership is used. Unattributed bytes are not a bloat claim.

Route measurements join exact canonical entry identity and independently check
handler identity. Mapped chunk indices select final function bodies, deduplicated
within each metric. Partial direct mappings retain their measured subset and
mapped/expected counts; missing roots make reachability unavailable. Shared or
merged functions use the same artifact-local body ID across rows. Route values
may overlap and must not be added. The physical census counts each body once.

Reachable means static direct-call closure, including conditional/shared callees,
with imported implementations outside the artifact. It excludes data and framing;
it is not a request trace, execution frequency, runtime cost or removal savings.
Own and Shared stay unavailable because startup/error/event/export and other
execution roots have not been qualified as a complete ownership universe.

## Passive capture and replay

The build-support owner observes the actual final serialization of pinned
AssemblyScript 0.28.18. Zero-argument convergence emissions are ignored. It
returns the first ordinary serialization unchanged, temporarily emits names from
the same optimized module, restores Binaryen's debug flag in `finally`, verifies
every non-custom section byte/order/encoding, and verifies another ordinary
serialization. This is one generation and one asc invocation per ordinary build.
No extra compilation, new export, `--debug` flag or optimizer pass is introduced.

Only allowlisted identities, indices, byte counts and direct edges survive the
capture. Raw names, generated source, WAT and local paths are not retained in the
Report sidecar. Fastly now carries the existing generator ownership records into
its metadata and forwards capture through its existing data result. It does not
add a CLI provider branch or a new provider contract field.

The bounded graph parser uses the verified binary and the same pinned Binaryen
instance during the build. Unknown names/order, tables/elements, indirect,
reference or tail calls reject the graph while retaining direct measurements.
Report itself imports no compiler, provider, Binaryen or subprocess, and performs
no regeneration, disassembly, optimization or network access.

The completion marker binds one optional v1 attribution sidecar by hash/size.
Primary-artifact capture is preferred; a retained portable fallback remains
explicitly prelink. Capture version/shape/identity failures suppress this optional
evidence without rejecting an otherwise-valid build. Replay verifies the actual
function census against the sidecar and rejects tampering. A missing optional
sidecar leaves the physical ledger available and route metrics unavailable.
Historical exported capsules retain their recorded evidence without claiming a
current-project match. PRPT-02's safe paths, input matching and completion-last
lifecycle continue to apply.

Limits: 64 MiB Wasm, 100,000 census/graph records, 16 MiB sidecar/capsule,
32 MiB graph text and one million traversal operations per artifact. Graph work
beyond the budget is unavailable. Parser text/output caps are acceptance bounds;
Binaryen serialization itself is not a hard memory sandbox.

## Focused proof and remaining qualification

Three paired fixture builds prove every executable byte unchanged:

| Artifact/profile | File bytes | Unique direct handler bytes | Mapped routes |
| --- | ---: | ---: | ---: |
| Portable/default | 2,545 | 157 | 5/5 |
| Fastly/default | 31,466 | 147 | 5/5 |
| Portable/converging size | 2,464 | 112 | 5/5 |

Each observed artifact executes all five routes with expected responses. These
are local Node/injected-Fastly checks, not deployed or Viceroy reality. The
paired builds are test-only noninterference evidence; Report never does this.
The lifecycle test also covers schema-bearing/embedded-asset input, final Fastly
persistence, sidecar removal/tampering and compiler-free replay. See
`validation.json` for source identity, terminal receipts and diagnostic costs.

Guest-linking can rewrite indices after asc. Hash mismatch discards capture;
linked final route attribution and unretained AS-primary evidence remain gaps.
A portable artifact retained alongside Fastly is a distinct prelink artifact,
never a substitute for final Fastly sizes. Stage/helper and single-dispatcher
layouts without supported chunk roots remain partial/unavailable. Resource
payload ownership, complete exclusive roots, source-map builds, real ARC/Catalog
and large-app overhead remain PRPT-06 qualification or an explicitly scoped
future adapter. No new compiler optimization work is implied.

Public command/viewer integration remains PRPT-04/05. No release seal,
publication, merge, deployment, or full release campaign is performed here.
