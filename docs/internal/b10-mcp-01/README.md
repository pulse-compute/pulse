# B10-MCP-01: Native Fastly context-MCP design

Issue [#425](https://github.com/pulse-compute/pulse/issues/425). Builds on
[00](../b10-mcp-00/README.md), merged in
[#424](https://github.com/pulse-compute/pulse/pull/424).

Status: **proposed for implementation and human architecture review**. This unit
resolves the design choices and supplies a measured reference workload. It does
not implement the Native server, production vector builder or seal gate. Those
are the explicitly dependent work units below. Current public contracts remain
unchanged. The user directed “Implement B10-MCP-01”; merge/release/deployment
authority remains human.

No named Entry Point covers this repository-only architecture design. The root
and `docs/AGENTS.md` ordinary instruction chain applies. All additions stay in
this internal directory; no public documentation, generated corpus, package,
compiler, release workflow or provider configuration is changed.

## Selected decisions

| Decision | Contract |
| --- | --- |
| Application | Rebuild example 12 as provider-neutral Pulse handlers, explicitly built for `fastly-native`; one artifact, one `/mcp` endpoint, direct local dispatch |
| Retrieval | `pulse.context-sparse-lexical.v1`: exact sparse token vectors with integer field-presence weights; **lexical retrieval, not semantic embeddings** |
| Query encoder | ASCII tokenization shared with documents; bounded query, exact dictionary lookup; no hosted service, learned model, stochastic operation or runtime index |
| Text | Separate immutable `text.bin` and `metadata.bin`, row-aligned with `vector.bin`; UTF-8 content remains byte-exact and cited |
| Growth | 512 records, 4,096 vocabulary terms, 1,024 nonzeros per row, 64 bytes per term; independent explicit byte budgets; overflow is a build error |
| Native gap | Add general bounded UTF-8 resource decoding and fixed-capacity request-local numeric workspaces, with independent canonical-plan/provider proof in 02; do not pretend the current subset already supports them |
| MCP ownership | New lowerable `@pulse-compute/mcp/pulse` subpath in the existing package, reusing Entities/schema ownership; existing root and `/node` host APIs remain supported |
| Protocol | Default stateless JSON-only `2026-07-28`; explicitly enabled `2025-06-18` compatibility profile; no failed-modern-to-legacy fallback |
| Public admission | Deliberately public, read-only bundled documentation; no authentication requirement for this app, reject every supplied Origin by default; no public backend/tool management endpoint |
| Determinism | Source-to-bytes, not merely reusing an immutable downloaded vector; build before candidate freeze, independently rebuild/check during seal, never repair the candidate in a check |

The remembered 700 KiB–1 MiB original vector was not recovered by 00. This design
is an explicitly new canonical workload. Its dimension equals the sorted
vocabulary size (2,453 on this corpus), not a size-derived dense dimension. The
measurement calculates 158,121 bytes of vector data from actual records; exact
sizes are in [measurement.json](./measurement.json). Generic large-resource
qualification in #412 remains mandatory even if this application is smaller.

The lexical decision is intentional and reviewable. It preserves the current
product's lexical purpose, but changes whitespace/substrings to exact tokens,
deduplicates query terms and rejects non-ASCII queries. It does **not** promise
synonyms, multilingual retrieval, semantic paraphrases or embedding equivalence.
If semantic search is required, revise this decision before 02/03: a new encoder
must pin query/document model, tokenizer, weights, arithmetic, offline execution,
quality and reproducibility. Do not label this format a semantic substitute.

## Contract and evidence map

- [contract.json](./contract.json): versioned decisions, identities and numerical
  limits, consumed by the design calculator.
- [RETRIEVAL.md](./RETRIEVAL.md): token/vector format, text, ranking, pagination,
  corruption admission, bounded computation and quality gates.
- [MCP.md](./MCP.md): package, dispatch, protocol, public admission and tool parity.
- [BUILD-SEAL.md](./BUILD-SEAL.md): generation, manifest identities, packaging,
  freshness and recovery gates.
- [HANDOFF.md](./HANDOFF.md): concrete owners, proof prerequisites, model/effort
  and acceptance mapping.
- [measure.cjs](./measure.cjs), [measurement.json](./measurement.json) and
  [VALIDATION.md](./VALIDATION.md): reproducible design evidence and its limits.

Normative baseline is `0b2a861c20f427cae0bfcaaca5549c90d201fa04` on `latest`,
tree `12a50235da1f6fde406e1eb3f30fc53cdac2986d`. The corpus is still
`3476598caee665b829e1b5a32c1263716e84cc2fa8ac4dc36137c07a264d2165`:
244 records from 38 sources, canonical JSON 515,764 bytes and module 516,102
bytes. Its existing 256-record/524,288-byte generator limits have only 12 records
and 8,524 bytes of headroom. 03 must deliberately update that source contract
and all derived copies to the new admitted envelope; this PR does not raise it.

## Architecture review boundaries

This design proposes future changes to `public-authoring-api` (UTF-8 reads and
bounded numeric workspace syntax), `configuration-contract` (explicit resource
budgets/profile), `lowerer-trust` (a declared MCP lowerer),
`runtime-target-fluidity` (direct Native MCP), `package-publication` (the new
subpath and packaged immutable data), and `release-authority` (the vector
freshness gate). The lowerer remains a trusted build dependency through the
existing versioned contract, with no publisher allowlist or arbitrary backend
code hooks. Host authority and provider SDKs stay outside handlers. No new
production dependency or release package is selected.

Reviewing this design does not itself qualify these future surfaces. Each owning
implementation PR must declare its actual protected boundaries and carry the
specified evidence. The 00 acceptance ledger remains historical; the completion
of this design does not close #381, #412 or the integrated B10-09 gate #382.
