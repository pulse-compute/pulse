# 05C validation and recovery checkpoint

05C (#444) is implemented on draft PR #442. It builds directly on the 05B
checkpoint and stops at helper/import composition and multiple callable owners.

- Remote branch: `codex/b10-call-proof-recovered`; local branch: `codex/b10-mcp-05c`.
- Starting delivery: `dcafb95b585c628d9e9d92ee19b3ef338f9ea335`.
- PR base/untouched baseline: `8a51d705025c69ae306004215cb6cb48248d68e1` (`latest` at inspection).
- Clean tested implementation: `5251782483c03171ca480fcf807e110bb74803cf`.
- Tested tree: `187ab39a0fad579af85ba752eddef94571b483e2`.
- Delivery adds only this handoff and retained evidence after that implementation;
  the final delivery identity is recorded on #442/#444/#436. No merge performed.

## Completed development evidence

All eight selected runner tasks completed, passed, and exited zero on the clean
implementation. `focused-clean.json` retains the exact requested/selected set,
terminal status, individual cleanup results and source revision. Adjacent task
logs are retained copies; original absolute log paths remain in the raw report.

| Check | Result |
| --- | --- |
| callable-source-admission | 9 accepted, 31 rejected |
| callable-authored-composition | 6 Node/injected Fastly executions; 16 source rejections; 11 rehashed deserialized-plan rejections |
| pure-helper-contract | ordinary source/type contract passes |
| pure-source-helpers | ordinary scalar sharing and Node/JS/Fastly parity passes |
| pure-record-helpers | 59 parity cases; 22 source and 16 plan rejections |
| pure-loop-helpers | 19 parity cases; 10 source and 12 plan rejections; 65,536 product bound |
| pure-argument-helpers | ordinary provenance/parity/tamper corpus passes |
| suite-shape | registry/profile/evidence enrollment passes |

`composition-clean.json` is extracted unchanged from the registered task's JSON
output. It records two callable owners, three sites, three helper ownership
records, same-module and re-export helper cases, sixteen admitted targets, three
logical resource bindings and two physical resource blobs. Each invocation starts
with a fresh workspace; exact Unicode and response values agree on both targets.

The separate `authored-clean.json` replay also completed with exit zero on that
same clean revision: 8 executions, 12 rejections and 2 no-call context compatibility
cases. Same-source no-call complete Wasm hashes/imports match untouched `8a51d70`.
For imported-unused, that baseline frontend rejects the source form, so the exact
new call-free plan is compiled through its untouched backend. Complete hashes and
imports match. Different no-import/unused-import sources retain distinct embedded
plan identity; executable source, byte count and imports are equal.

| Fixture | Node bytes | Injected Fastly bytes |
| --- | ---: | ---: |
| No call | 37,123 | 81,822 |
| Imported unused function | 37,123 | 81,822 |
| One authored computation | 39,494 | 84,657 |
| Two composed callees / three sites | 45,178 | 88,547 |

The last fixture includes different schemas/computation/resources and is not a
universal per-call cost or timing benchmark. Physical resource backing is eight
bytes for three logical bindings in this fixture; unselected data is absent.

Workspace build, maintenance synchronization/checks, documentation
synchronization/check/release inventory and the protected-scope declaration pass.
The dependency graph was restored during 05B from an existing identical lockfile
without lifecycle scripts. This is not fresh clean-install evidence.

## Boundaries and next action

The user explicitly directed focused checks per ticket and complete checks at
coherent integration checkpoints. No full functional profile or seal ran for
05C. Historical 05B broad attempts remain partial, with 114/166 unique development
passes across source revisions and 52 unqualified tasks. They are not fresh 05C
qualification. Injected Fastly does not establish actual Viceroy/deployed behavior.

Two early development failures were test updates: the old one-target rejection
expectation and an invalid resource ID in the new fixture. The raw failure logs
and reasons are retained in `failed-development-attempts.json`; the clean final
selection passes. No failed check remains unresolved and no check remains running.
No implementation blocker was found within this scope. Full profiles, installed
acceptance, provider reality and release sealing remain deferred.

Next action: **05D / #445**, implement the explicit JavaScript callable boundary
and same-source parity on the existing draft lineage. 05E follows after that;
05F qualifies exceptional cleanup and cumulative budgets. Public support stays
with 05G. Merge, release, deploy and self-approval remain human-owned.
