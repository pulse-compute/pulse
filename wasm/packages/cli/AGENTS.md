# CLI maintainer instructions

The CLI is a public contract. Its declarative command specification, project-config schema, diagnostic catalog, help, completion files, human references, and machine JSON must stay synchronized.

- Public options belong in `src/command-spec.js`; repository-only truth-suite controls stay hidden.
- Public configuration belongs in `src/project-config-schema.js` and must remain aligned with TypeScript types, generated JSON Schema, defaults, precedence, and runtime validation.
- Every public diagnostic needs title, summary, remediation, exit class, scope, stability, and a resolvable exact-version anchor.
- Preserve one-object JSON output for completed commands and newline-delimited event output for `pulse dev --json`.
- Keep provider loading behind the approved exact `./toolchain` package resolver. Do not add CLI host branches, dependency scanning, self-registration, or fallback discovery.
- Run docs synchronization, `unit`, and the CLI profile; run provider/build/release evidence when affected.

## Pulse entry points

Paths are repository-root-relative. The root Entry Point rules remain in force.

### project-workflow

**Use for**

The application journey across CLI descriptions, generated scaffolds,
executable examples, and guidance, including the routine `dev -> test -> build`
loop versus advanced inspection or compile-only workflows.

**Contracts**

- `wasm/packages/cli/src/command-spec.js`
- `wasm/packages/cli/src/project-execution.js`
- `wasm/packages/cli/src/project-config-schema.js`
- `wasm/test/cli/assert-cli-init-workflow.cjs`
- `wasm/test/docs/assert-executable-documentation.cjs`

**Write**

- `wasm/packages/cli/src/command-spec.js`
- `wasm/packages/cli/src/project-execution.js`
- `wasm/packages/cli/src/provider-drivers.js`
- `wasm/test/cli/assert-cli-*-workflow.cjs`
- `wasm/test/docs/assert-executable-documentation.cjs`
- `README.md`
- `docs/getting-started.md`
- `docs/packages/cli.md`
- `docs/maintainers/testing.md`
- `packages/runtime/docs/API.md`
- `packages/runtime/docs/guides/**`
- exact example READMEs named by the task under `wasm/packages/cli/examples/**`
- `wasm/packages/cli/docs/**`

**Derived**

- `wasm/packages/cli/docs/**`

**Read**

- `wasm/packages/cli/src/project-config.js`
- `wasm/packages/cli/src/internal/command-request.js`
- `packages/provider-node/src/**`
- `packages/provider-fastly/src/**`
- `release/pulse-release-manifest.json`

**Evidence**

- `node wasm/scripts/run-wasm-tests.cjs --task cli-init-workflow --task cli-project-workflow --task cli-dev-workflow --no-report`
- `node wasm/scripts/run-wasm-tests.cjs --task docs-executable-contracts --task docs-executable-init-dev --no-report`
- exact `docs-example-*` tasks for examples changed by the task
- `npm run docs:check` when canonical or generated guidance changes

**Supplements**

- `docs/getting-started.md`

**Exclude**

- removing public commands or changing their execution semantics
- compiler, runtime, lowerer, or provider behavior
- release identity, package-set, publication, or deployment changes
