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

The seven existing exact-release HTML trees are retained unchanged under
`release/documentation-site-archives/`. A small read-only archive validator
preserves their manifest, identity, path, anchor, asset and link checks.
Historical receipt verification still authenticates retained candidate bytes.
Website delivery and the owner's existing backup remain recovery authorities;
this retirement does not modify storage, require a new backup or rewrite old
presentation. See [documentation versioning](./documentation-versioning.md).

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
