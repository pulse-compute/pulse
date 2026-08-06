# Documentation maintainer instructions

These instructions extend the repository root guidance for `docs/`.

- Keep the layered path intact: start, examples, guides, concepts, packages,
  reference, authors, and the gated maintainer namespace.
- Distinguish current canonical behavior from compatibility and internal history.
- Bind executable or contract-sensitive examples to canonical source files whenever practical.
- Do not promise public third-party lowerers or providers while `publicPluginApi` remains false.
- Do not describe dependency-bound validation as complete unless the dependency bundle was restored and the commands actually passed.
- Add contributor and maintainer pages to `scripts/documentation-ownership.cjs`
  and keep their review dates honest.
- Update `release/documentation-site.json` when a new public page needs navigation order or a named route.
- Edit generated references through their source catalogs. Run `npm run maintainer:sync`, `npm run docs:sync`, `npm run docs:check`, and `node scripts/documentation-release.cjs`.
- For npm publishing or documentation deployment changes, also run `npm run publication:check`; do not describe local simulation as a production deployment.

Review links, anchors, installed CLI copies, exact-version hosted routes, and mobile/no-JavaScript behavior as release surfaces rather than cosmetic details.

## Pulse entry points

Paths are repository-root-relative. The root Entry Point rules remain in force.

### documentation-current

**Use for**

Current documentation authority, pruning, information architecture,
navigation/search classification, author/reference guides, links, and
source-bound examples. Repository-only synthesis inputs are not hosted,
searched, installed, or classified as current documentation.

**Contracts**

- `release/documentation-site.json`
- `scripts/documentation-ownership.cjs`
- `scripts/documentation-system.cjs`
- `scripts/build-docs-site.cjs`
- `scripts/documentation-release.cjs`

**Write**

- `README.md`
- `API.md`
- `CHANGELOG.md`
- `SECURITY.md`
- `SUPPORT.md`
- `docs/**`
- `examples/**/README.md`
- `packages/**/README.md`
- `wasm/*.md`
- `wasm/docs/**`
- `wasm/examples/**/README.md`
- `wasm/packages/*/README.md`
- `release/documentation-site.json`
- `scripts/build-docs-site.cjs`
- `scripts/documentation-*.cjs`
- `scripts/environment-reference.cjs`
- `scripts/documentation-site/**`
- `wasm/scripts/sync-reference-docs.cjs`
- `wasm/test/docs/**`
- `wasm/packages/cli/docs/**`
- `.pulse-docs-site/**`

**Derived**

- `docs/reference/**`
- generated pages and machine artifacts under `docs/maintainers/**`
- `wasm/packages/cli/docs/**`
- generated package README status blocks
- `.pulse-docs-site/**`

**Read**

- `release/pulse-release-manifest.json`
- `release/documentation-versions.json`
- canonical CLI, configuration, diagnostic, environment, and package catalogs
- source files referenced by contract-sensitive examples

**Evidence**

- `npm run maintainer:check`
- `npm run docs:sync`
- `npm run docs:check`
- `node scripts/documentation-release.cjs`
- focused `docs-executable-*` or `docs-example-*` tasks for changed executable guidance

**Supplements**

- `docs/maintainers/documentation-system.md`

**Exclude**

- product behavior or public API changes
- CLI workflow-source changes owned by `project-workflow`
- release version, channel, release date, package ranges, or deployment promotion
- hand-editing generated references or installed CLI documentation
