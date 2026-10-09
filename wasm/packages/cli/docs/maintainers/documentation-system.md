<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-09
review-by: 2027-04-09
pulse-doc-meta:end -->

# Documentation system and release workflow

Pulse documentation and the public product site have three synchronized delivery forms:

1. repository Markdown for review and source-bound examples;
2. installed Markdown, references, schemas, examples, and completions in the CLI package;
3. a generated public homepage plus a searchable, versioned static-site artifact under `.pulse-docs-site/`, with committed immutable exact-version archives for prior releases.

## Canonical owners

- `release/pulse-release-manifest.json` owns the release version, hosted documentation route, runtime targets, package set, support tiers, and supported entry points.
- `release/documentation-site.json` owns editable homepage copy, named document destinations, public navigation grouping and order, and homepage composition.
- `release/maintenance-policy.json` owns change classes, protected boundaries, validation selection, CODEOWNERS/label generation, and the resident-maintainer authority model.
- `wasm/packages/cli/src/command-spec.js` owns public commands and options; it generates help, the CLI reference, and shell completions.
- `wasm/packages/cli/src/project-config-schema.js` owns core config fields, defaults, and runtime constraints.
- `packages/provider-fastly/src/config-schema.json` owns Fastly provider defaults.
- the diagnostic and environment catalogs own their generated references.
- `release/documentation-versions.json` owns the version selector and latest alias.
- `scripts/documentation-site/` owns shared presentation tokens, the vendored Starry Night dark theme, components, browser behavior, the favicon, and the deterministic decorative Pulse field.

Do not hand-edit generated copies under `wasm/packages/cli/docs`, `wasm/packages/cli/completions`, or `.pulse-docs-site`. Edit the editorial manifest, canonical catalogs, Markdown, or shared site assets instead. The site directory is an ignored build artifact, not a source tree. Prior exact releases are the exception: `release/documentation-site-archives/v<version>/` contains a byte-preserved site subtree created while that release is still current.

## Procedure owners

| Task | Authoritative procedure |
| --- | --- |
| Contribute a change | [Contributor workflow](../contributing/README.md) |
| Edit and validate docs | Update loop below |
| Inspect site presentation | [Public site](./public-site.md#build-and-inspect) |
| Run tests or recover a seal | [Testing Pulse](./testing.md) |
| Understand release coverage | [Release acceptance](./release-acceptance.md) |
| Prepare, qualify and publish a release | [npm publishing](./npm-publishing.md) |
| Preserve exact-version history | [Documentation versions](./documentation-versioning.md) |
| Upload and promote hosted docs | [Documentation deployment](./documentation-deployment.md) |

Keep commands and recovery instructions with their owner; link to that page
from other guides. Historical task packets and raw run evidence belong in Git
history or retained run artifacts, not active procedures.

## Update loop

```bash
npm run docs:sync
npm run maintainer:check
npm run docs:check
node scripts/documentation-release.cjs
```

`docs:sync` also runs maintenance-policy synchronization. It refreshes references,
package metadata, shell completions, installed documentation, ownership metadata
and source-bound examples, regenerates the allowlisted MCP context corpus before
copying bundled examples, and removes retired generated copies.
`maintainer:check` validates the control plane and registered test commands.
`docs:check` checks generated-file drift and builds/validates the hosted site in
a temporary directory. `documentation-release.cjs` additionally checks package,
CLI, configuration, source-link and documentation-delivery contracts. Source-link
validation includes the root contributor entry point and PR template, so stale
links there fail the same gate.

`docs:site:check` is the standalone hosted-site check already included in
`docs:check`; it need not be added to this sequence. Use `npm run docs:site` to
retain a local artifact or [the preview adapter](./public-site.md#build-and-inspect)
for presentation work.

## Delivery boundaries

Repository-only material under `docs/internal/`, retired architecture decisions,
and `AGENTS.md` files are excluded from hosted pages, hosted assets and installed
CLI docs by the shared source policy in `scripts/documentation-system.cjs`.
Generated references remain derived from their catalogs; deleting a canonical
page removes its installed copy on synchronization. Immutable prior-version
archives are preserved, not regenerated during current-document cleanup.

The **Documentation** workflow validates changes and uploads previews. Production
delivery is a manual exact-tag operation consuming the pre-main qualified
artifact; it does not rebuild or deploy through GitHub Pages. The
[deployment runbook](./documentation-deployment.md) owns verification, immutable
uploads, npm gating and promotion. The [versioning procedure](./documentation-versioning.md)
owns snapshots from the exact published source before advancing the version.

## Ownership and review dates

Contributor and handwritten maintainer pages carry a generated
`pulse-doc-meta` block. The
release gate requires a known owner, status, last-reviewed date, and non-expired
review-by date. Update the ownership catalog and review the page content
together; do not merely extend a date without verifying the document.

The detailed editing contract, navigation rules, hero motion requirements, and presentation-specific gates are documented in [Public site and documentation presentation](./public-site.md).
