# VIS-09 — Full-window Execution Explorer

Implements the authorized VIS-09 presentation scope after VIS-08 PR #360 on
`vis-integration` (base `87506e865b483193aee2d003ddd846b188569929`). No exact
named repository Entry Point matches this report-only work; the ordinary root,
Wasm, CLI and documentation instruction chains apply. Classification: hardening
inside the developer preview. No protected semantic boundary, compiler behavior,
report schema, association meaning, dependency or public CLI option changes.

## Behavior

Explorer opens as a fixed report-contained window on desktop and mobile. The
canvas has compact search, mode, fit, center, zoom, scope and expansion controls.
Controls scroll horizontally on narrow screens; they remain keyboard reachable.
There is no native fullscreen request, permanent source column or lower table.

Selection and expansion are separate: selecting a node inspects its exact record;
the mount's +/− button expands/collapses one neighborhood without selecting it.
Collapsing an ancestor does not reopen it merely because a descendant is selected.
Center selection explicitly reveals that ancestry. Root/scope search and the
optional table retain access to every registration beyond the 300-node graph cap.
The table pages at 50 records, binding graphs at 12 groups/operations and exact
association evidence at 20 rows; these are display pages, not evidence limits.

A single compact inspector shows readable identity/type, static relationship,
coverage, and links to Entry Point, Binding or authored details. Generated names,
source ranges/hashes and verbose relationship records live in advanced details.
HTTP paths and event types lead node labels; selected nodes, expanded mounts and
dashed binding-candidate edges have separate meanings. Missing/partial evidence
is explicit. Containment is not execution; candidate associations are not grants.

Escape dismisses the current table/evidence panel or inspector before closing the
Explorer. Close restores the initiating inventory and control focus. Tab remains
inside the open Explorer; slash focuses search. Exact-details navigation retains
the existing live DOM, camera, zoom, expansion, selected pin and initiating focus.
Pointer drag, native touch pan and Control/Command-wheel zoom need no network.
Fit clamps at 65% to preserve readability; a large scope can require scrolling.

## Browser qualification

`browser-receipt.json` records the exact report hashes, renderer source hashes,
input hashes, viewport geometry, browser version and completed scenario results.
Genuine Chromium 153.0.8010.0 was driven through Playwright, with web security
retained, offline contexts and local `file://` HTML. No framework/dependency was
added to Pulse. This is Chromium evidence, not a Safari/Firefox or release seal.

Inputs are the pinned VIS-07 Catalog v2 capsule (255 registrations, 100 HTTP entry
points, 10 bindings), a real compiled HTTP fixture replayed as historical v1
(17 registrations, 8 bindings), and a compiled mixed HTTP/event v2 fixture
(16 registrations, 8 bindings). The mixed event is `analytics.tick`. Before/after
renders use identical capsules. Catalog was not rebuilt or narrowed for VIS-09.

| Viewport | Before canvas | After canvas |
| --- | --- | --- |
| 390 × 844 | 356 × 218 | 374 × 656 |
| 768 × 1024 | 702 × 508 | 744 × 836 |
| 1440 × 900 | 1374 × 400 | 1416 × 712 |
| 1920 × 1080 | 1854 × 580 | 1896 × 892 |
| 844 × 390 | — | 820 × 232 |

All three inputs pass the five viewport journeys (275 checks). Two additional
mobile HTTP/event/touch journeys pass 20 checks. Twelve baseline and twelve
matching final canvas screenshots, inspector/binding screenshots at all five
sizes, and event/touch screenshots accompany the external evidence bundle.
Screenshots, source fixtures and Catalog data are intentionally outside this repo.

Walkthrough: open Entry Points → Explore execution → search exact registration →
center/zoom/fit → inspect → authored details → Back to Explorer → dismiss →
Application → mount +/− → Table/help and all Catalog pages → Bindings → broaden
scope → select candidate → center/zoom → Entry Point → Back to Explorer → pan →
Close → export JSON. Checks assert preserved live DOM/focus/camera, independent
expansion, bounded panels, keyboard containment, exact byte-for-byte canonical
export, no network requests, no page/console errors and no CSP violations.
The event/touch walkthrough also checks event filtering, native touch panning,
Escape panel dismissal, slash search, unmatched binding search and origin focus.

Development failures are retained in the external run logs. A genuine collapse
regression was fixed by separating selected-ancestry reveal from ordinary redraw.
Harness corrections waited for hash navigation, selected empty canvas for drag,
compared decoded canonical exports rather than the encoded inert payload, and
used the actual list nesting. Final runs completed with no failing scenario.

## Repository validation

The nearest recorder tests cover independent expansion, collapsed selected
ancestry, explicit center reveal, full-window mobile opening, inspector dismissal,
all 650 synthetic table records beyond the graph cap, and the VIS-08 navigation
return invariants. Their compiled fixtures retain compiler-owned semantics.

Final candidate qualification uses:

```sh
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile cli
npm run maintainer:check
npm run docs:check
node scripts/documentation-release.cjs
```

Terminal outcomes and immutable commit/tree identity belong to the PR validation
record. Documentation copies and context corpora are regenerated with
`npm run docs:sync`; they are not hand-edited. No merge, deployment, publication,
provider reality lane or full release seal is authorized or claimed here.
