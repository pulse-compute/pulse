# WEB-02 — Read-only source import

Status: implemented for review, 2026-10-09. The [WEB-00 contract](../web00/README.md)
and [WEB-01 framework decision](../web01/README.md) remain the migration boundary.
Website implementation: `pulse-compute/website`, branch `feat/web-02-source-import`,
based on merged website #2. Pulse changes stack on the still-open #248 branch at
`39b47d7f404f4256088e1c26a671cb2cdddec396`.

Entry point: `documentation-current`. The additional release-owned path
`release/documentation-sources.json` is the minimal source-data extraction
explicitly authorized by WEB-02 and the user's “Implement WEB-02” direction.
The current maintenance catalog does not yet classify this new release-file path;
the scope report identifies it for human review rather than granting implicit authority.
This is a protected release-authority surface: the PR declares `Human decision:
required`, records the supplied direction, and leaves merge/publication/deployment
under human authority. No release identity, channel or publication route changes.

## Ownership and data boundary

`release/documentation-sources.json` owns eligibility, root routes, source aliases,
route aliases and hidden maintainer prefixes under `pulse.documentation-sources.v1`.
It contains no navigation ordering, theme, renderer, hosted-version availability,
search index, or deployment settings. `scripts/documentation-sources.cjs` interprets
it for Pulse's existing public source selection and stable URL helper. The old
site/CLI export remains supported; a focused compatibility check verifies its
source aliases, route aliases and hidden prefixes agree with the new contract.
Legacy presentation and archive owners remain until WEB-06/07.

The website interprets this JSON as data. It never imports Pulse JavaScript,
installs the Pulse workspace, runs generators, or executes lifecycle scripts.
Canonical generated references arrive from the selected commit. Pulse's own
source checks remain responsible for semantic correctness, installed CLI copies,
and the curated MCP corpus. Package READMEs remain pinned GitHub source links.

Approved sources are root README/API/CHANGELOG, eligible docs Markdown, and
example READMEs. Any docs path segment `internal`, the architecture decisions
subtree, and AGENTS files are excluded from pages/assets. Hidden maintainer
pages remain directly readable but carry hidden navigation/search flags. Eligible
non-Markdown docs assets retain their original bytes. No editable Markdown mirror
or product frontmatter was added.

## Selection and provenance

The website's published lock remains beta.7 at full SHA
`be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`. Before replacing derived output the
importer checks the exact lock schema/fields, canonical repository, full SHA,
version/tag pair, source origin, checkout HEAD, tracked cleanliness, resolved tag,
and release-manifest schema/repository/origin/base path/version/latest alias/source identity. It reads tracked Git
blobs at that immutable SHA, not working-tree content; untracked files cannot
enter the import. Eligible symlinks, unsafe paths, malformed contracts, missing
roots, invalid aliases and page/asset/alias output collisions fail closed.

Beta.7 predates the new data file. Its website-owned adapter is bounded to that
single captured commit and reproduces WEB-00 eligibility/routes/visibility.
Unknown commits without a native contract are rejected. Older Pulse renderer
scripts and editorial manifests are never executed or interpreted to discover
policy. A future released source requires a reviewed source-lock update and a
native v1 contract; a matching manifest version alone never proves publication.

Ignored `.pulse-content/import-manifest.json` records source commit/tree, resolved
tag, exact lock-file hash, source manifest and native-contract blob/hash (or bounded
adapter identity), page/asset blob IDs and SHA-256 hashes, routes, visibility and
aliases. This is source provenance, not a deployment receipt or package seal.
WEB-05 owns complete website-artifact identity and protected delivery authority.

Managed outputs are ignored `src/content/docs/`, `public/latest/`, `public/preview/`,
`.pulse-content/`, `.astro/` and `dist/`. Inputs are validated before replacement;
managed generated content and caches are rebuilt to remove stale pages/assets.
The importer touches neither source checkout files nor published archive inputs.
The build emits no `/v<version>/` HTML. Production archives, object metadata,
public availability and restoration are still WEB-06 evidence requirements.

Relative Markdown links/images/reference definitions resolve through the selected
source map, including `examples/README.md`'s alias, and retain query/fragment suffixes.
Non-hosted files link to the exact GitHub source commit. Mapped `/latest/` links
follow the selected local prefix; explicit exact-version URLs retain archive
identity. Framework-owned Markdown parsing preserves nested lists/tables/code.
The compatibility plugin retains legacy/explicit heading IDs and rejects executable
imported HTML/URLs. Literal diff prefixes are preserved by disabling Expressive
Code's text-marker transformation. There are no Starlight component overrides.

Route aliases use injected static pages with a JavaScript redirect that preserves
queries/fragments and a readable canonical link without JavaScript. HTTP/CDN
redirect status and production delivery belong to WEB-05; this scaffold makes no
claim of a server-side redirect or no-JS query/fragment transfer.

## Reproduce a published import

In a clean website checkout with Node 22.12+ (tested Node 24.19.0):

```bash
npm ci
npm run source:fetch
npm run build
npm run check
npm test
npm run verify:import
npm run verify:proof
npx playwright install chromium
npm run test:browser
```

`source:fetch` creates a separate ignored shallow checkout at the locked tag,
checks the tag's full SHA, and detaches HEAD with hooks disabled. It refuses to
replace an existing cache. To use an existing clean pinned worktree, set
`PULSE_SOURCE_DIR` for build/check/dev; do not run `source:fetch`. `prepare:proof`
is retained as a script-name compatibility alias for the full importer;
`import:source` exposes the same operation directly.

For the full beta.7 regression comparison, point the optional verifier input at
the canonical Pulse baseline rather than checking a second full inventory into
website:

```bash
PULSE_BASELINE=../pulse/docs/internal/web00/published-beta7.json npm run verify:import
```

The baseline must match the published import commit/tree. Without that option,
verification still checks every imported page/asset, Markdown hash, code block,
unique DOM ID, source edit link, local link/fragment, alias fallback and complete
HTML output allowlist. The retained five-page WEB-01 oracle separately binds all
121 captured IDs and the labeled structural fixture to beta.7.

## Unreleased native-contract preview

Use a clean checkout of a reviewed Pulse commit containing the new data contract.
Pass its complete HEAD SHA explicitly; do not rewrite the published lock:

```bash
PULSE_SOURCE_DIR=../pulse-preview \
PULSE_PREVIEW_COMMIT="$(git -C ../pulse-preview rev-parse HEAD)" npm run build
npm run verify:import
PULSE_SOURCE_DIR=../pulse-preview \
PULSE_PREVIEW_COMMIT="$(git -C ../pulse-preview rev-parse HEAD)" npm run check
npm run test:browser
```

This mode uses `/preview/`, labels the landing “Unreleased preview” and each doc
“Unreleased source preview”, records no release tag, and emits no `/latest/` or
exact-version tree. The manifest version is recorded only as an input fact.
Switching back to the default locked build removes stale preview pages/assets.
Do not run the published-only `verify:proof` oracle against an unreleased source.
Native tagged imports, selection failures, exclusions, provenance and stale-output
replacement are also exercised in isolated temporary Git-repository tests, with
throwing source scripts present to verify no imported code executes.

## Evidence and remaining handoff

The native contract preview of this Pulse change imports **82 pages, 1,051 anchors,
seven assets, 406 code blocks and 5,213 local links/assets**, all under `/preview/`,
with per-page unreleased banners. Full verification, Astro typecheck and the same
representative browser checks pass. These current-versus-published counts reflect
the existing retirement recorded in WEB-00, not a source-pin advance.

Published beta.7: **83 pages, 1,084 source anchors, seven byte-identical assets,
434 fenced code blocks and 5,300 local links/assets** pass. All page/source hashes,
routes, visibility flags, aliases and ordered IDs match WEB-00's full inventory.
The five-page WEB-01 oracle and structural probe also pass. Focused importer/link
tests pass; Chromium 134.0.6998.35 checks seven representative routes at
1440/768/390/320px, keyboard/mobile navigation, query/fragment-preserving aliases,
no-JS reading/fallback, and an exact-version 404. This browser run uses a locally
available headless executable; production-hosted archives are not tested.

Pulse `docs:sync` changes no generated tracked files. Source exclusion/compatibility,
`maintainer:check`, `docs:check`, `documentation-release.cjs`, and MCP corpus checks
pass; the corpus remains 228 records with hash
`db57b1884a6297a4b0dab0c14686c4239ed8532a725615bb44c01bdb9840543e`.

WEB-03 can consume the selected release facts for the full landing. WEB-04 owns
full navigation/search/theme/version UX and retired-anchor decisions; the current
sidebar remains the five-page proof navigation with global search disabled.
WEB-05/06 own CI, artifact/deployment receipts, staging, archive recovery, single-writer
cutover and rollback. WEB-07 removes obsolete owners after those gates close.
