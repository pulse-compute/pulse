# Pulse implementation map

| Surface | Canonical source | Strongest current evidence | Remaining gap |
|---|---|---|---|
| Runtime application contract | `packages/runtime` plus canonical projects | unit, native, JavaScript, conformance, CLI, provider, package, and clean-consumer evidence | broader syntax and provider coverage |
| Request/response | whole-project compiler + canonical runtime | Node execution, CLI projects, native Fastly build and real-host proof | broader production soak and resource-limit evidence |
| Single/grouped/dependent fetch | explicit effects + continuation registry | reverse-resolution groups, dependent chains, CLI examples, native Fastly realization | cancellation remains a later optimization |
| Explicit JSON schemas | `schema-json` package-owned compiler | request/origin/response codec workflow under Node and Fastly | broader JSON tooling and validation policies |
| Opaque pass-through | host-owned response handle | exact Node bytes/repeated headers and native Fastly realization | broader provider and device-host coverage |
| CLI | `packages/cli` | init/doctor/inspect/test/dev/compile/build clean-project lanes | execution-target ergonomics |
| Fastly provider | root `provider-fastly` package | local conformance, compact native `bin/main.wasm`, real Fastly CLI-managed execution | production deployment soak |
| GRIP | root package-owned lowerer | canonical lowering, local conformance, compiled target | production Fanout delivery evidence |
| Public documentation | root `docs/`, complete examples, and generated site | executable documentation, local preview, versioned deployment candidates | ongoing product-language refinement |

## Public versus internal surfaces

Released conventional projects use public `@pulse-compute/pulse` for deterministic configuration and the project-aware application root, `@pulse-compute/runtime` for the low-level portable contract, and `@pulse-compute/cli` for orchestration. Maintained Node JavaScript execution lives behind the explicit provider target and is not exposed as a fallback.

## Current priorities

1. Keep native and JavaScript semantics aligned through the conformance corpora.
2. Preserve explicit target selection and native-eligibility diagnostics.
3. Expand schema validation and CLI ergonomics without widening authority.
4. Add broader provider evidence before making new release claims.
