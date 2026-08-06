# Pulse first-party ES256 guest

This directory owns the G1 standalone ES256 verifier unit:

- `source/` is the exact locked Rust source used by maintainers;
- `prebuilt/es256-verifier.unoptimized.wasm` is the Cargo release artifact
  before whole-module Binaryen optimization;
- `prebuilt/es256-verifier.wasm` is the reviewed package prebuilt;
- `pulse.guest-unit.json` binds the artifact, source, toolchain, ABI, memory,
  and provenance identities;
- `build.cjs` is the maintainer-only deterministic build/check entry point.

Run `node build.cjs --write` only in a maintainer environment with the pinned
Rust toolchain and workspace dependencies restored. Run `node build.cjs
--check` to rebuild twice and compare with the checked-in manifest and bytes.

G2 connects this exact reviewed prebuilt to the compiler's private,
content-addressed guest-link path and proves Node Native artifacts for both
Native optimization modes. Application lowering still does not select it, and
JWT, providers, executable crypto planning, and public configuration remain
unchanged; G3 owns activation.
