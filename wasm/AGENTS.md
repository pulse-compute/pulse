# Canonical Wasm workspace instructions

These instructions extend the root guidance for `wasm/`.

The canonical workspace owns compilation, explicit effects, continuations, provider-neutral runtime contracts, and the product CLI. Preserve contract ownership between `contracts`, `library-kit`, `host-runtime`, provider packages, runtime-core AssemblyScript, and the compiler orchestrator.

- Do not reintroduce implementation contracts into the compiler when an owning package already exports them.
- Keep internal `PULSEWASM_*` proof diagnostics separate from public `PULSE_*` CLI diagnostics.
- Keep artifacts deterministic and regenerate them through the owning task rather than manual edits.
- Treat changes under handler effects, continuation runtime, package lowering, and provider descriptors as protected boundaries.
- A new effect, capability, provider, syntax form, or lowerer discovery path is scope/architecture work, not an incidental defect fix.
- Run the smallest relevant functional profiles plus `unit`; use `release` only when the full dependency environment is available.
