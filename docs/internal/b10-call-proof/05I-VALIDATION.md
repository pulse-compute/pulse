# 05I validation and recovery checkpoint

05I (#450) is implemented on draft #442, remote branch
`codex/b10-call-proof-recovered`, local branch `codex/b10-mcp-05i`. It continues
`c34e8a6484b429ae1f6b1c710eba4d00e1421b2a`; actual base remains
`8a51d705025c69ae306004215cb6cb48248d68e1`. No merge was performed.

## Source and terminal evidence

- Clean tested implementation: `eaa0180bb5576737af62aa638119b48c176a9707`.
- Published implementation: `dd7241e1a0c7ca99fe56bf1ee7bbbc100a910681`.
- Identical full Git tree: `985322c1d59e0eacc6d585acee44b4e083e289ec`.
- Clean remainder-check source: `7a82f92a6d63ded093e35b25bdc1a341c82b2792`.

The connector changes commit metadata; uploaded blobs and the full implementation
tree match local Git. The follow-up changes only the rebuild task timeout and
evidence/documentation. Final delivery identity is recorded on #442/#450/#436.
Complete reports, task logs and failed attempts are retained in `05i-validation/`.

The first clean runner passed the four-tool task and suite shape, then timed out
the expanded rebuild fixture at its inherited 60-second allowance (exit 124).
Raising only this task allowance to 120 seconds allowed the eight remaining/
regression tasks to pass on clean source. The terminal remainder report has no
active child and process exit 0. All nine selected checks therefore have passing
terminal evidence; this is not a claim that the first aggregate run passed.

| Check | Result |
| --- | --- |
| pulse-context-tools | 3,330 complete MCP executions: 2,673 production and 657 synthetic across Node Native, injected Fastly Native and Node JavaScript; public TypeScript check; all 05H start cases retained |
| pulse-context-build | 120 deterministic rebuild/admission cases; 28 outputs and CLI mirrors |
| pulse-context-corpus | 260 exact-version records; identity and deterministic freshness |
| pulse-context-application | Existing five-tool v1 application; 509 calls and independent JavaScript build execution |
| pulse-context-host | Existing Node host/HTTP/MCP compatibility |
| callable-authored-composition | Six executions; sixteen source and eleven plan rejections; one physical backing per shared/distinct resource across parent and two callees |
| callable-lifetime | Existing terminal-failure, frame cleanup and cumulative-budget regression |
| suite-shape | Task registration, profile structure and finite timeouts |
| docs-example-12-pulse-context-mcp | Executable example documentation, formatting and workflow checks |

Build, maintainer, documentation release inventory and deterministic protected-scope
checks passed. The cumulative scope report retains the inherited Entities warning
and requires human review. Large documentation logs have hash/byte receipts.
Generation used pinned Node 24.18.0; execution used Node 24.19.0, TypeScript 5.9.3
and the restored identical-lockfile graph. This is not fresh clean-install
qualification. No 05I implementation blocker or running check remains.

## Application and resource measurements

The contained application exposes pulse.start, pulse.read, pulse.example and
pulse.diagnostic through shared ctx.call. The original five-tool v1 host, including
pulse.explain_diagnostic, is unchanged. Complete response arrays, optional fields,
exact versions and citations are compared with independently executed legacy
handlers and an independent JSON.stringify oracle for v2 pagination budgets.

Read preserves original UTF-16 offsets and scalar-aligned UTF-8 text. Pages can
end earlier than v1, with explicit nextOffset/truncated, to fit the complete MCP
tool result including text and structured copies. Examples retain whole files;
oversized files direct callers to read. Oversized diagnostics return an explicit
response-too-large error. Synthetic admission covers maximum text, BOM, astral
characters, controls, escaping, empty text and exact terminal behavior.

Largest observed structured output: 12,139 bytes. Largest complete MCP tool result:
24,576 bytes, exactly its 24 KiB bound. Largest whole protocol response: 24,610
bytes, below 128 KiB. Production Native artifacts are 768,790 bytes (Node) and
820,895 bytes (Fastly); synthetic artifacts are 842,626 and 894,771 bytes. Full
SHA-256 and plan identities are in the tool task log. These include the production
corpus and response shapes, not isolated callable-overhead measurements.

Original corpus identity remains
`b892b2edc0bdfcd5d9a95726ad7711a586ae2c77e5a26611fa5d1fe558a025f8`.
The three corpus binaries are unchanged. Full cited text stays in its resource,
not generated quoted text or a legacy corpus import. A small shared-emitter fix
reuses a physical backing across callable owners. Both real application artifacts
and parent/two-callee fixtures assert physical uniqueness in initial memory.
Resource validation and frame/workspace ownership remain intact. Broader generic
resource qualification remains 07B (#454).

Because Native emission changed, a fresh baseline replay ran on clean eaa0180
against untouched 8a51d70: 28 executions and twelve rejection cases passed. Router no-call/imported-unused
artifacts remain byte-identical at 38,063/87,771 bytes (Node/Fastly); MCP equivalents
remain byte-identical at 99,527/129,895 bytes. Full hashes and import comparisons
are retained in baseline-final.json. No unused-call overhead gate was relaxed.

## Stop boundary

Four complete migrated tools. Next: **06A (#451), sparse lexical search**. Full
profiles, installed closure, actual Fastly CLI/Viceroy, client acceptance and
sealing remain their designated checkpoints under the user's staged-check
direction. Merge, release, deployment and self-approval remain human-owned.
