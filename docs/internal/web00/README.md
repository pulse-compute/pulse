# WEB-00 — Website ownership and migration contract

Status: WEB-00 complete; implementation handoff for WEB-01 through WEB-07.
Reviewed: 2026-10-09. Model/effort: Sol / high.

Human direction: create a cleaner Pulse website from the supplied v5 landing
concept, separate website presentation/deployment into `pulse-compute/website`,
and retain product READMEs and documentation in `pulse-compute/pulse`. The user
created the website repo and requested WEB-00. This packet records the target
design and exact inspection baselines; it changes no active release workflow,
deployed content, package export, version, credential, or CDN setting.

Entry point: `documentation-current`. WEB-00 writes only this repository-only
packet in Pulse, plus the website repo's introductory README, instructions,
ignore rules, and initial source lock. Future release-control changes have the
additional release/deployment owner and review scope listed below.

## Baselines and current findings

| Baseline | Identity | Pages | Content anchors | Source assets | Route aliases |
| --- | --- | ---: | ---: | ---: | ---: |
| Published beta.7 source | `v1.0.0-beta.7`, `be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb` | 83 | 1,084 | 7 | 1 |
| Inspected integration source | `latest` at `05e926830d940d53f08ebd5867ac939b9b291d6d` | 82 | 1,051 | 7 | 2 |

[Published baseline](published-beta7.json) and [integration baseline](current-latest.json)
record each source, source hash, hosted route, content anchor, visibility,
source/route alias, asset, and archive digest. They are migration fixtures, not
new production manifests. The source commits, rather than a moving branch, own
these observations. The published tag is verified to resolve to the stated SHA;
production Object Storage was not inspected in WEB-00.

- `build-docs-site.cjs` owns a custom Markdown renderer, homepage HTML,
  navigation, search, archive copying, and rendered-link validation.
- `documentation-release.cjs` mixes source/package/CLI correctness with website
  layout and delivery contracts. `docs:check` also builds the whole site.
- `/latest/**` currently contains redirects into `/v1.0.0-beta.7/**`, not
  independently rendered current pages. Root HTML currently uses release-local
  assets. Decoupling the homepage therefore requires independent website assets.
- Five archived site trees total 510 files and 20,380,236 bytes. Every current
  build copies and validates those trees. All five pass the existing archive
  validator; their asset dependencies and tree hashes are retained below.
- `@pulse-compute/cli/documentation-site.json` is a declared supported export,
  not merely a build artifact. Moving editorial ownership cannot silently delete
  that export, its schema, or its release-owned generation.

## Ownership after cutover

| Surface | Canonical owner | Website responsibility |
| --- | --- | --- |
| Root/package/example READMEs, API, changelog, guides, concepts | Pulse Markdown | Render the explicitly selected public subset; link other source files to the pinned GitHub commit |
| CLI/config/diagnostic/environment references and source-bound snippets | Existing Pulse catalogs and generators | Consume already generated, checked content; never install or execute the Pulse workspace to render it |
| Installed CLI docs, completions, example copies, MCP context corpus | Pulse generators and package tests | No second editable copy or generator |
| Version, supported targets, packages, exact diagnostic URLs, public origin | `release/pulse-release-manifest.json` | Read facts from the pinned source; validate production source against its tag and published packages |
| Public content eligibility, source aliases, stable routes | Small Pulse source contract, extracted in WEB-02 from `documentation-system.cjs` and the existing source map | Interpret the contract as data; transform links and render content |
| Homepage text/components, theme, navigation ordering, search presentation, demos | Website source | Own an independent build/review/deploy cycle |
| Site build/artifact, preview, storage deployment, cache policy, CDN verification | Website tooling/configuration | Deploy the checked artifact using the website protected environment |
| Product and operational documentation, including migration/runbooks | Pulse | Website README links to the authoritative procedure; avoid duplicated runbooks |

`release/documentation-site.json` must be split deliberately. Its source/route
facts go to the source contract; its active editorial presentation goes to the
website; any data required by the supported CLI export remains release-owned
compatibility metadata. Website edits must not require editing or synchronizing
that legacy presentation snapshot. Do not remove its export under WEB-07.

## Source import and identity

The website's `source-lock.json` initially pins the published beta.7 tag and SHA.
WEB-01 proves rendering from those bytes. The inspected `latest` snapshot above
is for reconciliation; its manifest still says beta.7 despite containing
unreleased beta.8 changes, so matching `releaseVersion` alone is insufficient.

The lock's v1 fields are `schemaVersion` (`pulse.website-source.v1`),
`repository` (`pulse-compute/pulse`), full 40-character lowercase `commit`,
`tag` (`v<releaseVersion>`), and `releaseVersion`. There is one selected product
snapshot per build. The website commit and lock hash identify the presentation
build separately. WEB-02 validates all fields, fetched commit identity, manifest
version, and tag resolution; WEB-05 additionally checks published package
availability before production release-doc promotion. An unreleased source is
an explicitly marked preview, never `/latest/` or a release claim.

Use a second Git checkout at the exact commit as ignored build input. Import
only approved Markdown/data/assets into a disposable generated content area.
Do not commit synchronized Markdown, rewrite source files, require MDX, or add
website-only frontmatter to product docs. Derive a missing page title from its
first heading. No submodule, documentation npm package, CMS, or content service
is needed for this migration.

WEB-02 extracts a small data contract for the currently approved subset:
root `README.md`, `API.md`, `CHANGELOG.md`, public `docs/**`, and example READMEs.
Keep DOC8-01's shared eligibility semantics: exclude `docs/internal/**`, retired
`docs/architecture/decisions/**`, and `AGENTS.md` from pages, assets, search and
installed copies. Package READMEs remain repository/npm sources; their public
package guides are already under `docs/packages/`. Hidden maintainer content is
excluded from navigation/search, not an authenticated namespace.

For older tags without the new data contract, a bounded adapter reproduces the
captured eligibility/routes; it does not execute imported scripts. The capture
utility in this packet is a trusted-source audit using the old renderer, not
that adapter. Imported canonical references arrive generated; Pulse checks
their drift before release. Website checks cannot certify their API semantics.

## URL and rendering contract

| Route class | Target behavior |
| --- | --- |
| `/` | v5 landing page, independently cached website assets, published-version install command |
| `/latest/**` | Released documentation from the source lock; new theme may render directly here while retaining URLs, query strings and fragments |
| `/v<version>/**` already published | Byte-preserved HTML, search, references, CSS, JS and assets; never rebuilt or restyled in place |
| A newly released exact tree | Build once from a reviewed website artifact + released Pulse source; retain its complete assets and receipt; reject same-key byte/metadata conflicts |
| `versions.json` and existing root machine manifests | Preserve existing consumers through a compatibility adapter before simplifying schemas; current release facts must remain accurate |
| Missing/unknown exact version | Real not-found behavior; no silent redirect to a different contract |

The initial public origin and base path stay `https://pulsecompute.io/`.
The source mapping stays: `docs/README.md` to the version root, root README to
`project/`, API to `api/`, changelog to `changelog/`, `docs/x.md` to `x/`, nested
`docs/x/README.md` to `x/`, and `examples/x/README.md` to `examples/x/`.
`examples/README.md` aliases `docs/examples.md`.

Resolve source-relative Markdown links through that map, retain query/fragment,
and copy approved assets to their intended routes. Non-hosted source links use
the selected commit, not a same-version tag guessed from integration content.
Maintain GitHub-style duplicate heading suffixes and explicit HTML anchor IDs.
Verify all captured content IDs before migrating a page; template-generated IDs
are outside the content-anchor count. Preview checks cover tables, nested
lists, fenced code, inline code/links, explicit anchors, diagrams where present,
relative asset links, mobile navigation, keyboard controls and no-JS reading.

Published beta.7 has `alpha-scope/` -> `preview-scope/`. Current source adds
`maintainers/compiler-efficiency-p01/` -> `maintainers/testing/` after DOC8-01.
That retired page had 36 content anchors. On retained pages, current source also
removed `contributing/#contributing-documentation`,
`maintainers/documentation-system/#publishing-the-site`, and
`maintainers/testing/#jwt-and-crypto-proof-seals`.
These are existing source changes, not losses caused by the new renderer. Keep
their exact beta.7 URLs through archive preservation. When advancing released
content, WEB-04 must give each retired moving-alias anchor an explicit mapping
or reviewed retirement; a redirect to an unrelated page is not anchor parity.

## Archive inventory and recovery

| Local retained tree | Files | Bytes | Pages |
| --- | ---: | ---: | ---: |
| `v1.0.0-beta.6` | 103 | 4,660,748 | 82 |
| `v1.0.0-beta.4` | 102 | 3,982,257 | 81 |
| `v1.0.0-beta.3` | 102 | 3,960,118 | 81 |
| `v1.0.0-beta.2` | 102 | 3,949,850 | 81 |
| `v1.0.0-beta.1` | 101 | 3,827,263 | 80 |

Each has release-local `tokens.css`, `syntax-dark.css`, `site.css`, `boot.js`,
`redirect.js`, `site.js`, `network-field.js`, and `favicon.svg`, plus its own
search/version/public-site/release manifests and listed source assets. The JSON
fixtures record their tree digests. The digest is SHA-256 of sorted UTF-8
`relativePath + NUL + byteLength + NUL + fileSha256 + LF` records. It covers all
files, not only the manifest. Archive capture checks actual local links/assets
through the existing validator. The tree hashes agree in both baselines.

Beta.7 is current and has no committed archived subtree. WEB-06 must retain the
actual published tree/receipt or the original verified deployment artifact,
including its bytes and content-type/cache metadata, before migrating delivery.
A fresh rebuild from the tag is not proof of identical published bytes; compare
to the retained receipt/storage identity before accepting it as recovery.

Beta.5 is the explicit npm-published/documentation-unpublished exception in the
release manifest, source SHA `91cc3145e7ad4bec5d94c228d95016b0f77d04fd`.
It is absent from the hosted version catalog. Preserve any existing keys; do
not fabricate a beta.5 compatibility tree or redirect its exact links to latest.
The recorded failure does not prove that production storage is currently empty.

Normal website builds must eventually read a small version index and the
selected current source, rather than rebuild or recopy all historical trees.
WEB-06 establishes a durable archive/receipt copy and exercises restoration to
an isolated prefix. WEB-07 may remove committed rendered archives only after
byte/metadata comparison, recovery validation and cutover review. Git history
is supplemental recovery, not the sole deployment backup.

## Release/deployment separation and beta.8 reconciliation

REL8-01 and REL8-02 have landed (#241/#242); DOC8-01 landed as #243. Preserve
their early source checks, exact package qualification and merge/tag binding.
The current source-check stage already builds the site once and seals those
bytes; documentation deployment does not rebuild after main. Do not reintroduce
post-main compiler qualification as part of the website.

The remaining coupling is concrete: `release-source-checks.cjs` requires a site
and docs candidate; `release-pr-qualification.cjs` copies it into accepted
artifacts; `release-qualification.cjs` verifies its digest/source and shares
binding with npm consumption. Removing the docs field naively breaks npm
publication. WEB-07 updates the writer, reader, versioned receipt compatibility,
tests and runbooks together. Already accepted artifacts/tagged workflows retain
their old readable path; the new source-only qualification applies to future
reviewed release tooling. A missing required old artifact must still fail.

| Operation | After cutover |
| --- | --- |
| Website PR | Validate lock/content/routes and frontend; no Pulse compiler test matrix |
| Pulse documentation change | Validate canonical snippets/references, source links, installed copies and MCP corpus; website source-pin PR previews the rendering |
| Pulse package release | Full package qualification/publish remains Pulse-owned; website release-doc promotion verifies exact tag/SHA and matching published package facts |
| Website deployment | Build artifact bound to website commit and Pulse source; deploy those bytes under human-reviewed production authority; retry from retained artifact |

Start with reviewed source-pin PRs; automatic cross-repo PR creation is deferred.
Moving authority/secrets/environment configuration is a human rollout action.
The old deployer hard-codes Pulse repository/workflow/release-manifest identities;
it cannot just run unchanged in the new repo. WEB-05 establishes a reviewed
website identity and separate landing versus release-doc operations, while
retaining scoped prefixes, immutable collisions, idempotent retries, checksums,
content types, cache metadata, npm gating for docs promotion, purge-before-public
verification, and no bucket-wide delete/sync. A landing-only deploy does not
republish immutable docs or trigger package qualification. Keep the current
Fastly Object Storage/VCL host initially.

WEB-06 must prevent both repos writing production concurrently during handoff.
Keep the current deployer usable until staging/rollback is proven, then switch
the active writer deliberately. Cutover has a previous website artifact and
released source pin available for rollback; exact-version objects stay intact.
Mutable multi-object publication is resumable, not claimed to be atomic.

## Keep, move, split, remove

| Current path/owner | Decision and follow-up |
| --- | --- |
| Product Markdown, `wasm/scripts/sync-doc-snippets.cjs`, `sync-reference-docs.cjs`, `scripts/pulse-context-corpus.cjs` | Keep in Pulse; detach presentation imports only after preserving generated/installed/exported semantics |
| `scripts/documentation-system.cjs` | Keep minimal source eligibility, stable URL/version helpers, installed module generation; extract shared data in WEB-02 |
| `release/documentation-site.json`, `scripts/documentation-site-config.cjs` | Split source/compatibility facts from website editorial settings; retain the declared CLI export until separately reviewed product direction |
| `scripts/documentation-ownership.cjs` | Keep source ownership/review facts; remove frontend-token checks if split reveals any |
| `scripts/documentation-release.cjs` | Keep source/package/CLI/metadata/exact-link checks; remove live-site layout/build/delivery requirements in WEB-07 after equivalent website checks |
| `scripts/build-docs-site.cjs`, `preview-docs-site.cjs`, `highlight-code-blocks.mjs`, `scripts/documentation-site/**` | Replace in website; remove old renderer/presentation dependencies after cutover; preserve archived copies |
| `scripts/documentation-deployment.cjs`, `release/documentation-deployment.json`, `infra/fastly/documentation/**` | Port only required delivery behavior into website; remove obsolete Pulse ownership after reviewed writer handoff |
| `.github/workflows/documentation.yml`, `documentation-deploy.yml` | Replace frontend preview/deploy in website; retain a focused Pulse source-doc check, then retire old deploy workflow |
| `release/documentation-versions.json` | Split product history/CLI compatibility from website's actual hosted-version availability; do not assume manifest version means hosted bytes exist |
| `release/documentation-site-archives/**` | Retain now; move durable recovery ownership and remove only after WEB-06 proof |
| `package.json` docs scripts and Starry Night dependency | Keep source sync/check commands; remove renderer-only commands/dependency after caller audit |
| `release-source-checks.cjs`, `release-pr-qualification.cjs`, `release-qualification.cjs` | Remove new-schema website candidate dependency together in WEB-07; preserve package receipt authentication and older supported artifact readers |
| `release-prepare*.cjs`, `release-preflight.cjs`, `source-identity.cjs`, maintenance policy, package/CLI export manifests | Audit archive/editorial path lists and generated owners; update declared boundaries together; no silent export deletion |
| `validate-publication-workflows.cjs`, `validate-maintainer-control-plane.cjs`, docs/release fixtures | Separate npm/Pulse contract checks from website deploy simulations; preserve negative cases for both owners |
| Canonical maintainer procedures and `AGENTS.md` | Update Pulse runbooks/instructions once ownership changes; website README links to them |

This list is a migration target, not an instruction to delete these paths in
WEB-00. Record removed owners and dependencies in WEB-07's final diff; moving a
large custom renderer intact is not the target result.

## Ticket handoffs and completion gates

| Ticket | Owner | Bounded deliverable / acceptance | Model / effort | Dependencies |
| --- | --- | --- | --- | --- |
| WEB-00 | Both repos | This contract, two deterministic baselines, website foundation and published source lock; no active pipeline changes | Sol / high | Done |
| WEB-01 | Website | Astro/Starlight candidate proof: v5 hero plus docs overview, quickstart, CLI reference, API and one example; old-route/anchor parity, nested-list/code/explicit-anchor probe; decide framework from observed output | Sol / high | 00 |
| WEB-02 | Both repos | Read-only importer + minimal source contract, exact lock validation, ignored derived content, relative-link/assets adapter and source provenance; installed/MCP generation stays correct | Sol / high | 01 |
| WEB-03 | Website | Full v5 landing, extracted/lazy demo assets, published-version command, mobile/keyboard/modal/no-JS reading checks; concept/fixture labels preserved until replaced with measured output | Sol / high | 01; release data from 02 |
| WEB-04 | Website; Pulse only for source contract/retirement decisions | Full docs/nav/search/theme/versions and link/anchor coverage against selected baseline; explain current-versus-published changes explicitly | Sol / high | 02 |
| WEB-05 | Website | Credential-free checks/build, immutable artifact identity, reviewed deployment tooling/environment handoff, scoped storage retry, landing/docs phases, CDN/public checks and rollback procedure in Pulse | Sol / high | 02 |
| WEB-06 | Both repos/infrastructure owner | Staging public-route checks, exact archive/metadata preservation, durable recovery/restore, coordinated single-writer cutover and rollback reviewed before production action | Sol / high | 03–05 |
| WEB-07 | Pulse/release owner | Remove superseded renderer/deploy/archive workload, split docs candidate qualification schema safely, preserve CLI exports/source checks/npm binding and update procedures | Sol / high | Successful 06 |

Astro with Starlight is a candidate, not an installed dependency or settled
framework in WEB-00. WEB-01 must fail the proposal early if importing ordinary
Markdown, preserving routes/anchors or applying the v5 visual system requires
substantial framework overrides. No CMS, runtime backend, new public URL tree,
Pulse compiler changes, or automatic cross-repo orchestration is in this scope.

The supplied `Pulse-Landing-Refresh-Concept-v5.html` is the visual reference.
Its source hash is recorded in [concept.json](concept.json); it contains inline
screenshots and a base64 report fixture. WEB-03 extracts separately cached
assets and lazy-loads the report rather than retaining one large HTML blob.
Keep the slate/mint palette, static hero, Inspect/Doctor/Report sequence,
explicit target selection and evidence-led report section. Compare and ARC
figures remain clearly labeled concepts/fixtures until backed by real output.

## Reproduce WEB-00 inventory

From a trusted checkout with the published tag fetched and a separate worktree
at that tag, run:

```bash
node docs/internal/web00/capture-baseline.cjs --source ../pulse-beta7 --out docs/internal/web00/published-beta7.json --check
node docs/internal/web00/capture-baseline.cjs --source ../pulse-inspected-latest --out docs/internal/web00/current-latest.json --check
```

The second worktree must be at `05e926830d940d53f08ebd5867ac939b9b291d6d`.
The utility rejects modified tracked inputs and reads no production storage or
credentials. It validates each archive with the old renderer and retains only
the compact route/asset/digest contract, not copied archive bytes or run logs.
New captures require a new output path; review baseline updates rather than
silently overwriting them. Retire this audit utility once migration is complete.
