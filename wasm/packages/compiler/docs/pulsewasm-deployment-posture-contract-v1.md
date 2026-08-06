# PulseWasm Deployment Posture Contract v1

## Core rule

Pulse never silently falls back from Wasm to JS.

If Wasm fails, the Wasm build fails. If the developer wants to ship JS, they explicitly choose `runtime.engine = "js"`.

## Artifact

```text
deployment-posture.json
```

## Wasm posture

```json
{
  "engine": "wasm",
  "optimizedTarget": "wasm",
  "wasmOptimized": true,
  "manualEscapeHatch": false,
  "fallback": "manual-only",
  "debt": []
}
```

## JS escape hatch posture

```json
{
  "engine": "js",
  "optimizedTarget": "wasm",
  "wasmOptimized": false,
  "manualEscapeHatch": true,
  "fallback": "manual-only",
  "debt": [
    {
      "code": "PULSEWASM_ENGINE_JS_SELECTED",
      "kind": "manual_escape_hatch",
      "message": "JS engine selected manually. Application can ship, but Wasm optimization is bypassed."
    }
  ]
}
```

## Principle

Pulse does not stop you from shipping, but it records exactly when a feature or engine choice takes on optimization debt.
