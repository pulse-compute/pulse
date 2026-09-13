# Compiler maintainer instructions

The compiler orchestrates canonical owners; it must not become a second owner of runtime, schema, provider, or package-lowering contracts.

- Reject unsupported source with a stable diagnostic. Never preserve arbitrary JavaScript as a hidden fallback.
- Propagate the explicit target through linking, handler validation and planning. JavaScript retains resolved static imports and ordinary awaits for original-source execution; inspection exposes recognized Pulse behavior, not an executable normalized generator or proof of dependency internals. Native validation remains independent and strict, including record-only eligibility inspection.
- Keep lowering deterministic, whole-project, and explicit about effects and continuation sites.
- Resolve package lowerers only through the existing trusted first-party path unless explicit human direction and an update to `docs/architecture/current-contracts.md` change the trust model.
- Keep provider realization behind the versioned provider toolchain contract; compiler composition must not import provider implementations or provider SDKs.
- Any change to accepted syntax, effect shape, continuation protocol, or artifact identity requires contract tests and protected-boundary declaration.
- Run `node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native --profile javascript --profile conformance`; add CLI, provider, build, or release checks selected by the scope report. `wasm/test/suite/registry.cjs` owns task/profile names; use the runner's `--list` for focused work. `docs/maintainers/testing.md` owns completion and evidence rules.
