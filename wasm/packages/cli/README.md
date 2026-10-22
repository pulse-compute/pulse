# @pulse-compute/cli

Create, check, test, run, and build Pulse applications with the `pulse` command.
Project configuration lives in `.pulse/config.ts`.

<!-- pulse-package-status:start -->
> **Support tier:** Canonical application surface<br>
> **Audience:** Pulse application authors, CI workflows, and tooling integrations.<br>
> **Install directly:** Yes. Install the package globally or as a project development dependency.<br>
> **Supported entry points:** `pulse binary`, `@pulse-compute/cli`, `@pulse-compute/cli/workflow`, `@pulse-compute/cli/project-config`, `@pulse-compute/cli/project-execution`, `@pulse-compute/cli/project-config-schema`, `@pulse-compute/cli/diagnostics`, `@pulse-compute/cli/project-config.schema.json`, `@pulse-compute/cli/cli-spec.json`, `@pulse-compute/cli/release-manifest.json`, `@pulse-compute/cli/documentation-versions.json`, `@pulse-compute/cli/documentation-site.json`<br>
> **Stability:** Supported Beta workflow and project-configuration contract.<br>
> **npm:** [`@pulse-compute/cli`](https://www.npmjs.com/package/@pulse-compute/cli)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.10/packages/cli/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.10` package policy.
<!-- pulse-package-status:end -->

## Install and create a project

Use Node.js 22.14 or newer on the 22.x line, or Node.js 24.x, with npm.

```bash
npm exec --package=@pulse-compute/cli@1.0.0-beta.10 -- pulse init ./my-app
cd ./my-app
npm install
npm run doctor
npm test
```

`pulse init` writes exact package versions and does not run a package manager.
The generated project includes a local CLI and scripts for the normal workflow;
no global install is needed.

## Run and build

```bash
npm run dev
```

Open <http://127.0.0.1:8787/> to see `Pulse is running`, or
<http://127.0.0.1:8787/health> for `{"ok":true}`.
Stop the foreground server with Ctrl+C, then build:

```bash
npm run build
```

Use `npm run inspect` when you need the compiler/provider plan.
`npm run compile` is the advanced provider-neutral Wasm workflow and requires
Native-compatible source. Neither command is required before `npm run build`.
See the [project lifecycle guide](./docs/guides/project-lifecycle.md) and
[Native build optimization](./docs/reference/native-build-optimization.md).

## Workflow boundaries

Project commands discover one authoritative `.pulse/config.ts` workspace and
select a flat profile. The profile chooses Node, Fastly, or compile-only `none`.
Provider and target selection remain explicit.

Repository fixture/profile/task flags are not part of installed help or the
public contract. For checkout development with lockfile-pinned dependencies
restored, replace the initial command with `pnpm pulse -- init ./my-app`.

## JavaScript support and eligibility

Profiles may select `target: 'javascript'` with either the Node or Fastly
provider. Both targets execute the live Router/context and package
implementations, and both satisfy their declared full-target-support gates.

`pulse inspect` and `pulse doctor` expose general target availability separately
from deterministic project eligibility and loader observations. `pulse test`
and `pulse dev` execute only when the reachable application, capabilities,
provider requirements, and packages are eligible. Fastly identifies this local
mode as provider emulation; it is not Node-provider fallback.

Use `pulse inspect` for detailed plan and eligibility evidence when needed.
`pulse compile` requires Native-compatible source even for a JavaScript profile;
it emits provider-neutral Wasm and records the configured target separately in
`pulse-compile.json`.
`pulse build` emits a deterministic Node or Fastly source package. Fastly output
also carries exact downstream compiler pins and deployment-candidate metadata;
the release gate compiles that closure to a runtime Wasm without deploying or
publishing it. Pending or blocked projects never switch to Native execution:
`automaticFallback` is always false.

## Supported programmatic entries

- package root for `defineConfig`, public types, diagnostics, and workflow integration;
- `workflow` for command parsing/execution;
- `project-config` for discovery and normalization;
- `project-execution` for canonical command orchestration;
- `diagnostics` for stable public descriptors and mappings.

## Included documentation

- [Documentation index](./docs/README.md)
- [Package guide](./docs/packages/cli.md)
- [CLI reference](./docs/reference/cli.md)
- [Project configuration](./docs/reference/project-config.md)
- [Diagnostics](./docs/reference/diagnostics.md)
- [Environment variables](./docs/reference/environment.md)
- [Canonical API](./API.md)
- [Runnable examples](./examples/README.md)

These references and examples ship in the npm tarball and are checked after packing.
