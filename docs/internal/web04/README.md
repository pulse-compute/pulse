# WEB-04: documentation navigation, search and version UX

WEB-04 completes documentation presentation in `pulse-compute/website`. Product
Markdown, references, examples, installed CLI documentation and source eligibility
remain Pulse-owned. This procedure is repository-only; it is neither hosted nor
installed. No product API, release pin, archive bytes, delivery authority or
production state changes in this ticket.

The implementation targets website `main` at
`ba6e8bacec207fb9c02a0d64a9d5c2fe982ed844` (merged website #4). This Pulse
procedure stacks on #248 at `98bb09fe0c25d0dcdad3c2f295ad3d0b48a92a74`.
The [WEB-00 contract](../web00/README.md),
[WEB-02 importer procedure](../web02/README.md) and
[WEB-03 landing procedure](../web03/README.md) retain their respective ownership.
This is a documentation change under the ordinary root/docs instruction chain;
it introduces no new named product entry point or protected boundary.

## Presentation owners

| Website owner | Responsibility |
| --- | --- |
| `scripts/docs-navigation.mjs` | Seven public sections: Start, Examples, Guides, Concepts, Packages, Reference, Authors and contributors; source-based ordering and labels |
| `astro.config.mjs` | Starlight navigation, built-in Pagefind search, GitHub link and the single page-title wrapper |
| `src/components/DocsPageTitle.astro` | Selected version, pinned source provenance, native version disclosure and no-JavaScript search explanation |
| `src/styles/docs.css` | Slate/mint dark and light tokens, responsive controls, focus indicators and historical notices |
| `src/data/version-links.json` | Small website-owned exact-version link catalog, with original Pulse catalog identity |
| `src/data/retired-anchors.json` | Explicit historical destinations for all 39 anchors retired between the two WEB-00 captures |
| `scripts/retired-anchors.mjs`, `src/components/RouteAlias.astro` | Historical section notices and the retired compiler-measurement page |
| `scripts/build-site.mjs` | Clear disposable `dist/` before rendering, so failed builds cannot leave stale pages or search inputs |

Navigation uses every eligible public page exactly once. New eligible paths that
fit no section fail classification instead of disappearing silently. Maintainer
pages retain direct URLs and source links, but remain absent from public
navigation, previous/next sequences and search. This visibility boundary is not
authentication. Internal/retired-decision sources and `AGENTS.md` remain excluded
from import; the rendering probe, landing and ARC/Compare fixtures are not indexed.

Search is the framework's static Pagefind index and UI, scoped to the selected
build's public pages. It introduces no search service, runtime backend, production
dependency or Starlight search/sidebar override. Keyboard search, native mobile
navigation, section disclosures and persisted light/dark/automatic theme controls
remain framework-owned. No-JavaScript users can read every page and browse native
menus, contents and version links; full-text search requires JavaScript.

## Versions and historical links

`source-lock.json` still selects published beta.7 at
`be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`. The version-link catalog is a
compact presentation snapshot of that commit's
`release/documentation-versions.json`. Its current entry and source commit must
match the published lock, and duplicate, malformed or ambiguous entries fail.
Published builds also compare every catalog fact and its source hash with the
immutable selected Git blob, whose identity is recorded in import provenance.
A future released pin must update this catalog deliberately. Preview selection
does not advance either owner.

The menu links six existing exact-version overviews on `https://pulsecompute.io/`:
beta.7, beta.6, beta.4, beta.3, beta.2 and beta.1. Historical choices explicitly open
their overview; this avoids inventing same-page or fragment parity across older
contracts. Published pages also provide a same-page link to the selected exact
release; JavaScript preserves its query and fragment, including hash changes.
Unreleased preview pages have no same-page released claim and state that the
package release remains beta.7.

These links are catalog-backed destinations, not verification of live storage or
archive recovery. Normal builds read one selected source plus the small index;
they neither render nor copy historical trees. Unknown or absent exact-version
paths in the local artifact return 404 without falling back to latest. Root
`versions.json`, release/public-site manifests and their existing consumer schemas
are not replaced by this UI catalog; compatibility and delivery belong to WEB-05/06.

The source cleanup removed 39 beta.7 content anchors. Each receives an explicit
historical lookup rather than a claim that unrelated current text replaces it:

| Old moving-alias path | Historical decisions |
| --- | --- |
| `contributing/#contributing-documentation` | One section notice linking its beta.7 exact URL |
| `maintainers/documentation-system/#publishing-the-site` | One section notice linking its beta.7 exact URL |
| `maintainers/testing/#jwt-and-crypto-proof-seals` | One section notice linking its beta.7 exact URL |
| `maintainers/compiler-efficiency-p01/` | All 36 original anchors retained on a labeled historical-link page, each pointing to the corresponding beta.7 section |

The retired page offers current testing guidance separately and does not
automatically redirect readers or carry an old measurement fragment to that page.
Ordinary aliases, including `alpha-scope/`, retain query/fragment-preserving
navigation and a no-JavaScript destination link. Retained published anchors remain
untouched. On consolidated source, section notices appear only when the original
ID is absent and are excluded from search. Website-only notices do not edit the
canonical Markdown or its installed copies.

## Reproduce the checks

Use the locked website dependencies and a separate clean Pulse checkout. Keep
both WEB-00 captures available from the #248 stack; they are canonical baseline
inputs, not documentation copies in the website repository.

```bash
npm ci --ignore-scripts
npm run source:fetch
npm run build
npm run check
npm test
PULSE_BASELINE=/path/to/pulse/docs/internal/web00/published-beta7.json npm run verify:import
PULSE_BASELINE=/path/to/pulse/docs/internal/web00/published-beta7.json npm run verify:docs
npm run verify:proof
npm run verify:landing
npm run test:docs
npm run test:browser
npm run test:landing
```

If the ignored source cache already exists, use the existing clean pinned
checkout through `PULSE_SOURCE_DIR`; `source:fetch` does not replace it. Browser
checks need a Playwright-compatible Chromium. This environment used Chromium
134.0.6998.35 through `PULSE_BROWSER_EXECUTABLE` with
`PULSE_BROWSER_SINGLE_PROCESS=1`. Set `PULSE_SCREENSHOTS=1` to save ignored local
screenshots. The harness serves only the artifact, including Pagefind's Wasm;
it uses no production storage, credentials or signed-in browser session.

For current-versus-published verification, use the clean native-contract snapshot
`12b6f70dc6dbbbdb1dfd2b7503716d7d98b1c66c` used by WEB-02/03. Set
`PULSE_SOURCE_DIR` and `PULSE_PREVIEW_COMMIT` on build/check, then pass both
`PULSE_BASELINE` and `PULSE_CURRENT_BASELINE` (WEB-00 `current-latest.json`) to
`verify:docs`. Run the import, landing and docs/browser checks against that preview.
The current capture is `05e926830d940d53f08ebd5867ac939b9b291d6d`; the native
snapshot adds the source contract/internal procedures without changing those
captured public content anchors. Future public source changes need a new reviewed
comparison capture and explicit retirement decisions; do not silently edit the
old capture to make a check pass.

## Observed result and remaining work

Published validation covers 83 pages, all 1,084 original content anchors, seven
byte-identical source assets and 434 unchanged fenced code blocks. Navigation and
the actual Pagefind corpus each contain exactly 66 public pages. Current source
has 82 pages and 1,051 source anchors before the three historical section notices;
the retired route separately carries its 36 historical destinations. These are
source consolidation differences, not renderer losses.

The focused suite has 23 passing tests. Artifact checks validate full navigation,
visibility, source/version labels, exact destinations, duplicate IDs, complete
published anchor parity and all 39 current-source retirement decisions. Browser
checks cover 1440/768/390/320px, actual search results and full index enumeration,
keyboard search/focus restoration, native version menus, persisted themes,
mobile/no-JavaScript reading/navigation and absent exact-version 404 behavior.
The earlier seven-route proof and landing browser checks remain regression gates.
Desktop/mobile screenshots were inspected locally.

A failed early build exposed stale output on retry; the clean artifact build
resolved it and full-page coverage caught the affected pages. Search test probes
were corrected to use the framework's actual text input and a term present in the
selected example. Final results come from the corrected checks, not those failed
attempts. Pulse synchronization and maintainer/docs/documentation-release checks
produce no generated tracked changes. This ticket runs no compiler qualification
or aggregate release seal.

WEB-05 owns credential-free CI, complete artifact/deployment identity and protected
delivery tooling. WEB-06 owns byte/metadata-preserved archives, live staging,
durable recovery and the coordinated writer cutover. WEB-07 removes superseded
Pulse presentation/delivery owners after that proof. Keep #248 open while this
work continues; no merge or production action is performed by WEB-04.
