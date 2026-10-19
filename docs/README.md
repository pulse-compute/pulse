# Pulse documentation

Pulse documentation is organized in layers so you can stop when you have enough detail. The `1.0.0-beta.9` candidate uses async-shaped managed handlers, trusted Pulse effects, a conventional `.pulse/config.ts` workspace, and the `pulse` CLI. The synchronized release catalog remains the authority for npm availability and support tiers.

## 1. Start and ship a first project

1. [Getting started](./getting-started.md) — install and create a first project.
2. [Project lifecycle](./guides/project-lifecycle.md) — the normal `init → doctor → test → dev → build` journey and the advanced `inspect`/`compile` branches.
3. [Beta scope](./preview-scope.md) — what the release guarantees and deliberately excludes.
4. [Canonical examples](./examples.md) — source-bound projects,
   including focused Entities, events, and MCP proxy shapes.

## 2. Follow a task-oriented guide

- [Static Router authoring](./guides/routing.md)
- [Explicit JSON schemas](./guides/json-schemas.md)
- [Fetching and composing data](./guides/fetching-and-composition.md)
- [Project lifecycle](./guides/project-lifecycle.md)
- [Static events and outbound emission](./guides/events.md)
- [Migrate an Express service](./guides/migrating-from-express.md)
- [Node build and execution](./guides/deploying-node.md)
- [Fastly deployment candidates](./guides/deploying-fastly.md) — including links to bindings and GRIP/Fanout.
- [Troubleshooting](./guides/troubleshooting.md)

Older package fixtures can use the retained [compatibility import notes](./guides/compatibility-imports.md).
They are separate from current Express onboarding.

## 3. Understand the model

1. [Architecture overview](./architecture/overview.md) — the application model and two execution paths.
2. [Targets and host work](./concepts/targets-and-hosts.md) — choose a target and distinguish current support from future hosts.
3. [Contracts and providers](./concepts/contracts-and-providers.md) — bindings, eligibility and host realization.
4. [Effects and continuations](./concepts/effects-and-continuations.md) — execution ownership, concurrency and failure.
5. [Structured and opaque bodies](./concepts/bodies.md) — data ownership and bounded reads.
6. [Compilation and lowering](./concepts/compilation-and-lowering.md) — how eligible Native source becomes Wasm.
7. [Entity engine, adapters, and facades](./concepts/entities-and-adapters.md) — protocol boundaries around governed operations.
8. [Package-owned lowering](./concepts/package-owned-lowering.md) — advanced extension and trust details.

For deeper implementation invariants, see the linked
[Architecture contracts](./architecture/current-contracts.md). [Architecture vision](./architecture/vision.md) describes
direction rather than release support.

## 4. Use a package directly

- [`@pulse-compute/pulse`](./packages/pulse.md)
- [`@pulse-compute/runtime`](./packages/runtime.md)
- [`@pulse-compute/cli`](./packages/cli.md)
- [`@pulse-compute/provider-fastly`](./packages/provider-fastly.md)
- [`@pulse-compute/grip`](./packages/grip.md)
- [`@pulse-compute/assets`](./packages/assets.md)
- [`@pulse-compute/crypto`](./packages/crypto.md)
- [`@pulse-compute/jwt`](./packages/jwt.md)
- [`@pulse-compute/entities`](./packages/entities.md)
- [All package support tiers](./packages/README.md)
- [Implementation packages](./packages/implementation-packages.md)

## 5. Look up exact behavior

- [Reference overview](./reference/README.md)
- [Canonical API](../API.md)
- [Provider and target compatibility](./reference/compatibility-matrix.md)
- [Managed handler TypeScript and JavaScript](./reference/handler-authoring.md)
- [CLI](./reference/cli.md)
- [Project configuration](./reference/project-config.md)
- [Diagnostics and remediation](./reference/diagnostics.md)
- [Environment variables](./reference/environment.md)
- [Shell completion](./reference/shell-completion.md)
- [CLI machine specification](./reference/cli-spec.json)
- [Project configuration JSON Schema bundle](./reference/project-config.schema.json)

## 6. Authors and contributors

- [Pulse-aware package authoring](./contributing/pulse-aware-packages.md)
- [Contributor guide index](./contributing/README.md)
- [Package-owned lowerer contract](./contributing/package-lowerer-contract.md)
- [Add a first-party package-owned lowerer](./contributing/adding-first-party-lowerer.md)
- [Entities lowering maintainer reference](./contributing/entities-lowering.md)
- [Add a core provider](./contributing/adding-core-provider.md)
- [Changelog](../CHANGELOG.md)
- [Package support and extension boundaries](./packages/README.md)

## Entry points for tools and agents

For an application task, start with this index, the installed package guides and
[project lifecycle](./guides/project-lifecycle.md). Pin the selected package
version, project root and profile before interpreting commands. The CLI ships
this documentation under its package's `docs/` directory, plus `API.md` and
`cli-spec.json`; use `pulse --help` for the supported command list.

For a change to Pulse itself, first read the repository's root and nearest
`AGENTS.md`, then choose one named Entry Point and its canonical owners. Installed
application documentation is not a substitute for repository maintenance policy.
See the [contributor workflow](./contributing/README.md#contributor-workflow).

[Diagnosing command results](./guides/troubleshooting.md#reading-command-results)
explains JSON streams, evidence limits and recovery. A release number alone does
not identify uncommitted source or prove that a local artifact matches it.
