<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-10-09
review-by: 2027-04-09
pulse-doc-meta:end -->

# Contributing to Pulse

These pages describe changes to the synchronized Pulse repository. They are not application-author extension APIs.

## Contributor workflow

1. Choose the owning contract and read the root and nearest `AGENTS.md`.
   Use the [architecture overview](../architecture/overview.md) when ownership is unclear.
2. Classify the change with the [scope policy](../maintainers/scope-policy.md).
   That page owns the PR declaration and protected-boundary rules. Obtain human
   direction before widening a contract; record existing direction in the PR.
3. Make the smallest coherent change in canonical sources. For documentation,
   use the [documentation update loop](../maintainers/documentation-system.md#update-loop)
   to regenerate installed copies and references.
4. Run `npm run maintainer:check` and the focused checks selected for the diff.
   [Testing Pulse](../maintainers/testing.md) owns task selection, dependency
   requirements and evidence rules. Ordinary changes do not require a local
   aggregate release seal.
5. Open a PR with the scope declaration, what changed, checks completed, and
   any dependency-bound checks still outstanding. Include the tested revision
   and working-tree state; an interrupted check is incomplete evidence.

Use the repository-pinned Node and pnpm versions and restore the frozen lockfile
with lifecycle scripts disabled before dependency-bound checks. The
[release manifest](../maintainers/release-manifest.md) owns the supported package
and target set. Human maintainers retain merge, settings and release authority.

## Choose the extension boundary

- [Pulse-aware package authoring](./pulse-aware-packages.md) — ordinary JavaScript packages, bounded package-root Native lowering, trusted builders, and the separate scoped-provider boundary.

## Package-owned lowering

- [Package lowerer contract reference](./package-lowerer-contract.md) — manifest fields, builder protocol, effect shape, trust rules, and release invariants.
- [Add a first-party package-owned lowerer](./adding-first-party-lowerer.md) — end-to-end implementation tutorial using the GRIP/assets pattern.
- [Entities lowering maintainer reference](./entities-lowering.md) — static extraction, schema authority, Native realization, catalog, and seal invariants for the Entities package.

## Providers

- [Add a provider toolchain](./adding-core-provider.md) — descriptor, bindings, runtime, target, namespace bootstrap, diagnostics, docs, and tests.

## Repository context

- [Package support policy](../packages/README.md)
- [Architecture overview](../architecture/overview.md)
- [Current architecture contracts](../architecture/current-contracts.md)
- [Reference overview](../reference/README.md)

The current release executes only trusted first-party lowerer builders. Built-in
provider shorthand is release-owned, while an exact scoped project provider may
export the versioned `./toolchain` contract without self-registration or
dependency scanning. Changes that widen either executable trust boundary
require an explicit security and compatibility design, not only another
manifest or package export.
