# WEB-03 — Full landing and lazy report fixture

Status: implemented for review, 2026-10-09. Entry point: `documentation-current`.
Human direction: “Implement WEB-03”; leave Pulse #248 open and stack additions
on its branch. Website work starts from main after merged #3 at
`f5dc1a0d2faa31a0b7ae27f24fe8c723f888b771`. This repository-only procedure stacks
on #248 at `df92f03eba78b678d5e860986db2457d79bee0bf`. No production deployment,
archive promotion, release identity or product API change is part of this ticket.

The [WEB-00 migration contract](../web00/README.md), [WEB-01 renderer decision](../web01/README.md)
and [WEB-02 source import](../web02/README.md) remain authoritative. The website
branch is `feat/web-03-landing` in `pulse-compute/website`. Product Markdown,
canonical snippets, generated references and operational procedures remain in
Pulse. The website README links to this procedure; it is not a second runbook.

## Result and source binding

The full supplied v5 concept is implemented as an Astro landing page: slate/mint
palette, static Inspect/Doctor/Report rail, report preview, Compare concept,
application example, explicit target choices, MCP section and get-started/footer.
The source lock remains published beta.7 at
`be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`.

`landing-data.mjs` derives the CLI package/version, target labels, license and
Hello JSON handler from the importer's already validated immutable inputs.
The handler is read from the canonical `pulse-doc-source` block in
`examples/01-hello-json/README.md`, with its source hash recorded in ignored
`.pulse-content/landing.json`. It is rendered as escaped text without executing
it or installing Pulse. The concept's older Router/runtime example is replaced
with the selected release's `Pulse` application source. A missing or mismatched
CLI package, application entry point, executable host, bound handler or MCP
example rejects preparation before generated content is replaced.

Published mode presents `npm install -g @pulse-compute/cli@1.0.0-beta.7`, derived
from the selected manifest, and local `/latest/` documentation links. Unreleased
mode visibly labels the hero, links to `/preview/`, presents no install command
or copy control, and links to the exact published quickstart from the unchanged
source lock. A future unreleased manifest version cannot become an npm install
claim. Unit tests exercise that case using a different preview version.

The profile controls are native radio inputs. Their explanatory text switches
with CSS, including without JavaScript. They describe explicit Native/JavaScript
choices and are labeled illustrative; this page does not compile or deploy.
The MCP link resolves to the selected release's context-MCP example. Full
navigation/search/version UI remains WEB-04.

## Demo assets and identity

The [supplied concept identity](../web00/concept.json) is SHA-256
`d2edf3b0c765014bc02d4e038e1ea6c973bf037cfc9740065acea422a2c68d58`.
The website extracts its two screenshots and report into `public/demos/` with
content-derived names. `src/data/demo-assets.json` records original/output hashes,
byte sizes, image dimensions and the report transformation. Normal builds do not
read the large concept file or regenerate assets from unreviewed input.

| Asset | Size | Source/output relationship |
| --- | ---: | --- |
| Desktop report screenshot | 147,242 bytes | Original PNG, byte-identical |
| Mobile report screenshot | 79,033 bytes | Original PNG, byte-identical |
| Interactive report | 196,585 bytes | Original HTML plus the sandbox Escape bridge and its CSP hash |

The original report hash is
`4fb0dbdfb90f20bebb3e702eb50f1cd30f8e4b8cb38bb0a1ec7e1394717874f9`.
Its fixture evidence JSON is unchanged, with SHA-256
`e9b3464a511983143f68be63d54384d8bbeddc5eaa3b8f5ff2cf588b717b1210`.
The small website-owned `report-escape.js` bridge lets Escape inside the opaque
sandbox request closure of the outer dialog, while preserving the fixture's own
inner overlay dismissal. The parent accepts only the expected message from that
iframe's window with its opaque origin. The fixture CSP explicitly allows the
bridge's hash, retains its existing script hash and disallows network connections.

The landing HTML is about 18 KB rather than the concept's 608,332-byte embedded
payload. A responsive lazy `<picture>` supplies the appropriate screenshot;
explicit dimensions reserve its layout space. The iframe has no `src` or `srcdoc`
until the report launcher is activated. It uses `allow-scripts allow-downloads`,
without same-origin access or top-level navigation permission. Closing/reopening
retains its source; a standalone fixture link remains available. Content-derived
URLs separate caching identity from page bytes. Production cache metadata and
artifact/deployment receipts remain WEB-05 work.

ARC report sizes/routes/schemas remain **design fixture data**, and all five
Compare changes remain a **synthetic UI concept**, including the removed route.
Labels appear beside the preview, inside the report and under Compare. The page
does not claim a measured beta.8 comparison or production benchmark.

## Reading and interaction

JavaScript enhances the two view links into tabs with roving focus, ArrowLeft/
ArrowRight/Home/End handling and associated panels. Without JavaScript, both
sections remain readable, the links navigate to their anchors and all Compare
rows use native details/summary controls. The report launch and copy buttons are
hidden until their handlers exist; ordinary documentation and standalone fixture
links remain available.

The report uses a native modal dialog, keyboard focus wrapping, Escape/cancel,
backdrop/close controls, scroll locking and focus restoration. Escape in an inner
fixture panel dismisses that panel first; Escape in the report body closes the
outer viewer. The install command is ordinary selectable text. Clipboard denial
selects the command and presents a status message rather than claiming success.
The handler code region is keyboard-focusable and scrollable on small screens.
Reduced-motion preferences disable motion; the hero rail is static in all modes.

## Reproduce and verify

In website with Node 22.12+ and a separately prepared source checkout, follow
[WEB-02's source preparation](../web02/README.md#reproduce-a-published-import), then:

```bash
npm run build
npm run check
npm test
npm run verify:landing
PULSE_BASELINE=../pulse/docs/internal/web00/published-beta7.json npm run verify:import
npm run verify:proof
npx playwright install chromium
npm run test:landing
npm run test:browser
```

The source directory can instead be supplied with `PULSE_SOURCE_DIR`. For the
native-contract preview, use the explicit full SHA and clean source checkout as
in [WEB-02's preview procedure](../web02/README.md#unreleased-native-contract-preview),
then run `verify:landing`, `verify:import`, `check`, `test:landing` and `test:browser`.
Do not apply the published-only five-page `verify:proof` oracle to a preview.
Switching back to a normal locked build restores `/latest/` and removes stale
preview outputs.

To regenerate the extracted fixture from the exact original concept, explicitly
provide that local file to the maintainer-only utility:

```bash
node scripts/prepare-demo.mjs /path/to/Pulse-Landing-Refresh-Concept-v5.html
```

It verifies the concept digest, preserves screenshot bytes and fixture evidence,
appends the reviewed bridge, updates its CSP hash and rewrites asset metadata.
A different concept is rejected. Review any asset update as website code; neither
normal build nor source import executes this utility automatically.

`verify:landing` checks the HTML size, absence of embedded payloads, release-bound
handler/command, fixture labels, all five changes, dialog/sandbox/lazy attributes,
asset hashes and bridge/CSP/data identity. `verify:import` allows only the declared
standalone demo HTML in addition to approved docs, homepage, fixture and 404.
It still rejects exact-version trees and checks all source/assets/anchors/code.
The two browser scripts share credential-free artifact serving at a synthetic
origin; they never contact production or load external assets.

## Measured checks and handoff

Website: build and Astro check pass with no diagnostics; 20 focused importer,
link and landing-data tests pass. Published docs retain **83 pages, 1,084 ordered
anchors, seven byte-identical source assets and 434 fenced code blocks** against
WEB-00; the five-page 121-anchor oracle and Markdown structural fixture pass.
The native-contract preview retains 82 current pages, 1,051 anchors and seven
source assets, with no install command or exact-version output.

Chromium 134.0.6998.35 checks the landing at 1440/768/390/320px in both modes:
no horizontal overflow, lazy report activation, keyboard tabs, all Compare rows,
Native/JavaScript profile reading, clipboard success/denial, outer and inner
Escape, dialog focus/restoration and no-JS reading/navigation. The existing
seven-route docs/browser proof also passes. Desktop/mobile Report and Compare
screenshots were inspected locally. This browser executable is the locally
available validation runtime, not a claim of production browser coverage.

Pulse documentation synchronization produces no generated tracked changes;
maintainer, documentation and documentation-release checks pass. This Pulse PR
adds only the internal procedure. There is no aggregate package/release seal or
production/storage verification in this ticket.

WEB-04 owns full docs/navigation/search/theme/version UX and retired-anchor
coverage. WEB-05 owns credential-free CI, complete artifact identity, deployment
receipts and protected delivery. WEB-06 owns durable archives, staging, single-writer
cutover and rollback; WEB-07 then removes superseded Pulse owners. Keep #248 open
while that work continues.
