# B10-MCP-02: Native retrieval prerequisites and proof

Implements issue [#428](https://github.com/pulse-compute/pulse/issues/428), following
merged [B10-MCP-01](../b10-mcp-01/README.md). The public additions are strict bounded
UTF-8 reads and fixed-capacity numeric workspaces. The application experiment
executes the whole query-to-cited-result path on Node Native, injected Fastly
Native, and original-source JavaScript. This is an isolated feasibility proof;
the production builder, MCP binding, installed closure and seal gates follow in
03–10. No merge, publication or deployment is performed by this unit.

Entry Point: `runtime-effects`. Additional owning files are the compiler's
source/plan validators, runtime-core code generation, Fastly realization,
public Pulse type re-export, diagnostic catalog, test registry/shard enrollment, and schema
presence projection. The last corrects an existing string double-escaping bug
exposed by byte-exact citations. These owners are necessary for 02a–02c.

## Primitives

- `view.readUtf8(offset, byteLength)` validates UTF-8 strictly and returns at most
  12,288 input bytes. Scalar boundaries, zero-length ranges, BOM/NUL, invalid
  encodings, ownership and synchronous deadline checks have cross-target proof.
- `const cells = ctx.workspace.numbers(capacity)` creates zeroed private f64
  cells: literal capacity 1–1,024, four allocations maximum. Direct numeric
  indexed reads/simple writes and read-only length are supported. No alias,
  capture, object storage, escape, borrowed mutation or general array support.
- The explicit workspace factory refines 01's array syntax sketch: it makes
  allocation and lifetime enforceable on JavaScript as well as Native. Pure
  loop limits stay 1,024 per loop and 65,536 combined nested iterations.
- Plan/compiler v11, generator v10 and Node host v5 identify the change. The
  guest ABI remains 2 with optional workspace imports. Forged identities,
  capacities, initialization and operation shapes are independently rejected.

## Measured result

| Workload | Records / vocabulary | Resources | Fastly artifact | Peak guest memory | Slowest Fastly request |
| --- | --- | --- | --- | --- | --- |
| Current corpus | 245 / 2456 | 564,085 bytes | 703,533 bytes | 14,680,064 bytes | 803.8 ms |
| Admitted growth | 512 / 4096 | 3,243,626 bytes | 3,371,686 bytes | 26,738,688 bytes | 248.0 ms |

The receipt contains 153 successful/negative parity executions across three lanes,
plus sampled synchronous deadline failures on Node and Fastly Native. The
largest tool body is 16,446 bytes; its separately calculated MCP envelope stays
below 128 KiB. Source-operation counts come from an instrumented execution of
the identical JavaScript handler, checked against both Native results; they
are not Wasm instruction counts. Each invocation owns three immutable resource
views and 1,040 numeric cells (8,320 raw bytes).

## Proof boundary

`wasm/test/runtime/context-native-fixture.cjs` is an isolated test producer. It
packs the current entire generated corpus into the three proposed v1 resource
formats. It is not the production source-to-bytes/check workflow of 03.
`assert-context-native-proof.cjs` compares complete metadata, exact excerpts,
integer scores, tie order, filtering and offsets with an independent direct
field-membership oracle. Paged reads reconstruct exact UTF-8 content using
UTF-16 offsets. A generated 512-row, 4,096-term fixture exercises 160 full
1,024-entry rows, eight query terms, all-positive ties, deep offsets and a
24,576-byte text record with JSON escaping and Unicode. Its canonical corpus
is below 2 MiB; the simultaneous byte and shape budgets are enforced.

The proof fixes ceilings before execution: 5,000 ms/request, 120 s/compilation,
8 MiB/artifact, 128 MiB guest committed memory, 1,048,576 Node value handles,
24 KiB tool output and 128 KiB calculated MCP envelope. These are experiment
acceptance thresholds, not new Fastly platform limits. Every authored loop is
validated by the existing compiler; no compiler loop ceiling changes.

Fastly uses the injected native ABI host. Repeated runs reuse immutable artifacts
with fresh invocation instances, not a claim of warm-instance recycling. Guest
memory is committed Wasm-page high-water, not live-object size; process RSS
includes compilers and harness. MCP envelope accounting is calculated outside
the prototype transport. Real CLI/Viceroy, production MCP/client interoperability,
installed-only execution, independent production reconstruction and seal/recovery
remain explicitly unqualified here.

See [VALIDATION.md](./VALIDATION.md) and [evidence.json](./evidence.json) for the
terminal checks, exact identities, sizes and measurements.
