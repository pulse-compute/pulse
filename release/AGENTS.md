# Release-control instructions

Release files are protected human-authority surfaces.

- Do not change release version, channel, package composition, documentation version, publication route, signing, or provenance policy without explicit human direction.
- Keep release-owned manifests internally consistent and regenerate every hosted/installed copy.
- `maintenance-policy.json` is the source of truth for agent authority, scope classification, labels, CODEOWNERS output, and required checks.
- Any change here requires `Human decision: required` in the pull-request declaration and the appropriate protected boundaries.
- That field identifies human decision authority, not whether direction is still outstanding. Record already supplied human direction and continue within it; it does not authorize merge, publication or deployment.
- A passing portable validation set does not substitute for the real pnpm build, release pack, package acceptance, clean-machine acceptance, or external provider reality checks.
- Report aggregate seal status separately from additional feature acceptance gates. Conditional KV's required local task and deployed Pulse cross-location evidence are not satisfied by the generic Fastly reality task, the portable release profile or a standalone live SDK probe. Consult `wasm/test/kv/K4.md`; carry unresolved requirements as blockers, without waiving assertions or relabeling a known failure as passed.
- Authoritative release evidence requires the complete replay on the clean candidate source, terminal passing reports and exact package/artifact identities. Development reruns, partial task ranges and reports from another tree cannot be pooled into a seal.

- `pulse-release-manifest.json#publication` owns npm registry, channel tag, trusted-publisher identity, toolchain, and canonical smoke package.
- `documentation-deployment.json` owns Object Storage prefixes, immutable and mutable classes, deployment receipts, cache classes, and public verification routes.
- Exact npm tarballs and exact-version documentation objects are immutable release artifacts. Never replace an existing same-version artifact with different bytes.
- Production publication and documentation promotion require the exact reviewed release tag plus human approval of the corresponding protected environment.

## Pulse entry points

Paths are repository-root-relative. The root Entry Point rules remain in force.

### release-readiness

**Use for**

Pre-snapshot release contracts and gates: vocabulary schema, license, supported
and exact Node versions, dependency bundles, npm bootstrap, public identities,
supply-chain evidence, and mandatory provider reality.

**Contracts**

- `LICENSE`
- `NOTICE`
- `release/maintenance-policy.json`
- `release/pulse-release-manifest.json`
- `release/documentation-deployment.json`
- `release/release-preflight.json`
- `release/documentation-inventory.json`
- `package.json`
- `.github/workflows/validate.yml`
- `.github/workflows/npm-publish.yml`
- `.github/workflows/documentation-deploy.yml`

**Write**

- `LICENSE`
- `NOTICE`
- `package.json`
- `packages/*/package.json`
- `wasm/packages/*/package.json`
- `release/maintenance-policy.json`
- readiness, legal, publication, toolchain, and display-label fields in `release/pulse-release-manifest.json`
- `release/documentation-deployment.json`
- `release/release-preflight.json`
- `release/documentation-inventory.json`
- `release/AGENTS.md`
- `.gitignore`
- `.github/workflows/validate.yml`
- `.github/workflows/npm-publish.yml`
- `.github/workflows/documentation-deploy.yml`
- `.github/ISSUE_TEMPLATE/**`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `.github/labels.yml`
- `.github/codex/schemas/maintainer-review.schema.json`
- `scripts/maintenance-policy.cjs`
- `scripts/validate-maintainer-control-plane.cjs`
- `scripts/pack-release.cjs`
- `scripts/release-*.cjs`
- `scripts/publish-release.cjs`
- `scripts/validate-release.cjs`
- `scripts/validate-publication-workflows.cjs`
- `scripts/release-preflight.cjs`
- `scripts/offline-release-candidates.cjs`
- `scripts/bundle_deps.sh`
- `scripts/restore_deps.sh`
- focused release/control-plane tests under `wasm/test/release/**`
- generated maintenance-policy references under `docs/maintainers/**` and `wasm/packages/cli/docs/maintainers/**`

**Derived**

- generated maintenance-policy references under `docs/maintainers/**` and `wasm/packages/cli/docs/maintainers/**`
- `.github/CODEOWNERS`
- `.github/labels.yml`
- `.github/codex/schemas/maintainer-review.schema.json`

**Read**

- all publishable package manifests
- `pnpm-lock.yaml`
- all checked-in documentation sources classified by `release/documentation-inventory.json`
- `packages/provider-fastly/src/testing/**`
- existing release, publication, deployment, and evidence reports
- public npm, repository, documentation-origin, and provider state when access is available

**Evidence**

- `npm run release:preflight`
- `npm run maintainer:sync`
- `npm run maintainer:check`
- `npm run publication:check`
- focused release/control-plane scripts changed by the task
- no aggregate release seal until `release-seal`

**Supplements**

- `docs/maintainers/npm-publishing.md`

**Exclude**

- product behavior, new packages/providers, or architecture expansion
- the atomic version/channel/date/package-range snapshot
- packed candidate acceptance or final aggregate replay
- npm publication, documentation deployment/promotion, or Fastly activation

### documentation-release

**Use for**

The atomic snapshot after readiness decisions close: version, channel, display
label, date, package ranges, status text, generated references, installed
documentation, and versioned site inputs.

**Contracts**

- `release/pulse-release-manifest.json`
- `release/documentation-versions.json`
- `release/documentation-site.json`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/package-support.cjs`
- `scripts/documentation-release.cjs`

**Write**

- `release/pulse-release-manifest.json`
- `release/documentation-versions.json`
- `release/documentation-site.json`
- `package.json`
- `pnpm-lock.yaml`
- `packages/*/package.json`
- `wasm/packages/*/package.json`
- `README.md`
- `API.md`
- `CHANGELOG.md`
- release-status text in `docs/**`, `examples/**/README.md`, and package READMEs
- `docs/reference/**`
- `wasm/packages/cli/release-manifest.json`
- `wasm/packages/cli/docs/**`
- `.pulse-docs-site/**`

**Derived**

- `docs/reference/**`
- `wasm/packages/cli/release-manifest.json`
- `wasm/packages/cli/docs/**`
- generated package README status blocks
- `.pulse-docs-site/**`

**Read**

- completed readiness and blocker ledgers
- canonical package, CLI, diagnostic, environment, and documentation catalogs
- release-owned generators and synchronization scripts

**Evidence**

- `npm run maintainer:sync`
- `npm run docs:sync`
- `npm run maintainer:check`
- `npm run docs:check`
- `node scripts/documentation-release.cjs`
- `npm run publication:check`

**Supplements**

- `docs/maintainers/documentation-versioning.md`

**Exclude**

- unresolved release-policy, license, toolchain, bootstrap, or origin decisions
- product, CLI workflow, package-surface, lowerer, or provider implementation fixes
- generator behavior changes; route those through `documentation-current` or `release-readiness`
- packed artifacts, final evidence aggregation, publication, deployment, or promotion

### release-seal

**Use for**

Packed-consumer and provider-reality candidates, clean-state aggregate replay,
documentation checks, packaging, artifact verification, and final release
evidence only.

**Contracts**

- `release/maintenance-policy.json`
- `release/pulse-release-manifest.json`
- `package.json`
- `wasm/test/suite/registry.cjs`
- `scripts/validate-release.cjs`

**Write**

- `wasm/.test-results/**`
- `.pulse-release/**`
- `.pulse-docs-site/**`
- `.pulse-publication/**`
- `.pulse-documentation-deployment/**`
- no tracked source by default; route fixes through the relevant implementation Entry Point

**Read**

- the current sprint diff and pass-specific evidence
- `wasm/test/release/**`
- `scripts/pack-release.cjs`
- `scripts/release-*.cjs`
- `scripts/bundle_deps.sh`
- `scripts/restore_deps.sh`

**Evidence**

- `npm run maintainer:check`
- `npm run docs:check`
- `node scripts/documentation-release.cjs`
- `pnpm build`
- `node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-compute-reality --no-report` for the provider candidate
- `npm run release:seal -- --require-fastly` for the authoritative final seal
- `npm run publication:check`

**Supplements**

- `docs/maintainers/testing.md`
- `docs/maintainers/release-acceptance.md`
- `docs/maintainers/npm-publishing.md`
- `docs/maintainers/documentation-deployment.md`

**Exclude**

- new product behavior or API redesign
- implementation fixes performed inside the seal
- tracked release-policy or version changes without explicit human direction
- publication, deployment, promotion, or Fastly activation
