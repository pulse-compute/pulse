# B10-MCP-08 — callable sources and resource reporting

Issue #455; PR #475; branch `codex/b10-mcp-08`, targeting `latest`.

## Scope and result

The report observes existing admitted callable sources and Native plans. Original
callee, helper and call-site spans retain their source hashes. Shared Router
registrations retain separate consumers; missing entry ownership stays partial.
The executable plans and emitted Wasm do not contain report-source metadata.

Binary resources expose admission budgets, manifest sizes, logical aliases,
Native selection and unique backing identities. A bounded proof identifies
unambiguous, disjoint raw data ranges in the exact Wasm artifact and deducts their
union once from the unattributed data ledger. Retained replay verifies placement
and hashes again. JSON, terminal and existing resource-detail HTML views expose
the same facts. Payloads and manifest paths are excluded.

Per-callee final code sizes, instance/process memory and runtime copy counts
remain unknown. Native selection does not claim execution frequency. Historical
06B/07B receipts are not imported as fresh build evidence. This does not implement
#440, change provider capability or close resource acceptance #412. Actual
Fastly/Viceroy qualification remains 10A.

## Recovery and source identity

The interrupted implementation survived in commit `1c7cedc`. Every tracked file
in the surviving checkout matched that pushed commit. The checkout's Git
metadata pointed to a removed directory, so recovery used a separate checkout.

The follow-up reconciles `latest` at `e77c362` (including #474/#468). Conflicts
were confined to generated context files. Canonical context resources and CLI
mirrors were regenerated with the required Node 24.18.0, followed by ordinary
documentation synchronization. The original build/CI failure was a stale
`context-data/vector.bin`; both Node-floor build and Documentation CI pass after
regeneration.

Published implementation commit: `c8fa3a1379ac2d1636fdd586a27448eb934d7071`.
Local validation commit: `f19edac` (full identity in receipts/source.json).
Both have the identical Git tree `f5299e5b809bd31d6d93754b5cf63fa5282794d8`.
GitHub write access was through the connector, so commit metadata differs; the
source tree was explicitly compared before publishing. These are development
checks, not release-seal receipts. The later evidence-only commit adds this
handoff and receipts without changing executable source or generated resources.

## Targeted evidence

The generic resource/callable fixture retains two callees and three authored
sites. Six logical bindings have four unique backings; five selected bindings
have three selected backings (including an empty backing). Selected and observed
raw payload bytes both equal 1,052,676. Eleven hostile/inconsistent cases are
rejected. Its Wasm SHA-256 is
`44dbef64ba0f5f804f6d28d318b76478aaa204b957f7eb0a214020281cce978f`.

The topology proof covers HTTP, event and combined cells under default and
bounded-size recipes: six cells, 176 executions and 54 negative cases. It checks
unchanged plans/source/Wasm, effect order, retained source-free replay, HTML,
semantic comparison, source locations and older capsule compatibility.

## Failed attempts and limitations

The interrupted work's later unit run failed a topology plan comparison after
an earlier development pass. In recovery, the first focused run failed with
`REPORT_MISSING_COMPLETION` during full/default retained replay. Both failures
are retained; neither is counted as a pass. The subsequent diagnostic run and
the independent unit and CLI topology runs passed without changing the test or
weakening evidence admission. The precise cause of the intermittent earlier
failure has not been established. The first recovery run overlapped dependency
setup; the successful profile checkouts had finished dependency setup before
starting. That timing is context, not proof of causation.

The historical `REPORT_ARTIFACT_HASH` uncertainty was not reproduced or resolved.
Browser visual qualification, real Fastly execution and release sealing are not
claimed by this reporting slice.

## Next boundary

Review/merge PR #475, then proceed to #456 / B10-MCP-09A: vector freshness in
sealing. Merge and release remain human-owned. See receipts/summary.json for
checkpoint task results; running profiles are not passing evidence and receipts/source.json for the tested source mapping.

## Review checkpoint

All three PR workflows passed on the published implementation commit: Maintainer
scope, Documentation, and Repository validation (including Node-floor and fast
portable). Full local profiles were launched in isolated checkouts and are
recorded at this checkpoint as running, not passing. They are not a prerequisite
claim for this bounded reporting handoff and do not authorize a release. Their
absolute report/checkouts are recorded in receipts/summary.json for recovery.
