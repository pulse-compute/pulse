# Pulse lifecycle

The lifecycle uses explicit effects and host-controlled continuation resume.
Beta handlers are async-shaped; Native lowering erases managed
wrappers and lowers trusted awaits without adding a Promise runtime.

```text
request snapshot
→ generated handler evaluation
→ single/grouped effect emission
→ provider dispatch
→ continuation registry resume
→ structured or opaque response
```

## Implemented canonical path

Single handlers and static Router entries lower into the same canonical state machine. The compiler converts supported capability expressions such as `ctx.fetch` into internal effect markers. The Node canonical runtime dispatches those markers through the existing route-effect provider and resumes the generated handler at the compiler-recorded continuation point.

- Independent consecutive fetches dispatch concurrently and join in declaration order. A failed group settles all already-dispatched effects before returning the declaration-order primary failure, so execution does not leak background work.
- Host resolution order is diagnostic only.
- Dependent fetches produce separate continuation records.
- Effects in untaken branches are never registered.
- HTTP status remains response data; network and timeout conditions fail the active continuation.
- Double resume and expired resume are rejected by the continuation registry.

## Opaque lifecycle

A directly returned fetched binary/stream response remains host-owned. Status, repeated headers, exact binary chunks, stream/response references, and the stream-result ABI are preserved. Payload bytes are not copied into Wasm, and user attempts to inspect an opaque body fail intentionally. Direct structured fetch responses also pass through without being re-encoded by user code.



## Asset authoring guardrails

For package-owned asset lowering, the route method and assets.lookup method must match. A HEAD lookup therefore uses `router.head(...)`; mismatches fail with `PULSEWASM_ASSETS_ROUTE_METHOD_MISMATCH`. computed router methods, dynamic route registration, and dynamic asset keys remain rejected because the compiler cannot prove their lifecycle shape.

## Narrow target readiness

These lower-level compatibility paths remain deliberately narrower than the canonical project workflow:

```text
Node compiled-Wasm assets:       implemented-narrow
Fastly POST JSON request bodies: plan-only
Fastly compiled-Wasm assets:     plan-only
```

Static asset keys must remain compiler-visible; dynamic asset keys are rejected rather than guessed. The current non-AssemblyScript release gate is:

```bash
node wasm/scripts/run-wasm-tests.cjs --profile release --no-report
```


## Readiness aggregation

Focused lower-level compatibility evidence still emits `lifecycle-readiness-aggregate.json` and exposes the same information through the doctor readiness aggregate. That view keeps route readiness, package readiness, and provider readiness distinct so a narrow proof cannot be mistaken for canonical provider execution.

## Testing

Use the functional profiles documented in `docs/TESTING.md`. `native` establishes lowering, execution, and Wasm/ABI behavior; `javascript` establishes direct target realization; `conformance` establishes parity; `cli` establishes the user command path; and `providers` establishes capability realization.
