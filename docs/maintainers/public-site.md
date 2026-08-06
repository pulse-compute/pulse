<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Public site and documentation presentation

Pulse has one generated public-site system for the product homepage and versioned documentation. The homepage is an editorial product surface; the documentation remains layered technical content. They share release facts, routes, navigation metadata, design tokens, components, accessibility behavior, and validation rather than maintaining separate hand-written sites.

## Canonical inputs

The generator separates facts from presentation:

| Source | Owns |
|---|---|
| `release/pulse-release-manifest.json` | Release version, channel, documentation base path, repository metadata, runtime targets, package policy, and exact-version routes. |
| `release/documentation-versions.json` | Available versions and the moving `latest` alias. |
| `release/documentation-site.json` | Product copy, named document destinations, header/footer links, navigation sections and ordering, homepage section order, and checked fixture selection. |
| Repository Markdown | Tutorials, concepts, package guides, references, architecture, and contributor content. |
| CLI and configuration catalogs | Public command workflow, diagnostics, schemas, environment variables, and other generated reference material. |
| `scripts/documentation-site/` | Shared design tokens, dark syntax theme, layout and component styles, browser behavior, favicon, and the decorative Pulse field animation. |

Do not copy release versions, provider names, CLI command descriptions, package roles, or canonical routes into templates. Add or change the owning catalog and let the site builder consume it.

## Editorial manifest

`release/documentation-site.json` uses the `pulse.public-site.v1` schema. Its
document map assigns stable IDs such as `getting-started` and `preview-scope` to
Markdown sources. Homepage and header actions refer to those IDs, never
handwritten URLs. The generator resolves each action to the current exact
release or the `latest` alias as appropriate. `sourceAliases` maps
repository-only landing files to their canonical hosted document; `routeAliases`
preserves intentional redirects after a public route is renamed without
creating a second content owner.

Navigation sections classify every public page exactly once. Explicit `sources`
take precedence over directory `prefixes`; `navigation.overrides` controls
concise labels, order, and whether a page is hidden from the flat sidebar
without adding front matter to generated or installed Markdown. A hidden page
remains generated, versioned, and link-checked, and the builder requires it to
remain linked from visible documentation. `hiddenInSearch` is reserved for a
hidden compatibility page that should remain reachable without competing in
task search. Section `searchPriority` gives Start, Guide, Concept, Package, and
Reference material a deterministic ranking boost over contributor material. A
section may instead set `hiddenInNavigation` and `hiddenInSearch` to classify a
gated audience namespace without rendering that category in the sidebar or
general search. The Reference overview is the discovery gate for the hidden
Maintainers section. A new public Markdown page that
matches no section, matches more than one section, or has a duplicate route
fails the site build. Alias sources are excluded from hosted navigation, and
stale overrides or aliases fail the release gate.

The installed CLI exposes the same machine-readable value as `@pulse-compute/cli/documentation-site.json`, and the hosted build emits it as `public-site-manifest.json`. The editorial manifest owns copy and composition, not release identity or provider contracts. The homepage may choose which parts of the product story deserve emphasis, while version, channel, package, and provider facts remain release-owned.

## Shared presentation layer

The homepage and documentation shell load the same exact-version assets:

- `tokens.css` — colors, typography, spacing, radii, shadows, content widths, breakpoints, and motion values;
- `syntax-dark.css` — the vendored Starry Night dark syntax theme;
- `site.css` — reusable header, buttons, terminal, content, navigation, search, table-of-contents, and responsive layouts;
- `site.js` — search, version selection, mobile navigation, code copying, and table-of-contents state;
- `network-field.js` — the release-local decorative canvas animation used by the homepage;
- `favicon.svg` — the Pulse mark.

Fenced code is highlighted during site generation by `scripts/highlight-code-blocks.mjs` with `@wooorm/starry-night`. The generated HTML contains token spans and uses release-local CSS; no browser highlighter, CDN stylesheet, or runtime grammar download is required. Unknown fence languages remain safely escaped and readable.

The source assets live under `scripts/documentation-site/`. The builder copies them into `v<version>/assets/`; both the root homepage and exact documentation use those release-local copies. Historical exact releases therefore retain the presentation they shipped with instead of inheriting future root CSS or JavaScript.

Style refinements should usually start with tokens or a shared component. Avoid page-specific inline CSS and avoid duplicating a component between homepage and documentation templates.

## Homepage generation

The public base path, `/`, is a product homepage rather than a redirect. It is generated from:

- product positioning, the Router example, and homepage sections in the editorial manifest;
- candidate display information in the release manifest;
- the quick-start commands;
- a checked `pulse inspect` fixture;
- named routes resolved through the document map.

The current story leads with the application rather than the compiler: a
minimal hero, a primary Router example, a secondary quick-start strip, a
gradual path toward Native execution, practical containment principles, a
collapsed compiler inspection proof, and the explicit Beta scope.
Package inventories, target matrices, and full references remain in
documentation.

The hero Pulse field is deterministic and dependency-free. It restores the earlier restrained visual treatment: a dense, low-opacity network with sparse travelling pulses and no embedded compiler labels. It pauses while offscreen or while the document is hidden, offers a visible pause/resume control, caps device-pixel ratio, and honors `prefers-reduced-motion`. When reduced motion is requested, the decorative canvas and motion control are not started; the hero copy remains complete without them. The animation is decorative; all meaning remains in the surrounding copy.

The Router example follows the hero as the primary product proof. The install commands then live in a separate full-width quick-start card so long package names remain readable without competing with the application model.

## Documentation shell

Each exact-version page receives generated:

- product header, release selector, and release-local search;
- breadcrumbs;
- grouped and ordered left navigation;
- mobile off-canvas navigation that does not precede article content;
- an “On this page” list from level-two and level-three headings;
- previous/next links from the same navigation order;
- owner, status, review date, and canonical source metadata;
- a shared footer and exact-version assets.

The Markdown renderer folds an explicit anchor immediately before a heading into that heading ID. This preserves generated diagnostic and environment anchors while preventing duplicate HTML IDs.

## Build and inspect

```bash
pnpm docs:sync
pnpm docs:site
pnpm docs:site:check
node scripts/documentation-release.cjs
```

`pnpm docs:site` writes `.pulse-docs-site/`. `docs:site:check` builds into a temporary directory and validates the complete route graph.

For normal local development, use the preview adapter instead of manually reproducing the production mount:

```bash
pnpm docs:preview
```

The command refreshes generated documentation, builds directly into `.pulse-docs-preview/`, serves it over HTTP, and prints `http://127.0.0.1:4173/`. Production canonical metadata remains HTTPS and byte-identical; localhost changes only the transport used to inspect the artifact. Useful variants include:

```bash
pnpm docs:preview -- --port 8080
pnpm docs:preview -- --host 0.0.0.0
pnpm docs:preview -- --open
pnpm docs:preview -- --watch
pnpm docs:preview -- --no-build
pnpm docs:preview -- --smoke
```

`--smoke` uses an ephemeral port, verifies the root-mounted homepage, version root, search index, shared assets, the isolated compatibility fixture, output-marker isolation, and the branded 404, then exits. When `--preview-root` is supplied explicitly, the smoke artifact is retained for inspection; otherwise its temporary output is removed.

Preview generation writes `.pulse-docs-preview-root.json` at the selected output root. A populated custom directory without that ownership marker is never replaced, symlinked roots are rejected, and `--no-build` serves only a marker-owned artifact with a complete site manifest. These checks keep the convenience command from becoming a general recursive-delete surface.

## Release gates

Public-site validation rejects:

- stale or invalid public-site manifests;
- missing named document sources or actions;
- unclassified, multiply classified, or duplicate public routes;
- missing shared assets or required no-JavaScript fallbacks;
- handwritten homepage release facts that disagree with canonical catalogs;
- missing homepage sections, the Router example, motion controls, quick-start commands, or inspect fixtures;
- duplicate HTML IDs, broken base-path routes, or missing anchors;
- a root homepage that regresses to a redirect;
- documentation pages without search, version selection, mobile navigation, breadcrumbs, table of contents, or previous/next structure;
- exact pages that depend on mutable root presentation assets;
- archived versions that no longer satisfy their own version manifest.

The generated site is a release artifact. Edit the manifests, Markdown, catalogs, and shared source assets; never hand-edit `.pulse-docs-site/` or a published exact-version subtree.
