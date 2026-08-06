# PulseWasm assets sidecar

This directory contains the package-owned AssemblyScript sidecar declared by `../pulsewasm.manifest.cjs`.

The stable exports are:

- `pulse_assets_lookup`
- `pulse_assets_respond`

They delegate to the corresponding `pulse_assets_host` imports and form the compiled-Wasm ABI used by synchronized provider integration tests. Asset payload validation and canonical effect construction remain in the package compiler builder; provider execution remains in provider packages.

This sidecar is an implementation surface, not an application-author entry point.
