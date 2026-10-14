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
