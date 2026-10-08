# PRPT-05: Offline Report viewer

Implements the HTML renderer in the [v2 plan](../prpt00/feature-spec-v2.md),
using the frozen [capsule](../prpt01/README.md), [retained evidence](../prpt02/README.md)
and [size adapter](../prpt03/README.md). It closes PRPT-04's renderer and generated
output snapshot gaps. **A09/A16 real-browser qualification is still open**;
implementation and portable assertions are not a claim that mobile, file opening,
focus behavior or visual fidelity passed in a browser. See [validation](validation.md).

Entry point: none; ordinary root/wasm/CLI/docs chain. Human direction: implement
PRPT-05, PR against `latest`; base is PRPT-04's merge `246247a`.
Classification: scope-expansion. Ticket recommendation remains **Sol / high**.
No agents were delegated. No compiler, runtime, provider, config, package-export,
production-dependency or release authority expansion is introduced.

## Locked design

The exact [ARC fixture identities](../prpt00/feature-spec-v2.md#19-locked-arc-design-baseline-and-library-asset-manifest)
were materialized and SHA-256 verified before implementation:

| Fixture | SHA-256 |
|---|---|
| Pulse-Report-ARC-Design.html | `4fb0dbdfb90f20bebb3e702eb50f1cd30f8e4b8cb38bb0a1ec7e1394717874f9` |
| Pulse-Report-ARC-Fixture.json | `1833a078007104fee92e81154245237036666c896d991dfe8a129094103ba481` |
| Routes preview | `525d32959c1418a6c3dcef5902f8d36cde0e494df022958110e2239377ad2c2e` |
| Expanded schema preview | `6e661cc7aaa63e905de1bf1fe3c1e11d2483176807e30fc924f0215adf990990` |

The fixed shell/CSS follow the compact slate sidebar, header, summary strip,
route-first table, drawer, schema inventory and two-column expansion. Fixture
JSON is synthetic design data, not a Report v1 capsule or measured application.
It is not shipped or converted into fabricated application facts.

## Implemented behavior

- `pulse report --html [--out file.html]` writes a single self-contained document
  and prints its path; the default is `.pulse/reports/pulse-report.html`. No
  browser opens. Project, verified-artifact and historical replay have distinct
  freshness labels without changing capsule identity.
- Routes retain registration order and identity, text search, method/declaration/
  binding/availability filters, reset, visible/total counts and safe internal
  anchors. Path-prefix groups are labeled as such; no inferred authorization or
  middleware grouping. Handler body / Own / Reachable / Shared sort by raw bytes
  for one primary artifact/stage, with unknown values last and coverage visible. Multiple records for the same
  subject/metric are left unavailable rather than silently selecting one.
- The route drawer has Resolved facts / Size attribution / Evidence trail tabs.
  Declaration evidence does not imply effective permissions; shared sizes are
  nonadditive and unavailable measurements do not become zero or removal savings.
- Searchable/sortable schemas expose top-level/required keys, descriptor bytes
  and route references. Expansion renders property/type/required rows, descriptor
  representation, source, producer evidence and referencing routes. N/A and
  unavailable states stay distinct. The descriptor is explicitly not compiled
  validator/Wasm size. Collapsed schemas defer detail construction.
- Resource details distinguish input from retained payload; physical section and
  code/data ledgers stay separate from route attribution. Bindings, coverage,
  observations, entry records and provenance expose retained evidence only.
- Raw JSON and Blob download contain the complete deterministic capsule, including
  records hidden by filters. Theme and navigation do not alter evidence.
- Semantic tables, labeled sort/expand controls, visible focus, dialog inertness,
  tab keys/Escape/focus restoration, reduced motion, horizontal narrow tables and
  light/dark preferences are implemented. Their browser qualification is pending.

## Output safety and repeatability

The capsule is validated/redacted by the existing allowlisted contract before
rendering. HTML embedding escapes closing-script/context characters. Dynamic
content uses text nodes; application strings never become scripts, event
attributes, URLs or navigation selectors. A fixed SHA-256 script/style policy
blocks remote resources and connections; no framework, remote font, telemetry,
service worker or runtime network dependency is added. Rendering preserves the
16 MiB capsule limit and rejects HTML over 64 MiB after context escaping.

The contained atomic writer rejects recorded build inputs as destinations.
Output names follow the retained reader’s relative-path rules: no control, colon
or percent/URL-escape characters, traversal or symlinks. This prevents writing a
report that its own subsequent freshness scan cannot read.
Alongside the intended HTML it writes an internal `.pulse-report-outputs` receipt:
version, basename and up to two hashes for intended and previously verified bytes.
The old hash survives a failed HTML replacement. Receipts are at most 4 KiB,
256 per parent and 20,000 per scan; generated HTML reads count toward the existing
20,000-file/256 MiB scan budget. No file bodies or source/secret values enter a
receipt. Metadata is written atomically before the HTML replacement, and may
remain after failure. It is not a second public report format.

Only matching generated bytes are excluded from project input records. Edited
HTML is treated as an input, ordinary HTML is never blanket-excluded, and package
inputs never honor receipts. Previously recorded inputs and compiled watch/source
bindings still fail closed if a receipt tries to hide them. Removing a receipt
makes the associated HTML an ordinary input again and can stale the report until
the next successful build. Symlinks/malformed registries fail closed. These checks
retain the writer's existing bounded race protection, not an OS sandbox claim.

## Remaining qualification

Portable tests cover encoding/CSP construction, exact full export, pure view
sorting/filtering/schema projections, receipt failure paths, guarded CLI imports,
and real Native build → repeated HTML/JSON → edit rejection → rebuild → HTML.
They do not run a layout engine or establish browser enforcement of the policy.

The local Playwright executable was absent; its official download returned an
invalid/truncated archive. Automatic approval review denied sending the generated
report to the available remote browser without explicit destination authorization.
No browser interactions or screenshots are claimed. The merge gate is to perform
the [browser checklist](validation.md#browser-qualification-checklist) against
this implementation and the locked fixture, then record outcomes and fix findings.

PRPT-06 still owns installed-package/real ARC/Catalog, cost and final acceptance
matrix closure. Runtime parity, external provider reality, release sealing,
publishing and deployment are not claimed here.
