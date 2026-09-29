# STR-01 — body ownership and the next streaming increment

Selected design for review, 29 September 2026. Baseline:
`beta` at `a8ab5b0f34d2846270275a26274d6f42e7eded51` (includes RT-01 and JWT-01).
This freezes the requirements and implementation sequence for STR-02. It does
not add an authoring API, change a supported target, or certify deployment.
Human review of this PR remains the design decision gate.

## Decision

Start with **one incoming opaque body forwarded to one outbound POST**, with
provider-owned I/O and an ordinary opaque response. No application chunk API,
tee, replay, retry, buffering fallback, generated output, or transform enters
STR-02. Do not expand the currently admitted outbound method set incidentally.

The selected future spelling is `ctx.fetch(url, { method: 'POST', body:
ctx.req.body() })`. `ctx.req.body()` is a synchronous, opaque ownership marker,
not a reader and not a Promise. Initially it is admitted only inline in that
fetch body position. It cannot escape into state, arrays, closures, package
effects, event handlers, a response constructor, or a userland stream. It is
mutually exclusive with `json` and `schema`. This spelling is **not implemented**
by this PR. Existing source continues to fail eligibility normally.

The first vertical slice is Node JavaScript through the normal installed CLI
workflow and real loopback HTTP. Node Native follows with the same source and
provider-owned handles. Fastly Native follows only after a bounded hostcall
feasibility check. Fastly JavaScript remains unqualified for this new operation:
its existing total-deadline restriction cannot be hidden by Node fixtures.
These are sequential STR-02 implementation PRs, not automatic target promotion.

## Current facts and limits

| Seam | Current evidence | Implication |
| --- | --- | --- |
| Public request/fetch types | `packages/runtime/src/index.d.ts`: request text/JSON; fetch text/JSON body only | No incoming opaque body API exists. |
| Node JavaScript admission | `nodeRequestToWebRequest` in `packages/provider-node/src/javascript/node-adapter.js` awaits `readNodeRequestBody` and concatenates chunks | Even an early application denial currently follows complete bounded buffering. |
| Node Native dev admission | `readRequestBody` and the HTTP callback in `wasm/packages/cli/src/project-execution.js` buffer before execution | A new descriptor alone cannot make the HTTP path incremental. |
| JavaScript response writer | `writeWebResponseToNode` uses a Web-to-Node pipeline | A gated source/sink probe demonstrates incremental output and finite prefetch for that fixture. |
| Native CLI response writer | `wasm/packages/cli/src/internal/node-http.js` starts `pipe()` and returns synchronously | Handler/pipe return does not prove writer completion, cancellation coverage, or post-handoff deadlines. |
| Fastly Native body handles | `packages/provider-fastly/src/build/native-http-effects.js` retains the incoming handle, but creates/writes a separate outbound body before `send_async` | Handle transfer is a candidate mechanism, not proof of incremental upload, queue bounds, cleanup or deadlines. |
| Existing opaque response | `assert-canonical-opaque-passthrough.cjs` retains identity, binary bytes, repeated headers and continuation order | Preserve this path; the fixture is not a live Native transport or bounded-memory certification. |
| Managed lifecycle | RT-01 in `packages/runtime/test/request-budget.test.ts` | Reuse cancellation/late-result fencing and abandoned-body cleanup. Do not extend the buffered HTTP deadline guarantee by inference. |

## One owner, one terminal disposition

Ownership is an execution-local record, separate from effect invocation tickets.
A ticket authorizes one completion; a body record authorizes one byte consumer.
An application-visible marker is not a host object or serializable handle.

| State | Owner and allowed next step | Forbidden |
| --- | --- | --- |
| Available | HTTP admission owner; may reserve structured read or forwarding | Eager read merely to build the context; sharing across requests |
| Structured | Existing request reader owns one bounded snapshot/cache | Forwarding afterward, including after a failed or partial read |
| Reserved | One admitted fetch descriptor owns the incoming source | A second consumer, projection, clone or group member claiming it |
| Forwarding | Provider transport owns reading and upstream writing | Unbounded prefetch, replay on redirect/retry, application access |
| Closed | EOF and transport completion have discharged local ownership | Reuse or resumption of a terminal effect |
| Cancelled/failed | Terminal local disposition; cleanup attempt recorded once | More reads/writes, returning to Available, application recovery that retries the body |

Validate method, destination/provider eligibility, bindings, headers and limits
before reservation. Claim atomically before any body read or outbound dispatch;
if an effect group is used, validate **all** body claims before dispatching any
member. Reject duplicate claims rather than racing to pick a winner. Static
analysis rejects obvious conflicts; the execution record remains authoritative
for loops and paths the compiler cannot disambiguate. Reservation failure has
no body/network effects. Failure after reservation cancels the source, even if
no bytes were sent. Repeated structured reads retain their existing cache rules.

Authentication may suspend before reservation without reading the body. Only
the host retains the source while application control is suspended. The same
record survives a fetch suspension, and is fenced by execution identity on
resumption. Late results are disposed without resuming user code. A Native
guest may retain an execution-local token, never a JS object, pointer into
another request, or a body snapshot in its ordinary value heap.

Opaque response ownership is distinct from incoming upload ownership. Returning
a response transfers it once to the HTTP writer; it does not discharge an
unfinished upload. If the origin responds early, STR-02 cancels the remaining
upload and stops reading the client. A denied, abandoned, unmatched or bodyless
request is cancelled without an unbounded drain. The provider may close the
connection; connection reuse is not a reason to violate the byte/time bound.
For HEAD and statuses that prohibit a body, suppress and dispose of an owned
response body. Cleanup never introduces a compensating write.

## Demand, bounds and time

The first slice requires an explicit finite transfer limit and the existing
provider-owned total request budget. No unbounded default, caller header, or
operation retry may enlarge either. Configuration names/schema belong to the
STR-02 owner; this design does not quietly add project fields.

For the initial provider pump, select **16 KiB maximum emitted chunks** and a
**64 KiB maximum Pulse-managed queue per direction**. Read only when destination
demand permits; keep at most one pending read and one pending write per pump.
Do not retain all chunks, concatenate them, or call whole-body conversion APIs.
Count actual encoded bytes, including when content length is absent or false.
Reject a declared over-limit length before dispatch; stop when measured bytes
cross the limit. An oversized host chunk needs a bounded source contract or
explicit rejection: slicing views cannot make its retained allocation disappear.

These limits are requirements for the new pump, **not measured properties of
today's pipeline or platform buffers**. Account separately for source buffers,
destination buffers, in-flight chunks and platform-owned storage. A queue limit
alone is not an RSS or guest-memory guarantee. STR-02 must record those terms
and a size-independent high-water mark across 1, 16 and 64 MiB inputs. If a
provider cannot enforce/observe a required bound, keep the target ineligible or
return with a separately reviewed narrower guarantee; never claim zero-copy.

One admission budget covers authorization, reservation, upload, origin waiting
and all locally owned response writing. Use the earlier operation/request
deadline. Check before dispatch, after readiness/settlement, before resuming,
and before final handoff. The HTTP writer retains cancellation until its local
completion signal, even after handler return or response headers. EOF ends a
source, not necessarily the destination writer. A deadline, disconnect, failed
read/write or early origin response cancels pending local work and releases
listeners/timers. Cleanup rejection is observed; stalled cleanup cannot prevent
terminal completion. Exactly-once disposition means one logical transition and
at most one cleanup invocation, not proof that a remote server stopped.

Before committed response headers, failures use the existing bounded HTTP
error policy (deadline 504, transfer-size rejection 413; other mappings remain
owned by their existing boundary). After commit, abort the unfinished response;
do not synthesize a second response, append an error document, or report a clean
end. Record only bounded diagnostic metadata and byte counts, without body or
secret contents. Post-dispatch failure never proves that an upstream write was
rolled back. These are cooperative deadlines, not CPU preemption or proof of
client receipt. A platform handoff with no remaining completion authority must
be recorded explicitly and cannot claim continued Pulse deadline coverage.

## HTTP and security boundary

This increment forwards bytes, not the inbound request wholesale. The
application still chooses the destination, method and permitted headers through
existing provider authority. Do not copy client authorization, cookies, Host,
hop-by-hop headers, framing headers, or trailers implicitly. The provider owns
outbound framing; forwarded content length must not be trusted as a byte meter.
Preserve binary bytes without UTF-8 decoding or implicit compression changes.
Disable automatic redirect/body replay for this single-use operation. Ordinary
existing text/JSON fetch behavior is unchanged. Transport retries require a
separate replayable-body design and are excluded here.

## Cross-lane integration map

| Owner / touchpoint | Required STR-02 change | Gate |
| --- | --- | --- |
| Runtime public types, request context and effect adapter (`packages/runtime/src/`) | Opaque marker, single-owner record, group preflight, terminal disposal | Public API/effect review; no provider object enters user code |
| `surface-contract.js`, compiler spine and Native plan | Recognize only the admitted body marker; carry source identity in fetch metadata; reject unsupported use | Coordinate with `latest` before edits; preserve optimizer and shared-stage work |
| `canonical-runtime.js`, `canonical-native-runtime.js`, managed Native host | Pin descriptor/version compatibility; separate body identity from single-use invocation ticket | Inspect whether existing handle imports suffice; never silently reinterpret an ABI field |
| Node provider and CLI HTTP owners | Lazy incoming adaptation, provider pump, non-replaying fetch, completion-aware writer | Real HTTP plus installed doctor/inspect/test/build/dev; direct runtime injection is insufficient |
| Fastly Native build, capability descriptor, host fixture | Prove handle/pump readiness, early-response behavior, bounds, close/cancel and completion | Separate bounded feasibility before implementation; exact emitted Wasm plus actual platform evidence before deployment claims |
| Provider configuration/schema and diagnostics owners | Explicit limits, target admission, actionable ownership/limit errors | Generated references synchronized; no broad capability flag that admits unproven targets |

Changing descriptors, imports or memory ownership is a semantic contract change,
even if no Wasm ABI version bump turns out to be necessary. STR-01 makes no such
change. Guest linking, allocator tuning, code sharing and benchmark sweeps stay
in `latest`. No merge/cherry-pick or cross-branch authority is implied.

## Bounded implementation cards and completion gates

1. **STR-02A — Node JavaScript vertical slice (M).** Implement only the selected
   marker and ownership contract, lazy HTTP input and bounded provider pump.
   Prove origin receives a byte before client EOF; slow producer/consumer demand;
   byte equality at increasing sizes; unknown/false content length; duplicate
   claim and read/forward exclusion before effects; authorization denial before
   reads; empty/bodyless/abandoned input; early origin response; disconnect,
   deadline and post-header failure; redaction and per-request isolation.
2. **STR-02B — Node Native integration (M).** Same source and tests, ordinary
   compilation and installed execution, exact emitted Wasm identity, host-owned
   bytes, suspension/ticket fencing and completion-aware response ownership.
   No special proof runner or JavaScript fallback. Serialize shared compiler
   work with `latest` before starting.
3. **STR-02C — Fastly feasibility then integration (M, split if needed).** First
   establish the real hostcall contracts and platform buffer/completion limits.
   Do not assume passing an inbound handle to `send_async` satisfies this design.
   If it cannot, return a bounded decision card; do not expand into a scheduler
   or ABI redesign. Keep Fastly JavaScript's deadline eligibility truthful.

Suggested effort for these implementation cards: Astra/high; use xhigh only
for a separately identified ABI or lifecycle decision. STR-03 remains separate
generated-output and bounded-transform PRs. It must define output close versus
cancel, maximum output/expansion ratio, demand-driven continuation ownership,
and real Native first-byte/backpressure evidence before implementation. No SSE,
MCP capability advertisement, subscription, duplex application interaction,
trailers, resumability or background body processing is selected by STR-01.

## Evidence and reproducibility

Run `node wasm/scripts/run-wasm-tests.cjs --task canonical-opaque-node-emission
--no-report` on one line. Its existing response identity/bytes/header and
continuation checks now include `body-stream-feasibility.cjs`:

- current Node admission waits for EOF and preserves binary request bytes;
- canonical fetch rejects a non-string body handle;
- a blocked Node JavaScript writer stops pulling after finite fixture prefetch
  and writes before source completion;
- abort cancels the source once and destroys the blocked writer;
- source failure after the first write preserves the status/prefix and fails
  the writer without a successful finalization;
- Native CLI emission returns before its stream finishes.

The destination is an instrumented Writable, not a real HTTP socket. The
256 KiB probe chunks characterize the existing pipeline; they do not meet or
validate the proposed 16 KiB pump contract. The probe neither implements the
future API nor models it with a second fake runtime. Existing RT-01 tests cover
ownership conflicts, retained final responses, abandoned/late bodies, deadline
fencing and cleanup. Run the runtime package tests for those assertions.
Fastly source inspection is feasibility inventory only. Large upload and actual
Native/Fastly incremental transport acceptance remain STR-02 gates.

Record terminal test outcomes, clean source/tree identity and the PR's base/head
in the review handoff. No release seal, publication or live deployment is part
of this card.
