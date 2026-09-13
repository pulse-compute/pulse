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
https://pulsecompute.io/v1.0.0-beta.2/
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

Before changing the release manifest, snapshot the still-current exact site:

```bash
pnpm docs:site -- --snapshot
```

This writes `release/documentation-site-archives/v<current-version>/`. Commit that directory unchanged. Then:

1. add the new release to `release/documentation-versions.json` and leave the old entry in place;
2. update `release/pulse-release-manifest.json` with the new version and exact segment;
3. run the generated-documentation and site gates;
4. publish the combined site artifact.

The builder copies every non-current version from `release/documentation-site-archives/` and validates its version manifest, release manifest, public-site manifest, search index, pages, and versioned assets before deployment. The moving root homepage is regenerated for the current release; the archived exact subtree preserves the old release’s presentation and routes. A version bump therefore fails rather than silently dropping or rebuilding an older exact release. Existing archive directories are never overwritten unless the snapshot command is given `--force` deliberately.

The release gate also rejects a current release that is missing from the versions manifest or whose version segment does not match the release manifest.
