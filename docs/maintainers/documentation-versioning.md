<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-21
review-by: 2027-04-21
pulse-doc-meta:end -->

# Documentation versions, search, and installed copies

The website repository owns the homepage, hosted documentation, search and
rendered assets. Pulse owns canonical source pages and release identities.
The source version catalog records intended exact-version destinations; it
does not prove that those bytes have been deployed.

## Public product homepage

The base route is `https://pulsecompute.io/`. Homepage copy, navigation and
presentation live in `pulse-compute/website`; `release/documentation-site.json`
is retained CLI compatibility metadata, not the active homepage renderer.
The website imports release facts from its selected Pulse commit and links
readers into `/latest/` for current browsing.

## Exact release URLs

Diagnostics, package status blocks and package metadata use exact-version
URLs, such as `https://pulsecompute.io/v1.0.0-beta.9/`. This binds guidance to
its release rather than silently opening a newer contract. Historical rendered
bytes and their assets retain their original delivery identities; current
source cleanup does not rebuild or restyle those snapshots.

The website owns asset layout and version navigation. Do not assume that the
current Astro assets or search bundles use the legacy `/v<version>/assets/`
layout. A published source pin and reviewed delivery evidence are separate
requirements; a version catalog entry alone is not hosted availability.

## The `latest` alias

`/latest/` is the website's current-documentation namespace. Its importer emits
pages there from `source-lock.json`, which binds a released tag, full commit
SHA and version. It does not follow the Pulse `latest` branch automatically.
Unreleased source previews use `/preview/` and are labeled accordingly.
A merge into Pulse cannot move production documentation by itself.

## Search

The website owns rendered search indexing, navigation grouping, breadcrumbs
and page outlines. Hidden maintainer sources remain directly routable but are
excluded from navigation and search by the import contract. Historical release
search remains part of its retained rendered artifact. There is no requirement
for new website builds to emit the former Pulse `search-index.json` format.

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

Historical HTML is no longer checked into `latest`. The seven former trees'
release manifests were moved byte-for-byte into `release/documentation-release-history/`.
Their catalog entries retain `archived` status and exact URLs, with
`deliveryOwner: legacy-pulse`, `sourceManifestSha256` and `archiveSource` pointing
to the immutable Git commit/path from which those metadata bytes were retained.
This identifies a historical repository input, not deployed bytes or a new
release-tag assertion. Future website-managed entries keep their existing
separate tag/SHA binding. The beta.1 capture JSON is retained unchanged alongside
the manifests; its paths describe its historical artifact, not current files.

`--archive-current` is retired rather than requiring new committed HTML. Use
`--website-managed` for release preparation. For local read-only validation of
an old artifact supplied by the owner:

```bash
node scripts/documentation-archives.cjs --directory /path/to/old/site --version 1.0.0-beta.8
```

This structural check is not receipt authentication. The separate historical
v1 candidate/receipt verifier still requires all sealed bytes and checksums.
Neither reader falls back to missing repository copies or fabricates evidence.

The website importer projects version, segment, channel, date and status; those
fields are unchanged. Catalog bytes do change when metadata pointers move: a
future reviewed released-source pin must refresh the website version-links
`source.commit` and `source.sha256` provenance, even if version URLs are unchanged.
The existing beta.9 website pin keeps its original catalog hash; do not substitute
unreleased `latest` metadata under that pin. Its normal build and recovery do not read Pulse checkout
archives. Its recovery plan and historical v1 baselines retain their original
hashes and source identities. Historical capture uses the pinned beta.9 checkout,
where those files still exist; native source-contract capture needs no archives.
The owner's existing backup and Git history provide recovery. No storage, tags,
released `main`, published versions or CLI compatibility export is changed.

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
