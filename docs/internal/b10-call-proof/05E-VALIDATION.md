# 05E validation and recovery checkpoint

05E (#446) is implemented on draft #442, branch `codex/b10-call-proof-recovered`.
Local branch: `codex/b10-mcp-05e`. This continues delivery
`f29346bb2816e532b41a14b0b0acbc02e38e861c`; actual base is `8a51d705025c69ae306004215cb6cb48248d68e1`.
No merge was performed.

## Exact source identity

- Clean tested local implementation: `88b62fc5f9b4fb74a0e2d38203987fcfd34593af`.
- Published implementation: `d5a335aeb395db912a7208a2198464405340ea73`.
- Identical full Git tree: `e68f2b42c1252fd25c986cb062828e5f1b242f8e`.

Publication uses the connector because shell push authentication is unavailable.
Each uploaded blob and the resulting full tree match local Git. The connector
supplies different commit metadata; executable source is identical. The local
branch is aligned only after a clean status and exact-tree check. The evidence
follow-up adds this handoff and logs without changing executable source; its
final delivery identity is recorded on #442/#446/#436.

## Terminal evidence

All sixteen selected runner tasks pass on the clean implementation tree:

| Check | Result |
| --- | --- |
| callable-authored-routed | 28 source executions; 12 rejection cases; inline/reused routes and multi-module bindings |
| callable-source-admission | 9 accepted; 31 rejected |
| callable-authored-composition | 6 Native executions; 16 source and 11 independently rehashed-plan rejections |
| callable-authored-javascript | 14 executions; 4 invalid-output rejections; 10 source rejections; 18 ownership checks |
| callable-authored-native | 8 executions; 12 rejections; 2 unused context-form compatibility cases |
| pure-source-helpers | Existing shared helper compilation and cross-target behavior |
| entities-managed-handler; entities-managed-handler-effects | Managed admission, effects, schemas and provider requirements |
| entities-native-runtime; entities-javascript-runtime | Existing dispatch, framing, effects and result handling |
| entities-schema-bridge; entities-package-owned-lowering | Existing schema ownership and trusted lowering boundaries |
| mcp-native-binding | 83 protocol cases across Node JavaScript, Node Native and injected Fastly Native |
| mcp-http | 114 exchanges plus bounded streams, deadlines, disconnects and real Node HTTP |
| cli-javascript-target-compilation | Original-source imports/packaging and existing Native rejection diagnostics |
| suite-shape | Registered task/profile/timeout consistency |

The new source fixture uses one imported resource/workspace/loop computation with
an imported scalar helper. Both an ordinary routed HTTP handler and one managed
MCP tool execute it on the three selected targets. Loaded and built JavaScript
packages agree. Additional cases cover two caller modules, reused and inline
routes, dormant invalid managed operations, cross-caller schema conflicts,
repeated-route limits and no-call JavaScript compatibility. Entities and MCP
receive no new primitive emitters.

The separate baseline replay passes and compares complete Wasm SHA-256 hashes,
byte sizes and import tables against untouched `8a51d70`. Identical no-call
source uses its project compiler; imported-unused call-free plans use its
backend, because the earlier frontend does not admit those imports. No embedded
plan hash is removed. Adding an unused import changes source identity, so the
no-call and imported-unused fixtures can have different hashes while retaining
equal sizes/imports; each matches its corresponding untouched-baseline output.

| Fixture | Node bytes | Injected Fastly bytes |
| --- | ---: | ---: |
| Router, no call | 38,063 | 87,771 |
| Router, imported unused | 38,063 | 87,771 |
| Router, authored call | 40,238 | 87,820 |
| MCP, no call | 99,527 | 129,895 |
| MCP, imported unused | 99,527 | 129,895 |
| MCP, authored call | 101,378 | 143,982 |

Build, maintenance, documentation check/release inventory and protected-scope
checks pass. The scope report retains the existing Entities adapter
classification warning for human review. Maintenance/documentation synchronization
completed without additional generated-source changes.

Terminal captures, baseline hashes/imports and the source-bound receipt are in
`05e-validation/`. Large documentation inventories stay in `.pulse-development/05e/`
and are marked unretained in the receipt. The focused runner terminated with exit
code 0; its redirected console file retained only the beginning. The receipt
records the complete sixteen-task selection and terminal result, and marks that
console capture partial. Development iteration failures are
resolved and summarized separately; they are not counted as passing evidence.

## Remaining boundary and next action

No check remains running and no 05E implementation blocker remains. Full profiles
remain deferred by the user's explicit checkpoint direction. This is focused
integration evidence, not release qualification, installed closure, actual
Fastly/Viceroy/client acceptance, or a seal. Dependencies remain the restored
identical-lockfile graph, not a fresh clean-install qualification.

Next: **05F (#447) only**, failure/cleanup and cumulative request budgets, on the
existing draft lineage. Public authoring/types remain 05G; application migration
and final acceptance retain their own tickets. Merge, release, deployment and
self-approval remain human-owned.
