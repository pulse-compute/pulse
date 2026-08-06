# PulseWasm Wasm Host ABI Contract v1

## Status

Locked before Phase 10C.

## Purpose

This document defines the host-facing WebAssembly ABI for the local bridge phase. It is intentionally narrow and platform-neutral.

## Exports

The Wasm module must expose:

- `memory`
- `pulse_alloc(byteLength: i32) -> i32`
- `pulse_free(ptr: i32, byteLength: i32) -> void`
- `pulse_init() -> void`
- `pulse_reset() -> void`
- `pulse_execute_request(methodCode: i32, pathPtr: i32, pathLen: i32) -> i32`
- `pulse_execute_connect(methodCode: i32, pathPtr: i32, pathLen: i32) -> i32`
- `pulse_execute_disconnect(methodCode: i32, pathPtr: i32, pathLen: i32) -> i32`
- result getters: `pulse_result_status`, `pulse_result_kind`, `pulse_result_body_ref`, `pulse_result_body_ptr`, `pulse_result_body_len`, `pulse_result_headers_ref`, `pulse_result_error_ref`
- string getters: `pulse_string_ptr`, `pulse_string_len`, `pulse_string_is_null`
- ctx operations: `pulse_ctx_param`, `pulse_ctx_state_get`, `pulse_ctx_state_set`, `pulse_result_text`, `pulse_result_empty`, `pulse_next`, `pulse_next_error`
- error operations: `pulse_error`, `pulse_error_with_cause`, `pulse_error_code_ref`, `pulse_error_message_ref`, `pulse_error_status_code`, `pulse_error_cause_ref`
- channel operations: `pulse_channel_count`, `pulse_channel_ref_at`

## Imports

Handlers are imported from:

```text
pulsewasm_handlers
```

The broadcaster adaptor is imported from:

```text
pulsewasm_broadcaster.broadcast(channelsRef: i32, ctxRef: i32) -> i32
```

Broadcaster return policy:

- `0` means success
- non-zero means an `ErrorRef`

## Memory

Host-facing strings are UTF-8 pointer/byte-length pairs. Runtime-returned string data is addressed through opaque `StringRef` integers and read with `pulse_string_ptr` / `pulse_string_len`.

`pulse_reset()` invalidates transient refs.

## Defaults

- normal fallthrough returns `404`
- error fallthrough returns `500`
- contract violation returns `500 PULSEWASM_NO_RESULT`

## Non-goals

This contract does not define WIT, platform adapters, JSON/binary ABI, async, or production memory optimization.
