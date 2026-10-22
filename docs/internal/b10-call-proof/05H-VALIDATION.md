# 05H validation and recovery checkpoint

05H (#449) is implemented on draft #442, remote branch
`codex/b10-call-proof-recovered`, local branch `codex/b10-mcp-05h`. It continues
`0dcd22f3975c47bf78446fc91f83a629ee8bdb45`; actual base remains
`8a51d705025c69ae306004215cb6cb48248d68e1`. No merge was performed.

## Source and terminal evidence

- Clean tested local implementation: `681dd8f82abf125d3ee189ea62bd2ae4d5812c18`.
- Published implementation: `2ce5096d4425291c4a8ff10f49110ccd6bfd89c7`.
- Identical full Git tree: `d3a74eefe109e7c80350a0503e02f407d4e0ce49`.

The connector supplies different commit metadata; uploaded blobs and the complete
tree match local Git. The evidence/documentation follow-up changes no application,
generated output or test. Final delivery identity is recorded on #442/#449/#436.
Complete reports, task logs and failed attempts are retained in `05h-validation/`.

The final runner report has terminal `passed` status, seven of seven selected
tasks completed, no active child, and process exit 0. The first focused run is
retained as failed; formatting and exact generated-file exceptions were corrected
before the complete focused selection was rerun on clean source.

| Check | Result |
| --- | --- |
| pulse-context-start | 84 real MCP executions across Node Native, injected Fastly Native and Node JavaScript; eight complete starter plans, eighteen error/boundary cases, discovery and schema errors; public TypeScript check; one full-text resource backing per Native artifact |
| pulse-context-build | 110 deterministic rebuild/admission cases; 22 compared outputs; stale/missing/corrupt source/config/mirror rejection without repair |
| pulse-context-corpus | 260 exact versioned records; source identity and deterministic freshness |
| pulse-context-application | Existing five-tool v1 application; 509 real calls and source-independent JavaScript build execution |
| pulse-context-host | Existing Node host/HTTP/MCP compatibility |
| suite-shape | Task registration and profile structure |
| docs-example-12-pulse-context-mcp | Executable example documentation, formatting and workflow checks |

`npm run build`, `npm run maintainer:check`, `npm run docs:check`, documentation
release inventory and deterministic protected-scope checks passed. The cumulative
scope report retains the inherited Entities protected-path warning and requires
human review. It does not authorize merge or release. Large documentation logs
are identified by byte count and hash in `documentation-receipts.json`.

Generation used pinned Node 24.18.0; execution used Node 24.19.0, TypeScript 5.9.3
and the restored identical-lockfile graph. This is not fresh clean-install
qualification. No check remains running and no 05H implementation blocker remains.

## Application and resource measurements

The contained `application/` project exposes only migrated `pulse.start`; the
root example retains its five-tool v1 host API. All four goals and both Node
starter target choices preserve complete dependencies, configuration, contract
arrays, commands, exact package versions and citations through shared `ctx.call`.
The test independently executes the unchanged legacy handler as its oracle and
accounts explicitly for application metadata v2.

Largest observed structured tool output is 9,348 bytes; largest MCP response is
19,954 bytes. Native artifact sizes are 361,630 bytes (Node) and 418,395 bytes
(Fastly). Full artifact SHA-256 and plan identity are retained in the start task
log. These sizes include the production corpus backing and full response shapes;
they are not an isolated callable-overhead measurement.

The original corpus identity remains
`b892b2edc0bdfcd5d9a95726ad7711a586ae2c77e5a26611fa5d1fe558a025f8`.
Text, vector and metadata resource bytes are unchanged. Configuration text is
read from the binary resource; generated computation source does not duplicate
cited full text or import the legacy corpus module. Initial Native memories each
contain exactly one full-text backing, including optimizer-split data segments.
Generic installed resource closure remains a later checkpoint.

No compiler/runtime/provider implementation changed in 05H. The byte-identical
no-call/unused baseline evidence in 05G remains historical evidence; it was not
rerun or represented as a fresh 05H result.

## Stop boundary

One migrated production tool is complete. Next: **05I (#450), read/example/
diagnostic**. Search remains 06A (#451). Full profiles, installed closure, actual
Fastly CLI/Viceroy, client acceptance and sealing remain their separate checkpoints
under the user's staged-check direction. Merge, release, deployment and
self-approval remain human-owned.
