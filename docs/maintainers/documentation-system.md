<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
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

## Update loop

```bash
npm run maintainer:sync
pnpm docs:sync
pnpm docs:check
pnpm docs:site:check
node scripts/documentation-release.cjs
```

`maintainer:sync` refreshes generated governance outputs. `docs:sync` refreshes references, package metadata, shell completions, installed documentation, ownership metadata, and source-bound examples. `docs:check` fails when any checked-in generated surface is stale. `docs:site:check` builds and validates the hosted artifact in a temporary directory; `docs:site` writes `.pulse-docs-site/` for inspection or deployment.

For local presentation work, `pnpm docs:preview` performs the synchronization and build, mounts the artifact at `/`, and serves it at `http://127.0.0.1:4173/`. The preview adapter does not rewrite production HTTPS origins or release manifests. `pnpm docs:preview -- --smoke` exercises the local HTTP surface and exits, while `--watch` rebuilds when documentation or presentation sources change. Preview roots are symlink-checked and carry a generator ownership marker; populated unowned directories are rejected, and `--no-build` can only reuse a complete owned artifact.

## Publishing the site

The Pages workflow builds `.pulse-docs-site/` for pull requests and main-branch changes, but those events are validation-only. The base route is a generated product homepage; `latest` remains a documentation redirect tree. Publication requires an explicit manual dispatch or a `v<version>` tag that exactly matches `release/pulse-release-manifest.json`. The canonical documentation release lives under `/v<version>/`; `/latest/` contains redirects to the version marked latest. The homepage uses the current release’s exact-version CSS and JavaScript so its shipped presentation is archived with that release. Every exact subtree owns its HTML, assets, search index, release manifest, and version-site manifest.

Before changing the release version, run `pnpm docs:site -- --snapshot` while the old release is still current and commit the resulting `release/documentation-site-archives/v<version>/` directory. Add the new version entry only after the archive exists. The builder imports and validates every non-current archive; missing or mismatched history is a release error rather than a Pages deployment that drops old URLs.

## Ownership and review dates

Contributor and handwritten maintainer pages carry a generated
`pulse-doc-meta` block. The
release gate requires a known owner, status, last-reviewed date, and non-expired
review-by date. Update the ownership catalog and review the page content
together; do not merely extend a date without verifying the document.

The detailed editing contract, navigation rules, hero motion requirements, and presentation-specific gates are documented in [Public site and documentation presentation](./public-site.md).
