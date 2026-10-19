<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-09
review-by: 2027-04-09
pulse-doc-meta:end -->

# Public site and documentation presentation

The public website is owned by [pulse-compute/website](https://github.com/pulse-compute/website).
Pulse no longer includes a website renderer, presentation assets, syntax
highlighter, local preview server or site-building CI. Canonical product
content remains here; do not create an editable Markdown mirror in the website.

## Canonical inputs

`release/pulse-release-manifest.json` owns product release facts.
`release/documentation-sources.json` owns eligible sources, stable routes,
aliases and hidden maintainer prefixes. The website importer reads these as
data from its selected Git commit without executing Pulse scripts.
CLI/configuration/diagnostic/environment references and installed copies still
come from their existing source generators. The version catalog preserves
exact-version identities; it is not proof of hosted availability.

## Editorial manifest

`release/documentation-site.json` and its schema/loader remain because the CLI
ships a supported compatibility export. Named source destinations, routes and
aliases remain validated and synchronized. This retained metadata does not
grant Pulse ownership of active homepage copy, navigation or visual design.
Those changes belong in the website repository.

## Build and inspect

Use the website repository's source lock, importer, preview commands and
frontend checks. In Pulse, follow the [documentation update loop](./documentation-system.md#update-loop)
for source validation and the registered executable documentation tasks.
No local Pulse command rebuilds historical HTML or seals a new website preview.

## Historical presentation and recovery

The seven checked-in HTML archive trees have been removed from `latest`.
Their exact release manifests remain under `release/documentation-release-history/`,
with SHA-256 bindings and historical Git commit/path provenance in the version
catalog. Exact version URLs, dates, channels and CLI version metadata are unchanged.
The original beta.1 capture record remains there as historical recovery evidence.

`scripts/documentation-archives.cjs` reads an explicitly supplied old site; its
manifest, identity, path, anchor, asset and link checks use small synthetic test
fixtures instead of repository site copies. Historical deployment receipt and
candidate verification still authenticates supplied retained bytes and rejects
missing or tampered artifacts. The owner's existing backup and Git history
provide recovery; this change creates no new archive system or backup requirement
and never deletes origin/CDN content. See [documentation versioning](./documentation-versioning.md).

The website's legacy source-baseline audit is frozen to historical Pulse source
that still contains the old renderer (its current baseline is beta.9). It is not
a current-source generator. New source inventories use the source contract;
future rendered baselines belong to website rendering and retained artifacts.

## Release gates

Pulse retains source/reference drift, installed copies, MCP corpus, CLI/config
parity, package documentation and executable-example checks. Website CI owns
responsive layout, accessibility, navigation/search, theme and rendered-route
checks. Old deployment simulations and the disabled writer workflow remain
for the next retirement step; their presence is not permission to deploy.
