# VIS-08 — Entry Points and Bindings navigation

Implements the authorized VIS-08 navigation specification on `vis-integration`,
following VIS-07 (#359, merged as `753d2d8bec69782a4587a45a217188fa7e30ac15`).
This is report presentation and navigation work. Compiler/runtime behavior,
canonical facts, relationship semantics and report formats are unchanged.

## Navigation contract

Entry Points and Bindings are the only primary execution inventories. Entry
Points combines HTTP and event registrations without a host-wide mode switch,
with search and type-specific filters. Lists page at 50 entries; authored
operations and consumers page at 20. These are display pages, not evidence caps.
Bindings has searchable identities, exact details, candidate entry points,
authored sources and operations, resolution/coverage and unresolved identities.
Its consumer views select route/event registrations from VIS-07 queries; other
registration roles remain available through contextual details and routing.

More report sections retains HTTP size analysis, resources, schemas, evidence,
searchable authored records, all entry records and compiled helpers. Their size,
comparison and provenance semantics have not changed. Authored detail pages keep
record search in a disclosure rather than competing with the selected record.
Anonymous definitions show retained file:line; anonymous registration labels also
show kind/order and mount context. No readable label becomes a lookup key.

| Hash | Destination |
| --- | --- |
| `#entry-points` | Combined HTTP/event inventory; default landing view |
| `#entry-points/<encoded ID>` | Exact entry-point details |
| `#bindings/<encoded ID>` | Exact logical binding details |
| `#explorer/entry/<encoded registration ID>` | Focused execution context |
| `#explorer/binding/<encoded binding ID>` | Focused possible consumer context |
| `#handlers/<encoded ID>`, `#registrations/<encoded ID>`, `#use-sites/<encoded ID>` | Exact authored evidence |
| Historical `#routes/N`, `#bindings/N`, `#atlas/N` and other numeric record hashes | Original capsule-local ordinal resolution |

Encode the full ID with `encodeURIComponent`; do not abbreviate or substitute a
name, ordinal or source label. Missing/malformed Explorer targets show unavailable
and return to the relevant inventory rather than silently selecting another
binding. Historical ordinal hashes remain supported for existing reports/links.

Opening details suspends the live Explorer view. Back to Explorer (or browser
Back to its hash) reveals the same DOM, so selected focus, query, scope, expanded
mounts, graph/evidence pages, inspector state, zoom and both pan offsets survive.
Keyboard focus returns to the initiating link without recentering. The return
action also appears inside the legacy route modal. Starting a new exploration
replaces this return context. State is local to the open report; a reload opens
the deep-linked target with initial camera state. No storage or network is used.

## Six core journeys and checks

| Journey | Implemented path and coverage |
| --- | --- |
| 1. Discover HTTP and events | Combined inventory; type/method/event filters; compiled mixed fixture |
| 2. Entry Point to execution and back | Entry detail → Explore execution → selected handler → exact definition → Back to Explorer; expanded mount, zoom, pan, selection and focus checks |
| 3. Binding to consumers and back | Binding detail → Explore consumers → exact entry point → Back to Explorer; selected consumer, binding focus, zoom/pan and focus checks |
| 4. Find authored operations/source | Entry or Binding → paged operation/use-site → exact source/provenance; no graph required |
| 5. Resolve anonymous/reused definitions | Retained source plus registration/mount fallback; distinct exact identities; reordered inventory links and repeated mount fixture |
| 6. Investigate incomplete evidence | Dynamic/unknown identity disclosure; v1 partial rows and missing-analytics replay; unavailable coverage and explicit non-use caveats; unchanged export |

`report-navigation-viewer-cases.cjs` exercises the production renderer with the
existing DOM recorder and real compiler-produced mixed fixture. Existing
handler/atlas/relationship cases cover historical partial capsules and mounted
instances. The viewer owner task also checks deterministic HTML, fixed CSP,
hostile-string encoding, exact JSON export and comparison rendering. Recorder
checks verify structure, interactions and state, not actual browser layout/CSP
enforcement. Real-browser responsive/visual qualification remains VIS-09.

## Validation scope

Focused command:

```sh
node wasm/scripts/run-wasm-tests.cjs --task cli-report-viewer --task cli-report-relationships --task report-capsule-contract --no-report
```

The initial viewer attempts exposed old presentation-label assertions, the moved
HTTP method/path summary assertion, and explicit mobile exploration being hidden
by the legacy default. Those were corrected; the next focused viewer run passed.
One combined invocation used an unregistered task name and ran no tasks; it was
corrected to `report-capsule-contract`. Final completed checks and immutable
source identity are recorded in the PR.
Full release/installed-package qualification stays at the workstream boundary.
