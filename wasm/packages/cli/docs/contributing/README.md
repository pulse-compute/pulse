<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Contributing documentation

These pages describe changes to the synchronized Pulse repository. They are not application-author extension APIs.

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
