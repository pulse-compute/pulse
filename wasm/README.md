# PulseWasm workspace

Canonical public documentation and complete projects live at [`../docs/`](../docs/) and [`../examples/`](../examples/). This directory documents compiler/runtime implementation details.

`wasm/` contains the canonical TypeScript compiler target, lifecycle runtime, ABI/contracts, provider implementations, implementation artifacts, and truth-oriented tests. It is part of the root pnpm workspace rather than a package-management island.

## Product chain

```text
user TypeScript
→ pulse CLI
→ compiler/lowering
→ lifecycle runtime
→ selected provider
→ observable response
```

The provider-neutral authoring API lives in `packages/api`. The project workflow belongs to `packages/cli`; the compiler package owns lowering only.

```text
wasm/packages/
  api/                canonical TypeScript authoring surface
  cli/                project config and init/dev/test/inspect/build/doctor workflow
  compiler/           extraction, lowering, and generated canonical programs
  contracts/          stable API, ABI, effect, and provider contracts
  host-runtime/       platform-neutral lifecycle behavior
  runtime-core-as/    AssemblyScript runtime target
  schema-json/        schema JSON lowering/runtime support
  build-support/      shared deterministic build helpers
  library-kit/        package-owned lowerer protocol
```

The product-facing Node and Fastly providers live at `../packages/provider-node/`
and `../packages/provider-fastly/`; `wasm/` retains provider-neutral compiler,
ABI, and host-runtime machinery.

See [Package boundaries](./docs/PACKAGE-BOUNDARIES.md) and [Testing](./docs/TESTING.md).

## End-user CLI workflow

From a checkout, invoke the product CLI through the single root delegation script:

```bash
pnpm run pulse -- init ./tmp/my-pulse-app
cd ./tmp/my-pulse-app
node ../../wasm/scripts/pulse.cjs doctor
node ../../wasm/scripts/pulse.cjs test
node ../../wasm/scripts/pulse.cjs inspect
node ../../wasm/scripts/pulse.cjs build
node ../../wasm/scripts/pulse.cjs dev
```

In an installed package, those commands are simply `pulse ...`.

`pulse init` creates a normal project with `src/index.ts` and `.pulse/config.ts`. Every subsequent command discovers that config, honors its real entry/provider/output and explicit schema declarations, and uses the same canonical project compilation path. `pulse dev` is a foreground local server and watches the entry source by default. Node and Fastly local conformance execution use the same canonical lowering and lifecycle runtime without adding Promise or ambient-fetch semantics to user scope.

Fastly `test`, `inspect`, `doctor`, `dev`, and `build` are implemented through `@pulse-compute/provider-fastly`. `pulse compile` always emits provider-neutral Pulse Wasm. `pulse build` uses the provider declared by the active `.pulse/config.ts` profile; Fastly builds emit generated AssemblyScript and compact direct-host-ABI `bin/main.wasm`. Public provider overrides and source-only JavaScript packaging are rejected, and remote deployment validation remains separately recorded.

The eight projects under `../examples/` are the product-level lowering, runtime, CLI, docs, and provider oracles. `test/fixtures/internal-canonical/` is limited to implementation-edge cases; it is not an alternate user workflow.

## Functional profiles

```bash
pnpm run wasm:test:unit
pnpm run wasm:test:native
pnpm run wasm:test:javascript
pnpm run wasm:test:conformance
pnpm run wasm:test:providers
pnpm run wasm:test:cli
pnpm run wasm:test:release
```

The `release` profile composes all current functional evidence, deterministic package/site construction, and packed clean-consumer acceptance. Every task has a finite timeout and optional ephemeral report under `wasm/.test-results/`.

## Canonical implementation status

Implemented through the canonical Node and Fastly project workflows:

- bounded immutable request text/JSON and structured responses;
- explicit TypeScript JSON schemas compiled and linked for request decode, fetch decode, and response encode;
- identical generated schema registries/codecs across Node and Fastly targets, with schema dependency watching in `pulse dev`;
- ordinary branching;
- one or more fetches with compiler-owned continuation lowering;
- deterministic independent fetch groups and dependent continuation chains;
- config, secrets, and KV capability values;
- direct structured or opaque binary/stream pass-through;
- exact Node binary emission and repeated-header preservation;
- package-owned GRIP channel/hold/publish lowering with Fastly realization;
- clean-project initialization, diagnostics, tests, inspection, build, and foreground development serving.

Still outside the current boundary:

- `fastly compute serve --file` execution evidence in environments where the Fastly CLI is available, plus remote Fastly service validation;
- full userland streams, chunk iteration, and transforms;
- arbitrary binary inspection or mutation;
- background tasks and ambient provider SDK authority.

## Artifacts

Compiler, runtime, and provider outputs are generated into an isolated artifact directory for each test task or into `wasm/artifacts/` for an explicit repository build. Generated outputs are not checked into the repository and do not define release truth.
