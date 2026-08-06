# PulseWasm Runtime ABI Boundary Contract v1

## Status

Locked before Phase 9E.

## Boundary

PulseWasm v1 uses:

- deterministic dense handler slots
- explicit minimal ctx operations
- explicit result builders
- explicit error constructors
- explicit `next()` / `next(err)` continuation helpers
- explicit broadcaster adaptor semantics
- explicit lifecycle harness entrypoints
- full request path matching for mounts
- AssemblyScript strings inside generated AS core for Phase 9
- separate future host/WIT memory boundary

## Handler imports

```ts
@external("pulsewasm_handlers", "auth")
declare function __pulsewasm_handler_0_auth(ctx: usize, next: usize): void
```

No dynamic lookup is allowed. Missing handlers are build-time/compile-time failures, not runtime fallbacks.

## Minimal ctx operations

```ts
pulse_param(ctx: usize, name: string): string
pulse_state_get(ctx: usize, key: string): string
pulse_state_set(ctx: usize, key: string, value: string): void
pulse_result_text(ctx: usize, status: i32, body: string): void
pulse_result_empty(ctx: usize, status: i32): void
pulse_next(ctx: usize): void
pulse_next_error(ctx: usize, err: usize): void
pulse_error(code: string, message: string, status: i32): usize
```

No broad JS-style `ctx` object is exposed in this boundary.

## Result ABI

```ts
const RESULT_NONE: i32 = 0
const RESULT_TEXT: i32 = 1
const RESULT_JSON: i32 = 2
const RESULT_BINARY: i32 = 3
const RESULT_EMPTY: i32 = 4
```

Only text and empty builders are immediate. JSON/binary are reserved until their ABI is explicitly locked.

## Error ABI

```ts
type PulseErrorRef = {
  codeRef: usize
  messageRef: usize
  statusCode: i32
  causeRef: usize
}
```

`code`, `message`, and `statusCode` are mandatory. `causeRef` is optional.

## Continuation ABI

```ts
const NEXT_NONE: i32 = 0
const NEXT_NORMAL: i32 = 1
const NEXT_ERROR: i32 = 2
```

`next()` resumes normal routing at `entry.nextIndex`. `next(err)` enters error routing at `entry.nextIndex` with `activeErrorRef = err`.

## Channel / broadcaster ABI

Channel handlers return a pointer to a channel value/list. If channels resolve and no broadcaster adaptor is present, the harness/runtime fails with `PULSEWASM_BROADCASTER_MISSING`.

## Lifecycle

Lifecycle simulation remains explicit:

```ts
executeRequest(...)
executeConnect(...)
executeDisconnect(...)
```

Lifecycle handlers are not hidden inside normal request dispatch.

## Mount path policy

Full request path is canonical. Mount behavior is represented through execution-plan indices, not semantic path trimming.

## Phase 9E

Phase 9E compiles generated AssemblyScript with `asc`. It does not execute the emitted Wasm and does not finalize host bindings.
