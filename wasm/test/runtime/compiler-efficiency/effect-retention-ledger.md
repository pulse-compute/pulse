# MEM02 — effect and continuation retention ledger

Evidence-only, 2026-09-25. Entry point: `runtime-effects`.
Base: `adb32f4` (merged MEM01). No production source, ownership policy, trace
truncation, registry deletion, ABI, or reclamation change is included.

## Decision

Recommend one bounded MEM04 cleanup: release a **consumed JavaScript fetch
response's request-budget cancellation registration**, including the budget's
own callback bookkeeping. This concerns the shared runtime executed on Node;
Node Native's structured-fetch transport has a different ownership path.

The 64-read JavaScript fixture retains 64 raw Web `Response` objects after their
text projections settle. They remain reachable after effect-adapter disposal
while the inherited request budget remains open. Closing that budget makes all
64 collectible. The no-budget control retains zero raw responses. Separately,
calling the budget's returned unsubscribe removes the signal listener but leaves
the callback reachable through the budget's `listeners` array until `close()`.
Unsubscribing from the signal alone therefore cannot deliver the proposed fix.

This is a response-wrapper/callback result, **not proof of retained decoded
buffers**: all four tracked structured readers and decoded `ArrayBuffer`s in the
focused control are collectible even while its four raw responses remain rooted.
MEM04 must measure its actual benefit and must not promise payload-size savings.

For MEM05, investigate **completed sequential-read result containers that have
no carried, pending, response, or diagnostic aliases**. The Native fixture keeps
all 64 result graphs rooted in `ValueHeap`, including earlier iterations. Its
first result is deliberately carried to the final response, so reclaiming every
settled result would be incorrect. The mutable `state`/`alias` pair also survives
all resumes. This identifies a candidate class, not an approved release point or
an implementation-ready liveness proof. KV redaction sets additionally retain
string leaves; removing a container root need not release its text.

## Reproduction and evidence

Run from the repository root with the lockfile dependencies restored:

```sh
node wasm/scripts/run-wasm-tests.cjs --task effect-retention-mem02 \
  --report .test-results/mem02-proof.json
```

The opt-in task launches Node with `--expose-gc` when needed and writes the full
stage report under `wasm/.test-results/compiler-efficiency/mem02/`. It is outside
the normal release profiles because explicit-GC reachability is diagnostic
runtime evidence. `effect-retention-evidence.json` contains the accepted compact
report, with sampled stage rows and exact harness, production-source, fixture,
Wasm, and toolchain identities. No private consumer fixture is used.

Accepted toolchain: Node 24.19.0 / V8 13.6.233.17-node.51, AssemblyScript 0.28.18.
The same unmodified Wasm is used for public-controller stepping and the complete
managed-host execution. They have identical responses and value-handle counts.
Stepping omits the managed driver's continuation/trace/redaction bookkeeping;
its lower accounting total must not be interpreted as an optimized runtime.
Neither path injects production hooks or modifies provider sources.

Five explicit collections separated by event-loop turns precede each WeakRef
sample. The probe stores weak references and scalar counters, not retained
payload snapshots. The controller is intentionally strongly held for the
closed-owner sample, then released for the owner-release control. Measurements
of handles, counters and trace JSON sizes are deterministic structural evidence;
WeakRef observations depend on the specified Node/GC environment. Process
memory is supplemental and cannot establish a leak or a byte saving.

## Lifecycle ledger

| Stage / root | Owner and contents | Observed end of ownership / constraint |
|---|---|---|
| Admission | Request/frame, request budget, abort controller, optional deadline timer, context state; Native controller adds guest memory and `ValueHeap` | Request owner closes its budget. An inherited budget belongs to the outer host, potentially through response writing. |
| Dispatch | JavaScript pending-effect map owns promise and descriptor; descriptor may own outbound payload. Native queue/driver owns payload handle, normalized descriptor and invocation ticket | JavaScript `trackEffect` removes the promise on settlement; Native drains its queue and consumes the authenticated active ticket before guest result insertion. Handle-table roots remain. |
| Suspension | Guest locals/handles, carried aliases, one waiting continuation; parallel group additionally owns all member promises/results until the group settles | Resume requires every group member to settle; declaration order determines reconstruction and primary failure, even when completion order differs. |
| Effect settlement | Normalized result enters Native heap; JavaScript promise holds its result if an application alias still owns that promise | Active ticket/pending entry is consumed, but settlement does not prove the result is dead. Native setter rejects duplicate/stale tickets before allocation. |
| Structured projection | Reader owns cached byte/text/JSON promises; response metadata WeakMap owns projection caches while wrapper is alive | Read completion removes its reader abort listener and releases reader lock. Reader and decoded buffer collect when wrapper/projection aliases disappear. Raw response has a separate budget-callback root. |
| Continuation resume | Reused static Native slot, distinct invocation identity, carried locals, result handles; completed continuation metadata enters returned evidence | Static slot reuse does not reclaim old value handles. First-result alias and mutable carried state remain valid in the fixture. |
| Trace and redaction | Native returned envelope owns copied trace and continuation records; controller redaction set owns sensitive string leaves. Generator runtime owns registry plus aggregate trace | Native envelope retained by a caller is caller-owned evidence. Shared generator records persist with that runtime; removing them would alter diagnostic history. Redaction roots must be included in future liveness proofs. |
| Response handoff | Returned structured response or opaque stream/body owner | Successful opaque transfer keeps bytes readable after budget close. Consumer cancellation, not successful handoff, closes that stream in the control. Actual socket writer is outside this fixture. |
| Failure / timeout / cancellation | Budget revokes authority; effect races reject; active tickets are invalidated; provider gets aborted signal | Exactly one provider disposal per managed fixture. Late resolve/reject does not resume execution or change its terminal evidence. Late JavaScript response bodies are cancelled. Dispatched writes are not rolled back. |
| Execution disposal | JavaScript execution removes source listener and invokes adapter disposal; Native controller closes tickets and pending queue | Disposing execution does not close an inherited budget. Native `close()` does not clear heap; dropping the controller releases the tracked graph roots. |
| Budget disposal | Removes listeners and timer, empties callback bookkeeping | Consumed-response roots collect. No surviving raw responses in the repeated owned-budget JavaScript runs. |
| Provider resources | Injected adapters and synthetic streams in this experiment; real sockets/handles remain provider-owned | Counts here cover timers/listeners, disposal, body cancellation and tracked objects, not network pools, real sockets, Fastly handles or deployed host resources. |

## Growth within one request

The bounded Native KV fixture varies chain length independently of its literal
64-iteration cap. Its result contains `next`, `tag`, and unique text. The response
uses only the visit count, mutable carried state and the first result's tag.

| Reads | Text bytes/read | Native handles | Rooted result graphs | Logical payload UTF-16 bytes | Managed cumulative PS3 bytes | Managed trace entries | Continuations |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 256 | 29 | 1 | 512 | 6,914 | 7 | 1 |
| 8 | 256 | 64 | 8 | 4,096 | 35,012 | 42 | 8 |
| 32 | 4,096 | 184 | 32 | 262,144 | 377,530 | 162 | 32 |
| 64 | 4,096 | 343 | 64 | 524,288 | 752,266 | 322 | 64 |

Closing a still-owned controller leaves these handles/graphs unchanged. After
releasing it, the tracked controller and every tracked result graph are
collectible in every case. Wasm capacity stays 65,536 bytes throughout; these
payloads reside in the Node host heap. Logical string size and PS3 accounting
are **not** measured V8 live bytes and must not be summed as distinct allocations.

The managed trace is 56,291 serialized JSON bytes at 64 reads. That is a diagnostic
representation size, not heap size. Conditional KV traces redact result values;
the registry/trace figures do not imply a second complete payload copy.

| JavaScript text projections | Raw responses after effect disposal | Abort listeners after effect disposal | Responses / listeners / timers after budget close |
|---:|---:|---:|---|
| 1 | 1 | 1 | 0 / 0 / 0 |
| 8 | 8 | 8 | 0 / 0 / 0 |
| 32 | 32 | 32 | 0 / 0 / 0 |
| 64 | 64 | 64 | 0 / 0 / 0 |

One request deadline timer remains until budget close. The JS fixture's inherited
budget models an outer host that still owns the execution through handoff. This
is temporary request-owned retention, not evidence of cross-request leakage.
The direct adapter control without a budget retains zero responses while the
same control with a budget retains four. Neither retains the tracked projection
readers or decoded buffers after those projection owners are dropped.

## Growth across completed requests

| Completed requests, four reads each | Native result envelopes still reachable after caller drops them | JS raw responses still reachable after owned-budget close | Shared generator registry records | Registry transitions | Shared runtime trace entries |
|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 4 | 16 | 22 |
| 4 | 0 | 0 | 16 | 64 | 88 |
| 16 | 0 | 0 | 64 | 256 | 352 |

Shared generator diagnostic serialization grows from 7,744 to 123,926 bytes in
this sample. Its registry contains IDs, timestamps, state history and normalized
error names, not payload graphs or result objects. The runtime intentionally
owns that registry and aggregate trace across calls. The earliest completed ID
still rejects duplicate resume. This is a distinct owner lifetime from Native's
per-request returned evidence and must not be labelled a production Native leak.
Dropping Native result envelopes proves only their tracked reachability; the
separate controller-release control establishes the tracked value-graph lifetime.
No assertion here proves zero surviving objects throughout the entire process.

## Lifecycle and negative controls

Sixteen managed lifecycle cases cover a sequential read after one successful
iteration, a two-member Native group, and JavaScript groups/bodies: success,
effect failure, total-request timeout, cancellation followed by late success or
late failure, and opaque response transfer. The successful group deliberately
completes right before left but reconstructs left/right in declaration order;
Native failure selection remains left-first. Conditional KV provider failure is
a typed failed read, so its handler can normally return `unavailable` rather than
throwing a runtime error. Duplicate Native settlements cannot insert a value.

Registry controls separately preserve completed, failed, expired and cancelled
states, including the stable expired/double-resume failures. Timer count reaches
zero after budget disposal. Listener samples after GC exclude Node's weak
Request-following callback once its Request owner is collectible.

Development retries: the first two runs expected zero listeners immediately
after budget close. Inspection identified Node's weak Request-following callback,
which collects with its Request; the fixture now samples after the same explicit
GC protocol as its other reachability controls. Production behavior was not
changed. These failed reports remain under the ignored result directory; the
committed report comes from a complete passing replay.

## Validation

The complete registered MEM02 task passed. The full unit profile passed 34/34;
the six selected runtime-entry tasks passed 6/6; runtime package Vitest passed
71/71 across six files. The TypeScript workspace build, maintainer check and
scope classifier passed. The classifier selects maintenance-policy and unit
for these five evidence files; no production/protected boundary is touched.

The initial unit profile stopped at missing generated crypto output in the
fresh worktree; the normal TypeScript build and complete unit replay passed.
The installed pnpm launcher was 11.19.0, below this repository's required
^12.4.2 range. TypeScript and Vitest were invoked directly from the existing
lockfile-resolved workspace dependencies, without relaxing the engine policy
or changing dependency files. Failed attempts remain separate from acceptance.

## Follow-up boundaries

MEM04 should couple successful/failed structured-reader finalization to release
of the raw response's cancellation registration and remove the corresponding
budget bookkeeping root. It must retain cancellation while a body is unread or
being read, keep repeated projection caches valid, preserve opaque ownership
through the writer, and cancel late responses after failure. Preserve pending
checks, deterministic group failure, all evidence, and write-uncertainty semantics.
Do not change providers or general value lifetimes in that cleanup.

MEM05 must prove a region boundary for an overwritten read-result container,
including guest locals, nested/container aliases, pending payloads/results,
response roots, schema caches and redaction/diagnostic roots. It must preserve
cumulative accounting without refunds and reject stale handles without reuse.
No recommendation to delete trace/registry records follows from this evidence.

Provider comparison is read-only: Node Native structured fetch releases the
reader lock/listener in `readStructuredResponseText` and its operation timer and
source listener in `executeLiveFetch`'s `finally`; opaque bodies instead register
budget cancellation until handoff. Fastly uses static ticket slots cleared at
settlement/close and its invocation-owned value table remains rooted. MEM01 owns
the measured Fastly graph evidence. MEM02 makes no Fastly execution claim.

Source owners: `packages/runtime/src/internal/{effect-adapter,request-budget,body,
response,router,conditional-kv}.js`; `wasm/packages/host-runtime/src/runtime/
{canonical-native-host,canonical-api-runtime,continuation-registry,effect-invocations,
native-value-budget}.js`; provider comparisons in
`packages/provider-node/src/runtime/canonical-api-runtime.js` and
`packages/provider-fastly/src/build/effect-invocations.js`.
