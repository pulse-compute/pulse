# MEM9-09B — Fastly frames and effects

Human direction: “No let's finish the work, proceed with 09B.”
Base: `codex/mem9-integration` at `bc008e3690d65f3f916fe60e4a4884ba0f71dc6a`,
after #354. Target: `codex/mem9-integration`; related #289 and #349.
Class: architecture. Protected boundaries: runtime target realization,
effect/continuation ownership and the release controller's regression selection.
No single Entry Point spans the canonical emitter and provider owners; ordinary
root, Wasm, provider and docs instructions apply. Merge remains human-owned.

## Owner audit

| Owner | Lifetime and checkpoint rule |
| --- | --- |
| Pure helper frame | Existing globally declared local slots; no checkpoint inside the helper, including loops. Earlier caller operands and borrowed returns reach the outer expression boundary first. |
| Async helper frame | Declared locals and helper-return global are roots. Arguments transfer before entry; return transfers before the caller clears the result. Existing non-nesting validation remains required. |
| Shared stages | All stage locals and every registration's effect-result slot are roots. Existing stage accessors select registration slots; ready-flag clearing does not clear results. Stage entry/reset and exit ordering are unchanged. |
| Router errors | Error moves into the declared Router local before recovery. No collection during construction or settlement; a latched guest/provider failure suppresses tracing. |
| Effect groups | All sibling payloads enter provider slots before the suspend checkpoint. Guest results, provider payloads and ready results are traced independently of flags. No checkpoint runs inside effect dispatch, polling, resolution or authenticated settlement. |
| Opaque resources | Fetch wrappers and values carrying response/body resources are pinned on insertion for the invocation. No new close/cancel operation. Forwarding marker/result are explicit roots; the remaining forwarding integers are resource IDs, lengths, modes or pointers. |
| Provider caches/state | Header snapshot, occupied cache index and guest request-state arrays retain existing semantics. Managed request strings, redaction strings, byte buffers and S3's direct wrapper references remain ordinary managed references. |

The explicit effect allowlist covers fetch, config/secret, KV, conditional KV,
time/digest and existing first-party GRIP, Assets, JWT and S3 adapters. Their
provider calls are synchronous between guest checkpoints; persistent integer
value ownership flows through the shared payload/ready slots. Per-effect pending
IDs, invocation tickets, timeout/outcome arrays and counters are not handles.
S3's direct body-wrapper array retains its existing cleanup ownership; the new
pin also preserves the integer mapping. Linked JWT realizations remain excluded.

Both guest and provider root descriptors reject missing entries before source
composition. Unknown frame versions, frame statements, effects, expressions and
capabilities disable tracing. Event and package-owned application emitters,
Node, stub, linked and allocation-budgeted paths retain their prior lifetime
behavior. No ABI, public option, authoring syntax or effect protocol changes.

## Evidence and limits

`fastly-handle-frames` compares real traced and retained Wasm under both arena
settings. It exercises caller operands, borrowed pure returns, early and repeated
async helper calls, repeated stage registrations, caller-local survival, group
results arriving out of order, schema/transport/deadline recovery, cancellation,
late completion cleanup and closed-invocation duplicate rejection. Diagnostic
root probes isolate provider-only payload/ready owners and guest results after
flag clearing. Opaque forwarding and S3 handoff/discard/failure paths compare
exact host traces and binary output.

Increasing fixed-working-set loops measure mapping/capacity bounds independently
of legitimate resource pins. Pure helper work can allocate substantially between
checkpoints; pins, conservative local slots and live ropes still retain data.
Wasm capacity, allocator-observed managed bytes and host RSS are different metrics.
No deployed-provider or process-RSS improvement is claimed.

Validation and paired cost receipts will be recorded on the frozen source.
This increment does not complete MEM9-09C or final integrated compliance. Latest
reconciliation (including #353), installed-consumer and final provider qualification
remain with #349. Historical 09A receipts keep their original source identities.
