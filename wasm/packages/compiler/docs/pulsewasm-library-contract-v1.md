# PulseWasm Library Contract v1

## Status
Locked by Phase 11D.

## Purpose
Declare when a library can participate in PulseWasm.

A library may be pleasant in TypeScript mode, but it is not considered Wasm-compatible unless it provides a validated contract and explicit AssemblyScript sidecar.

## Minimal shape

```json
{
  "version": "pulsewasm.library-contract.v1",
  "package": "pulse.grip",
  "modes": {
    "typescript": { "entry": "./dist/index.js" },
    "jsEngine": { "entry": "./dist/index.js" },
    "wasm": {
      "mode": "wasm-sidecar",
      "sidecar": "./as/index.as.ts",
      "lowerings": [
        {
          "tsSymbol": "grip.hold",
          "asSymbol": "pulse_grip_hold",
          "callShape": "literal-mode",
          "hostCapabilities": ["headers"]
        }
      ],
      "hostCapabilities": ["headers"]
    }
  }
}
```

## Rules

- no inferred library compatibility
- no arbitrary TypeScript package compilation
- no public plugin API yet
- Wasm compatibility requires an AssemblyScript sidecar
- sidecar behavior must be verified by future parity fixtures
- JS engine use is manual debt, not automatic fallback
