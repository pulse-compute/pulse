# `@pulse-compute/cli`

`@pulse-compute/cli` owns the supported `pulse` command, project configuration types, project discovery, compilation workflow, local execution, and target builds.

## Install and initialize

The current repository CLI is a source candidate. Its conventional initializer
depends on the public `@pulse-compute/pulse` package and is validated from both
the checkout and the exact packed acceptance set:

```bash
pnpm pulse -- init ./my-app
cd ./my-app
npm install
pulse doctor
```

`pulse init` writes a conventional `.pulse/config.ts` workspace, an async
`Pulse` application root, a dedicated `tests/pulse.harness.ts`, strict
TypeScript configuration, and exact source-candidate package versions. It does
not run a package manager or perform hidden network work. Public npm
availability is defined by the synchronized 18-package release manifest.

## Daily workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse compile
pulse build
```

- `doctor` validates project, provider, dependencies, and external toolchain readiness.
- `inspect` compiles and reports effects, continuations, schemas, event registrations/callsites, capabilities, target eligibility, and provider lowering without executing cases.
- `test` executes configured request and explicit `kind: 'event'` cases through the provider-owned local conformance runtime.
- `dev` runs a foreground local server and watches the project by default.
- `compile` writes deterministic provider-neutral Pulse Wasm plus its native plan, generated AssemblyScript, WAT, and manifests.
- `build` writes the configured target realization: Native profiles emit provider Wasm, while JavaScript profiles emit deterministic source packages. Eligible event projects also emit `event-catalog.json` and `event-inspection.json` beside the target output. Fastly JavaScript packages carry exact downstream compiler pins and deployment-candidate metadata.

See the generated [CLI reference](../reference/cli.md) for every option, positional form, output, side effect, and exit behavior.

## Project configuration

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

The generated application imports `Pulse` from `@pulse-compute/pulse`, declares
managed handlers `async`, and keeps deterministic request cases in the separate
harness module. Workspace discovery starts from `.pulse/config.ts`.

Harness event cases require the explicit `kind: 'event'` discriminant, one
canonical input frame, and an ordered exact `expect.emitted` array. HTTP cases
retain their existing shape and default behavior. There is no public `pulse
event` command and `pulse dev` remains HTTP-only.

The complete event workflow, queue, artifact, target, and diagnostic boundary
is in [Static events and outbound emission](../guides/events.md).

## Machine-readable contracts and shell completion

The installed package exposes release-owned machine interfaces for editors, automation, validation, and documentation tooling:

| Export or command | Contract |
|---|---|
| `pulse completion bash` | Bash completion generated from the public command specification. |
| `pulse completion zsh` | Zsh completion generated from the same specification. |
| `pulse completion fish` | Fish completion generated from the same specification. |
| `@pulse-compute/cli/cli-spec.json` | Seven commands, public options, aliases, positional forms, provider restrictions, output modes, and completion metadata. |
| `@pulse-compute/cli/project-config.schema.json` | JSON Schema bundle plus discovery, precedence, defaults, runtime rules, and provider configuration schemas. |
| `@pulse-compute/cli/release-manifest.json` | Exact release, hosted-documentation routes, package tiers, supported entry points, and publication policy. |
| `@pulse-compute/cli/documentation-versions.json` | Available documentation versions and the current `latest` target. |
| `@pulse-compute/cli/project-config-schema` | Programmatic schema, defaults, structural validation, and reference metadata. |

These files are generated from the same modules used by the parser, runtime configuration loader, package packer, and documentation release gate. See [Shell completion](../reference/shell-completion.md), the [CLI specification](../reference/cli-spec.json), the [project configuration schema](../reference/project-config.schema.json), and the [release manifest reference](../maintainers/release-manifest.md).

## Public entry points

The supported package surface is:

| Entry point | Intended use |
|---|---|
| `pulse` binary | Application and CI workflow. |
| `@pulse-compute/cli` | `defineConfig`, project-config types, diagnostics helper, and programmatic workflow entry. |
| `@pulse-compute/cli/workflow` | CLI parsing and execution integration. |
| `@pulse-compute/cli/project-config` | Project discovery and normalization integration. |
| `@pulse-compute/cli/project-execution` | Canonical doctor/inspect/test/dev/compile/build orchestration. |
| `@pulse-compute/cli/diagnostics` | Stable public diagnostic descriptors and mappings. |

Other files present in the tarball are not automatically public APIs.

## JSON output

Completed commands emit one JSON object with a trailing newline when `--json` is used. `pulse dev --json` emits newline-delimited event objects instead of one enclosing document. Supported events include `compiled`, `ready`, `reloaded`, `request`, `compile-error`, and `request-error`.

Stable failures include a public diagnostic code, remediation, exit class, and exact-version documentation URL. See [Diagnostics and remediation](../reference/diagnostics.md).

## Provider behavior

The CLI supports `node`, `fastly`, and compile-only `none`. Node and Fastly each
accept an explicit `native` or `javascript` execution target:

- Node Native lowers to Pulse-owned Wasm and executes through the Node host.
- Node JavaScript loads the reachable application graph and runs the live runtime and package implementations.
- Fastly Native emits compact direct-host-ABI `bin/main.wasm`.
- Fastly JavaScript emits a deterministic source/deployment package and a structurally deployable downstream runtime candidate.
- `none` can inspect or compile canonical output but cannot serve or run tests.

For projects with reachable event registrations or `ctx.emit` callsites, Node
Native and Node JavaScript are eligible for the bounded reference workflow.
`inspect`, `doctor`, compile/build manifests, and event inspection artifacts
report the catalog, schema IDs, callsites, host requirements, and per-command
target support. `none` remains useful for compile-only catalog inspection.
Fastly Native and JavaScript fail closed with exact event-ingress or event-emit
diagnostics; Pulse does not translate that plane through HTTP or GRIP and never
changes targets automatically.

`pulse compile` is provider-neutral regardless of the configured provider. It produces the portable Pulse-owned Wasm boundary directly; `pulse build` continues to own provider realization.

Those provider IDs are configuration data, not command-layer implementation
branches. The CLI consumes a neutral facade over the compiler-owned fixed
registry; concrete provider imports, configuration policy, and target adapters
remain outside the CLI package. Node retains a deliberate reference/smoke role
for canonical Native behavior.

Both JavaScript declarations satisfy full-target-support and report general
availability. Project eligibility remains separate, and target selection never
falls back automatically. Fastly JavaScript `test` and `dev` identify their
execution mode as provider emulation; the offline candidate gate compiles a real
Fastly JavaScript runtime artifact but performs no deployment or publication.

Provider and target selection change realization, not handler APIs. See
[Contracts and providers](../concepts/contracts-and-providers.md).

## Installed documentation payload

The CLI npm package ships:

- this public documentation hierarchy;
- the canonical API reference;
- CLI, configuration, diagnostics, environment, release, and version references;
- generated command/config/release machine interfaces and shell completions;
- package and contributor guides;
- ten complete lifecycle example projects plus the focused Entities candidate,
  including static Router lowering and mixed HTTP/event authoring.

This makes diagnostic links and package README links usable from an installed exact-version release rather than depending on monorepo paths.

## Safety boundaries

- Build output must remain a real descendant of the project root.
- `--no-clean` does not disable traversal or symbolic-link safety checks.
- Raw configured secrets are redacted from public JSON and diagnostics.
- `dev` is a foreground process, not a hidden daemon.
- Repository-only fixture/profile/task flags are excluded from installed help and the public reference.
- Fastly external execution is delegated to the Fastly CLI; the reality gate may pass an inspected Viceroy path, but Pulse does not launch Viceroy directly.

## Related documentation

- [Getting started](../getting-started.md)
- [Project lifecycle](../guides/project-lifecycle.md)
- [Static events and outbound emission](../guides/events.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Node build and execution](../guides/deploying-node.md)
- [Fastly deployment candidates](../guides/deploying-fastly.md)
- [CLI reference](../reference/cli.md)
- [Shell completion](../reference/shell-completion.md)
- [Project configuration](../reference/project-config.md)
- [Release manifest and package policy](../maintainers/release-manifest.md)
- [Documentation versioning](../maintainers/documentation-versioning.md)
- [Environment-variable reference](../reference/environment.md)
- [Release acceptance](../maintainers/release-acceptance.md)
