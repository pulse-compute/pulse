<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-21
review-by: 2027-04-21
pulse-doc-meta:end -->

# Documentation system and release workflow

Pulse owns canonical Markdown, generated references, installed CLI documentation
and source-bound executable examples. `pulse-compute/website` owns the public
homepage, rendering, navigation, search, previews and delivery of selected source.

## Canonical owners

- `release/pulse-release-manifest.json` owns the release version, hosted documentation route, runtime targets, package set, support tiers, and supported entry points.
- `release/documentation-sources.json` owns the renderer-independent public source roots, exclusions, aliases, routes and hidden maintainer prefixes. `scripts/documentation-sources.cjs` enumerates pages and assets without loading presentation code. The website importer reads this data contract from the selected Git commit, including unreleased previews.
- `release/documentation-site.json` remains supported CLI compatibility metadata; it no longer drives a Pulse renderer. Its route/alias facts stay aligned with the source contract.
- `release/maintenance-policy.json` owns change classes, protected boundaries, validation selection, CODEOWNERS/label generation, and the resident-maintainer authority model.
- `wasm/packages/cli/src/command-spec.js` owns public commands and options; it generates help, the CLI reference, and shell completions.
- `wasm/packages/cli/src/project-config-schema.js` owns core config fields, defaults, and runtime constraints.
- `packages/provider-fastly/src/config-schema.json` owns Fastly provider defaults.
- the diagnostic and environment catalogs own their generated references.
- `release/documentation-versions.json` owns the version selector and latest alias.
- The website repository owns presentation assets and browser behavior.

Do not hand-edit generated installed documentation, completions or MCP data.
Historical exact-release trees remain immutable compatibility/recovery inputs,
not templates for future releases. `scripts/documentation-archives.cjs` retains
read-only validation of their manifests, links, anchors and assets.

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
| Website delivery and historical receipt reading | [Writer retirement boundary](./documentation-deployment.md#writer-retirement-boundary) |

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
`docs:check` checks generated-file drift, canonical links, package/CLI/config
parity, source metadata and the MCP context corpus without rendering or sealing
HTML. `documentation-release.cjs` exposes the same source validation for package
consumers. Source-link validation includes contributor and PR-template links.
All 14 executable documentation tasks remain registered and run through the
normal task runner; source checks do not replace their execution evidence.

## Shared example layout

An example README opts into the shared layout with
`<!-- pulse-example-template:v1 -->`. `docs:sync` keeps its purpose first,
regenerates the request/response table from resolved HTTP and event harness cases, and
orders the authored Code, Inspect, Doctor and Report material before workflow,
test evidence and size measurements. Only present, nonempty views are emitted.
Handler/application, project-config, harness, workflow and size headings retain their anchors.

Edit the authored section prose and the existing `pulse-doc-source` / `pulse-doc-run`
bindings. The request/response table and Code grouping are generated. JSON results
are explicitly selected excerpts and must be verified by executable documentation;
never add placeholder Inspect/Doctor/Report output. A report binding may prepare
one build in `.pulse-docs-build`, then replay that retained artifact; it does not
embed a report viewer in Markdown. Installed copies and the MCP corpus regenerate
through the ordinary pipeline. All 11 public runnable examples use this layout, including nested Dynamic endpoint probes. The examples index and the private Assets package-out and MCP authorization fixtures are not public application walkthroughs. Examples without the marker remain unchanged.

Inspect and Doctor excerpts describe the selected default profile. Report requires
completed Native evidence: Entities tools selects `node-native`; context MCP
binds its nested `application/` project. Event cases retain their input frames,
expected errors and emitted events. Protocol examples without a Pulse harness
may opt into `<!-- pulse-example-requests:authored -->` to retain a concise
Request and response section. Their executable docs gate must replay the live
request and verify its selected result; it must not claim harness-derived evidence.
The pipeline refreshes harness tables after regenerating the corpus, then checks
both owners to reject cyclic or stale output. Context MCP maintenance and
compatibility notes live in the repository-only
maintenance note (repository-only: `docs/internal/mcp-context-example.md`).

## Delivery boundaries

Repository-only material under `docs/internal/`, retired architecture decisions,
and `AGENTS.md` files are excluded from hosted pages, hosted assets and installed
CLI docs by the shared source policy in `scripts/documentation-system.cjs`.
Generated references remain derived from their catalogs; deleting a canonical
page removes its installed copy on synchronization. Immutable prior-version
archives are preserved, not regenerated during current-document cleanup.

The **Documentation** workflow runs `node scripts/documentation-check.cjs` and
preserves its `build` job name for required-check compatibility. It neither
renders nor uploads a sealed website candidate. Contract tests reject a return
to rendering/sealing and retain generated-corpus and installed-mirror negatives.

Website builds consume the source contract from an explicit selected commit.
Its developer-only legacy baseline capture must use pinned historical sources
such as beta.9, which retain their renderer. It cannot capture this retired
renderer from current Pulse. Future source inventories should use
`release/documentation-sources.json`; rendered parity and recovery evidence
belong to website tools and retained artifacts, not a rebuilt Pulse site.

The old writer source and storage-write simulations are retired from Pulse.
The website handoff guard still queries the historical workflow identity and
requires it to remain disabled and idle. Supported v1 receipt readers verify
retained bytes; v2 source qualifications cannot authorize the old writer. See the
[deployment runbook](./documentation-deployment.md) for the legacy boundary and
[versioning procedure](./documentation-versioning.md) for tagged source history.

## Ownership and review dates

Contributor and handwritten maintainer pages carry a generated
`pulse-doc-meta` block. The
release gate requires a known owner, status, last-reviewed date, and non-expired
review-by date. Update the ownership catalog and review the page content
together; do not merely extend a date without verifying the document.

Presentation ownership and retained compatibility are documented in [Public site and documentation presentation](./public-site.md).
