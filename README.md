# Pulse

Pulse is a compiler-driven TypeScript application layer for small, portable edge and WebAssembly services.

A conventional Pulse project is an async-shaped `Pulse` or low-level `Router`
application plus a `.pulse/config.ts` workspace and dedicated test harness. The
`pulse` CLI resolves the complete project, including explicit JSON schemas and
package-owned capabilities, then realizes the exact provider and target selected
by the active profile.

```text
canonical TypeScript
→ pulse CLI
├→ Native: whole-project lowering → effects/continuations → Node or Fastly Wasm
└→ JavaScript: reachable source graph → live packages → Node or Fastly lifecycle
```

## Start here

```bash
# From the repository checkout after restoring lockfile-pinned dependencies
pnpm pulse -- init ./my-app
cd ./my-app
npm install
npm run doctor
npm test
npm run dev
npm run build
```

`pulse init` writes exact package versions but does not perform network
installation. Packed-package acceptance installs the synchronized release set
and verifies this path without workspace links. Published package availability
remains defined by the 19-package release manifest.

This is the normal application lifecycle. Use `pulse inspect` when you need to
examine the compiler/provider plan, and use the advanced provider-neutral
`pulse compile` command when you specifically need the portable `pulse_host`
Wasm boundary. Neither command is a prerequisite for `pulse build`. See the
[project lifecycle guide](./docs/guides/project-lifecycle.md).

A minimal managed handler is async-shaped and provider-neutral. Native lowering erases the wrapper and lowers only trusted Pulse effects; it does not add a Promise runtime or Asyncify. The source shown here is copied exactly from [`examples/01-hello-json/src/index.ts`](./examples/01-hello-json/src/index.ts):

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

The matching project configuration is source-bound as well:

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

## Implemented Beta surface

Pulse currently supports:

- request method, URL, path, headers, text, and JSON;
- explicit TypeScript JSON schemas compiled with the project;
- branching and structured value manipulation;
- static `Router` authoring with mounted exact, parameter, wildcard, GET, HEAD, and POST routes;
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
inspection, userland stream transforms, background tasks, or raw sockets.

## Public packages

The public `1.0.0-beta.5` catalog is defined by the release manifest.


| Package | Role |
|---|---|
| [`@pulse-compute/pulse`](https://www.npmjs.com/package/@pulse-compute/pulse) | Conventional application root, deferred project configuration, schema declarations, and runtime type re-exports. |
| [`@pulse-compute/runtime`](https://www.npmjs.com/package/@pulse-compute/runtime) | Canonical provider-neutral application types, plain handlers, and the static `Router` authoring surface. |
| [`@pulse-compute/cli`](https://www.npmjs.com/package/@pulse-compute/cli) | Project configuration and the supported `pulse` workflow. |
| [`@pulse-compute/provider-fastly`](https://www.npmjs.com/package/@pulse-compute/provider-fastly) | Typed Fastly configuration, Native lowering, JavaScript execution, local conformance, and Compute target generation. |
| [`@pulse-compute/grip`](https://www.npmjs.com/package/@pulse-compute/grip) | Stateless GRIP framing and request-bound broadcast across supported targets. |
| [`@pulse-compute/assets`](https://www.npmjs.com/package/@pulse-compute/assets) | JavaScript asset runtime and package-owned Native lookup lowering. |
| [`@pulse-compute/crypto`](https://www.npmjs.com/package/@pulse-compute/crypto) | Bounded provider-neutral HS256 and ES256 verification. |
| [`@pulse-compute/jwt`](https://www.npmjs.com/package/@pulse-compute/jwt) | Bounded provider-neutral JWT verification and claims validation. |
| [`@pulse-compute/entities`](https://www.npmjs.com/package/@pulse-compute/entities) | Statically declared schema-backed operations with the first-party JSON-RPC adapter. |
| [`@pulse-compute/s3`](https://www.npmjs.com/package/@pulse-compute/s3) | Bounded exact-key object reads and writes on supported Node and Fastly Native targets. |

`@pulse-compute/pulse` and `@pulse-compute/runtime` are layered public
application contracts: the former owns conventional project ergonomics and the
latter owns the low-level portable runtime surface. Native and JavaScript
execution are explicitly selected targets over the same canonical model; Pulse
never changes targets automatically.

## Documentation

The [public Pulse site](https://pulsecompute.io/) introduces the compiler and links into the layered documentation. [Exact hosted documentation](https://pulsecompute.io/v1.0.0-beta.5/) is release-pinned; repository Markdown remains the reviewable source.

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
