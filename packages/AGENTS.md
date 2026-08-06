# Root package maintainer instructions

Packages under this directory are public application/provider/extension surfaces or private reserved packages.

- The release manifest defines which exports are supported. Do not promote an implementation export merely because it resolves.
- Assets, GRIP, and JWT use their package roots as canonical author facades; `/pulsewasm` is compatibility-only where present.
- Package-owned compiler and manifest files remain trusted release components, not a public self-registration mechanism.
- `@pulse-compute/runtime` owns the low-level portable application contract; public `@pulse-compute/pulse` owns the conventional project-aware application root, configuration, and schema declaration surface.
- Keep obsolete implementation snapshots out of the active workspace and release packages.
- Keep package README status blocks generated from the release manifest and keep packed links inside the package or on exact-version hosted documentation.

## Pulse entry points

Paths are repository-root-relative. The root Entry Point rules remain in force.

### package-surface

**Use for**

One named public package at a time: its import root, supported exports,
compatibility subpaths, packed layout, examples, and package-root evidence.
Use `package-lowering` for compiler builders, sidecars, or lowering behavior.

**Contracts**

- `release/pulse-release-manifest.json`
- `packages/assets/pulse.package.json`
- `packages/grip/pulse.package.json`
- `packages/jwt/pulse.package.json`
- `scripts/package-support.cjs`
- `scripts/pack-release.cjs`

**Write**

Select only the package named by the task; sibling package sources and examples
remain read-only.

- `packages/AGENTS.md`
- the named `packages/assets/**`, `packages/grip/**`, or `packages/jwt/**` tree
- `API.md`
- `docs/packages/assets.md`
- `docs/packages/grip.md`
- `docs/packages/jwt.md`
- exact examples named by the task under `wasm/packages/cli/examples/**`
- exact provider fixtures named by the task under `wasm/test/fixtures/projects/**`
- `scripts/pack-release.cjs`
- `wasm/test/contracts/assert-package-reachability.cjs`
- `wasm/test/assets/assert-assets-package-owned-lowering.cjs`
- `wasm/test/library/assert-grip-package-owned-lowering.cjs`
- `wasm/test/compiled/assert-package-root-native.cjs`
- `wasm/test/release/assert-release-packages.cjs`
- `wasm/packages/cli/docs/**`

**Derived**

- `wasm/packages/cli/docs/**`
- generated status blocks inside the listed package READMEs

**Read**

- the named package entry in `release/pulse-release-manifest.json`
- the named lowerer contracts and implementation as package-root evidence
- the sibling first-party package as parity evidence

**Evidence**

- Assets: `node wasm/scripts/run-wasm-tests.cjs --task package-reachability --task assets-package-owned-lowering --task package-root-native --no-report`
- GRIP: `node wasm/scripts/run-wasm-tests.cjs --task package-reachability --task grip-package-owned-lowering --task grip-package-runtime --task package-root-native --no-report`
- JWT package surface: `corepack pnpm --filter @pulse-compute/jwt build && corepack pnpm exec vitest run packages/jwt/test`
- `node wasm/scripts/run-wasm-tests.cjs --task package-exports --no-report` when exports or packed files change
- `npm run docs:check` when public examples, package guides, or generated copies change

**Supplements**

- `docs/concepts/package-owned-lowering.md`

**Exclude**

- package-lowerer compiler, sidecar, or trusted-loader behavior
- sibling package mutation
- provider implementation changes
- release version, channel, package-set, publication, or deployment changes
