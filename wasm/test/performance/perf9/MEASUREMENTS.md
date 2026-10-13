# PERF9-01B — local forwarding measurements

This is a bounded measurement campaign for #301, using PERF9-01A's qualified
Pulse/Rust artifacts and the existing Fastly host-handoff contract. It does not
change either guest, deploy to Fastly, change release gates or create a general
benchmark framework. PERF9-01C owns the published results narrative.

## Run

Use a clean, committed checkout, the pinned Pulse workspace dependencies,
Rust/Cargo 1.90.0 with `wasm32-unknown-unknown`, and Viceroy 0.21.1 as described
in [the parity preflight](README.md). Run the campaign alone: do not build or
run tests beside it. The runner locks other PERF9 campaigns in this checkout,
not unrelated processes or other tenants on the machine.

```sh
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/scripts/run-wasm-tests.cjs \
  --task perf9-01b-measurements --report .test-results/perf9-01b-attempt1.json
```

This runs full PERF9-01A qualification first, then measures byte-identical copies
of its default artifacts. A missing/mismatched toolchain, unsupported operating
system, unavailable procfs metrics or failed parity is a failure, not a skipped
or successful comparison. Linux is required for process CPU/RSS measurement.
No production dependencies are added. The task is explicitly selected and is
not a fast-CI or release-seal gate.

For runner development, reuse an exact validated parity report and run the
short profile. Its results are labeled smoke and cannot support inference:

```sh
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/test/performance/perf9/measure.cjs \
  --profile smoke --seed 90102 --parity /absolute/path/to/parity.json
```

The same explicit options accept `--profile standard` for a measured campaign.
Never retry selected unfavorable blocks. Choose a fresh full attempt; retain
failures and explain why it was rerun. SIGINT/SIGTERM records interruption and
cleans up children. A force-killed report remains `running` and cannot validate.
A lock surviving a hard kill must be inspected for a live owner before removal.

Each attempt retains `wasm/.test-results/perf9-01b-*/measurements.json`, copied
Wasm, Viceroy config and bounded diagnostic logs. Raw paired blocks, every
attempt, RSS samples, CPU counters and errors remain in the JSON. The report
references the exact parity report, so retain that result directory as well.
Local artifact paths are absolute. To recompute summaries and verify files:

```sh
node wasm/test/performance/perf9/measure.cjs --check /absolute/path/to/measurements.json
```

Validation checks complete coverage and balanced order, binary lengths,
concurrency, origin receipts, CPU counter arithmetic, RSS maxima, percentile
and bootstrap recomputation, qualification/artifact hashes, source hashes and
diagnostic recovery. Synthetic tests cover the sampler, noisy/inadequate
inference and procfs parsing; mutation tests reject partial, altered, errored
and wrong-environment reports. A passed report means this campaign completed
correctly, not that Pulse met a speed threshold or a release was qualified.

## Sampling protocol

`measurement-protocol.cjs` pins the protocol before measurements:

| Cases | Standard samples per implementation and cell |
| --- | --- |
| Echo: 1 KiB, 64 KiB, 1 MiB × concurrency 1 and 4 | 30 blocks × 16 requests = 480 requests |
| Paced origin response: 1 MiB × concurrency 1 and 4 | 12 blocks × 4 requests = 48 requests |
| Slow client: 1 MiB × concurrency 1 and 4 | 12 blocks × 4 requests = 48 requests |

Eight warmup requests per implementation/cell are recorded but excluded.
Both persistent Viceroy servers are started before sampling, with profiling
disabled and logs set to errors. Startup compilation is excluded. Each request
still creates a fresh guest invocation. Client agents use HTTP/1.1 keep-alive
and at most four sockets. The origin/backend and binary pattern are identical.

A seeded shuffle orders cells. Each cell has an equal number of Pulse-first
and Rust-first blocks, shuffled with the same recorded seed. Both members run
adjacently; both outcomes are retained before a failing block is rejected.
Requests within a block use closed-loop lanes: a lane starts its next request
when the previous one completes. This is bounded load, not an open-loop offered
arrival rate or a claim about saturation capacity. Short cells do not establish
long-duration memory stability. Environment, CPU quota and memory limits are
recorded, but shared-machine contention and thermal drift are not controlled.

The origin checks incoming bytes incrementally, waits for upload EOF, then
returns the same bytes from one shared immutable fixture buffer. It does not
retain a separate whole request. This preserves sequential upload/response and
avoids accidentally triggering early-response semantics. Client byte checks
are also incremental. Their CPU cost is in the separate Node harness process,
although loopback end-to-end latency includes that harness's work.

The paced origin writes 16 KiB chunks, honoring `drain`, with 2 ms requested
spacing. The slow client pauses reads for 2 ms after each received chunk;
actual chunking/timer scheduling is OS-dependent. Guest completion can precede
slow-client receipt because successful close is host handoff. These workloads
exercise external backpressure; they do not establish a bound on Fastly or
Viceroy queues.

After measurements, each guest receives three post-header deadline stalls and
three client cancellations after the origin sees a chunked upload prefix.
Cancellation uses an unknown-length body, matching the qualified incremental
path. In the initial smoke probe, a declared-length partial upload did not
reach the origin before the 5-second harness timeout on either guest. That
failed attempt is retained; this campaign makes no declared-length incremental
cancellation claim. Each probe
must be followed by a healthy binary request. These outcomes and completion
times remain separate from ordinary latency/throughput distributions.

## Metric domains

| Metric | What it means and excludes |
| --- | --- |
| Completion latency / time to headers | Node client request creation to full response/error, and receipt of headers. Includes loopback transport, host wait, validation and client/origin scheduling; excludes build/startup/warmup |
| p50/p95 and raw distribution | Successful request latency is labeled separately from all attempt completion time; no silent dropping of failures |
| Throughput | Successful responses or response bytes / measured block wall time; fixed concurrency, excludes inter-block settle and warmup |
| CPU | Delta of Linux Viceroy process `utime` + `stime`, all threads. Includes guest execution, runtime and host work; excludes the Node client/origin. Recorded tick resolution may be coarse; zero ticks does not mean zero CPU |
| Guest-only / host-only CPU | Explicitly unavailable. Unchanged guests have no per-request CPU counter, and process CPU cannot split guest from host or quantify network wait by subtraction |
| Guest memory | PERF9-01A's exact-artifact linear memory and 16 KiB scratch proof; not process RSS or host queues |
| Sampled VmRSS | Viceroy process resident bytes, sampled every 10 ms plus boundaries; a lower bound on a possible short-lived peak, including runtime/JIT/guest/host storage |
| VmHWM | Kernel process-lifetime RSS high-water, including startup; do not interpret as per-block allocation, guest-only memory or a leak |
| External buffering | Observed client chunk + remaining readable bytes, client upload writable bytes, origin writable bytes and drain waits. These are Node/transport observations, not Viceroy/OS queue occupancy |

CPU/RSS windows include a 20 ms post-block settle interval for request teardown;
latency/throughput duration does not. Raw before/after ticks, sample timestamps,
PID start-time identity and window duration make this boundary auditable.
If procfs exposes outer-namespace PIDs, the sampler resolves only its direct
child using parent PID, namespace identity and the child's namespace PID.
No `wall time − CPU` estimate is labeled network wait. Viceroy process CPU is
never compared to Node CPU or deployed Fastly billing metrics.

## Uncertainty and interpretation

For each cell, the primary comparison is the **mean paired block-p50 latency**:
absolute Pulse-minus-Rust milliseconds and percentage relative to Rust. It is
not the ratio of the pooled request medians. Pooled p50/p95 remain descriptive.
The 95% percentile bootstrap resamples whole paired blocks 4000 times, preserving
within-block correlation and Pulse/Rust pairing. It is exploratory local
uncertainty; serial correlation and shared-host drift can still understate it.
It does not establish causal isolation or transfer to deployed Fastly.

At least 20 paired blocks, the standard profile and zero unexpected errors are
required for a directional label. The 1–3% hypothesis is resolvable only when
the relative interval is at most 2 percentage points wide. Otherwise the report
says **inconclusive at this resolution**. An interval wholly above zero favors
Rust latency; wholly below zero favors Pulse. An interval may demonstrate a
large difference while remaining too wide to resolve a 1–3% band. The slow
cases intentionally have fewer blocks and remain descriptive. No performance
threshold determines task success.

Keep local Viceroy, injected-ABI memory observations and any later live Fastly
measurements in separate domains. #301 remains open until PERF9-01C reports the
reproducible results and limitations; deployment is a separate action.
