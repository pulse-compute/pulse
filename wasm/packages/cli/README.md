# @pulse-compute/cli

<!-- pulse-package-status:start -->
> **Support tier:** Canonical application surface<br>
> **Audience:** Pulse application authors, CI workflows, and tooling integrations.<br>
> **Install directly:** Yes. Install the package globally or as a project development dependency.<br>
> **Supported entry points:** `pulse binary`, `@pulse-compute/cli`, `@pulse-compute/cli/workflow`, `@pulse-compute/cli/project-config`, `@pulse-compute/cli/project-execution`, `@pulse-compute/cli/project-config-schema`, `@pulse-compute/cli/diagnostics`, `@pulse-compute/cli/project-config.schema.json`, `@pulse-compute/cli/cli-spec.json`, `@pulse-compute/cli/release-manifest.json`, `@pulse-compute/cli/documentation-versions.json`, `@pulse-compute/cli/documentation-site.json`<br>
> **Stability:** Supported Beta workflow and project-configuration contract.<br>
> **npm:** [`@pulse-compute/cli`](https://www.npmjs.com/package/@pulse-compute/cli)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/cli/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

The public CLI and conventional `@pulse-compute/pulse` application root are
both part of the synchronized `1.0.0-beta.5` release set. Validate the generated
workflow from the repository or the exact packed acceptance set:

```bash
pnpm pulse -- init ./my-app
cd ./my-app
npm install
pulse doctor
pulse test
pulse inspect
pulse dev
pulse build
```

`pulse init` writes exact catalog package versions and does not invoke a package manager. Project commands discover one authoritative `.pulse/config.ts` workspace, select a flat profile, compile the same canonical handler contract, and realize Node, Fastly, or compile-only `none`.

## Supported programmatic entries

- package root for `defineConfig`, public types, diagnostics, and workflow integration;
- `workflow` for command parsing/execution;
- `project-config` for discovery and normalization;
- `project-execution` for canonical command orchestration;
- `diagnostics` for stable public descriptors and mappings.

Repository fixture/profile/task flags are not part of installed help or the public contract.

## JavaScript support and eligibility

Profiles may select `target: 'javascript'` with either the Node or Fastly
provider. Both targets execute the live Router/context and package
implementations, and both satisfy their declared full-target-support gates.

`pulse inspect` and `pulse doctor` expose general target availability separately
from deterministic project eligibility and loader observations. `pulse test`
and `pulse dev` execute only when the reachable application, capabilities,
provider requirements, and packages are eligible. Fastly identifies this local
mode as provider emulation; it is not Node-provider fallback.

`pulse compile` remains provider-neutral while recording the configured
JavaScript target and static eligibility evidence in `pulse-compile.json`.
`pulse build` emits a deterministic Node or Fastly source package. Fastly output
also carries exact downstream compiler pins and deployment-candidate metadata;
the release gate compiles that closure to a runtime Wasm without deploying or
publishing it. Pending or blocked projects never switch to Native execution:
`automaticFallback` is always false.

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
