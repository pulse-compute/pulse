<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
pulse-doc-meta:end -->

# Documentation versions, search, and installed copies

Pulse publishes a generated product homepage at the configured base path, exact documentation snapshots, and a moving `latest` alias.

## Public product homepage

The base route for this repository is:

```text
https://pulsecompute.io/
```

It is a generated product homepage, not an alias or redirect. Its copy, named actions, section order, and navigation come from `release/documentation-site.json`; release facts and runtime targets come from `release/pulse-release-manifest.json`; CLI workflow summaries come from the public command specification. The homepage links into `latest` for browsing, while diagnostics and package metadata continue to use exact-version URLs.

The homepage and exact current documentation load the same assets under `/v<version>/assets/`. This keeps the visual system consistent and ensures a release snapshot retains the CSS, JavaScript, favicon, no-JavaScript fallback, and hero-graph implementation it shipped with.

## Exact release URLs

The canonical URL for this release begins with:

```text
https://pulsecompute.io/v1.0.0-beta.9/
```

Diagnostics, package status blocks, and package metadata use exact-version URLs. This prevents a diagnostic emitted by an older CLI from silently opening instructions for a newer contract.

Each exact release subtree carries its HTML, release-local search data, public machine-readable references, design tokens, CSS, JavaScript, favicon, editorial site manifest, and version manifest under the same `v<version>/` segment. The release remains renderable and searchable without mutable assets. A small root `versions.json` index may refresh the cross-version selector as newer releases are added; it cannot change the archived page content, styling, or search index.

## The `latest` alias

`/latest/` redirects to the release marked current in `release/documentation-versions.json`. It is convenient for browsing, but tools and emitted diagnostics should use the exact release segment.

## Search

Every published release has its own generated `search-index.json`. Navigation grouping, breadcrumbs, previous/next order, and the on-page outline are generated from the same editorial navigation model. Search runs locally in the browser and never mixes pages from different release versions. Page titles, headings, text, owner, and review status are indexed.

## Installed and offline documentation

`@pulse-compute/cli` ships the public Markdown hierarchy, examples, schemas, command specification, release manifest, version manifest, and shell-completion files. Installed copies remain usable when the hosted site is unavailable. Hosted links are preferred when a stable anchor or cross-package destination is required.

## Adding a documentation version

The **Release preparation** workflow defaults to `documentation_history=website-managed`.
It reads the previous release manifest from its exact Git tag and retains that
metadata under `release/documentation-release-history/`, bound to the tag commit
and a content digest. It never installs the prior release, builds its website,
or creates a new historical HTML archive. Local preparation uses
`release:prepare -- <version> --channel beta --website-managed`.

Product versions, package ranges, changelog history, CLI metadata and generated
references still advance together. Historical catalog entries keep their exact
version URLs and `archived` status for the website importer, with an explicit
`deliveryOwner: website`. This is product history, not proof of hosted availability.
Website delivery receipts and the existing owner-managed recovery remain the
authority for actual published bytes and metadata. No new backup is required.

The seven existing trees under `release/documentation-site-archives/` remain
unchanged for legacy rendering, historical receipt verification and the website's
pinned beta.9 baseline audit. Old `--archive-current` preparation still accepts
an already committed snapshot; it does not build one. The legacy renderer's
`pnpm docs:site -- --snapshot` command remains for historical tooling, outside
release preparation. The retained preview copies and verifies local legacy
archives only; it excludes website-owned history from its local version selector
and never manufactures or redirects those exact trees. Its version metadata
still retains the full catalog. The website's normal importer and recovery read
version metadata and retained delivery artifacts without executing this renderer.
The developer-only legacy baseline capture remains for pinned historical sources;
a future baseline for website-owned history must use website delivery evidence.

This step retains `release/documentation-site.json` and the Public product homepage
preview while later retirement removes their remaining ownership.

The release gate also rejects a current release that is missing from the versions manifest or whose version segment does not match the release manifest.

## Unpublished hosted docs after npm publication

A Git/npm release does not prove that its exact documentation tree was hosted.
The release manifest's `readiness.versionPreparation.unpublishedDocumentationReleases`
records narrowly reviewed exceptions, the unchanged source tag/commit, npm
publication, evidence, and the exact-link policy. The repository evidence ledger
`wasm/test/release/documentation-hosted-history-d01-2026-09-25.md` and package-link
audit `wasm/test/release/documentation-package-links-d03-2026-09-26.md` explain the
current decision and its limits.

For that explicit exception, select `replace-unpublished-docs` in the preparation
workflow, or use the local command:

```bash
node scripts/release-prepare.cjs "$NEXT_VERSION" --channel beta --replace-unpublished-docs
```

This replaces the current hosted-docs entry without building or committing its
archive. It preserves the npm release record, source tag, published changelog,
and all other archived docs. It is distinct from `--replace-unpublished`, which
replaces an entirely unpublished candidate and is rejected for the reviewed
npm-published exception. The next release gets a new exact documentation tree
and receipt; D02 limits production operations to that tree and its mutable routes.

Already-published packages keep their original exact-version homepage, README,
and diagnostic links. This choice does not repair those links, redirect them to
`latest`, or publish a compatibility tree. An absent object continues to produce
the site's not-found response; any object already stored remains untouched.
The recorded deployment failure does not prove present storage absence.
Use the matching installed `@pulse-compute/cli` Markdown under `docs/` or the
unchanged Git tag's source documentation when an exact hosted link is unavailable.
The hosted version selector will omit this release after the next promotion,
while npm preflight still recognizes its published version.
