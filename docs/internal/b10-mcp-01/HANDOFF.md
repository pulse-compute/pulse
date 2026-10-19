# Implementation and proof handoff

The [00 ledger](../b10-mcp-00/ACCEPTANCE.md) remains the integrated acceptance
map. 01 resolves its five design questions; A02/A03/A07 now have an explicit
contract, not production receipts. This work changes no implementation status
for A04–A21 and closes neither #381 nor #412. Models below are recommended work
assignments, not a claim that separate agents or those models executed this PR.

## Implementation units

| Unit | Concrete deliverable and owning scope | Model / effort | Dependency / exit |
| --- | --- | --- | --- |
| 02a | Generic bounded UTF-8 resource read; runtime types/contracts, canonical-plan validation, codegen and Node/Fastly/JS parity; strict Unicode/range/deadline/lifetime rejection | Sol 6.1 / XHigh | Reviewed 01; no replacement decoding, foreign/stale handle or deadline bypass |
| 02b | Fresh fixed-capacity local numeric workspace, checked reads/writes and no borrowed-array mutation or escape; compiler/plan/runtime ownership | Astra / XHigh | Reviewed 01; prove allocations and forged-plan rejection, no blanket mutable-array support |
| 02c | Actual corpus query-to-cited-result Native proof combining encoder, resource scan, heap, metadata decode, text and final bounded serialization | Astra / XHigh | 02a/02b; below whole-request proof passes before 03/06 |
| 03 | Explicit deterministic build/check command, formats/manifest and mirrors; raise canonical corpus limits deliberately, independent clean reconstruction, format/corruption tests | Sol 6.1 / High | 02c; exact source-to-bytes and stale rejection |
| 04 | Existing MCP package's new lowerable subpath, static direct Entities dispatch, selected protocols/public origin policy, typed errors/schemas and old host API regression | Sol 6.1 / XHigh | Reviewed 01; can proceed alongside 02, but must prove complete Native binding |
| 05 | Complete Native start/read/example/diagnostic and search response plumbing; exact version/citation and Unicode pagination | Sol 6.1 / XHigh | 02c/04; all output schemas and bounded failures |
| 06 | Production sparse query/scoring/heap/filter/paging; independent decoder/oracle and frozen relevance set | Sol 6.1 / High | 03/05; exact ordering/citations plus all quality gates |
| 07 / 08C | Exact installed, source-free resource and MCP closure; corruption/mixed identity and generic-resource matrix | Sol 6.1 / High | 06; retain separate installed release gate |
| 08 / 08C | Complete identity/admission/physical artifact/memory reporting and dedup/reachability | Sol 6.1 / High | 03 and merged 08B; no summary-as-memory-proof |
| 09 | Mandatory pre-pack vector freshness receipt, package identity, negative seal/recovery tests | Sol 6.1 / High | 03/07; candidate unchanged, failures block seal |
| 10 | Actual Fastly CLI/Viceroy whole-app run plus each pinned client/profile; optional deployed smoke separately authorized | Sol 6.1 / XHigh | 06/07/09; terminal receipts for all tools and adverse workloads |
| 11 | Canonical/installed Native Fastly workflow docs and migration; integrated B10-09/#382 handoff | Sol 6.1 / High | 07–10; one immutable candidate, no pooled historical passes |

Splitting 02 makes previously implicit compiler work visible. It does not grant
an additional broad mutable-language feature, arbitrary text operation or new
effect. Each PR must declare the exact owning Entry Point/extra owner and the
actual protected boundaries. Human review of 01 is the design decision; the
individual implementation and qualification proofs remain required. If 02
cannot implement the selected general primitives safely and within budgets,
stop/revise the design in a reviewable follow-up; do not silently shrink the
corpus, switch encoders, raise loop caps or fall back to JavaScript.

## 02c proof receipt

Use all 244 current records and the exact cited text, not the 32 × 8 PVB1 fixture
or arbitrary 1 MiB dense filler. Record actual sparse bytes/rows/dimension and
content hash. Also construct admitted growth/adversarial cases for 512 rows,
4,096 terms, 1,024 terms per row, eight query terms, all-positive hits, ties,
deep pagination, maximum text/escaping and wrong version/unknown terms. Byte
ceilings apply jointly: reject an over-budget combination, rather than claiming
it as an admitted worst case. Full generic large-payload testing remains #412.

The receipt must identify source tree plus dirty-file hashes if applicable,
producer/dependency identities, manifest/data hashes, canonical plan, Wasm and
Fastly artifact hashes, exact provider execution path, selected tasks, terminal
status and retained failures. Report:

- Compiler loop bounds and helper products; actual request-total reads,
  comparisons, heap work, metadata/text/serialization work and number of handles.
- Cold/warm repeated executions, worst admitted query/offset/read page, zero
  matches and failure paths; no result truncation on exhaustion.
- Native module/data/artifact growth, current input sizes versus each budget,
  backing/copies, allocation/high-water/peak instance memory and bounded reuse.
- Synchronous cancellation/deadline expiry during query encoding, scoring,
  heap/pagination, UTF-8 decoding and output, with no successful partial response.
- Independent expected IDs/scores/citations, exact read reconstruction across
  Unicode page boundaries and final reply-byte accounting including MCP wrapping.

Set measurable acceptance budgets in the proof receipt from actual compiler/
provider limits before running the full workload; never retroactively loosen a
threshold to make the result green. The app deadline is already 5,000 ms, with
32/128/24 KiB request/protocol/tool bounds fixed by this design. Wall-clock and
memory measurements must name the environment; local injected-ABI success is
not a real Fastly result. 02 can establish the isolated Native execution proof;
10 still must establish actual CLI/Viceroy and client interoperability for the
finished application. No production activation is required by these units.

## Review checklist for 01 completion

1. Review the explicit lexical-versus-semantic decision and v1-to-v2 query/snippet
   changes. No hidden semantic retrieval claim.
2. Confirm source/corpus identity and the reproducible measured workload; original
   unrecovered vector remains labelled unrecovered.
3. Review binary/text/mapping formats, simultaneous budgets, whole-request bounds
   and generic Native prerequisites. No present-tense runtime support claim.
4. Review direct package ownership, public read-only exposure and both profiles;
   no repurposing of root host APIs or new public backend authority.
5. Review source-to-bytes generation, freeze/check/package/recovery/promotion
   identities and fail-closed behavior; full installed gates retained.

01 is complete when the contract, calculator and repository checks are
reviewable in its PR. Architectural approval is a human review outcome, not a
status the agent assigns to itself. Implementation follows only the reviewed
direction; a merge of this design is not a Native MCP or release qualification.
