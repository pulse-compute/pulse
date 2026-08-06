# Runtime provider / KV contract

The canonical authoring shape is `runtime.provider` under a profile runtime. It selects one provider per profile by default and maps provider-specific stores as generated output, not as compiler semantics.

KV uses a provider-neutral handler surface, `ctx.kv(name)`. Phase 14B locks the shape and generated contract artifacts. Phase 14C proves a local compiled-Wasm runtime / Node adapter KV provider. Compiled-handler lowering for `ctx.kv(...)` and Fastly KV hostcalls are still reserved.
