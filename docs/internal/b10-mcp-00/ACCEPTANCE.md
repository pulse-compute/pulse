# B10-MCP acceptance ledger

Baseline and source identities: [README](./README.md), [inventory](./baseline.json).
Only B10-MCP-00 is implemented by this change. Later IDs are work-unit identifiers;
they do not imply GitHub issues exist or that their design is already approved.
All implementation PRs target `latest`. Human merge and release remain separate.

## Work owners and dependencies

| Unit | Deliverable / completion criterion | Model / effort | Size | Dependencies |
| --- | --- | --- | --- | --- |
| 00 / #423 | Pinned baseline, source/task inventory, vector disposition, A/B issue reconciliation and this ledger | Sol 6.1 / High | S | None |
| 01 | Native app, retrieval/query encoder, text representation, MCP package/protocol and public admission contract; explicit open decisions resolved | Astra / High | M | 00 |
| 02 | Representative Native Fastly query-to-cited-result proof; measured work, handles, memory, deadline and artifact growth; no hidden general-limit expansion | Astra / XHigh | M–L | 01 |
| 03 | Canonical corpus/vector/mapping builder and manifest; independent identical rebuilds, stale/corrupt rejection | Sol 6.1 / High | L | 01, 02 |
| 04 | Native direct MCP admission, discovery/list/call, schemas/errors and selected compatibility profiles; existing host API preservation | Sol 6.1 / XHigh | L | 01 |
| 05 | Native start/read/example/diagnostic and common search-response behavior; bounded cited text retrieval and Unicode pagination | Sol 6.1 / XHigh | L | 02, 04 |
| 06 | Resource-backed query encoding/scoring/top-k, stable ties/filters/pagination, independent oracle and retrieval-quality evaluation | Sol 6.1 / High | M | 03, 05 |
| 07 / 08C | Exact installed package closure, source-free execution, identity/corruption checks, reachability/deduplication; generic-resource matrix retained | Sol 6.1 / High | M | 06 |
| 08 / 08C | Trustworthy identity/budget/realization and physical-size reporting; distinct artifact/backing/copy/instance/process measurements | Sol 6.1 / High | M | 03, merged 08B |
| 09 | Candidate-bound vector rebuild/check seal gate, stale recovery invalidation and exact packaged bytes; fast PR/full release boundaries retained | Sol 6.1 / High | M | 03, 07 |
| 10 | Whole module through actual Fastly CLI/Viceroy and supported clients; all tools, worst admitted workload and failures; separate deployed smoke instructions | Sol 6.1 / XHigh | L | 06, 07, 09 |
| 11 | Canonical Native Fastly docs/installed examples and migration; final integrated evidence handoff to B10-09 (#382), 08C/parent closure only when complete | Sol 6.1 / High | M | 07–10 |

## Required proof

Status describes this baseline. Existing unit tests and historical results are
reusable specifications, not passing receipts for future Native implementations.

| ID | Acceptance requirement | Baseline evidence / missing proof | Owner |
| --- | --- | --- | --- |
| A01 | Exact revision/tree and merged resource lineage | Recorded; 08A/08B ancestors verified; stale #410/#411 closed, #381/#412 retained | 00 |
| A02 | Actual corpus/vector provenance, exact bytes/hash/dimensions/access pattern | Original unavailable in recorded search; new canonical workload must be explicit; synthetic fixtures excluded | 01, 03; #412 |
| A03 | Query/document vector compatibility and useful retrieval | Current app is lexical; encoder/model and quality acceptance unset | 01, 02, 06 |
| A04 | Deterministic source extraction, chunk IDs, metadata and citation mapping | Text corpus generation exists; vector/chunk mapping and reconstruction absent | 03 |
| A05 | Identical independent vector builds and bounded input rejection | No vector build workflow; test reordered enumeration, clean/cache-free builds, missing/mixed/corrupt inputs, invalid numerics and truncation | 03 |
| A06 | Native direct MCP protocol and schema correctness | Existing host JS facade and fixed HTTP backend; preserve IDs, error envelopes, notification semantics, header/revision agreement and finite body/depth limits | 04 |
| A07 | Intentional public Fastly exposure and admission | Existing example is loopback-only; origin/auth policy, identity and public route scope undecided | 01, 04, 10 |
| A08 | Five tools preserve exact-version and cited-content behavior | JS contracts/fixtures exist; Native implementations and text access absent | 05, 06 |
| A09 | Complete admitted search fits bounded execution | 08B synthetic reads and numeric-region evidence only; measure encoder + scan + top-k + serialization; do not silently truncate corpus coverage | 02, 06 |
| A10 | Synchronous deadlines/lifetime and bounded allocation on real host | Injected ABI/resource evidence exists; actual MCP workload and real provider receipt absent | 02, 10; #412 |
| A11 | Resource admission/reads remain general purpose | Merged A/B; retain zero-length, unaligned, range/corruption/foreign/stale/escape failures, repeated scans beyond 4 MiB within execution limits, composition and every claimed target | 07, 10; #412 |
| A12 | Installed artifact contains all required immutable data | Existing JS context installed gate; Native vector/text/mapping closure and deletion-of-source proof absent | 07 |
| A13 | Independent construction and physical dedup/reachability | General resource qualification pending; equal aliases vs logical/file counts, unused payload elimination and complete closure must be checked | 07; #412 |
| A14 | Honest resource size/memory/report attribution | Summary projection exists; full report integration and real MCP measurements absent; no payload disclosure | 08; #412 |
| A15 | Vector freshness blocks sealing and cannot be repaired silently | Existing text source checks only; independent vector receipt and negative freshness tests absent | 09 |
| A16 | Recovery/package/publication bind the same exact vector bytes | Existing general source/tarball/recovery framework; vector identities, missing/changed receipts and post-seal regeneration rejection need integration | 09 |
| A17 | Real client compatibility against Native Fastly | Pinned official/Codex/Claude Node-host fixtures exist; each selected Native profile needs its own terminal result | 10 |
| A18 | Provider simulation, local reality and deployed proof remain distinct | 08B injected ABI only; require CLI/Viceroy result for Native claims; remote smoke remains separately authorized and reported | 10 |
| A19 | Updated canonical and installed user workflow | Current Node JS instructions and stale 220-record prose; rebuild docs alongside implementation, reconcile all generated copies at completion | 03–11 |
| A20 | One integrated candidate closes Beta.10 qualification | No new seal here; #382 owns complete candidate-bound qualification; historical/partial results cannot be pooled | 11; #382 |
| A21 | Existing report integrity uncertainty remains visible | #418's intermittent REPORT_ARTIFACT_HASH cause is unexplained; later passes do not prove a fix | 08, 11; report owner if recurrence |

## Exit conditions and handoff

00 exits when its deterministic inventory and repository checks pass, the
reconciliation is reflected in live issues, and the evidence PR is reviewable.
It does not wait for the missing original vector: an explicit reconstruction
disposition satisfies 00, while provenance and actual workload proof stay open.

Next: implement **01**, beginning with query-encoding semantics, corpus growth
and Native text representation. Carry all decisions into the smallest executable
02 proof. Do not start by selecting a binary dimension from the remembered size,
changing the loop ceiling, replacing the existing host API, or expanding the
release package set. Those choices must follow the concrete contract.

08C is complete only when A02 and A10–A14 have the required real-workload,
generic-resource, installed and provider evidence. The larger MCP rebuild is
complete only when all applicable rows are satisfied or a human explicitly
changes scope. Missing provider/client receipts remain gaps, not silent skips.
