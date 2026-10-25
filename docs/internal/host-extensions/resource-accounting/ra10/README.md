# RA-10: host lifecycle qualification

This bounded checkpoint runs the cache/fetch ownership proof against the **real
Viceroy 0.21.1 Linux engine**, with a loopback HTTP origin. It replaces no hostcalls
with JavaScript fixtures. It qualifies specific local outcomes, not hosted Fastly,
ESP32, production admission, resource limits or physical reclamation.

The owner requested RA-10 after RA-09 merged at
`b04440397aecd01be2e93167aabd49f9249835ba`. No exact named Entry Point covers this
internal qualification; root/docs instructions apply. All changes remain internal
evidence. Production adapters and the conservative RA-07 ledger are unchanged.

## Result and adoption consequence

The qualification covers **33 real-engine cases** and **six matched bridge
controls**. Widths 1, 8 and 32 complete cache miss → fetch → insert and subsequent
cache-hit requests with zero remaining guest handle charges and no ledger error.
The miss makes exactly one origin request per parent; the hit makes none.
Backing charges remain retained, as designed: 262,785 bytes per miss parent and
257 per hit parent. These are logical charges, not measured memory.

The critical new finding is that **abandon is not cache rollback**. After writing
seven bytes and abandoning the writer, a lookup reports FOUND | USABLE, but its
body fails before complete EOF. Returning or trapping with the writer unclosed
leaves the same observable incomplete-entry behavior on the next request.
Conversely, explicit close permits reading the complete payload through EOF.
This distinguishes writer ownership, stream completion and entry visibility.
The existing composed reader fails on body-read error; the evidence does not
authorize treating that error as a miss, retrying the loader, or promising that
cleanup removes an entry.

The checkpoint supports continuing to RA-11's architecture review with this
qualification boundary. It does **not** qualify production adoption. A production
cache contract must explicitly address incomplete entries, and a hosted Fastly
qualification must determine whether the same behavior applies there.

## Executed lifecycle matrix

| Operation / trigger | Observed local outcome | Ownership implication |
| --- | --- | --- |
| Body close / abandon | Success, immediate stale-handle rejection | Guest handle invalidated; no physical-memory claim |
| Async send to unknown backend | Status 2; request and body both invalidated; pending output unchanged | A nonzero status cannot mean inputs retained |
| Async send with invalid body argument | Status 3; request invalidated; separately allocated, unpassed body still valid | A single hostcall can have different input outcomes |
| Second downstream send | Rejected; new response and body invalidated; client sees first response | Failed transfer is not permission to retry or reuse |
| Successful pending wait | Pending invalidated; response/body independently closeable | Adopt both outputs before fallible later work |
| Pending wait / ready poll after origin reset | Error; pending invalidated | Failure can consume pending ownership |
| Poll before delayed origin completes | Success, done=0, ABI invalid-handle output sentinels; pending remains valid | No result handles acquired; ordinary driver wait can continue |
| Cache miss body acquisition | Status 10; output unchanged; lookup remains closeable | Failed acquisition does not consume this lookup in this case |
| Cache insert with 4,097-byte key | Error; output unchanged | Bounded validation failure only; not an allocation-exhaustion result |
| Cache writer close | Writer invalidated; complete payload and EOF read afterward | Local completion observed; no global durability promise |
| Cache writer abandon | Writer invalidated; found/usable entry, failing body | No rollback, miss or successful-commit inference |
| Return / trap with unclosed cache writer | Next request sees found/usable entry with failing body | Teardown does not manufacture a successful commit or guest release receipt |
| Return / trap / exit / process termination with pending fetch | Origin's delayed work completes after guest response/end | Guest lifetime does not bound origin side effects |
| Handle identity and finite capacity | Zero response handle valid; request/response integers overlap; 256 bodies acquired and closed | Namespace matters; 256 is an exercised count, not a platform maximum |

Successful cache/body/request/response disposal is followed immediately by a
second destructive validity probe, with no intervening acquisition. This avoids
confusing reuse with continued ownership. These probes are test-only; an adapter
must never discover ambiguous consumption by blindly attempting another close.
No same-request body-handle reuse occurred in the small probe. Generations and
execution identity remain necessary regardless.

The composed failure cases use actual origin connection reset, a 65-byte body
exceeding the proof's 64-byte bound, and a 1,300 ms origin delay exceeding the
1,000 ms request budget. Responses are respectively 502, 500 and 504. Reset and
deadline retain one uncertain pending charge; oversized-body failure safely
closes the acquired fetch response/body and retains zero handle charges. The next
request succeeds and makes a new origin request, demonstrating no inserted value
from these three failures. This is separate from the abandoned-writer finding.

## Engine and source witnesses

[profile.json](profile.json) pins the downloaded release archive and executable
digests, with the matching version tag's source revision
`fastly/Viceroy@ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f`. The archive and binary
match the repository's previously recorded 0.21.1 hashes. This is not a
reproducible-build attestation tying every binary byte to that source tree.
Exact audited source copies, hashes and upstream license are in the evidence.

| Pinned upstream owner | Relevant witness and limit |
| --- | --- |
| `src/wiggle_abi/req_impl.rs` | `send_async` takes request/body before backend lookup; wait and ready poll take the pending item before propagating upstream errors |
| `src/wiggle_abi/resp_impl.rs` | Downstream send takes response/body before accepting delivery |
| `src/wiggle_abi/body_impl.rs`, `src/streaming_body.rs` | Close finishes a streaming body; abandon drops without finish; finish may schedule work, so successful close is not end-to-end delivery |
| `src/wiggle_abi/cache.rs`, `src/cache.rs` | Insert exposes a streaming entry; ordinary cache close takes the entry and awaits its lookup task |
| `src/body.rs`, `src/body_tee.rs`, `src/cache/store.rs` | An unfinished stream propagates a read error; entry visibility is separate from complete body delivery |
| `src/async_io.rs` | Readiness does not consume an item; timed select may return the timeout sentinel |
| `src/sandbox.rs`, `src/sandbox/async_item.rs` | Request/response tables are separate; bodies, pending requests and cache operations share the async-item table; spawned upstream tasks are separate from their result receiver |
| `src/execute.rs` | A request-scoped Wasmtime store runs the entrypoint and closes the downstream channel on return/trap; this is not a measured host-memory reclamation receipt |

The ordinary lookup in these tests can initially be unready. `get_state` waits
for it, after which close succeeds. No deliberately long-running unready lookup
was established, and no worst-case disposal latency is claimed. The source
witness justifies preserving RA-06's readiness gate: **never use ordinary cache
close as a supposedly nonblocking cancellation primitive**. `close_busy` is a
different ABI and is not substituted into this profile.

## Harness and evidence integrity

[probe.as.ts](probe.as.ts) is a small compiled Native ABI probe. It records status,
output-slot changes and validity checks through WASI stdout. Raw handle numbers,
keys, URLs and headers are not added to a public resource report. The runtime's
diagnostic stderr can contain only this fixture's loopback addresses.

[build.cjs](build.cjs) reuses RA-07's compiler, fixed profile and authored
application. It replaces the injected `ra06_proof.event` callback with an empty
guest sink and adds a scalar WASI diagnostic after joint closure. All other host
imports remain identical. No response path, ownership policy, disposal action,
deadline or host result is replaced. Six controls compare the transformed and
original Wasm under the existing independent host for hit/miss at each width,
including outcomes, ledger facts and remaining host resources. These six controls
are injected-host bridge checks, **not six additional real-host checks**.

[run.cjs](run.cjs) runs the exact compiled bytes in Viceroy, verifies the binary
hash, retains stdout/stderr and records independent client/origin observations.
The diagnostic snapshot occurs at joint closure, before later response handling;
it is not a full post-teardown audit. Wire responses are checked separately.
The origin continuation observation means its scheduled application work still
runs; it does not imply the result was delivered to a departed guest.

Every request has a four-second timeout, startup is bounded to fifteen seconds,
and the host run has a two-minute watchdog plus an outer process timeout. Each
case checkpoints; failures preserve their status and logs. Cleanup terminates
the engine, closes origin sockets and clears pending timers. Engine shutdown
escalates to SIGKILL after a one-second SIGTERM grace period. These are harness
limits, not measured provider service-level guarantees. Timing is recorded for
diagnosis, not used as a performance comparison with RA-09.

[check.cjs](check.cjs) snapshots experiment sources and pinned upstream witnesses,
records base/dirty-tree identity, compiler identity, loaded repository source
hashes and every generated artifact hash, then requires exact completed coverage.
It verifies sources and artifacts are unchanged at completion. The final receipt
and raw host cases are indexed by [evidence.json](evidence.json);
[evidence.tar.gz](evidence.tar.gz) retains reproducible final inputs, generated
AssemblyScript/Wasm/plans, raw observations and exploratory failures.

Exploration caught wrapper issues (an exact source anchor, a log-import comparison,
an unbound AssemblyScript abort import, and an incorrectly selected diagnostic
counter) and corrected expectations against real behavior (abandon leaves a
failing entry; reset maps to 502 with one uncertain charge). An invalid option
mask also trapped at ABI decoding rather than returning a status; the qualified
invalid-insert case uses a well-formed, oversized key instead. Failed exploratory
logs and receipts are retained. Their original generated bytes were not all
snapshotted before iteration; they are not reproducible qualification claims.
The formal attempt has exact snapshots and artifact identities.

## Reproduction and remaining work

Obtain the pinned binary, verify **both** digests in `profile.json`, and check out
the pinned upstream source revision. Use the repository's lockfile-pinned build
dependencies. No Fastly credentials or deployment are needed.

```sh
node docs/internal/host-extensions/resource-accounting/ra10/check.cjs \
  /tmp/hex-ra10-fresh /absolute/path/to/viceroy /absolute/path/to/Viceroy-source
```

Use a fresh output directory; a failed run must not be overwritten. The check
requires the upstream checkout to be clean and at the exact pinned revision.
Upstream source is audit evidence only; the published binary is the executed host.

Still unqualified: hosted Fastly error/termination behavior, every possible
failed acquisition or cleanup, allocator exhaustion, a long unready cache lookup,
physical resource reclamation, global cache propagation/durability, host capacity
limits, JavaScript composition parity and ESP32 DMA/quiescence. Unknown outcomes
continue to quarantine claims without retry or refund. RA-11 must decide adoption
scope and ownership of further qualification; this evidence does not change the
production contract or authorize merge, deployment or release.
