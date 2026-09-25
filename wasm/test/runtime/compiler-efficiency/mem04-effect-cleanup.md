# MEM04 — release a consumed Node JavaScript fetch response

Entry point: `runtime-effects`. Class: hardening. Baseline: the accepted MEM02
ledger on merged `latest`; its recorded hashes match every relevant production
owner at the start of MEM04. This is one `ctx.fetch(...).text/json` body lifetime
on the shared runtime executed by Node. Node Native and provider realization
paths are unchanged.

## Owner and release point

The outer request host owns the inherited budget through response handoff. A
fetch adapter may return a Web `Response`; the effect adapter registers a
budget abort callback that owns the raw response and can cancel its unread body.
The public fetch result retains its own response and projection cache while an
application alias exists. Previously, after a bounded body projection settled,
the budget callback and its bookkeeping array retained the raw response even
when the application and effect execution had released their aliases.

The response reader now releases that one registration after its byte read
settles and the underlying body is disturbed and unlocked. Text decoding and
schema projection may continue from the bounded snapshot. Cached repeated
projections continue to use that snapshot. An error before the body is read
(such as a declared `Content-Length` over the limit) leaves cancellation
registered; the request budget still owns the unread body. Active reads retain
their reader abort listener and the budget callback until reader finalization.
An opaque/unread response retains cancellation until the budget closes or the
host transfers ownership. Normal budget close still does not cancel a
transferred response. Late results after cancellation keep the existing
best-effort body disposal and cannot resume the handler.

`request-budget.onAbort` now removes its returned callback from budget
bookkeeping when unsubscribed, not only from the `AbortSignal`. The budget's
source-signal listeners, deadline timer, authority checks and `race` behavior
retain their existing lifetimes. No value handles, continuation records, trace
entries or cumulative charges are released or refunded.

## Paired reachability

The MEM02 baseline and MEM04 candidate run the same registered proof harness
with the same Native Wasm. The full report and compact comparison are identified
in [the evidence](mem04-effect-cleanup-evidence.json). Each row holds the outer
budget open, disposes the effect execution, then performs five explicit GC
cycles separated by event-loop turns before sampling `WeakRef`s.

| Sequential text reads | Baseline reachable raw responses / budget listeners | MEM04 raw responses / listeners | Budget deadline timer before close |
| ---: | ---: | ---: | ---: |
| 1 | 1 / 1 | 0 / 0 | 1 |
| 8 | 8 / 8 | 0 / 0 | 1 |
| 32 | 32 / 32 | 0 / 0 | 1 |
| 64 | 64 / 64 | 0 / 0 | 1 |

The callback root after an explicit unsubscribe likewise changes from one to
zero. Closing the budget leaves zero tracked raw responses, listeners and
timers in all four cases. The repeated completed-request control reports zero
surviving responses at 1, 4 and 16 requests, with four reads each. There is no
surviving tracked-resource growth on that fixed completed-request sequence.

The 16 managed lifecycle cases, registry history, shared generator history,
Native/parallel Wasm, and Native handle and accounting totals match MEM02.
They cover success, effect failure, deadline, cancellation with late success
or failure, deterministic parallel selection and opaque transfer. Focused
package tests add repeated text projection, a failed consumed read, and an
unread response rejected by `Content-Length` that must still cancel when the
outer budget aborts. Existing request-budget tests cover pending read
cancellation, late completion and dispatched-write uncertainty.

This is a tracked-object reachability result. MEM02 already observed that
decoded buffers and reader objects could collect while raw responses were
rooted; the result does not establish a payload-byte, V8 heap-byte or RSS
saving. The direct low-level effect-adapter projector fixture still retains
four raw responses under an open budget, because it does not use the `ctx.fetch`
response reader. That path is outside this one cleanup. Real sockets, other
providers and deployed service memory are not measured.

## Reproduction

Run from the repository root with lockfile-pinned workspace dependencies:

```sh
node wasm/scripts/run-wasm-tests.cjs --task effect-retention-mem02 --no-report
node node_modules/vitest/vitest.mjs run packages/runtime/test
```

The first task launches Node with `--expose-gc` when needed. Its full atomic
report is written under `wasm/.test-results/compiler-efficiency/mem02/`.
The committed evidence retains the baseline/candidate source hashes, the
full candidate report hash, paired reachability rows, lifecycle parity and
limitations. MEM02's committed report remains the original pre-cleanup
baseline; the updated proof harness asserts the post-MEM04 lifetime.
