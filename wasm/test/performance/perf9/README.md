# PERF9-01A — pinned Fastly forwarding parity

This is the semantic preflight for #301, using the FWD9-01 host-handoff decision
and merged FWD9-02/03 implementation (#307). It produces comparable artifacts
and correctness evidence. It does **not** measure Rust/Pulse performance, qualify
a deployed Fastly service, or change a release gate. The subsequent local
campaign and its limitations are recorded in the [PERF9-01C baseline](RESULTS.md).

## Reproduce

Start from a clean, committed checkout with the lockfile-pinned Pulse dependencies
installed with lifecycle scripts disabled and the workspace built. Install Rust
**1.90.0** with the **wasm32-unknown-unknown** target and Viceroy **0.21.1**.
The target is a bare Wasm command exporting `_start`, with explicit Fastly ABI
and WASI clock imports; it does not run a JavaScript or Node server.

```sh
rustup toolchain install 1.90.0 --profile minimal --target wasm32-unknown-unknown
# Put that toolchain's bin directory first on PATH (do not set RUSTUP_TOOLCHAIN).
export PATH="$(rustup run 1.90.0 rustc --print sysroot)/bin:$PATH"
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/scripts/run-wasm-tests.cjs \
  --task perf9-01a-parity --report .test-results/perf9-01a-attempt1.json
```

The runner rejects a different compiler/Cargo or Viceroy version, Rust build
overrides, and ancestor Cargo configuration. It uses an isolated Cargo home,
empty target directory, `--locked --offline -j1`, and no Rust dependencies or
build scripts. Missing Rust, target libraries or Viceroy fails the task; there
is no passing ABI-only substitute. No installation or deployment occurs in the
runner. The task is explicitly selected, outside fast CI and the release seal.

Each attempt retains `wasm/.test-results/perf9-01a-*/parity.json`, both guests,
the generated inputs, and local Viceroy configuration. The report starts as
`running` and becomes `passed` only after every cell and a second clean build of
both default artifacts complete. Failures retain their error and completed
cells. Inspect the terminal aggregate report as well as the detailed report:

```sh
node wasm/test/performance/perf9/qualify.cjs --check /absolute/path/to/parity.json
```

`--check` verifies retained artifact bytes, current fixture/oracle hashes and
coverage. Preserve the entire result directory when moving evidence (artifact
paths in this local report are absolute). A report alone cannot authorize later
measurements of different binaries.

## Equivalent workload

`contract.json` pins the fixture. `pulse.ts` is an ordinary Pulse application,
built through the normal Fastly Native provider. The handwritten Rust guest is
an explicit implementation of the same transport contract, using direct Fastly
ABI calls without a Pulse runtime or Fastly SDK. It is a comparison fixture,
not a new production provider or a claim about every Rust application.

| Boundary | Both guests |
| --- | --- |
| Input/dispatch | POST `/` to `https://origin.example/upload`, static backend `origin`, one outbound request |
| Payload | Opaque bytes, including NUL/non-UTF-8; no JSON, decoding, transform, whole-body guest materialization or retry |
| Storage/pumping | One reused 16 KiB payload buffer, writer readiness before reads, partial-write completion before next read, sequential upload/response |
| Limits | Independent 1 MiB actual-byte caps; declared length checked but never trusted; cap+1 sentinel never forwarded |
| Deadlines | 2000 ms request budget from invocation entry, 1500 ms fetch budget from admission; cooperative checks through final pre-close |
| Request headers | Only explicit `content-type: application/octet-stream`; incoming credentials and Host not copied |
| Response headers | Raw 16 KiB metadata arena, at most 64 pairs; same framing, hop-by-hop and Connection-nomination filtering; repeated end-to-end values and encoded bytes preserved |
| Failure | Same status/error body before commitment; after headers abandon without a second response; early headers stop unfinished upload |
| Ownership | Close read handles, abandon unfinished writers, poll pending cleanup once; no pending-request cancellation ABI |
| Completion | Successful streaming close hands queued completion to Fastly; no drain, receipt, rollback or post-handoff deadline promise |

The Rust code deliberately pays for those bounds and policies; a direct
request/body-handle passthrough would skip work and is not this comparison.
Both use `send_async_streaming`, `pending_req_poll_v2`, body read/write/close/
abandon and readiness/select against the same host. Different compiler/runtime
bookkeeping and hostcall counts are legitimate implementation costs; byte,
header, status, abort and ownership outcomes must match.

The Rust export `pulse_fastly_last_error` exists only for the shared injected
host's diagnostic accessor. Rust failures are expressed by HTTP status/abort or
Wasm traps, each checked separately. The export is never called by Viceroy or
Fastly and does not bypass the response or cleanup assertions.

## Evidence

Every default and variant pair runs the unchanged FWD9-03 ABI corpus (90 default,
88 unequal-cap, 90 earlier-total cases **per guest**), including invalid host
counts, clock faults, deadlines at EOF, late results, partial writes, early
headers, cap boundaries, header budgets, cancellation and fresh invocations.
A separate differential corpus compares status, ordered raw headers, byte
length/digest, dispatch identity, abort/commit behavior and final resources.
Both default artifacts also run all 19 FWD9-03 real HTTP cases in pinned local
Viceroy: binary 1 KiB/64 KiB/1 MiB, incremental transfer, backpressure, framing,
early rejection, deadline/overflow aborts and disconnect recovery.

Variants use request/response caps of 33/65 bytes and an earlier 1000 ms total
budget. Both default artifacts must reproduce byte-identically in a second
fresh build. Evidence pins the Git revision/tree, clean working tree, fixture
and shared oracle hashes, workspace lockfiles/compiler versions, Node identity,
Rust compiler/Cargo/target libraries, Viceroy binary, generated configuration,
Wasm imports, sizes and hashes. Artifacts remain available for PERF9-01B.

Only guest linear-memory size and scratch assertions are recorded here. Rust's
metadata arena/pair table and stack ABI outputs differ from Pulse's 128-byte
reused ABI-output area; do not call the oracle's Pulse-specific metadata total
a Rust memory measurement. Host queues, process RSS/high-water and CPU domains
remain unmeasured. The shared HTTP oracle records sequential loopback timing
for diagnostics; those observations are not performance samples and must not
be used to claim parity or an overhead percentage.

PERF9-01B must use these qualified semantics, pin the actual measured artifacts,
and add randomized/alternating sampling, CPU/memory domains, uncertainty and
bounded load. Live Fastly evidence remains a separate environment. #272 and
#301 remain open; this task establishes only the local comparison preflight.

The PERF9-01B runner is documented in [local forwarding measurements](MEASUREMENTS.md).
The [frozen results report](RESULTS.md) includes provenance, interpretation and
commands to replay the retained evidence after relocation.
