# B10-MCP-06A — production lexical search

## Delivery

PR #469 targets `latest`, base `e3bd03711ce15222fc318c6bb5ab5d68b51bfdbf` after merged #442. Remote branch: `codex/b10-mcp-06a`. Tested local code `afe635c` and published code `7f2bf3768a605abb92b157ddfdad2acd6ff8bc3d` have identical full tree `1dfa268136b20ab75464af90292543b440a0621f`. The final evidence-only commit is a descendant; it changes no executable inputs. No merge, release, deployment or self-approval occurred.

Example 12 now exposes all five authored tools through shared `ctx.call`. Search uses bounded ASCII tokenization, integer field-presence scoring, all-distinct-term matching, exact scalar filters, a request-owned heap, stable ASCII ID ties, complete counts and offset pagination. Excerpts retain the scalar-aligned leading 384 UTF-8 bytes and original citations. Results advertise the v2 application and sparse-lexical encoder. The full duplicated MCP tool envelope is capped at 24 KiB; oversized pages fail without partial results.

The callable uses the existing 05I finite citation projection. No `decodeJson` authority, compiler/runtime change, loop-cap increase, nested/effectful/dynamic call or corpus reduction was added. Resource contents remain unchanged from the base. The builder binds citation literals, masks and resource bytes to the same corpus; metadata ownership/cost and whole-request performance remain explicit 06B/07B follow-ups.

## Qualification

- Five-tool production/synthetic parity: **4692 executions**, Node Native, injected Fastly Native and Node JavaScript; terminal pass and successful runner cleanup. Production includes every corpus ID, direct field-scanning/sort oracle, full pagination, filter/error cases and exact citations. Synthetic cases cover equal-score ties, UTF-8 excerpt boundaries, escaped metadata, 24 KiB rejection and all existing read/example/diagnostic bounds.
- Focused runner: **2/2** tasks passed (`pulse-context-tools`, `pulse-context-build`). Resource freshness/format tests retain 123 cases and the independent 02 encoder.
- No-call/imported-unused Wasm replay passed against untouched `e3bd037` for Node and Fastly; 8 used-call executions and 12 rejection cases also passed. This ran on clean local `9e92e02`, published as `2d4ef181`, tree `84496ca4652da24a4284e78e3231800f9363a155`. Subsequent changes fix literal citation projection, synthetic fixture selection, whitespace and its documentation; no compiler/runtime/provider or no-call fixture changed.
- Broader unit profile: **passed**, 68/68 tasks, also on clean `9e92e02`. This is development regression evidence on that earlier tree, not qualification of a later immutable release candidate. Final generator/tool changes have the separate fresh focused pass above.
- Workspace TypeScript build, maintainer checks, docs checks, documentation-release simulation and scope declaration pass on `afe635c`. An early concurrent docs check raced a disappearing unit-test temporary file; the isolated final checks passed.

Production Node artifact: **991,442 bytes**. Injected Fastly artifact: **1,043,352 bytes**. These are fixture measurements, not provider reality or latency/memory qualification. Maximum complete tool result: **24,576 bytes**; maximum whole MCP reply: **24,610 bytes**. Exact artifact hashes and source identities are in `validation.json`.

## Environment, failed attempts and stopping point

Node 24.18.0 ran the producer and checks. Workspace dependencies were copied from the available identical-lockfile graph, then TypeScript packages were built. The first frozen offline install rejected the environment's pnpm 11.25.0 (repository requires 12.4.2). This is not a fresh installed-consumer/packed-package proof; 07A owns that check.

Retained attempts cover unsupported callable decoding, missing package build outputs, early return inside a bounded loop, optional-number helper admission, citation literal substitution and the synthetic fixture initially exceeding the independent starter budget. All were corrected at application/generator/test owners; no contract gate or ceiling was relaxed.

Human direction authorizes 06A implementation. Unclassified producer script paths require `Human decision: required` in the PR declaration; the recorded user direction supplies that authority. No protected product boundary is changed.

No 06A implementation check remains running at handoff. The broader regression and no-call reports retain their exact earlier source identity. Next: **06B / #452**, freeze the 24-query relevance set and qualify whole-request overhead. Packed closure (07A), generic lifetime/reachability (07B), reporting (08), seal/recovery (09), actual Fastly/client qualification (10), and final handoff (11) remain separate.
