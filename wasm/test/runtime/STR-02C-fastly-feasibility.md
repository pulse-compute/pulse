# STR-02C — Fastly incoming-forwarding feasibility

Decision card, 29 September 2026. Human direction: “Implement STR-02C”. Base:
`beta` at `30c4ee72ab7a74b0b33cb3e24d8f0a39269dd54e`, including STR-02B.
Entry point: `provider-fastly`; this change is evidence and admission regression
coverage. It changes no provider capability, authoring surface or Native ABI.

**Outcome: feasibility established in part; product integration remains blocked
on completion ownership. Both Fastly targets remain ineligible.** This is the
bounded decision outcome expressly allowed by [STR-01](STR-01-body-stream-ownership.md).

## What was actually exercised

A standalone 5,982-byte Wasm probe calls the real Fastly host ABI in explicitly
selected Viceroy **0.20.1**, using real loopback client/origin HTTP. It is not a
Pulse-compiled forwarding application, an installed integration test, a live
Fastly deployment, or a large-body memory qualification. No injected mock host
supplies the results. Reports record the engine binary hash, source/tree and
working state, probe/runner hashes, exact Wasm hash and hostcall observations.

| Probe | Local result | Meaning and limit |
| --- | --- | --- |
| Incoming handle passed to `send_async` | Origin receives the four-byte binary prefix before client EOF; complete eight-byte transfer matches SHA-256 | Incremental transfer works. This does not establish metering or queue bounds. |
| Read incoming handle after transfer | Status 3 (`BADF`) | Guest ownership is consumed; this shortcut cannot also meter actual input bytes. |
| `send_async_streaming`, write prefix, select/poll pending response before upload close | Select succeeds, pending response is ready, poll reports done | Local engine exposes early responses before upload completion. |
| Abandon unfinished upstream upload after early response | Status 0 | Local abort hostcall is usable while the streaming handle is owned. |
| Close downstream streaming body | Status 0; subsequent readiness query returns `BADF`; client gets a complete response | Close relinquishes the handle; readiness cannot observe a later completion. This small response does not measure a blocked writer. |
| Abandon downstream streaming body | Status 0; subsequent readiness query returns `BADF`; client connection fails | Abort is distinct from successful framing; no second response is synthesized. |
| Ordinary Pulse build, Native and JavaScript | Native capability rejection and JavaScript forwarding-ineligibility diagnostic | Existing product admission stays closed, independently of standalone probe success. |

The SDK documentation describes streaming requests as withholding the response
until the upload is finished. The raw-ABI local observation differs. Treat that
as a qualification discrepancy, not evidence that live Fastly has the local
behavior. The implementation must not rely on either interpretation without
platform evidence.

## Host contract and unresolved boundary

The ABI provides body reads/writes, timed readiness selection, streaming sends,
successful close and unsuccessful abandon. Readiness applies to a particular
I/O operation, not end-to-end delivery. Its type documentation explicitly
separates the host write buffer from origin consumption.

Viceroy's pinned `StreamingBody` implementation has an eight-item channel,
not a byte limit. Its `finish()` can enqueue completion for background execution
when that channel is full; a closed receiver also yields success. The body
resource is removed by close. This is source evidence about local host behavior,
not a measurement of live Fastly buffering or proof of client receipt.

Consequently:

- Direct handle forwarding loses the measurement/control point needed for
  unknown or inaccurate content lengths. It cannot satisfy STR-01 by itself.
- A metered provider pump is a plausible next implementation: bounded reusable
  byte buffer, timed readiness, partial-write handling, measured upload and
  response limits, grouped admission, early-response cancellation and explicit
  close/abandon. The application value heap must not accumulate body bytes.
- Before final close, readiness and abandon provide useful cooperative control.
  After close, the inspected ABI offers no receipt for draining the host queue
  and no retained body handle for cancellation. `_start` returning, an input
  EOF, or successful close cannot serve as that receipt.
- Node's local writer evidence does not qualify this Fastly handoff. Neither
  the probe nor source inspection proves 1/16/64 MiB memory behavior, downstream
  backpressure under deadline, platform cancellation, or installed execution.

STR-01 requires an explicit reviewed narrower guarantee when a provider cannot
establish the selected bound. This change does not silently move the deadline
boundary or expand into a scheduler or new ABI design.

## Decision and next bounded work

| Choice | Result | Next work / effort |
| --- | --- | --- |
| **Accept an explicit Fastly host-handoff boundary (recommended for review)** | Pulse enforces limits and deadline while it owns the pump, through final host close acceptance. Queued host/network delivery may continue afterward; no post-close deadline/cancellation guarantee. This is a proposed narrower contract, not approved behavior. | **STR-02C1**, human contract decision (S), then **STR-02C2**, metered Native integration and ordinary build/installed execution (M–L). |
| Retain completion/cancellation authority until the final local writer drains | Current evidence is insufficient to implement that promise with the inspected interface. | Obtain a supported platform completion/cancellation primitive and its precise contract before implementation; estimate afterward. |

After either decision, require the full STR-01 corpus: 1/16/64 MiB byte identity
and separate guest/queue/platform accounting; slow source/sink; absent/false
length; group conflicts before dispatch; denial without reads; early response;
disconnect; upload and response overflow; operation/total deadlines before and
after EOF; post-header abort; and stale completion. Execute the exact emitted
artifact through the ordinary workflow and qualify the relevant live host
behavior before claiming deployment support. No deployment is authorized here.

Fastly JavaScript has a separate missing total-request-deadline implementation.
It stays ineligible regardless of the Native decision.

## Reproduce

```bash
node wasm/scripts/run-wasm-tests.cjs --task provider-fastly-package
PULSE_VICEROY_BIN=/absolute/path/to/viceroy-0.20.1 \
  node wasm/scripts/run-wasm-tests.cjs --task str02c-fastly-feasibility
```

The portable package task includes both ordinary CLI rejection cases. The
explicit external task additionally compiles and runs the ABI probe, has a
90-second ceiling and five-second per-observation bounds, and does not install
or silently select another engine. A changed engine version requires review.
Unique reports live under `wasm/.test-results/str02c-*/report.json`; failed
attempts remain separate from retries. Initial fixture fixes addressed a
receipt/response race and the fixture's explicit return syntax.

## Primary sources inspected

- [Viceroy v0.20.1 ABI](https://github.com/fastly/Viceroy/blob/e9132256a2c061af9ef9e6e12f56e8c42c4576e2/wasm_abi/compute-at-edge-abi/compute-at-edge.witx): body ownership, `close`, `abandon`, `send_async_streaming`, `select`, `is_ready`. File SHA-256: `4f8b111013eee1c3f98745986e5e1f62f5c16678e530b07b7555f0cf8aba9db6`.
- [Pinned streaming body implementation](https://github.com/fastly/Viceroy/blob/e9132256a2c061af9ef9e6e12f56e8c42c4576e2/src/streaming_body.rs): channel accounting and asynchronous finish. SHA-256: `20f3fea1e6414a4501ef047b1bfdab7d7df45bffd77cfef07f9675ceaf62088f`.
- [Pinned HTTP body implementation](https://github.com/fastly/Viceroy/blob/e9132256a2c061af9ef9e6e12f56e8c42c4576e2/src/component/compute/http_body.rs): resource removal on close and write behavior.
- [Current ABI type documentation at inspected commit](https://github.com/fastly/Viceroy/blob/3e56608584666f0b27698a0099c59bbef4d1e024/wasm_abi/compute-at-edge-abi/typenames.witx): asynchronous-item readiness and host buffering.
- [Fastly Rust request SDK reference](https://www.fastly.com/documentation/reference/compute/sdks/rust/fastly/struct.Request/): streaming request/response completion caveat; public documentation is not local-engine qualification.

No production compiler, runtime or provider implementation is changed, so no
shared compiler work with `latest` is required by this decision-only outcome.
