# 06B frozen-case review and bounded correction

The 24 query inputs, expected IDs, criteria and budgets in
`wasm/test/mcp/context-quality-cases.json` were committed in local `ba4c699`
(published `8d5d529`) before ranking measurements. That file is unchanged.
Its original `reviewStatus` is historical provenance: proposed at freeze, not
an assertion that an independent human has reviewed the later measurements.

The first full production replay found 23/24 criteria passing. Exact command
and diagnostic cases point to their literal canonical records; workflow/filter
cases select records whose source content owns the requested topic. Negative
and ambiguity cases preserve ASCII, token-count and lexical-only constraints.
The independent oracle scans the record fields directly and sorts results; it
shares neither sparse resources nor heap or response-budget arithmetic.

The failed workflow query is `compare reports`. Source inspection establishes:

- `contract/report-comparison`, sourced from the “Report comparison contract”
  heading in `docs/architecture/current-contracts.md`, owns comparison of two
  Report capsules. Its tags include `compare` and `report`, but no field contains
  the exact token `reports`.
- `command/report` documents reporting and includes `reports` in an output path,
  but does not provide the exact `compare` token.
- The selected all-term lexical encoder therefore correctly finds no joint
  match in either v1 or v2. This is a discoverability gap in corpus metadata,
  rather than a scoring, pagination or citation defect.

The bounded correction adds the truthful plural tag `reports` to the existing
comparison record's canonical declaration in `scripts/pulse-context-inputs.json`.
It keeps the frozen query and expected IDs, every corpus record, original source
content/citation identity, field weights, ASCII tokenizer, AND semantics and all
budgets. Regeneration updates corpus/resource/application identities normally.
It adds no stemming, synonym expansion, alternate encoder or semantic promise.
The initial miss and pre-correction v1/v2 outcomes remain in retained evidence;
final results compare both versions against the corrected same corpus.

This source-grounded review is the implementation agent's recorded review,
not independent human approval or a held-out quality study. The user's 06B
implementation direction includes the described tuning after freezing cases.
No new runtime, architecture or release-authority decision is required by this
metadata correction. The PR remains subject to ordinary human review.

The initial harness also treated an independent-human-review prerequisite and
an exact guest-internal allocation census as automatic acceptance blockers.
Those exceeded the ticket's stated measurement requirements. They are corrected
as evidence-coverage statements, not numerical threshold relaxations: observed
host-exported allocations/copy bytes, cumulative retained charges and peak
committed instance memory are measured, while guest-internal allocation totals
and peak live-object heap remain null/unavailable. No unknown metric is zero or
substituted for another metric. Raw initial receipts preserve these earlier
interpretations. The frozen numerical budgets and all relevance/failure gates
remain unchanged.
