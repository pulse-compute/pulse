# FWD9-01 — Fastly Native forwarding feasibility

Decision record, 12 October 2026 (America/Denver). Human direction: “Implement
FWD9-01”; parent [#272](https://github.com/pulse-compute/pulse/issues/272),
benchmark dependency [#301](https://github.com/pulse-compute/pulse/issues/301).
Inspected Pulse `latest`: `ed88e80bbddcf581de79460b1e6a85155005a328`.
Entry point: `provider-fastly`. Class: evidence. The additional mutation owner
is `wasm/test/runtime/`, solely for this decision record and the prior record's
cross-reference. No product contract, capability or release surface changes.

## Verdict

**NO-GO for the full STR-01 completion-aware forwarding contract on the
inspected ABI. Conditional GO for implementing a bounded metered Native pump
only after an explicit Fastly host-handoff contract decision.** Both Fastly
targets remain ineligible. FWD9-01 is complete with this bounded verdict;
FWD9-02 and PERF9-01 are not unconditionally unblocked.

The ABI supports incremental body I/O without whole-body Wasm materialization.
It does not provide a final downstream drain receipt or cancellation authority
after successful streaming-body close. Direct incoming-handle transfer also
removes the actual-byte metering point. Neither shortcut meets the existing
contract. This confirms, rather than supersedes by assumption, the earlier
[STR-02C finding](STR-02C-fastly-feasibility.md).

Recommended decision for human review:

> For Fastly Native incoming forwarding, Pulse meters upload and response bytes
> and enforces cooperative deadlines while it owns the provider pump, through
> the final check and successful streaming-body close acceptance. That close is
> a host handoff, not a queue-drain or client-delivery receipt. Pulse cannot
> cancel or enforce a deadline on delivery after handoff. Pending upstream
> requests have no general cancellation hostcall; cleanup fences their results
> and disposes of handles it still owns, without claiming remote rollback.

This proposed narrower guarantee is **not approved by this evidence PR**.
`docs/architecture/current-contracts.md` explicitly requires a reviewed handoff
contract before Fastly forwarding admission. If this boundary is unacceptable,
keep #272 blocked pending a supported completion/cancellation primitive and
stop #301. Do not substitute a direct-handle Rust/Pulse benchmark.

## ABI evidence and alternatives

Source review pins Viceroy **0.21.1**, commit
`ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f`, against the earlier **0.20.1**
commit `e9132256a2c061af9ef9e6e12f56e8c42c4576e2`.

| ABI path | Ownership / behavior | Decision |
| --- | --- | --- |
| `body_downstream_get` | Provides incoming request and body handles; body can remain unread during authorization | Suitable lazy admission seam |
| `send_async` with incoming body | Consumes request and body; local read afterward returns `BADF` | Reject as the bounded product path: cannot meter unknown/false lengths after transfer |
| `body.new` + `send_async_streaming` | Request transfers; body becomes an owned streaming writer; a pending response handle is returned | Candidate upload pump; poll for early response while upload remains open |
| `body.read` / `body.write` | Bounded read destination and explicit write length; account for returned byte counts | Reuse raw scratch buffers; no strings, application values or accumulated chunks |
| `async_io.select` / `is_ready` | Normal body readiness means read; streaming body readiness means write; pending request readiness means headers | Demand signal, not remote consumption or completion; zero select timeout means **unbounded** |
| `body.known_length` | May be absent; advertised length does not guarantee that many bytes arrive | Admission hint only; actual bytes and EOF remain authoritative |
| `body.close` | Successful stream framing; frees the body handle | Final handoff only, never a drain receipt |
| `body.abandon` | Frees body without successful stream termination | Abort an unfinished owned writer; do not replace with successful close on failure |
| `send_downstream(..., streaming=1)` | Transfers response metadata, retains streaming writer for incremental output | Candidate response pump, followed by close only on verified success |
| `send_downstream_pending` / `body.append` | Delegates response completion or transfers another body into host storage | No measured-byte/cleanup advantage; excluded from the initial path |
| `send_async_v2` | Adds uncached/streaming send selection, not a final-body completion handle | Does not remove the blocker |

The 0.20.1 → 0.21.1 changes in the inspected WITX and request implementation
concern cache overrides. Body close/write and `StreamingBody` are unchanged.
The classic `wiggle_abi` implementation used by this probe was inspected as
well as the component implementation. On send failure, handles may already
have been taken before backend lookup fails: implementation must track attempted
transfer and never blindly reuse or retry a numeric handle.

`StreamingBody` has an **eight-item**, not byte-sized, channel. `finish()` may
enqueue completion in a host background task when full and may return success
after the receiver closes. Waiting for write readiness before close does not
turn that readiness into a drain receipt. No pending-request cancel export
appears in the inspected request interface. These are source-level findings
about the pinned local engine/interface, not a proof about every future ABI or
deployed Fastly behavior.

## Current Pulse integration seams

| Owner | Finding / follow-on work |
| --- | --- |
| `packages/provider-fastly/src/provider-contract.js` | Deliberately omits `request.body.forward`; keep it omitted until the vertical is proven |
| `packages/provider-fastly/src/javascript/target-support-policy.js` | Explicitly blocks incoming forwarding; JavaScript stays outside FWD9 |
| `wasm/packages/compiler/src/canonical-native-plan.js` and runtime contracts | Existing `req.body` marker / ownership vocabulary can be reused; no application stream API is needed |
| `packages/provider-fastly/src/build/native-platform-capabilities.js` | Incoming body handle is already separate from lazy text materialization. Fetch construction currently accepts string bodies; opaque response return directly hands its handle downstream. Both need a distinct metered path |
| `packages/provider-fastly/src/build/native-fetch-deadlines.as.ts` | Beta.8 deadlines end at response headers; retired pending handles are polled without blocking at invocation cleanup. This is useful machinery, not a body deadline or cancellation guarantee |
| `packages/provider-fastly/src/build/s3-body.as.ts` | Existing 16 KiB response-copy pattern demonstrates provider-owned scratch I/O. Exact-length S3 response copying does not qualify incoming upload, early response, or final-drain authority |
| Fastly configuration / Native import policy / capability evidence | New opt-in limits and imports need explicit validation; inspector/doctor/report and docs stay blocked until exact emitted application evidence exists |

Additional owners for FWD9-02 must be named in its declaration: provider
registry/target realization and configuration; effect/continuation or compiler
owners only where marker admission actually requires changes. Do not reinterpret
an existing ABI field or broaden shared admission as a shortcut.

## Proposed bounded implementation contract

Preserve the existing authoring form: one inline `ctx.req.body()` in one literal
outbound POST, to one configured static backend, returning the opaque response.
No tee, replay, redirect following, retry, arbitrary dynamic backend, body
inspection, structured request reads in the forwarding application, or detached
work. Reserve the single owner before dispatch, including group preflight;
reject duplicate claims before any member starts. Authentication denial performs
no incoming read and no outbound dispatch.

| Resource | Initial qualification budget (proposal, not measured support) |
| --- | --- |
| Payload | Explicit positive `maxBytes`, initially at most **1,048,576 bytes per direction**, independent upload and response counters; no unbounded default |
| Time | Require existing `fastly.maxDurationMs` (1–30,000 ms); inherit admission deadline. Earlier fetch timeout persists through this forwarding response's handoff, unlike ordinary fetch header-only semantics |
| Guest payload storage | One reusable **16 KiB** raw buffer per direction, at most **32 KiB** total payload scratch; no allocation per chunk; separately account for fixed ABI outputs, metadata and existing runtime memory |
| Pump queue | At most one buffered chunk and one active I/O action per direction; drain a partial write before reading again; no producer prefetch queue |
| Handles | One incoming body, one upstream streaming writer, one pending request, one origin response body and one downstream streaming writer at most, plus bounded request/response metadata handles; no per-chunk handles or growing retirement list |
| Response metadata | Proposed 16 KiB total selected metadata and at most 64 header pairs; bounded raw-header enumeration must reject overflow before downstream commitment |
| Local host queue | Eight writes × 16 KiB = at most 128 KiB of payload in each pinned Viceroy streaming channel **under the proposed write discipline**; excludes in-flight chunks, HTTP/TLS/socket buffers and other host storage |
| Platform memory | Unknown from this probe. Record guest pages and host/RSS separately; no total-RSS, live-platform queue bound, or zero-copy claim |

The 1 MiB ceiling is chosen to qualify #301's full initial sweep without
importing Node's 64 MiB allowance. Larger transfers require separate evidence.
The 16 KiB choice bounds each raw `read`/`write` argument and the locally
inspected item queue; it is not inherited proof from Node or S3. The
`fastly.bodyForwarding` configuration spelling and generated references belong
to FWD9-02; nothing here makes that proposed field valid today.

Use overflow-safe byte counters. Reject declared over-limit lengths before
dispatch/commit; read at most the remaining allowance plus one sentinel byte
(capped by buffer size), never forward the sentinel, and verify EOF even at
exactly the limit. Missing lengths remain valid subject to measured limits;
detectable declared/measured mismatches fail. One byte beyond the cap must fail
without buffering the rest. Record protocol-normalized lengths separately from
what the application can actually observe.

Select only actionable handles with the remaining positive deadline; never
select with timeout zero. Include pending-response readiness during upload so
a slow input or blocked writer cannot hide an early response. Poll that response
before continuing I/O when multiple handles are ready. Recheck time after every
hostcall and before continuation, downstream commitment and final close. A
blocking hostcall is still cooperative, not CPU preemption.

## Ownership and terminal outcomes

| State / event | Required disposition |
| --- | --- |
| Unclaimed → reserved | Invocation-local marker becomes unavailable to all other consumers; source remains unread |
| Reserved → uploading | Static backend and limits checked; create empty streaming upload writer and retain pending-response ownership |
| Partial write | Retain offset in the same scratch buffer; no second read or buffer replacement |
| Upload EOF | After byte/length checks, close the upload writer once; keep pending-response ownership, deadlines and response byte budget alive |
| Early origin response | Stop reading input; close/dispose owned source, abandon unfinished upload writer; adopt the origin response once |
| Response body ready | Validate status/eligible headers; begin downstream stream and meter response with an independent counter |
| Response EOF | Verify length and live deadline; close owned source; close downstream writer once and record **handed-off**, not delivered |
| Timeout, overflow, disconnect or transport error | Fence continuation; stop new I/O; dispose readable bodies, abandon unfinished writers, and nonblocking-reap pending results; never wait indefinitely for cleanup |
| Late response / unready pending request | Dispose arrived handles without resuming code; keep unresolved pending ownership invocation-bound until host teardown; no assertion of upstream cancellation |
| Failure after downstream headers | Abort the writer; no second HTTP response, appended error document or successful EOF |

Before headers, select explicit bounded responses: upload overflow 413,
deadline 504, origin/protocol/response overflow 502, with ownership/invalid ABI
failures terminal under the existing error boundary. These are proposed
forwarding mappings, not changes to ordinary fetch. An incomplete input may
already have caused origin side effects; cancellation never proves rollback.
Downstream disconnect can be observed through I/O failure, but the ABI probe
does not prove immediate disconnect notification during every wait. The finite
deadline remains the fallback bound while handles are owned.

Forward bytes, not the inbound request wholesale. No implicit authorization,
cookies or Host copying. Reject caller-controlled framing/hop-by-hop fields;
filter response hop-by-hop fields and all `Connection`-nominated fields. Let
the host own framing; do not blindly propagate content length or trailers.
Preserve eligible status/header semantics and binary bytes without decoding or
automatic decompression. Suppress and dispose bodies for bodyless statuses;
never fabricate a successful empty response on an error.

## Fresh evidence

The existing standalone ABI probe was replayed on 0.21.1 with real loopback
client/origin HTTP. No mock host supplied these observations.

| Case | Observed result |
| --- | --- |
| Direct transfer | Four-byte binary prefix arrives before client EOF; complete eight-byte SHA-256 matches; read after transfer returns status 3 (`BADF`) |
| Early response | Select status 0/index 0; poll status 0/done 1 before upload close; abandon status 0 |
| Successful downstream close | Status 0; subsequent readiness status 3; client receives complete `prefix` response |
| Downstream abandon | Status 0; subsequent readiness status 3; client fails with `ECONNRESET` |
| Ordinary CLI admission | Native capability rejection and JavaScript forwarding-ineligibility rejection both retained |

Run: `wasm/.test-results/runs/2026-10-13T00-32-35-858Z--5`, task passed in
5.85 seconds; terminal probe report `wasm/.test-results/str02c-zoR4SW/report.json`.
At execution HEAD was the inspected base, tree
`9902a539efa82246456f46db36d1867a44689651`, with only the probe runner modified.
The run used Node 24.19.0, AssemblyScript 0.28.18 and lockfile-pinned dependencies
restored offline with pnpm 12.4.2 and lifecycle scripts disabled.

| Identity | SHA-256 |
| --- | --- |
| Viceroy executable | `881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9` |
| Probe source | `52c9459f861d879234585b51da97f7569a2beb0d596c0162319405a834ffc7a5` |
| Probe runner | `244adbec31c99f894da4ca8e72ec3058ca3a9bb3703bdc6b5e08b7d2b7ad7f32` |
| Emitted probe Wasm, 5,982 bytes | `82d636e6ca31845b3d78b230245346ebd9091685610937e0b82ee58e2898fc5b` |

The reviewed source commit is associated with the engine version; the binary
hash identifies the actual execution. This is not a reproducible-build
attestation. Logs are ephemeral; the observations and identities above preserve
the decision evidence without checking generated report trees into the repo.
This small probe does **not** measure the proposed pump's memory, large-payload
behavior, partial writes, blocked final writer or deadline behavior, nor does it
qualify emitted Pulse forwarding or deployed Fastly. No benchmark was run.

Reproduce with an explicitly selected source-reviewed engine:

```bash
PULSE_VICEROY_BIN=/absolute/path/to/viceroy-0.21.1 \
  node wasm/scripts/run-wasm-tests.cjs --task str02c-fastly-feasibility
```

The runner also retains the original reviewed 0.20.1 pin, rejects unreviewed
versions, and records exact engine/compiler/probe identities. Source review
and fresh qualification are required before adding another engine version.

## Implementation gates and effort

1. **Handoff decision:** accept the explicit paragraph above or retain the
   current blocker. Review the provider-specific body-timeout boundary as well.
2. **FWD9-02 (L, conditional):** one provider-owned state machine, fixed raw
   scratch, marker admission/configuration/import integration, static backend,
   opaque response metering and a normal Native build running one binary POST.
   This needs no generic scheduler, new application syntax or allocator change.
   Keep XL only if actual integration discovers a shared continuation redesign;
   split and review that discovery before expanding the work.
3. **FWD9-03 (L):** exact emitted Wasm and installed workflow; byte identity at
   0/1 KiB/64 KiB/1 MiB and cap ±1; unknown/mismatched lengths; duplicate/group
   conflicts; denial without reads; slow source/sink, early origin rejection,
   partial/failed writes, disconnect, header/bodyless/framing policy, operation
   and total deadlines across EOF, post-header abort, stale results and repeated
   requests. Show bounded guest payload storage and separate host accounting.
   Keep Node Native/JavaScript forwarding non-regression. Qualify local and live
   Fastly independently, especially early-response and abort semantics.
4. **PERF9-01:** only after that contract is implemented and qualified, compare
   Rust and Pulse using the **same metered pump, bounds, hostcalls and handoff**.
   Comparing Rust direct-handle transfer with Pulse metered copying is invalid.
   The 1–3% hypothesis may need revision; no result is assumed or targeted.

## Primary source pins

All links below target the inspected 0.21.1 commit:

- [WITX ABI](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/compute-at-edge-abi/compute-at-edge.witx), SHA-256 `ffaae0a9e1f7392a0d2498b9e46c0b034d3d400030d72ef9308e850616166631`.
- [Async item types](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/compute-at-edge-abi/typenames.witx), SHA-256 `1506336bf0e0d28a113a177b1450d08663e64a718b670099bd729bd2affd154a`.
- [Classic body implementation](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/wiggle_abi/body_impl.rs), SHA-256 `39cc4232d2311523bd8861fe70786762375030eca648e1d21b73ac29a4334183`.
- [Classic request implementation](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/wiggle_abi/req_impl.rs), SHA-256 `27b394f539db3f6df6ab02bc08fb1d5977d7f7f9de713c5eee5dc2df89818cb8`.
- [Streaming channel and finish](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/streaming_body.rs), SHA-256 `20f3fea1e6414a4501ef047b1bfdab7d7df45bffd77cfef07f9675ceaf62088f`.

The earlier SDK/local-engine early-response discrepancy in STR-02C is not
resolved by this local replay. A deployed-platform claim requires separate
evidence; this task authorizes no deployment, publication, merge or release.
