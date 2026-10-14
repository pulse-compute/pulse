# VIS-03: evaluate the execution graph spike

Status: evaluation complete; integration proposal for human review. No supported
viewer, compiler, runtime, schema, budget or CLI behavior changes in this ticket.

## Decision

Promote the **focused routing atlas** as the proposed primary graph treatment.
Keep retained dispatch links and dependency explanations as contextual
drill-downs from the selected registration or binding. Keep the execution table
as an equal navigation surface. Do not ship three competing top-level graph tabs
or an expanded application-wide graph as the default.

The useful moment is moving from application structure to one subrouter, one
registration and its evidence without losing identity. A graph of every record
is visually impressive only until its labels disappear. This is an evaluator's
recommendation, not a user-study result or approval to integrate.

## Evidence and limits

The walkthrough used the unchanged VIS-02 HTML from spike base `29d8c6c`.
Its source tree matches the tested VIS-02 PR. Capture identity:

- Pulse source: `a1ab879508b3f3a6c6f541d0094d04e49a337794`.
- Catalog source: `54a5bb5876f228a5778b66fb9beb2b2007cf5d18`.
- Recipe: Fastly Native, experimental native bounded size.
- Capsule: `d7a2c19daeeedbf435ebadd83453cc6ff7960d4534a826142e1ca56d99e34533`.
- HTML SHA-256: `b1ca01ceba2001c7419f5795236528e5fc00842f61f5458d7f69019b2a1cac5b`.
- HTML size: 33,830,872 bytes. No compiler rerun or new capture.
- Browser: Chromium 138.0.7204.0, headless, 1600 × 1150 and 390 × 844.

The private illustrated review contains the screenshots, scenario, exact source
spans, IDs and terminal evaluation receipt. Those files remain outside this
public repository. The reusable walkthrough lives in
`evaluate-report-graph.cjs`; run instructions are in the spike README.

| Retained inventory | Observation | Interpretation |
| --- | ---: | --- |
| Registrations | 255: 100 routes, 116 middleware, 38 mounts, 1 error | Complete within the retained static basis |
| Authored definitions | 214 | Six definitions have multiple registration instances |
| Authored use sites / helper calls | 6,398 / 141 | Retained inventory complete; individual facts may be unavailable |
| Contextual association rows | 10,000 | Partial: `graph-budget-exhausted`; expected count unknown |
| Registrations with any retained association | 7 | Orders 1, 2, 3, 4, 6, 8, 9 only; this is row occupancy, not a coverage percentage |
| Capability facts unavailable | 1,175 sites | Complete site enumeration does not mean complete capability attribution |
| Unresolved binding facts | 271 sites | Cannot be converted into named bindings by the view |
| Event registrations | 0 | Catalog cannot qualify event behavior |

The other 248 registrations having no retained association is **not** evidence
that they use no capability. The 40 MiB input budget did not change the separate
association derivation bounds. Even a complete individual explanation does not
make the overall consumer list complete.

## Questions tested

Orders below are the retained zero-based `order` values displayed by the spike.
They are snapshot-local identifiers, not cross-build identities. The supported
viewer currently displays registration ordinals starting at one; integration
must choose one convention and retain the exact ID in details.

| Question | Observed answer | Judgment |
| --- | --- | --- |
| Where does a route belong? | Focused mount #19 contains 87 registrations including itself. Nine visible nodes summarize its eight child mounts. Route #21 resolves through mounts #19 and #20 to its exact authored definition and separate registration source. The scoped table has exactly 87 rows. | Atlas succeeds; useful beyond an overview screenshot. |
| Does matching the selection route terminate execution? | Route #21 records normal continuation and no terminal outcome. The lane walkthrough follows retained root candidates #19 → #106 → #131 → #134 → #143 → #177. | Useful structural explanation, but not a feasible request path. It does not prove which later stage handles a request. |
| Can a terminal handler still have a next link? | Route #1 has a terminal outcome, no normal continuation and a next candidate. The lane note distinguishes candidate dispatch from matched execution. | Preserve the distinction next to the edge, not only in a global disclaimer. |
| Is reuse one definition or duplicated handlers? | Registrations #147 and #190 share one definition and have two distinct mount paths. The inspector links both instances and preserves their shared authored identity. | Works; keep instance identity separate from definition identity. |
| Why does a binding appear? | One resolved binding has 41 authored owners, 93 sites and 3 retained contextual consumers. The selected conditional explanation has 24 ordered hops including a helper, with partial `unsupported-mapping` coverage. All hops and the exact use-site source remain available. | Individual explanations are inspectable; a complete application-wide impact answer is unavailable. |
| Does a global Fit make the application readable? | Full expansion creates 256 nodes including the synthetic application root, in a 1,760 × 17,011 canvas. Fit selects 3.0% in a 540px-high viewport. | Fails as a reading view. Focus and progressive expansion are essential. |
| Does narrow layout remain usable? | At 390px, horizontal overflow stays within graph/table and export is unchanged. The selected evidence is below the canvas. A prior 3% fit persists during selection. | Containment passes; mobile usability remains limited. A readable list-first presentation is preferable. |

These are automated task walkthroughs plus visual inspection, not measured
human completion times. One local run observed load-to-visible graph at 595ms,
scope focus at 141ms, route selection at 126ms, candidate selections at 94–100ms,
binding selection at 61ms, and all-level expansion at 395ms. Timings include
Playwright actionability and two animation frames; exclude capsule validation
before browser launch. They are neither runtime measurements nor percentiles,
and do not establish a cross-device performance target.

## What to keep, change and defer

| Treatment | Keep | Change before supported integration |
| --- | --- | --- |
| Atlas | Exact mount scope, progressive expansion, ancestry highlight, linked table, breadcrumbs, previous/next selection, keyboard navigation | Integrate with existing report selection; make search accessible next to the graph; prefer scope fitting and readable zoom on selection; avoid relying on first-child filenames as authoritative router names |
| Lanes | One-hop next/child/parent-return evidence, exact control facts, separate lane meanings | Overlapping labels around admission obscure link types. Use a bounded adjacent-link list or separated edge labels. Label empty lanes as no retained links, not impossible execution. Keep error possibility explicit without inventing target edges |
| Dependencies | Owner versus consumer separation, exact explanation/source, coverage and conditionality, bounded pagination | The selected explanation's owner can be off the visible owner page. Focus/reveal its owner and show the missing-record state locally. Replace a long numbered dropdown with operation/source filtering; allow helper hops to open authored details |
| Narrow screen | Same evidence and export, local scrolling | Use table/list and inspector first; graph as an explicit expansion. Keyboard smoke and viewport emulation do not qualify touch, assistive technology or other browsers |

The partial-coverage banner scrolls out of view in the dependency screenshot.
The explanation says partial but its reason is in raw evidence. Integration must
put both overall truncation and per-explanation uncertainty near the selected
answer, including when an answer has no retained rows.

Do not add runtime animation, traffic widths, invocation counts, deletion savings,
physical size attribution or inferred missing links. Do not raise graph budgets
as a presentation fix. The retained association distribution is a separate
analytics investigation if complete consumer answers become a requirement.

## Bounded integration proposal

The report remains offline and self-contained. Reuse the existing capsule and
Handlers/registration/use-site detail navigation. No graph library, report
schema, compiler, public CLI flag or new network access is needed for the first
slice. No integration is implemented or approved by this evaluation.

Read-only integration review also checked `latest` at
`2497084d1d2e000f0d70ef2a0874af6a0dba116c` (AN9-07). The single-report renderer
and its model/UI assets match this spike baseline. The comparison viewer has
an unrelated change; do not overwrite it when the spike is reconciled.

| Proposed ticket | Boundary and implementation | Acceptance / stop condition |
| --- | --- | --- |
| VIS-I01: focused atlas in the existing report | Extend `wasm/packages/cli/src/internal/report/viewer/model.js`, `viewer.js`, `viewer.css`, `shell.html` and renderer asset assembly only as needed. Add a graph treatment beside the execution/registration table, use existing ID-based links, preserve report summary/provenance and source details. Port deterministic layout concepts, not the standalone shell. | Search → exact instance → source and back; scoped table agrees; reused definitions stay separate from registrations; missing analytics stays unavailable; full JSON export unchanged. Keep existing CSP and output budgets. |
| VIS-I02: contextual explanations | Selected registration gets bounded incoming/outgoing links and exact control labels; selected binding/use site gets authored owner and retained consumer explanations through existing details. Improve owner visibility, long-hop navigation and local coverage labels. | Terminal-plus-next, parent return, reused mounts, normal/error/event distinctions, unknown conditionality, unresolved binding and truncated/absent associations are explicit. No generated feasible request path. |
| VIS-I03: qualification and presentation polish | Reuse public synthetic fixtures; retain private Catalog capture outside the repo. Qualify desktop keyboard/focus, screen reader labels, supported browser policy, light/dark and narrow list-first layout. Add lazy graph construction when needed by the existing renderer. | Agree a measured interaction budget and supported browsers before claiming performance. Run targeted `report-capsule-contract` and `cli-report-viewer` tasks plus relevant maintainer/docs checks; perform broader sprint-boundary acceptance separately. Human review controls promotion. |

The supported renderer currently has `style-src-attr 'none'`, whereas the spike
uses inline CSS positioning and CSS zoom. **Do not copy that CSP relaxation.**
For VIS-I01, prototype SVG geometry/viewBox attributes with hashed stylesheet
classes under the existing CSP, and verify keyboard/focus and browser behavior.
If the positioning cannot preserve the supported policy, stop that integration
slice for a design decision. The supported HTML ceiling remains 64 MiB; the
embedded canonical JSON must remain a single unchanged payload.

The viewer model already owns registration/definition/use-site indexes and
hash navigation. Avoid a second independently selected record, duplicated
capsule, or independently recomputed association table. Mount labels must show
retained match and instance identity; source basenames may be secondary hints.

## Qualification status

The VIS-03 walkthrough passed all configured cases, exact export, no HTTP
requests and no page/CSP errors. Screenshots were inspected for scope,
admission links, dependency explanations, global Fit and narrow layout. Existing
VIS-02 focused model/browser evidence remains the navigation baseline; VIS-03
does not alter those assets. This evaluation makes the limits visible instead
of treating a passing smoke as a usability or production-readiness certificate.

Unresolved: real user comprehension, event-heavy applications, broad
browser/device/assistive-technology behavior, a new capture after later analytics
work, and supported-viewer integration. Human review selects whether to proceed
with VIS-I01. Merging remains human-only.
