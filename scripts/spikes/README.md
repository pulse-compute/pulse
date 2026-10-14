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
VIS-02 should deepen the preferred interaction after visual review; full browser
qualification, polished graph navigation and supported-viewer integration remain
outside VIS-01.

An optional browser check uses a separately provisioned `playwright` installation:

```sh
# CHROMIUM_PATH is optional when Playwright's own browser is installed.
CHROMIUM_PATH=/path/to/chromium node scripts/spikes/check-report-graph-browser.cjs /path/to/experiment.html
```

It exercises mount expansion, table/graph selection, terminal controls, retained
links, dependency explanations and pagination, keyboard activation, zoom, empty
search, exact JSON export, and narrow-screen containment. It rejects page/CSP
errors and HTTP requests. This smoke is not cross-browser qualification.
