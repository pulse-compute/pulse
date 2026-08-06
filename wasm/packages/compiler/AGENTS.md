# Compiler maintainer instructions

The compiler orchestrates canonical owners; it must not become a second owner of runtime, schema, provider, or package-lowering contracts.

- Reject unsupported source with a stable diagnostic. Never preserve arbitrary JavaScript as a hidden fallback.
- Keep lowering deterministic, whole-project, and explicit about effects and continuation sites.
- Resolve package lowerers only through the existing trusted first-party path unless explicit human direction and an update to `docs/architecture/current-contracts.md` change the trust model.
- Keep provider realization behind the versioned provider toolchain contract; compiler composition must not import provider implementations or provider SDKs.
- Any change to accepted syntax, effect shape, continuation protocol, or artifact identity requires contract tests and protected-boundary declaration.
- Run `static`, `contracts`, and `lowering`; add `runtime`, CLI, provider, build, or release lanes as selected by the scope report.
