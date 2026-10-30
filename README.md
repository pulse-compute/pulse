# Pulse

Pulse is a compiler-driven TypeScript application layer for small, portable edge and WebAssembly services.

Write an application with `Pulse` or the low-level `Router`, configure it in
`.pulse/config.ts`, and use one CLI to test, run, and build it. Each profile
explicitly selects a provider and a Native or JavaScript target.

## Start here

Use Node.js 22.14 or newer on the 22.x line, or Node.js 24.x, with npm.

Create a project with the published Beta CLI:

```bash
npm exec --package=@pulse-compute/cli@1.0.0-beta.10 -- pulse init ./my-app
cd ./my-app
npm install
npm run doctor
npm test
```

`pulse init` writes exact package versions but does not install them.
`npm install` installs the dependencies, including the project's local CLI;
no global install is needed.

For agent-assisted work, use the compact
[cold-start checklist](./docs/guides/project-lifecycle.md#cold-start-checklist)
to pin the goal, target, version and verification boundary.

Start the local server:

```bash
npm run dev
```

Open <http://127.0.0.1:8787/> to see `Pulse is running`, or
<http://127.0.0.1:8787/health> for `{"ok":true}`.
Stop the foreground server with Ctrl+C, then build:

```bash
npm run build
```

From a repository checkout with lockfile-pinned dependencies restored, use
`pnpm pulse -- init ./my-app` for the first command instead.

Use `npm run inspect` when you need the compiler/provider plan.
`npm run compile` is the advanced provider-neutral Wasm workflow and requires
Native-compatible source. Neither command is required before `npm run build`.
See the
[project lifecycle guide](./docs/guides/project-lifecycle.md).

## Example

This complete handler comes from
[`examples/01-hello-json/src/index.ts`](./examples/01-hello-json/src/index.ts):

<!-- pulse-doc-source: examples/01-hello-json/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.json({ ok: true }))
app.get('/hello', async (ctx) => ctx.json({ message: 'hello from Pulse' }))
app.get('/*', async (ctx) => ctx.text('not found', { status: 404 }))

export default app
```
<!-- /pulse-doc-source -->

The matching configuration explicitly selects Node Native:

<!-- pulse-doc-source: examples/01-hello-json/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
  },
}))
```
<!-- /pulse-doc-source -->

Native lowering erases the async wrapper and lowers only trusted Pulse effects;
it does not add a Promise runtime or Asyncify. JavaScript executes the reachable
source graph and live packages. See [compilation and lowering](./docs/concepts/compilation-and-lowering.md).

```text
canonical TypeScript
→ pulse CLI
├→ Native: whole-project lowering → effects/continuations → Node or Fastly Wasm
└→ JavaScript: reachable source graph → live packages → Node or Fastly lifecycle
```

## Implemented Beta surface

Pulse currently supports:

- request method, URL, path, headers, text, and JSON;
- explicit TypeScript JSON schemas compiled with the project;
- branching and structured value manipulation;
- schema-bound `ctx.call` computations, embedded binary resources and numeric workspaces on their [documented targets](docs/reference/compatibility-matrix.md);
- static `Router` authoring with mounted exact, parameter, wildcard, GET, HEAD, POST, PUT, PATCH, and DELETE routes;
- single, grouped, and dependent outbound fetches;
- JSON, text, custom, and direct pass-through responses;
- provider-neutral config, secret, and KV capabilities;
- synchronous thresholded `ctx.log.error|warn|info|debug` with redaction;
- opaque binary/stream pass-through without userland inspection;
- package-root GRIP framing/broadcast and Assets realization;
- explicit Node Native, Node JavaScript, Fastly Native, and Fastly JavaScript modes;
- deterministic JavaScript source packages and offline Fastly deployment candidates;
- `init`, `doctor`, `inspect`, `test`, `dev`, `compile`, and `build` through one CLI.

All four modes share one conformance corpus and never substitute targets
automatically. Candidate validation is offline: it does not deploy, activate, or
publish a Fastly service.

The Beta deliberately does **not** expose general Promise-based Native
semantics, provider SDKs, ambient environment authority, arbitrary binary
inspection, general userland stream transforms, background tasks, or raw sockets.
The separate experimental Node finite-output and UTF-8 transform opt-ins retain
their documented limits and qualification status; see [body handling](docs/concepts/bodies.md).

## Public packages

The public `1.0.0-beta.10` catalog is defined by the release manifest.


| Package | Role |
|---|---|
| [`@pulse-compute/pulse`](https://www.npmjs.com/package/@pulse-compute/pulse) | Conventional application root, deferred project configuration, schema declarations, and runtime type re-exports. |
| [`@pulse-compute/runtime`](https://www.npmjs.com/package/@pulse-compute/runtime) | Canonical provider-neutral application types, plain handlers, and the static `Router` authoring surface. |
| [`@pulse-compute/cli`](https://www.npmjs.com/package/@pulse-compute/cli) | Project configuration and the supported `pulse` workflow. |
| [`@pulse-compute/provider-fastly`](https://www.npmjs.com/package/@pulse-compute/provider-fastly) | Typed Fastly configuration, Native lowering, JavaScript execution, local conformance, and Compute target generation. |
| [`@pulse-compute/grip`](https://www.npmjs.com/package/@pulse-compute/grip) | Stateless GRIP framing and request-bound broadcast across supported targets. |
| [`@pulse-compute/assets`](https://www.npmjs.com/package/@pulse-compute/assets) | JavaScript asset runtime and package-owned Native lookup lowering. |
| [`@pulse-compute/crypto`](https://www.npmjs.com/package/@pulse-compute/crypto) | Bounded HS256, ES256 and RS256 verification, plus exact-text SHA-256. |
| [`@pulse-compute/jwt`](https://www.npmjs.com/package/@pulse-compute/jwt) | Bounded provider-neutral JWT verification, issuance and claims validation. |
| [`@pulse-compute/entities`](https://www.npmjs.com/package/@pulse-compute/entities) | Statically declared schema-backed operations with the first-party JSON-RPC adapter. |
| [`@pulse-compute/mcp`](https://www.npmjs.com/package/@pulse-compute/mcp) | Static `/pulse` MCP binding with local Entities dispatch, plus separate root Fetch and `/node` host adapters. |
| [`@pulse-compute/s3`](https://www.npmjs.com/package/@pulse-compute/s3) | Bounded exact-key object reads and writes on supported Node and Fastly Native targets. |

`@pulse-compute/pulse` and `@pulse-compute/runtime` are layered public
application contracts: the former owns conventional project ergonomics and the
latter owns the low-level portable runtime surface. Native and JavaScript
execution are explicitly selected targets over the same canonical model; Pulse
never changes targets automatically.

## Documentation

The [public Pulse site](https://pulsecompute.io/) introduces the compiler and links into the layered documentation. [Exact hosted documentation](https://pulsecompute.io/v1.0.0-beta.10/) is release-pinned; repository Markdown remains the reviewable source.

- [Documentation index](./docs/README.md)
- [Changelog](./CHANGELOG.md)
- [Public-site and documentation presentation system](./docs/maintainers/public-site.md)
- [Getting started](./docs/getting-started.md)
- [Project lifecycle](./docs/guides/project-lifecycle.md)
- [Handler authoring and target compatibility](./docs/reference/handler-authoring.md)
- [Node build and execution](./docs/guides/deploying-node.md)
- [Fastly deployment candidates](./docs/guides/deploying-fastly.md)
- [Beta scope](./docs/preview-scope.md)
- [Task-oriented guides](./docs/README.md#2-follow-a-task-oriented-guide)
- [Concepts: lowering, effects, bodies, and providers](./docs/README.md#3-understand-the-model)
- [Package guides and support policy](./docs/README.md#4-use-a-package-directly)
- [API, CLI, config, diagnostics, and environment reference](./docs/README.md#5-look-up-exact-behavior)
- [Contributor tutorials](./docs/README.md#6-authors-and-contributors)
- [Maintainer governance and support](./docs/maintainers/README.md)
- [Release acceptance](./docs/maintainers/release-acceptance.md)


## Maintenance and support

Pulse uses a repository-encoded resident-maintainer control plane. Codex can classify, review, reproduce, document, and prepare bounded patches; human maintainers retain architecture, merge, repository-setting, and release authority.

- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)
- [Security policy](./SECURITY.md)
- [Maintainer charter](./docs/maintainers/maintainer-charter.md)
- [Scope policy](./docs/maintainers/scope-policy.md)
- [Generated maintenance policy](./docs/maintainers/maintenance-policy.md)

Run `npm run maintainer:check` before opening a pull request.

Portable dependency bundle and restore tooling is distributed separately from the source snapshot. A handoff should pair this repository with a target-specific dependency archive and its matching verified restore script; the source workspace does not expose stale versioned wrapper commands.

## Examples

The top-level [`examples/`](./examples/) directory contains complete canonical projects for JSON responses, schemas, fetch workflows, Fastly capabilities, opaque proxying, GRIP, and static Router lowering. Each example can be driven with the same CLI commands used by a normal project.

## License

Pulse is licensed under the [Apache License 2.0](./LICENSE).
