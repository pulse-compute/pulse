# PulseWasm architecture

## Execution model

Pulse user functions are synchronous, capability-scoped TypeScript programs. The compiler owns suspension and continuation lowering.

```text
canonical TypeScript handler
→ compiler-generated effect markers
→ host/provider dispatch
→ continuation registry resume
→ structured or opaque response
```

There is no user-authored Promise/async requirement, Asyncify dependency, ambient `fetch`, or provider SDK authority in user scope.

## Canonical API implementation

The provider-neutral authoring surface lives in `@pulse-compute/runtime`. The current compiler accepts a deliberately small subset: one exported default handler, ordinary straight-line expressions, `if`/`else`, structured request/response helpers, config/secrets/KV, and lowerable `ctx.fetch` positions.

Compiler lowering uses the proven lifecycle implementation rather than adding a second scheduler:

- a single fetch becomes one explicit effect and one continuation;
- consecutive independent fetch declarations become one effect group and one deterministic join;
- a fetch whose URL or options depend on an earlier result remains a separate continuation;
- a directly returned fetch response becomes a pass-through continuation; structured responses preserve their body value and opaque responses preserve the host-owned body handle;
- effects inside untaken branches are never constructed or dispatched.

The generated handler is a compiler-owned generator protocol. Generators are an internal implementation mechanism, not a user-facing async API.

## Current artifact boundary

The canonical compiler now lowers the generated handler/effect program into a deterministic provider-neutral native plan and compact Pulse-owned Wasm. `pulse compile` stops at that portable module. `pulse build` composes the same plan with the provider configured by the active `.pulse/config.ts` profile; the Fastly realization generates AssemblyScript and compact `bin/main.wasm` with direct `fastly_*` guest imports.

The former Fastly JavaScript-runtime image path is not exported by `@pulse-compute/provider-fastly`, is absent from the lockfile, and does not participate in the public build lifecycle. The maintained JavaScript target is implemented through the Node provider and remains explicitly selected; it is never an automatic fallback. Router topology, terminal middleware, fallthrough, and error lanes lower through the same canonical contract.

## Continuations

The host runtime owns a continuation registry with explicit states:

```text
created → waiting → resumed → completed
                    ↘ failed
created/waiting → expired | cancelled
```

The registry rejects duplicate IDs, double resume, resume after completion/failure, and resume after expiry. Runtime traces record effect IDs, branch points, and state transitions.

## Body model

Two body classes are intentionally separate:

- **Structured bodies** are bounded, runtime-owned immutable values. Text and JSON transforms may be memoized and read repeatedly.
- **Opaque bodies** are host-owned binary/stream handles. They may be routed or returned, but not inspected, mutated, copied into Wasm, or iterated by user code.

Direct opaque return preserves status, repeated headers, response/stream references, exact binary chunks, and the existing stream-result ABI. Terminal handoff detaches the handle from the continuation while leaving payload ownership with the host.

## Provider model

Canonical capabilities include request/response, fetch, config, secrets, KV, and opaque pass-through. Providers implement those capabilities behind the common API; they do not add `ctx.fastly` or provider SDK objects to user code.

Node and Fastly implement the same canonical provider contract. The compiler records provider-neutral request/response, fetch, config, secret, KV, GRIP, and opaque pass-through operations. The selected provider validates those requirements and supplies lowering, local execution, and build realization. Node consumes the portable `pulse_host` module; Fastly realizes the same plan as direct-host-ABI Wasm. Real Fastly CLI-managed execution is maintained as an explicit environment-dependent reality gate; remote infrastructure validation remains separate.

## Truth boundaries

- Static tests prove package/API/import shape.
- Contract tests cross-check stable ABI and implementation artifacts.
- Lowering tests prove canonical source-to-effect transformation.
- Runtime tests execute generated handlers through route effects and continuation state.
- CLI tests prove clean-project Node/Fastly init, doctor, tests, compiler inspection, safe provider-specific build output, foreground development serving, live local fetch, and diagnostics/redaction.
- Provider tests execute one canonical source through Node and Fastly adapters, prove capability realization and redaction, and inspect the generated native Fastly module and its host-import contract.
- Compiled tests prove AssemblyScript/Wasm and ABI integration.

A claim is made only in the strongest lane that actually observes it.
