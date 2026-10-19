# B10-MCP-03 — Deterministic context resource construction

Implements [#431](https://github.com/pulse-compute/pulse/issues/431), following
the merged [01 design](../b10-mcp-01/README.md) and [02 proof](../b10-mcp-02/README.md).
The new workload is explicitly reconstructed sparse lexical data. The remembered
historical vector remains unrecovered; this is not a semantic embedding model.

## Owners and workflow

`scripts/pulse-context-build.cjs` is the explicit generation/check owner;
`scripts/pulse-context-format.cjs` owns encoding and independent strict parsing.
The existing corpus extractor/allowlist remains the sole extraction authority.
`scripts/pulse-context-build.json` pins the algorithm, simultaneous limits,
application/protocol identities and release producer Node 24.18.0.

From a repository checkout, run `npm run docs:sync`, then `npm run context:build`
using the pinned Node, then `npm run docs:sync` and `npm run context:check`.
Generation writes six outputs and six byte-identical installed CLI mirrors:

- `context-corpus.ts`, retained for the existing JavaScript v1 application.
- `context-data/vector.bin`, `text.bin` and `metadata.bin`.
- `context-data/context-metadata.ts`, scalar filter/tool tables with no full text.
- `context-data/context-manifest.json`, recursively sorted compact JSON plus LF.

The manifest binds canonical source selection/content and original citation blob
identities, producer source closure, explicit config/allowlist/lockfile hashes,
row/dictionary identity and output hashes. Its own hash is external in receipts.
The finite executable producer closure is checked against loaded dependencies;
only Node built-ins and the listed repository sources execute. No third-party
producer dependency or model download is introduced.

`--check` reconstructs into a fresh temporary directory and compares every byte.
It never repairs candidate files. Receipts name the actual verifier Node version;
a verifier on a different Node must still reproduce exact pinned output bytes.
Only `--write` may author outputs, and it enforces the pinned producer. Repository
build and documentation checks require freshness; fast documentation PR CI runs
the focused reproducibility/negative suite. Docs sync can copy emitted resources
and refresh the legacy corpus, but cannot generate vectors.

## Admission and evidence

The current corpus has 245 records, 2,456 vocabulary terms and 14,410 nonzeros.
The three resources occupy 564,085 raw bytes; the actual admitted serialized
resource manifest is 752,766 bytes. No approximate base64 multiplier substitutes
for the existing resource admission implementation.

The corpus envelope is now 512 records / 2 MiB; vector dimension remains at most
4,096, row entries at most 1,024, and terms at most 64 ASCII bytes. Every text,
metadata, raw and serialized resource limit applies together. Oversized inputs
fail without dropping records or truncating coverage.

The format parser checks headers, contiguous directories, counts/ranges,
UTF-8/UTF-16, canonical metadata, sorted unique IDs/terms, positive integer
coordinates and source/content mapping. It recomputes authoritative coordinates,
so a self-consistent forged index or manifest cannot pass.

[Validation](./VALIDATION.md) retains independent build, negative admission,
existing-host and Native retrieval results. Scope is architecture implementation
under the user's explicit B10-MCP-03 direction. No exact named Entry Point covers
this repository-only builder. Root/docs/wasm/CLI instructions apply; additional
owners are build/documentation orchestration, the documentation CI check, suite
registry and existing evidence shard enrollment. Protected path declarations
include maintenance control plane, documentation deployment, package publication
and release authority; human review/merge remains separate.

Native MCP application integration remains 04–06, installed resource closure 07,
full resource reporting 08, candidate-bound seal/recovery receipts 09, and real
Fastly/client qualification 10. This completes the construction prerequisite,
not #381/#412 or an integrated release seal.
