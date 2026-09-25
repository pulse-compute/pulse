# MEM05 — one conditional-read envelope lifetime

Entry point: `runtime-effects`. Class: evidence and architecture proposal.
Base: merged GEN04, `b1049ca`. Production runtime, compiler, providers and
current PS3 contracts are unchanged. This proposal requires human approval
before MEM06 implements reclamation.

## Decision

The existing Native ABI v2 can support **retiring the outer normalized
`kv.getVersioned` result envelope at the next suspension of the same certified
sequential-read site**. It needs a fail-closed plan eligibility proof and host
bookkeeping, but no guest root-enumeration ABI or general tracing collector for
this class. A completed settlement is too early: the continuation still needs
the envelope to bind its result and read its properties.

This is a deliberately small candidate. It removes an obsolete envelope's
strong table root, not all the read's data. The fixture reads `row.value` in
every iteration, creating independent payload handles. Those payload graphs
remain retained, including the first payload carried to the final response.
This proof establishes no payload-byte, RSS, or Wasm-capacity improvement and
does not justify broader graph reclamation.

Recommendation for MEM06: implement this only as the first bounded lifetime
mechanism if its modest reachability benefit is worth the eligibility and
accounting complexity. Keep graph reclamation as a separately reviewed design.
Approval of this evidence PR alone must not be interpreted as approval to ship
reclamation or change the current `retain-until-terminal` policy.

## Selected value and region

The selected value is the **fresh, immutable outer record** produced by
`normalizeConditionalKvResult` for one `kv.getVersioned` invocation: a `found`,
`not-found`, or `failed` envelope. Its `.value` is a detached JSON graph. The
envelope has only validated own data properties; normalization cannot create a
back-reference from that graph to the new envelope.

Eligibility is conservative and applies to the entire static site:

- One plain handler, one bounded read loop and one bound `kv.getVersioned` site;
  the read is the first statement of every loop iteration. No parallel group,
  other effect site, helper-handler transfer or nested read loop qualifies.
- The result binding is immutable. Every reference to the envelope is a direct
  read of `status`, `reason`, `generation` or `value` inside that iteration.
  Taking the envelope itself, unknown property access, mutation through it,
  use in the loop test/increment, effect inputs, or outside the loop declines
  the certificate. The miniature recognizer is evidence, not a shipped analyzer.
- A child read may escape. Its own handle/root is retained. An envelope alias
  in a local, container, request state, effect payload/result, response, schema
  cache or diagnostic root disqualifies the envelope. No dynamic alias discovery
  or traversal of the whole heap is proposed.
- The host must use normal conditional-KV normalization and the trusted,
  matching plan/artifact. Custom hosts holding raw handles or injecting arbitrary
  object graphs are outside this opt-in lifetime. Unknown or stale metadata
  must retain values using today's behavior.

The region starts when a valid invocation ticket inserts the normalized result.
It remains live through settlement and through every operation of its resumed
iteration. A release opportunity exists only after `resume()` returns
`SUSPENDED` with one **new ticket at the same certified effect and continuation
state**. The existing generated suspend block clears that effect's result slot;
the next resume binds the new result before the body reads the result local.
The old local's numeric bits may still exist, but the certificate proves there
is no future legal read of those bits. This is dead-use reasoning, not an ABI
claim that the host can enumerate or clear every guest global.

The last envelope is retained through terminal response handoff and owner
disposal. There is no terminal sweep in this proposal. If an error, cancellation,
deadline or memory failure prevents the next certified suspension, it also
prevents that release opportunity. Existing terminal fences continue to reject
late results before insertion. A released wrapper cannot undo any dispatched
operation; this pass selects reads only.

## Root and ownership table

| Root or representation | Rule for the proposed envelope lifetime |
| --- | --- |
| Guest effect result slot and bound local | Live at settlement. Next same-site suspension plus overwrite-before-use proof makes the previous envelope dead. ABI exports alone do not prove this. |
| Carried envelope local | Reject eligibility, including aliases that appear unused in this small recognizer. |
| Object/array containing envelope, request state, nested alias | Reject any escape of the envelope. Do not erase a container edge to make it eligible. |
| Carried `.value` or nested child | Keep its independent handle and graph. Child lifetime is not inherited from the envelope. |
| Pending descriptor/payload and queued results | Reject an envelope escape. The prior managed driver's `settled` array can additionally hold the envelope until that JavaScript loop turn ends; table eviction is safe but collection may be delayed. |
| Response and opaque body | An envelope escape rejects eligibility. Child payloads and response/body ownership remain intact. No host resource close is part of envelope retirement. |
| Schema preflight/codec and projection caches | Passing an envelope is an escape. Child inputs, frozen decoded values and guest codec allocations retain their existing owners. |
| Trace/continuation records and redaction | Preserve all records and charges. Managed conditional-KV results are redacted, so normal traces do not hold the original envelope. Redaction strings can remain live independently of its container. Custom envelope-bearing diagnostics decline eligibility. |
| `ValueHeap.values` | Remove only the certified envelope's exact entry; retain all child and scalar entries. |
| `ValueHeap.identities` | Delete the envelope's weak reverse mapping too; otherwise reinsertion returns the retired handle. Do not reset the cumulative index-growth count. |
| Scalar index, budget WeakSet | Leave them intact. The WeakSet is not a strong root. No PS3 accounting or scalar-cache capacity is refunded. |
| Caller-held controller or trusted raw ABI handles | No implicit reclamation for this usage mode. The proof explicitly opts into diagnostic retirement on its own controller. A shipped managed path needs a separate compatibility/eligibility gate. |

## Handles, counters and ABI determination

Retirement deletes the map entry and its matching object-identity cache entry.
IDs remain monotonically allocated; `next` never decreases and an ID is never
reused within the execution. `get(retiredHandle)` continues to use the existing
`PULSE_CANONICAL_NATIVE_VALUE_HANDLE_INVALID` failure. Reinserting a still-held
object gets a new handle and incurs the normal cumulative charges. The existing
PS3 value ceiling bounds eligible execution IDs below signed i32 exhaustion.

Memory bytes, value/edge charges, scalar capacity, and identity-index growth
charges remain cumulative. A latched budget failure still rejects cached and
new puts after retirement. No iteration boundary resets the budget.

There is one diagnostic issue MEM06 must address explicitly: today's
`ValueHeap.size()` is the map size, and the managed response's `valueHandleCount`
uses it. After retirement that would become a live-entry count and silently
change the observable metric. MEM06 must preserve the existing cumulative handle
count (equivalent to `next - 1` in this bounded execution), with any live-entry
counter separately named and scoped. The oracle compares cumulative allocations
and charges exactly and reports live entries independently.

The positive proof uses one unmodified, validated production Wasm artifact for
both variants, with identical imports, exports, plan hash and ABI version. It
uses existing `pendingEffects`, `continuationState`, `resume`, and ticket
settlement seams. This proves feasibility for this narrow class. It does not
prove a host-only policy for arbitrary local or container graphs: the current
ABI has no complete guest-root enumeration or last-use notification. If broader
reclamation requires tracing GC or new guest exports/imports, stop and propose
that separately.

Fastly remains read-only comparison. Its value table and pending payload/ready
arrays hold AssemblyScript references, and its handle lookup does not implement
this proposal's tombstones. MEM01 showed those table roots survive collection.
The Node proof is not permission to delete Fastly array entries or to infer that
AssemblyScript will collect their backing allocations. MEM07 must supply its
own ownership and stale-handle proof after MEM06 is approved and qualified.

## Executable oracle and measured result

```sh
node wasm/scripts/run-wasm-tests.cjs --task temporary-value-lifetime-mem05 \
  --report .test-results/mem05-proof.json
```

The opt-in task launches Node with `--expose-gc` and writes a terminal report
under `wasm/.test-results/compiler-efficiency/mem05/`. The committed
`mem05-lifetime-evidence.json` is its compact result with harness, production
source, lockfile, fixture, toolchain and Wasm identities. Production is not
patched. The oracle deletes entries only in its explicitly owned diagnostic
controller and checks the same compiled module against retain-all controls.

Six paired cases cover 1, 8 and 64 reads, a failed second read, cancellation
and request deadline expiry before the second settlement. Responses, normalized
effect/continuation boundary observations, controller trace, cumulative handle
allocations, PS3 charges and Wasm capacity match each pair. Duplicate, copied,
old-visit and terminal tickets cannot allocate a result. Timer disposal is also
checked for the deadline case.

| Successful reads | Cumulative handles, both variants | Live entries, retain / diagnostic retire | Live envelopes, retain / retire | Live payload graphs, both | Cumulative PS3 bytes, both |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 29 | 29 / 29 | 1 / 1 | 1 | 11,418 |
| 8 | 64 | 64 / 57 | 8 / 1 | 8 | 73,928 |
| 64 | 343 | 343 / 280 | 64 / 1 | 64 | 574,518 |

All tracked envelopes except the last become collectible in the successful
diagnostic variant. Carried payload identity remains valid through all resumes.
This is a tracked-object reachability result after five explicit collections
separated by event-loop turns, not allocated heap bytes. Wasm capacity stays
65,536 bytes. No payload graph is reclaimed in these fixtures.

Twelve negative controls include real compiled carried-local, container-alias
and response escapes; five explicit plan-model roots for pending payload,
pending result, schema cache, diagnostics and request state; a multiple-effect
case; premature settlement release; stale identity-cache resurrection; and
unrefunded terminal accounting. The model-root cases establish rejection by the
miniature rule, not support for corresponding invented source syntax.

The oracle's controller trace does not contain the managed driver's complete
continuation/trace history. MEM02 is the existing managed lifecycle evidence;
MEM06 must replay it and add full managed retain/retire trace equality before
shipping. This pass does not prove zero surviving objects outside the tracked
set, production live bytes, repeated-request savings, provider resource release,
or deployed behavior.

Validation on the proposal worktree: the six-pair/twelve-negative oracle passed,
the portable unit report completed all 34 selected tasks with terminal status
`passed`, the workspace TypeScript build passed, and maintenance policy and
scope checks passed. The scope declaration intentionally requests human review
of a continuation-lifetime design even though the changed paths are evidence.

## MEM06 acceptance gate

Human approval must select this exact envelope class and its eligibility gate.
Implementation must preserve the source/plan/artifact binding, fail closed for
unknown plans, keep raw-controller behavior explicit, and distinguish cumulative
diagnostics from live entries. It must add managed-driver parity and ownership
evidence, stale-handle rejection including reverse-cache eviction, no early
release of aliased payloads, and unchanged error/deadline/cancellation behavior.
Any proposal to release child handles, refund accounting, reuse IDs, drop trace
history, sweep at terminal return or extend to other providers is outside this
decision.
