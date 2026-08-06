# Getting started

This page creates and verifies a first project. The normal application journey
continues through `init → doctor → test → dev → build`; see [Project
lifecycle](./guides/project-lifecycle.md) for the canonical sequence and the
optional `inspect` and advanced `compile` branches.

## Requirements

- Node.js `22.14.0` or newer on the 22.x line, or Node.js 24.x (`^22.14.0 || ^24.0.0`).
- npm 10 or another npm-compatible package manager.
- A repository checkout with its lockfile-pinned dependencies restored, using `pnpm pulse -- <command>`, or the synchronized public package set produced by release acceptance.
- A Fastly local execution engine only when running the external Fastly Compute reality workflow. Native compilation and configured-provider builds do not require one. The gate accepts the Fastly CLI through `PATH`/`PULSE_FASTLY_BIN` or direct Viceroy through `PULSE_VICEROY_BIN`.

## Create a project

The command and documented result below are executed by the documentation test lane.

<!-- pulse-doc-run {"temp":true,"args":["init","hello-pulse","--json"],"display":"pnpm pulse -- init ./hello-pulse --json"} -->
```bash
pnpm pulse -- init ./hello-pulse --json
```
```json
{
  "status": "initialized",
  "files": [
    ".gitignore",
    ".pulse/.gitignore",
    ".pulse/config.ts",
    "README.md",
    "package.json",
    "src/index.ts",
    "tests/pulse.harness.ts",
    "tsconfig.json"
  ]
}
```

Then enter the project and install the exact dependencies written by `pulse init`:

```bash
cd ./hello-pulse
npm install
```

`pulse init` never runs a package manager or performs hidden network work.

The generated project uses the conventional `.pulse/config.ts` workspace,
an async `Pulse` application root from `@pulse-compute/pulse`, and a dedicated
`tests/pulse.harness.ts` case module. The `.pulse/.gitignore` keeps generated
workspace artifacts out of version control while retaining the project config.

## Verify the project

```bash
npm run doctor
npm test
```

- `doctor` validates configuration, entry resolution, schema declarations, provider support, output safety, and required toolchains.
- `test` executes the configured cases through the selected provider’s local runtime.

Use `npm run inspect` when you need the capabilities, effects, continuations,
schemas, target-support decision, or provider lowering required by the handler.
It is observability, not a required lifecycle stage.

## Run locally

```bash
npm run dev
```

`pulse dev` is a foreground server. It watches the handler and schema dependency graph, recompiles on change, and exits when the process receives a normal termination signal. It does not create a daemon or background worker. The executable docs lane starts it with `--once`, sends a real request, verifies the response, and checks clean shutdown.

## Advanced: compile portable Pulse Wasm

```bash
npm run compile
```

`pulse compile` lowers the canonical handler into a deterministic provider-neutral execution plan and writes compact Pulse-owned WebAssembly. The output includes `pulse-compile.json`, `canonical-native-plan.json`, generated AssemblyScript, Wasm, WAT, and the native ABI manifest. It does not package a deployment provider or embed the Fastly JavaScript runtime.

The provider selected by the active `.pulse/config.ts` profile remains relevant to `test`, `dev`, and `build`, but it does not change the portable artifact produced by `compile`. Normal projects can proceed directly from `dev` to `build`; `compile` is not a prerequisite.

## Build

```bash
npm run build
```

For Node, the build emits the canonical handler, program metadata, schema registry/codecs when configured, and `pulse-build.json`.

For Fastly, `pulse build` reads the provider and bindings from the selected `.pulse/config.ts` profile, compiles the same provider-neutral native plan, and emits generated Fastly-targeted AssemblyScript plus compact direct-host-ABI WebAssembly at `bin/main.wasm`:

```bash
npm run build
```

The public CLI does not accept provider overrides. Use `pulse compile` when only the portable `pulse_host` module is needed; use `pulse build` when the configured deployment realization is needed. Native builds always preserve generated source and Wasm together.

Provider-neutral compilation and Native provider builds may opt into the
explicitly experimental size optimizer:

```bash
pulse compile --experimental-native-size
pulse build --experimental-native-size
```

The Native compiler resolves that intent to its experimental size profile. The
current runtime and export surface remain unchanged, the default build is
unaffected, and portable and provider manifests record the resolved profile.
JavaScript build targets reject the flag.

For candidate-specific output and proof boundaries, continue with [Node build
and execution](./guides/deploying-node.md) or [Fastly deployment
candidates](./guides/deploying-fastly.md).

## Diagnose failures

Run `pulse doctor --json` and use the stable diagnostic code. See [Troubleshooting](guides/troubleshooting.md) and the [diagnostics reference](reference/diagnostics.md).

## Next steps

- Start with [`examples/01-hello-json`](../examples/01-hello-json/).
- Add upstream data with [fetching and composition](./guides/fetching-and-composition.md).
- Add bounded validation with [explicit JSON schemas](./guides/json-schemas.md).
- Map platform data using [Fastly capabilities](./guides/fastly-capabilities.md).
- Check source eligibility in [Managed handler TypeScript and JavaScript](./reference/handler-authoring.md), then confirm the selected mode in [Provider and target compatibility](./reference/compatibility-matrix.md).
