# STR-03 — generated output needs an explicit execution boundary

Status: **implementation incomplete; decision and feasibility evidence only**.
Base: `beta` at `447c8dfbe2c7b29ce19b36c28faf1aec86805ef4` (merged STR-02C).
No new authoring API, effect, capability, allocator behavior or provider support
is enabled by this change. Merging this evidence does not approve the proposal.

STR-03 asks for generated output and bounded transformations in separate PRs,
with actual Native lowering, first-byte-before-completion, demand/backpressure,
disconnect cleanup and bounded memory. STR-01 additionally requires defining
close/cancel, output and expansion limits, and continuation ownership before
implementation. This pass stops at that definition rather than silently widening
the work into a new allocator or scheduler. The user's earlier direction was to
surface work that grows beyond the bounded ticket.

## What the current code can and cannot supply

- Node JavaScript's `node-adapter.js` awaits application execution before calling
  `writeWebResponseToNode`. Its existing opaque stream can continue after the
  handler; that is provider-owned consumption, not resumed application production.
- The managed Native host drives effect suspensions to terminal completion and
  closes invocation authority in `finally`. Merely returning a stream wrapper
  would not keep an application continuation alive under that authority.
- `canonical-native-host.js` retains value handles in `ValueHeap`. Overwriting a
  guest local does not release its old host value. The existing read-loop budget
  is cumulative, deliberately never refunded, and applies to plans identified
  as bounded read loops. It must not be assumed to cover a new output path.
- STR-02's Node completion-aware writer is reusable transport infrastructure;
  it does not itself establish demand-driven application execution. Fastly's
  completion/handoff decision remains separately unresolved.

These are integration boundaries, not evidence that Native streaming is
impossible. A finite, cumulatively bounded output contract can be implemented
without changing allocation semantics. Constant retained memory independent of
stream length is a different guarantee and would require separate ownership work.

## Reproducible Native observation

Run from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task str03-native-retention
```

The probe compiles one canonical handler to actual Wasm, then injects existing
`kv.getVersioned` results through execution-owned tickets. It overwrites one
local on each read and returns only the last string. It exercises 1, 16 and 64
distinct 16 KiB values using the same module, checks successful completion and
rejects a stale ticket. It does not synthesize a streaming implementation.

| Values supplied | Final response bytes | Distinct retained payload bytes | Value handles | Cumulative accounted bytes | Guest linear memory bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 16,384 | 16,384 | 21 | 100,988 | 65,536 |
| 16 | 16,384 | 262,144 | 81 | 1,091,138 | 65,536 |
| 64 | 16,384 | 1,048,576 | 269 | 4,259,230 | 65,536 |

Observed module: 1,634 bytes, SHA-256
`0012d7fef80e054fc8d6cadda9cfa0f991564eaa0358e5c7ae548698ede6d0ab`.
Each replay keeps its Wasm, authored source and terminal report under a unique
`wasm/.test-results/str03-*` directory. Reports identify the source commit,
working tree, runner and fixture hashes, and exact module hash.

Accounted bytes are conservative policy charges, not measured RSS. The payload
column counts distinct string contents reachable in the host value table, not
physical allocations. This injected-host evidence is neither installed-consumer
acceptance nor first-byte, socket backpressure, cancellation or output qualification.

## Recommended decision: finite generated output first

Proposed scope for review: **Node Native and Node JavaScript, bounded UTF-8 text
output, one producer per HTTP request, no application stream objects**. The
following is a proposed contract, not an available API:

| Concern | Proposed rule |
| --- | --- |
| Authoring | Explicit `await ctx.output.start(options)`, sequential `await ctx.output.write(text)`, terminal `return ctx.output.close()`. Final names need API review. |
| Ownership | One request owns the output state and one in-flight write. No use in events, `ctx.parallel`, nested producers or background work. |
| Demand | A write effect suspends Native/JavaScript execution until provider demand permits acceptance. No eager execution of subsequent producer steps; no whole-body collection. |
| Chunk/output bounds | At most 16 KiB UTF-8 per write, 64 writes and 1 MiB total output, measured independently. Reject oversize writes; no implicit splitting that conceals allocation. These are initial ceilings to qualify, not established tuning results. |
| Retained memory | Activate explicit cumulative accounting for every output plan, including plans without storage-read loops. Start with the existing 64 MiB accounting ceiling and separately bound metadata, trace and linear memory. Do not claim constant memory independent of total output. |
| Queues | At most one pending Pulse chunk plus documented Node writer buffering. Transport and OS buffers are separately measured; no total RSS claim from guest pages alone. |
| Start | Validate status, headers, body eligibility, opt-in and deadline before committing headers. Reject caller framing/hop-by-hop headers; headers become immutable. |
| Close | Successful producer termination plus local writer completion under the inherited deadline. Local finish is not client receipt. An omitted close is an error, not success. |
| Cancel | Disconnect, deadline, output limit or producer failure invalidates outstanding tickets, destroys the writer and prevents another producer resume. Cleanup cannot mask the original failure. |
| Failure | Before headers: ordinary bounded error response. After headers: terminate the transport; no replacement status or error-handler output. No fallback to structured buffering. |
| Bodyless responses | Reject producer start for HEAD and bodyless statuses before producer work or header commitment; do not run a hidden producer to discard its output. |
| Deadline | Require a configured total request deadline, inherited through every write and local finish. Never restart it per chunk. |
| Admission | Explicit target capability and project opt-in. Unsupported targets fail during normal inspection/build; do not infer support from opaque pass-through. |

This introduces a partial-response execution state, so it crosses the public
API, effect, continuation, provider and configuration contracts. It is not an
incidental extension to `ctx.text`. Normal finite handlers must preserve their
existing terminal behavior. No allocator reclamation, guest-link optimization,
Fastly promotion or MCP SSE is implied.

## Bounded implementation sequence

| Ticket / PR | Deliverable and completion gate | Effort |
| --- | --- | --- |
| STR-03A | Generated-output contract above, runtime ownership, compiler lowering, capability admission and Node writer integration in one vertical slice. Real Native execution must emit a prefix while later application production is blocked, and must not advance while the writer is blocked. Serialize shared compiler edits with the active optimization lane. | L |
| STR-03B | Independent installed-consumer qualification of A: doctor/inspect/test/build/dev, exact Wasm identity, real sockets, 1/16/64 chunks, slow clients, concurrent request isolation, pre/post-header failures, HEAD/bodyless rejection, disconnect, deadline during write and finish, limit edges, stale tickets and retained host/guest/queue measurements. A remains experimental until these gates pass. | M |
| STR-03C | Separate bounded-transform contract and implementation. Select byte representation and allowed transformation first; declare independent input/output caps and a measured expansion ratio before enabling. Reuse A's ownership/completion semantics, then prove actual Native transform execution and transport backpressure. | L |

Alternative: if the requirement is arbitrarily long output with a constant
working set, split off a compiler/runtime ownership ticket first. It must prove
safe release of dead values while retaining live aliases, pending effect
payloads and resumable locals. No host table clearing or budget refund is safe
merely because one write completed. That would require explicit coordination
with the optimization lane and is outside this evidence patch.

The selected MCP milestone is finite JSON tools. Do not add SSE or advertise
streaming MCP capabilities through any of these cards without a separate
protocol-profile selection. Fastly remains gated by STR-02C's reviewed handoff
contract and target-specific qualification.
