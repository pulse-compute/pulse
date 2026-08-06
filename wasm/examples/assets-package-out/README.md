# Assets package-out reference

This implementation fixture verifies that the compiler can discover the package-owned compiler for the canonical `@pulse-compute/assets` root from an isolated, packed `node_modules`-style dependency rather than relying on monorepo source paths.

The fixture exercises:

- package-owned manifest discovery;
- package-owned compiler-builder loading;
- static asset lookup/response lowering;
- route-method and lookup-method alignment for the Native package-out source used by this fixture;
- sidecar compile/link behavior through `pulse_assets_lookup` and `pulse_assets_respond`.

It is retained as an implementation/package-release fixture and is not one of the canonical public CLI examples under the repository root `examples/` directory.
