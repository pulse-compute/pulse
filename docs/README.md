# Pulse documentation

Pulse documentation is organized in layers so you can stop when you have enough detail. The `1.0.0-beta.1` candidate uses async-shaped managed handlers, trusted Pulse effects, a conventional `.pulse/config.ts` workspace, and the `pulse` CLI. The synchronized 18-package release catalog remains the authority for npm availability and support tiers.

## 1. Start and ship a first project

1. [Getting started](./getting-started.md) — install and create a first project.
2. [Project lifecycle](./guides/project-lifecycle.md) — the normal `init → doctor → test → dev → build` journey and the advanced `inspect`/`compile` branches.
3. [Beta scope](./preview-scope.md) — what the release guarantees and deliberately excludes.
4. [Canonical examples](./examples.md) — nine source-bound projects,
   including focused Entities, events, and MCP proxy shapes.

## 2. Follow a task-oriented guide

- [Migrate an Express service](./guides/migrating-from-express.md)
- [Fetching and composing data](./guides/fetching-and-composition.md)
- [Explicit JSON schemas](./guides/json-schemas.md)
- [Static events and outbound emission](./guides/events.md)
- [Fastly config, secrets, and KV](./guides/fastly-capabilities.md)
- [GRIP and Fanout](./guides/grip.md)
- [Compatibility imports and migration](./guides/compatibility-imports.md)
- [Static Router authoring](./guides/routing.md)
- [Node build and execution](./guides/deploying-node.md)
- [Fastly deployment candidates](./guides/deploying-fastly.md)
- [Troubleshooting](./guides/troubleshooting.md)

## 3. Understand the model

- [Compilation and lowering](./concepts/compilation-and-lowering.md)
- [Effects and continuations](./concepts/effects-and-continuations.md)
- [Structured and opaque bodies](./concepts/bodies.md)
- [Contracts and providers](./concepts/contracts-and-providers.md)
- [Targets and host work](./concepts/targets-and-hosts.md)
- [Package-owned lowering](./concepts/package-owned-lowering.md)
- [Entity engine, adapters, and facades](./concepts/entities-and-adapters.md)
- [Architecture overview](./architecture/overview.md)
- [Current architecture contracts](./architecture/current-contracts.md)
- [Architecture vision](./architecture/vision.md)

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
