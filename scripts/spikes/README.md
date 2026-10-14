# Report execution graph spike

Experimental presentation work targeting `latest` through the separate
`spike/report-execution-graph` branch. This directory creates no public CLI
contract or execution semantics. No exact repository Entry Point matches this
evidence-only work; the ordinary root instructions apply.

## Capture first

Use a completed report produced by the selected Pulse checkout. Record the
application commit separately from the Pulse commit and the effective build
recipe. Preserve the canonical report JSON so every visual experiment can reuse
the same input without another compiler build.

Run the coverage audit on a canonical capsule (not the CLI response envelope):

```sh
node scripts/spikes/report-graph-audit.cjs /path/to/capsule.json > /path/to/audit.json
```

The audit validates the capsule with the existing report reader before counting
its retained definitions, registrations, mount depth, continuation links, use
sites and association paths. Missing analytics remains not-recorded. Complete
coverage refers only to the compiler's retained static analysis basis.

Keep private Catalog source, compiled artifacts and report data outside this
public repository. The spike's initial source baseline is Pulse `3aa520f`
(AN9-05); subsequent captures must name their own exact revisions.

## Visual experiments

Compare three presentations of one snapshot:

1. Routing atlas: expandable mount instances, with stable placement and scoped
   middleware. A reused definition remains one definition with separate uses.
2. Execution lanes: focus a registration and follow retained continuation and
   child/parent-return links. Keep normal, error and event lanes distinct.
3. Dependency view: select a capability or binding and inspect each retained
   use-site explanation and contextual consumer.

Link graph selections to execution-table rows and authored evidence. Preserve
conditionality and partial coverage. Do not turn the legacy composition list
into a proven execution sequence or animate static paths as observed requests.

Catalog's staged composition makes route selection followed by shared admission
and later operation handling an important usability case. Test that the UI can
explain that structure rather than assuming each matching route is terminal.

No new graph library or production dependency is selected in this capture step.
Prototype validation is focused; sprint-boundary acceptance remains separate.

## VIS-01: three linked graph treatments

Generate a self-contained experiment from a validated canonical capsule:

```sh
node scripts/spikes/report-graph-html.cjs /path/to/capsule.json /path/to/experiment.html
node scripts/spikes/check-report-graph.cjs
```

The generator refuses to overwrite an existing output. The HTML retains the
whole canonical capsule for export, uses no CDN or network requests, and adds
no production dependency. Its styles allow inline positioning for graph nodes;
its JavaScript and stylesheet are bound by CSP hashes. All evidence text enters
the interface through text nodes. This repository-only prototype does not
replace or change the supported report viewer.

- **Atlas:** expand individual mount instances; search paths, names and sources;
  select graph nodes and execution-table rows to inspect the same registration.
  Layout is deterministic. Curves mean containment, not execution. Mount labels
  use the first child's source-file basename when available; full instance IDs,
  source spans and mount ancestry stay available in the inspector.
- **Lanes:** explore incoming and outgoing retained links around one selected
  registration, separated into normal, error and event bands. Next means next
  dispatch candidate, including unmatched candidates. Terminal control facts
  remain visible. An error possibility never creates an inferred target edge.
- **Dependencies:** choose a binding or capability, focus an authored owner, and
  select a contextual consumer to inspect every retained explanation and its
  ordered hops. Owners and consumers are paginated independently in groups of
  eight; all records remain in the capsule. Missing associations never mean no
  use. Unknown conditionality and partial coverage remain explicit.

### Evaluate with Catalog

1. Expand the selection mount, locate a route, and find its definition/source.
2. Follow dispatch links from selection toward admission and operation routing.
   Explain which links are candidates and where a matched handler can terminate.
3. Choose a binding and explain one contextual consumer through the exact retained
   mount/middleware/helper hops. Check partial association coverage is apparent.
4. Compare a reused handler's registration instances without duplicating its
   authored definition. Check search, keyboard selection, zoom, narrow-screen
   scrolling, and evidence export.

Record initial load and interaction timings as local browser observations, not
runtime performance. Keep the runnable private Catalog HTML outside this repo.
VIS-02 deepens routing-atlas navigation. Full browser qualification and
supported-viewer integration remain outside these presentation experiments.

An optional browser check uses a separately provisioned `playwright` installation:

```sh
# CHROMIUM_PATH is optional when Playwright's own browser is installed.
CHROMIUM_PATH=/path/to/chromium node scripts/spikes/check-report-graph-browser.cjs /path/to/experiment.html
```

It exercises mount expansion, table/graph selection, terminal controls, retained
links, dependency explanations and pagination, keyboard activation, zoom, empty
search, exact JSON export, and narrow-screen containment. It rejects page/CSP
errors and HTTP requests. This smoke is not cross-browser qualification.

## VIS-02: focused atlas navigation

The atlas is the primary direction for this iteration. Execution lanes and the
dependency lens remain available against the same capsule and selected record.

- **Focus subrouter** isolates one mount instance and its descendants. The table
  follows that exact scope. Breadcrumbs return to enclosing mounts or the whole
  application. Selecting a record outside the current scope restores application
  context; sharing a definition never pulls another mount instance into scope.
  Bright curves highlight the selected mount ancestry, not an execution trace.
- **Open one level** expands the shallowest collapsed mounts. Search temporarily
  reveals matching ancestry within the current scope without changing saved
  expansion state. Expansion controls are disabled while searching. Clearing the
  query restores that state. The graph reports visible nodes separately from all
  scoped registrations; a mount's contained count excludes the mount itself.
- **Pan and zoom** use drag on empty canvas, native touch scrolling, zoom buttons,
  and Ctrl/Command + wheel anchored at the pointer. **Fit** frames visible nodes;
  **Center selection** reveals a selected registration hidden by collapsed nodes.
  Overview size does not represent traffic, invocation counts or physical bytes.
- **Minimap** shows the current graph and viewport. Click to reposition; when it
  has keyboard focus, arrows pan and Home fits the graph.
- **Keyboard selection** uses Up/Down for visible registration order, Right to
  expand or enter a mount, Left to collapse or return to its parent, and Home/End
  for the first/last visible registration. Enter/Space activate nodes. Focus
  survives graph redraws and the selected node is scrolled into view.
- **Previous/next selection** retains up to 100 registration selections without
  touching the capsule. A new selection discards the forward selection history.
  This history is session-local; it does not represent execution history.

The optional browser smoke also runs `check-report-graph-navigation.cjs` against
an actual capsule. It checks scope/table agreement, keyboard traversal and focus,
selection history, fit, drag, anchored wheel zoom, minimap movement and centering.
No compiler rerun is needed: compare VIS-01 and VIS-02 with the same retained
Catalog capture. This remains a standalone experiment; production report
integration and broad browser/device qualification are future work.

## VIS-03: evaluate and propose integration

Read [the evaluation and bounded integration proposal](VIS-03-evaluation.md).
The recommendation is a focused atlas with contextual dispatch/dependency
drill-downs and a linked table. This ticket does not change the supported viewer.

The optional walkthrough records exact case identities, local interaction
observations, screenshots and a terminal receipt in a **new** output directory:

```sh
CHROMIUM_PATH=/path/to/chromium node scripts/spikes/evaluate-report-graph.cjs \
  /private/experiment.html /private/scenario.json /private/new-evaluation
```

The scenario is JSON with `scopeOrder` (mount), `routeOrder` (its descendant),
`reuseOrder` (a registration whose definition is reused), `laneOrders` (at least
two registrations joined by retained `next` links), `bindingId` and
`associationId` (an existing explanation for a use of that binding). Orders are
the capsule's zero-based order values. Choose these from retained facts, never
rewrite the capsule to fit a scenario. The tool validates the capsule before
opening the HTML and rejects invalid case relationships. Use only a locally
generated trusted graph HTML file; this is not a general HTML sandbox.

All output, including scenario IDs and screenshots, may contain private data.
Keep it outside this repository. Existing directories are refused, preserving
failed attempts. `evaluation.json` records `running`, then terminal `passed` or
`failed`; an interrupted `running` receipt is incomplete. A passed walkthrough
does not mean a view is usable: unreadable global Fit and partial associations
are findings, not data to hide. The historical-capsule browser smoke remains
the absence check; Catalog contains no event registrations.

## VIS-04: integrate the focused atlas

VIS-04 implements the first integration slice proposed as VIS-I01 in VIS-03.
The supported renderer now has an Execution atlas section alongside the existing
report views, with exact mount scope, a paginated registration table and links to
existing registration/definition details. This does not port the standalone
lane or dependency graph treatments; those remain contextual integration work.

The SVG port preserves `style-src-attr 'none'`, the single canonical payload,
exact JSON export and the existing HTML output budget. The presentation bounds
graph DOM to 300 nodes and table pages to 50; it never discards capsule records.
Fit keeps a readable minimum scale. Narrow screens start with the table and
selection panel; the graph can be explicitly opened. Browser history navigates
selected registration hashes. Broad device/assistive-technology qualification
remains separate.

Focused browser validation uses the same optional external Playwright setup:

```sh
CHROMIUM_PATH=/path/to/chromium node scripts/spikes/check-integrated-atlas-browser.cjs /path/to/report.html
```

This checks the supported renderer's CSP, scoped table, selection/source links,
keyboard focus, history, readable Fit, complete table pagination, themes,
narrow-screen graph opt-in, exact JSON export and absence of HTTP/page/CSP errors.
Use a historical capsule too to verify analytics absence. No exact named Entry
Point covers renderer integration; ordinary root, Wasm, CLI and canonical-doc
instructions apply. Human direction to implement VIS-04 authorizes this first
slice; merging remains human review against `spike/report-execution-graph`.


## VIS-05: expanded workspace and binding explorer

VIS-05 integrates the contextual binding view into the supported HTML renderer.
Open **Execution atlas → Expand workspace → Bindings**, or select a registration
and choose **Explore bindings**. Binding inventory cards provide direct graph
entry points. The full-window workspace preserves routing camera and selection,
provides a collapsible details panel (three widths on desktop, a bottom sheet on
phones), and keeps the table behind a disclosure. Escape restores the report.

Consumer groups retain exact mount/definition identity. Counts separate consumer
instances, authored sites and association rows. Association coverage stays
visible; missing consumer edges never imply an unused resource. Operations are
canonical recorded operation names, not inferred read/write classifications.
Selecting a consumer or operation opens existing source and association
explanations, including conditionality, lanes and helper-call paths. Graph pages
are bounded to 12 consumers and 12 operations; explanation pages to 20 rows.

```sh
CHROMIUM_PATH=/path/to/chromium node scripts/spikes/check-binding-workspace-browser.cjs /path/to/report.html
```

The browser check covers expanded geometry, camera continuity, binding counts,
scoped registration joins, navigation in both directions, panel sizing, Escape
focus, mobile resource selection and bottom sheets, exact export, strict CSP and
no network requests. Optional `VIS05_SCREENSHOT` and `VIS05_MOBILE_SCREENSHOT`
paths capture private local review images. Run the VIS-04 browser check too for
routing regression coverage and a historical capsule for analytics absence.
Use focused `cli-report-viewer` and `report-capsule-contract` tasks for canonical
join, identity, historical-absence and export checks. Full acceptance remains a
sprint-boundary task; these checks do not claim broad device qualification.
