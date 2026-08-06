# PulseWasm Core Runtime Contracts v1

## Status

Locked for Phase 9B.

## 1. `ctx` ABI v1

`ctx` is a resettable runtime state object, not a semantic singleton.

Required runtime fields:

```ts
type PulseCtxRef = {
  methodCode: i32
  requestPathRef: usize
  routeRuntimeId: i32
  routeStableIdRef: usize
  mode: i32
  entryIndex: i32
  scopeId: i32
  activeErrorRef: usize
  resultRef: usize
  paramsRef: usize
  scratchRef: usize
  stateRef: usize
}
```

Phase 9B implements this as the generated `PulseWasmDispatchState` shell plus `PulseWasmParamsView`.

## 2. `next()` / `next(err)`

`next` is the routing continuation primitive.

```ts
NEXT_NONE   = 0
NEXT_NORMAL = 1
NEXT_ERROR  = 2
```

- `next()` resumes normal scanning at `entry.nextIndex`.
- `next(err)` resumes error scanning at `entry.nextIndex` with `activeErrorRef` set.
- Direct `next` calls remain the only supported continuation shape.

## 3. Fallthrough behavior

- Full normal fallthrough with no result: `404 Not Found`.
- Full error fallthrough with active error and no result: `500 Internal Server Error`.
- Handler contract violation: `500 Internal Server Error` with code `PULSEWASM_NO_RESULT`.

Userland can still implement a fallback 404 handler with `.use(handle404)` at the end of the chain.

## 4. Error shape

Minimum runtime shape:

```ts
type PulseErrorRef = {
  codeRef: usize
  messageRef: usize
  statusCode: i32
  causeRef: usize
}
```

Phase 9B models this as generated `PulseWasmErrorRef` with `code`, `message`, `statusCode`, and `cause` fields.

## 5. `ctx.params`

`ctx.params` is a view, not a freshly allocated map.

- Param names come from generated tables.
- Param values are start/length slices into the full request path.
- String materialization is lazy through accessor helpers.

## 6. Mount path policy

The v1 semantic model uses the full request path as canonical input.

Mount flow is represented by `childStartIndex` and `parentContinueIndex`; child routing does not receive a semantically trimmed path.
