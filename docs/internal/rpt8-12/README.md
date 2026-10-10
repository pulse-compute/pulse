# RPT8-12: Report coverage reconciliation

RPT8-12 closes the focused integration pass after RPT8-06 through RPT8-11,
including the agreed extension to reconcile the resulting report. It does not
claim complete attribution. This packet adds a combined synthetic regression
and an opt-in retained-report replay helper; product behavior is unchanged.

The integration run also exposed a stale graph-test assertion: v1 and v2
reports were expected to have identical hashes even though v2 now retains the
RPT8-08 implementation inventory. The corrected regression checks distinct
evidence identities, identical physical/measurement/diagnostic records, and
identical canonical serialization after removing only that optional inventory.
The reader and hash contract are unchanged.

Base: merged RPT8-11, `6fd8f5898876e830dabd0fe1fc5128ffa670c7b2`, tree
`f557b56da70d735494aa40eb9d3548d4677d9bdf`.
Entry point: none matches; ordinary root/Wasm/CLI/documentation instructions
apply. Classification: evidence. No release, dependency or profile changes.

## What changed, and what remains unknown

This is a contract/evidence comparison across the sprint, not a fresh benchmark
or a promise that a newer reader can repair an older capsule.

| Original gap | Result after RPT8-06–11 | Remaining boundary |
| --- | --- | --- |
| Helper schema uses lacked consumers | Unambiguous generated helper ranges join validated callers; repeat calls deduplicate and stage registrations remain distinct | Missing/foreign/ambiguous ownership stays incomplete |
| Package schemas looked unexplained or unused | Exact trusted reference joins can label external packages; no observed use and unresolved consumers are distinct states | JWT internal consumer tracing remains unresolved; unproven schemas are retained, not declared removable |
| Large named graph text hit 32 MiB first | 160 MiB text ceiling exposes the next supported/unsupported result, with structured diagnostics | Indirect/table/reference/tail control remains unsupported; no partial closure or complete Own/Shared root claim |
| Shared implementation detail was hidden | Authored helpers and consolidated stages have body unions and consumer links; middleware remains a semantic role | Associated helper code is nonadditive and is not exclusive route size |
| Dispatcher gaps had no drill-down | Associated carrier bodies and their known consumers are inspectable by physical identity | Whole dispatcher bytes cannot substitute for route Handler body, Reachable, Own or Shared |
| Packed assets and inline responses were conflated | Packed assets retain input/base64 sizes; canonical text-response sites retain proven UTF-8 sizes and consumer associations | Native string representation and final retained payload bytes remain unavailable; dynamic sizes are not zero |
| Historical replay could appear to gain evidence | Missing optional inventories stay absent, with unchanged canonical bytes and identity | Fresh producer evidence requires a new build; replay does not backfill it |

Physical section/body ledgers remain separate from every resource input count
and overlapping logical implementation view. No data-segment matching, retention
changes, new exports, optimizer changes or general call-graph solver are added.

## Combined regression

`wasm/test/cli/report-reconciliation-cases.cjs` runs inside the existing
`cli-report-viewer` task. It joins the existing synthetic helper/dispatcher,
reference, schema and response-resource producers in one validated capsule.
It adds no task, aggregate profile or default release gate.

| Synthetic observation | Expected result |
| --- | ---: |
| Routes / schemas | 2 / 3 |
| Logical helper/stage rows | 4 |
| Sum of individually mapped helper rows | 10 bytes, overlapping |
| Distinct helper body union | 6 bytes |
| Associated dispatcher body | 4 bytes, also used by a dedicated implementation |
| Physical code / whole artifact | 10 / 36 bytes, unchanged |
| Text-response sites / resolved sizes / dynamic sizes | 8 / 6 / 2 |
| Packed asset input / base64 representation | 12 / 16 bytes |
| Known empty response | Available, 0 bytes |

The schema rows cover known use, an external reference without a consumer, and
no observed use without proof of non-use. Schema-codec descriptor size joins the
correct schema. Both route drawer tabs retain dispatcher qualifications and
helper links. Rendering all inventories preserves measurements, physical
ledgers, canonical export and privacy canaries. A historical capsule lacking
all three optional inventories remains unchanged and displays missing evidence.

These numbers are deliberately tiny synthetic facts, not application sizes.
The initial fixture attempted to add an already-present schema consumer twice;
capsule validation rejected it. The fixture now deduplicates the accumulated
consumer list, as the production inventory does. No product validator was relaxed.

## Bounded validation

Run this selected integration set from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs \
  --task cli-report-viewer --task report-capsule-contract \
  --task cli-report-entry-proof --task cli-report-reference-provenance \
  --task cli-report-resource-inventory --task cli-report-graph-diagnostics \
  --task cli-report-size-evidence --task cli-report-retained-evidence \
  --task jwt-package-owned-lowering --report /absolute/results/rpt812.json
```

Confirm terminal status, all nine completed tasks, child exit codes and tested
source identity. Existing entry/capture, reference and resource fixtures compare
observed/control builds and response behavior, including default and bounded
optimization cases. The retained lifecycle covers portable/provider artifacts,
completion identity, missing/tampered evidence and passive replay. JWT's existing
lowering fixture proves actual external recognition; the combined viewer's
`@example/codec` label is synthetic. Graph diagnostics preserve physical evidence
when closure proof fails. These are focused development checks, not a release seal.

Reuse [RPT8-05 installed qualification](../rpt8-05/README.md) for installed
candidate evidence. This pass does not repeat package installation, a full
release suite, private application rebuilds, or production performance testing.
Real-browser layout/focus/download and CSP enforcement remain unqualified in this
environment; element-recorder and encoding tests do not stand in for a browser.

## Retained consumer reconciliation

For a previously collected canonical capsule and its matching completed build:

```sh
node docs/internal/rpt8-12/replay.cjs \
  /private/prior-capsule.json /private/build/pulse-build.json \
  /private/results/fresh-reconciliation.json
```

The opt-in helper refuses an existing output, repository output, or output inside
the build directory. It blocks compiler/provider/configuration/subprocess/network
loads. It validates the historical capsule and current artifact collection,
asserts identical physical artifacts, measurements, routes and schemas, checks
repeatable HTML and exact embedded JSON, and emits bounded before/after coverage.
It does not execute application source or rebuild artifacts. Different builds
must not be supplied as a matching pair.

Retained ARC and Catalog pairs were replayed successfully during this pass.
New implementation views can be derived from existing attribution sidecars;
missing response-producer, external-label and graph evidence is not synthesized.
The historical capsule itself is never upgraded. Private source, application
inventories, measurements, hashes and raw receipts stay outside this repository.

## Follow-on boundary

Exact route-specific dispatcher attribution, complete execution roots and final
payload identity remain open proof obligations. Later UI8 identity/navigation,
BLD8 build metadata, CMP8 comparison and PERF8 baseline tickets remain separate.
RPT8-12 neither implements nor silently qualifies those groups.
