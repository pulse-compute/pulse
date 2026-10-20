# 05D validation and recovery checkpoint

05D (#445) is implemented on draft #442, branch `codex/b10-call-proof-recovered`.
The local branch is `codex/b10-mcp-05d`. This continues delivery
`630ac449fe8900d77091551f3ae80ed541f95d02`; `latest` at inspection is
`8a51d705025c69ae306004215cb6cb48248d68e1`. No merge was performed.

## Exact source identity

- Clean tested local implementation: `f27ef5674458305dc944ec354110b0e95a5b7b9b`.
- Published implementation: `56f1e464ae4427d78bb20e839e54fb9cc65ce703`.
- Identical full Git tree: `a0d3aac1d4aebeeeb86fcf6929c64602771154f0`.

Publication used the connector because shell push authentication is unavailable.
Every uploaded blob and the resulting full tree were checked against local Git.
The connector supplies different commit metadata; no source changed. The local
branch was aligned only after a clean status and exact-tree check. The evidence
follow-up adds this handoff and logs, with no executable changes. Its delivery
identity is recorded on #442/#445/#436.

## Terminal evidence

All nine selected runner tasks pass on the clean implementation tree:

| Task | Result |
| --- | --- |
| callable-authored-javascript | 14 successful executions; 4 invalid-output rejections; 10 source rejections; 18 ownership/deadline checks |
| callable-source-admission | 9 accepted; 31 rejected |
| callable-authored-composition | 6 Node/injected Fastly executions; 16 source and 11 rehashed-plan rejections |
| cli-javascript-target-compilation | Original-source imports, Router/plain roots, doctor/test/build and independent Native rejection |
| target-support | Explicit Node JavaScript support and bootstrap regression |
| provider-toolchain | Exact provider/target/invocation boundary regression |
| javascript-effect-adapter | Request ownership, grouping, failure and observations |
| binary-resource-execution | Existing JS/Native ownership and >1 MiB raw resource corpus |
| suite-shape | 307 registered tasks; profile/timeout consistency |

The JavaScript task executes authored `ctx.call` through the graph loader, CLI
preparation and built Node package, alongside Native for the same three inputs.
It also executes re-exported application roots in both JavaScript loading paths.
Nested records, present/absent optional fields and Unicode agree. The private
host fixtures test impossible-at-source mutation, asynchronous output, wrong
schema pairs, unknown targets, lifetime escape, exceptional cleanup and inherited
deadline failure through the actual context method. These are focused boundary
checks, not full 05F cumulative-budget qualification.

The additional authored baseline replay passes eight executions, twelve source
rejections and two no-call context-parameter cases. Complete no-call Wasm hashes
and imports match untouched `8a51d70`; imported-unused call-free plans match its
backend. No plan hash is removed from the byte comparison. As before, adding an
unused import changes embedded source identity; executable source, bytes and
imports remain equal between the no-call and imported-unused fixtures.

| Fixture | Node bytes | Injected Fastly bytes |
| --- | ---: | ---: |
| No call | 37,123 | 81,822 |
| Imported unused function | 37,123 | 81,822 |
| One authored computation | 39,494 | 84,657 |
| Two composed callees / three sites | 45,178 | 88,547 |

Workspace build, maintenance synchronization/checks, documentation
synchronization/check/release inventory and protected-scope declaration pass.
The scope report retains the pre-existing Entities adapter classification warning
for human review; it does not block the declared architecture scope.

Receipts and raw focused/baseline logs are in `05d-validation/`. `checkpoint.json`
records terminal exits and log hashes; large documentation inventory outputs
remain in `.pulse-development/05d/` and are marked unretained in the receipt.
Development iteration failures are resolved and summarized separately in the
receipt; they are not counted as passing runs.

## Remaining boundary and next action

No checks remain running and no 05D implementation blocker remains. Full profiles
are deferred by the user's explicit direction to stack complete checks at coherent
integration checkpoints. Historical 05B/05C evidence does not qualify this source.
Installed closure, cumulative budgets, real provider/client acceptance and release
sealing retain their later gates. Injected Fastly is not Viceroy/deployed evidence;
there is no Fastly JavaScript MCP support claim.

Dependencies remain the restored identical-lockfile graph with relative workspace
links and no lifecycle scripts. This is not fresh clean-install qualification.
Public authoring/types remain 05G. Merge, release, deployment and self-approval
remain human-owned. Next implementation unit: **05E (#446) only**, Router and
managed MCP callers on the existing draft lineage.
