# RA-00 — ownership inventory

Status: **complete, evidence only**. Human direction: “Implement RA-00.”
Inspected base: `3ac02b2df56f95b47b8a92b5c4633dbe0e1fde7d`, `hex-integration`
after #525. No single named Entry Point covers this cross-owner internal audit;
ordinary root/docs instructions apply. Production source and public contracts are
unchanged. RA-01/02 decisions are identified, not implemented here.

## Findings that change the work estimate

Shared accounting must bridge three currently separate mechanisms: execution
tickets, guest value retention, and host resource disposition. None can stand in
for the others. The code already contains useful lifecycle hooks, but no single
ledger describes the whole cache/fetch operation.

1. **Native fetch wrapper retention is deliberate.** The value tracer pins fetch
   wrappers for the request lifetime and explicitly does not close or cancel
   host resources. Successful text projection does not dispose of the response
   and body. RA-05 must preserve aliases and opaque-return ownership before
   deciding whether a resource can be released earlier.
2. **Preparation failures are a distinct category.** Ordinary fetch allocates a
   request, then a body. Several subsequent failures return without closing the
   acquired handles. Terminal response construction has similar early returns.
   These handles are not represented by a successful fetch result wrapper.
3. **Timeout paths differ.** An operation timeout uses the fetch retirement list.
   A whole-request timeout in the generic readiness wait can return before the
   fetch waiter runs, leaving its pending handle outside that list. Expiry before
   send can instead leave the preparation request/body pair.
4. **Counters do not prove disposal.** The fetch reaper drops a ready retirement
   entry even when a response/body close fails. The cache prototype decrements
   local ownership before a consuming call and reports unresolved disposal
   separately. Neither zero counter means zero host resources.
5. **Streaming and JavaScript already have different lifecycle owners.** Native
   incoming-body forwarding has explicit fields and cleanup; JavaScript tracks
   owned responses and performs best-effort cancellation except for the final
   transferred body. A shared contract must preserve those distinctions.

These are source findings and controlled injected-host observations. They do not
prove a cross-request leak, actual platform exhaustion, memory cost, or hosted
reclamation timing. Reliance on host teardown may be intentional; its guarantee
must be stated and qualified separately from guest disposal.

## Coverage and authority

| Surface | RA-00 coverage | Evidence boundary |
| --- | --- | --- |
| Ordinary Fastly Native fetch | Acquisition, setup, send, wait/poll, projection, output, expiry and closure | Source audit plus 26 checks on four newly compiled artifacts |
| Cache primitives and fixed composition | Lookup/reader/writer lifecycle, commit/abandon and inherited fetch retention | Source audit and checked-in #524/#525 receipts; not rerun as new tests |
| Native opaque terminal fetch | Transfer of original response/body without structured reading | Fresh compiled-Wasm probe |
| Native incoming-body forwarding | Explicit upload/output lifecycle and failure cleanup | Source audit; existing forwarding evidence identified, not rerun |
| JavaScript fetch | Response ownership, transfer exception, cancellation and provider boundary | Source audit; no new JS parity or hosted test |
| Guest values, tickets and dynamic backends | Identify separate accounting domains and affected owners | Source audit; not a physical memory or host-capacity measurement |
| Transactions, HTTP-cache callbacks, S3/GRIP/KV implementations, ESP32 | Identify exclusions and shared-helper impact | Not a complete lifecycle audit or migration of those families |

The [source index](source-index.json) pins local file hashes and source anchors,
the prior receipts, and the exact upstream files inspected. The
[inventory](inventory.json) is the machine-readable resource/owner map. Local
source observations, fresh probe results, inherited receipts and upstream
implementation examples are kept distinct.

## Ordinary Native fetch lifecycle

The primary owner is
[native-platform-capabilities.js](../../../../../packages/provider-fastly/src/build/native-platform-capabilities.js).
Rows identify symbol boundaries rather than unstable line numbers.

| Resource / stage | Acquisition and holder | Success disposition | Failure / expiry / retention |
| --- | --- | --- | --- |
| Incoming request and body | `body_downstream_get` in `__pulse_fastly_run_invocation`; request globals | Borrowed for the invocation; ordinary path does not close ingress | No general ingress disposal in invocation close; forwarding takes explicit ownership of its source |
| Outbound request | `http_req.new` in `__pulse_fastly_start_request`; function local | Submitted to `send_async` with body | Body creation, method, URI, header, body write or later deadline failure can return with request still acquired |
| Outbound body | `http_body.new` in the same function; function local | Submitted to `send_async`; not a guest streaming writer in this path | Same preparation exits can retain it; send-error branch attempts close |
| Pending request | Successful send result; per-site pending array | Ordinary wait replaces it with response/body; operation-deadline path polls | Wait/poll failure consumption is host-dependent. Generic whole-request wait can exit without retirement; no pending cancel operation is used |
| Fetched response | Wait/poll output; `PULSE_VALUE_FETCH.responseHandle` | Opaque terminal send hands it downstream | Structured projection keeps wrapper/resource until teardown; late timed-out results use explicit close |
| Fetched body | Wait/poll output; `PULSE_VALUE_FETCH.bodyHandle` | Opaque terminal send hands it downstream; text/JSON materializes bounded data | Read/codec success or failure does not generally close it; EOF is not disposal |
| Structured body buffers | `__pulse_fastly_read_body` chunks, assembled bytes, decoded text | Become request-owned values; fetch wrapper caches text | Separate guest-memory lifecycle; no host-handle release follows from collecting a value |
| Terminal response | `http_resp.new` in `__pulse_fastly_send_result`; local | Sent with a new body | Body creation, status/header/write and send failures can leave it acquired; no general output ledger |
| Terminal response body | `http_body.new` in the same function; local | Nonstreaming downstream send transfers it | Setup/write/deadline/send failures have no general disposal hook |

Send failure is not uniformly “still owned.” The pinned Viceroy implementation
takes request parts/body before backend lookup; response send likewise takes
parts/body before completing delivery. Some failures can therefore consume
handles. The guest's send-error closes are best-effort and ignore close status;
RA-00 probes both consumed and retained outcomes without choosing a portable
host guarantee. No automatic request retry is introduced.

`__pulse_fastly_read_body` and `__pulse_fastly_write_body` are shared helpers.
Changing their disposal behavior without distinguishing callers would affect
request reads, fetch, other provider operations and terminal output. A reader
must not start closing a borrowed or transferred body merely because it reached
EOF. S3 has separately owned code, and GRIP publication calls the common outbound
request helper; those are regression-impact owners, not migrated resources here.

## Deadlines, settlement and teardown

| Path | Current mechanism | Consequence for accounting |
| --- | --- | --- |
| Whole-request check before send | `request-budget.js` inserts a check after preparation | A rejection is before network dispatch but after resource acquisition |
| Whole-request generic pending wait | `__pulse_fastly_resolve_effect` calls `__request_wait` before the waiter | Failure can bypass fetch retirement; pending remains live in the probe |
| Per-fetch header timeout | `__pulse_fetch_wait` observes active fetches and retires expired handles | Admission time is inherited; header arrival ends this operation timeout |
| Retired pending, not ready | `__pulse_fetch_reap` polls once on normal invocation close | Remains in retirement list and depends on host lifecycle; no blocking drain |
| Retired pending, ready | Reaper closes returned response/body then removes entry | Close statuses are ignored; zero unreaped can coexist with a remaining body |
| Poll error | Fetch completion/reaper drops or replaces bookkeeping according to path | Consumption cannot be inferred solely from failure or counter change |
| Failed group | `__pulse_application_settle_effect` drains admitted members, preserving failure precedence | Settlement is not resource reclamation; shared service must not change Router recovery implicitly |
| Normal `_start` return | `__pulse_invocation_close` fences tickets; selected cleanup hooks run | No generic sweep of ordinary live fetch/output resources |
| Trap | Normal return and cleanup code are bypassed | Guest cleanup is not a trap guarantee; host reclamation must be separately verified |

The canonical deadline prose broadly describes expired pending handles being
retired. The generic whole-request-wait probe is a narrower source/evidence gap
that RA-05 must reconcile. RA-00 leaves the public contract unchanged rather than
silently redefining its promise.

## Cache and composition inventory

Cache currently lives in the experimental
[ownership service](../../ownership/service.as.ts), not a supported production
cache package or reusable resource service.

| Resource / operation | Current lifecycle | Limit or unresolved point |
| --- | --- | --- |
| Lookup handle | Acquire, await readiness, inspect state; close on hit/miss/error when safe | A pending ordinary close may block in inspected Viceroy; cleanup checks readiness and records unresolved instead of draining |
| Read body | Acquire separately after a usable hit; bounded read; close body then lookup before result | Needs temporary extra capacity. Failed body close does not stop the separate cache cleanup attempt |
| Insert writer | Acquire streaming body; bounded partial writes; explicit close only on successful finalization | Cleanup uses abandon. Failed close/abandon may have consumed the handle; no retry |
| Local ownership count | Increment on adoption; detach/decrement before consuming disposal | Counts guest claims, not confirmed physical release; unresolved outcomes are separate |
| Parent and child state | Parent ticket plus three reserved child sites; one active child per parent | These are control records, not host handles. Static capacity is distinct from actual invocation count |
| Loader result | Core fetch returns text; recipe copies it into insert input | Fetch wrapper/body retention remains outside the cache ledger |

The inherited eight-miss result peaks at 24 **tracked** resources and leaves 16
fetch handles in its injected host. That ledger excluded ingress and terminal
response allocations; it was never a complete host census. RA-00's new ordinary
fetch host tracks terminal output too: text projection peaks at four owned
handles, transfers the output pair, and leaves the fetched pair. Borrowed ingress
is reported separately. Neither model includes host internals or backend memory.

The cache cap of eight, 64-byte values, and bounded read/write call counts remain
test constraints. The existing 1,024-effect ceiling bounds cumulative admissions,
not live host objects. Resource identities are opaque and scoped: prior injected
hosts allocate globally unique integers, which does not qualify cross-family
namespace uniqueness, handle reuse or lifetime safety on a real host.

## Other lifecycle owners that the contract must accommodate

**Native value tracing.**
[native-handle-ownership.js](../../../../../packages/provider-fastly/src/build/native-handle-ownership.js)
retains resource wrappers in `__pulse_handle_resource_roots`. Its checkpoint
traces guest values, not host resource IDs, and neither closes nor cancels them.
The fallback value table retains values too. Reusing this collector as a host
resource manager would change its contract and alias behavior.

**Native incoming forwarding.**
[native-body-forwarding.as.ts](../../../../../packages/provider-fastly/src/build/native-body-forwarding.as.ts)
tracks source, request, upload writer, pending, upstream response/body, output
response and downstream writer explicitly with `-1` sentinels. Streaming send
transfers the request/response side while retaining the writable body. EOF closes
the writer; failure abandons it. Cleanup polls pending once and invalidates its
local slot; many cleanup statuses are ignored. A committed downstream response
cannot be replaced by an error response. This path is currently restricted to
one terminal opaque POST and cannot be assumed to support composition.

**JavaScript.**
[effect-adapter.js](../../../../../packages/runtime/src/internal/effect-adapter.js)
registers returned `Response` objects, cancels late arrivals, and closes an
execution after admitted effects settle. The final transferred body is excluded
from cancellation. [response.js](../../../../../packages/runtime/src/internal/response.js)
releases cancellation registrations after an unlocked consumed read, and invokes
body cancellation without awaiting a potentially stalled/rejected callback.
Locked bodies are skipped by that helper; read cancellation has its own owner in
`body.js`. Adapter `dispose` is separately awaited. These are best-effort Web API
semantics, not Native handle-disposition evidence or proof of host cancellation.
The Fastly JS fetch adapter delegates through its configured implementation and
passes the execution signal; the cache spike has no JS implementation.

**Dynamic backend registration.** The Native path separately counts up to 32
registration attempts and reuses origin/name mappings. It does not acquire one
of the pending/body handles above, and it has no corresponding generic disposal
entry. Treat binding/registration authority and external host capacity separately
from an invocation-owned resource count.

## Upstream evidence and remaining host assumptions

Inspected revision:
[`fastly/Viceroy@aabb3697`](https://github.com/fastly/Viceroy/tree/aabb3697e08c30339f93a9bb15bbb46a5028619f).
Exact paths/blob IDs are in the source index. The ABI declares distinct body
close/abandon actions. The inspected implementation finalizes a streaming body
on close and drops it without finalization on abandon. Ordinary cache close
awaits its lookup task; request/response send and pending wait can consume
handles before returning an error.

These are pinned ABI declarations and implementation witnesses, **not** proof
that every deployed Fastly/Viceroy version has identical error consumption.
RA-10 still needs to establish:

- Consumption at every failed acquiring, consuming and transferring host call.
- What teardown reclaims after ordinary completion, deadline, trap and termination,
  and what upstream work or side effects can continue independently.
- Whether selected disposal actions are nonblocking after cancellation.
- Real handle namespaces/reuse and actual platform capacity boundaries.
- The difference between guest closure, host acceptance, delivery and commit.

No numeric production handle limit is established by this inventory. Failed
disposal cannot automatically be treated as a refund; the actual RA-02 policy
remains a decision.

## Exact implementation owners and handoff

| Next unit | Owners and required decision |
| --- | --- |
| RA-01 | Runtime host declarations, canonical invocation contracts and provider extension contract: define resource identity/lifetime/disposition independently of value handles and tickets |
| RA-02 | Request budget, invocation policy and provider admission: reserve progress capacity, distinguish bytes/handles/exclusivity, and decide unresolved-capacity accounting |
| RA-03 | Provider lifecycle service and structural emitter hooks: replace spike source patches; do not add a queue/executor |
| RA-04 | Shared service prototype, `__pulse_fastly_read_body` and JavaScript body readers: distinguish live bytes, temporary copies and exclusive leases; pressure progress capacity before selecting limits |
| RA-05 | `native-platform-capabilities.js`, `native-fetch-errors.js`, `native-fetch-deadlines.js/.as.ts`, `request-budget.js/.as.ts`, `native-application-errors.js`, `effect-invocations.js`, `native-handle-ownership.js`; preserve forwarding and JS boundaries listed above |
| RA-06 | Experimental cache service and package contribution boundary; a production cache package/service owner has not yet been selected |
| RA-07 | Composition prototype plus canonical plan/result-readiness owners; preserve admitted-child settlement and explicit failure |
| RA-08 | Capability bindings, report provenance/schema and semantic comparison: keep static demand separate from runtime disposition; no raw handle identity |
| RA-09/10 | Matched controls, existing fetch-deadline/forwarding tests, packed consumer and real-host lifecycle evidence |

The source index records exact paths and symbols for these owners. Shared helper
changes must consider GRIP publication, KV/assets reads and S3 independently; this
inventory is not permission to migrate those families. General loaders, nested
composition and ESP32 drivers remain outside RA-00.

## Validation and reproduction

26/26 fresh injected-host checks passed on four actual Wasm artifacts compiled
through the production compiler/provider, with no source instrumentation or
extension adapter. Expected retained resources and expected failures are asserted
as observations; a passing test does not mean the operation succeeded or cleaned
up fully. No host teardown is simulated. Fault status/consumption choices are
explicit host-model assumptions, not assertions of platform conformance.

```sh
node docs/internal/host-extensions/resource-accounting/ra00/probe.cjs /tmp/hex-ra00
```

[Receipt](receipt.json), [artifact archive](artifacts.tar.gz),
[evidence index](evidence-index.json), and [validation ledger](validation.json)
retain source identity, emitted source/plans/manifests/Wasm, host traces and checks.
The checked-in #524/#525 receipts are referenced by hash and named cases rather
than represented as newly executed qualification. No complete regressions,
JavaScript execution, Viceroy/hosted deployment or ESP32 hardware run is claimed.
