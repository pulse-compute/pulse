# PERF9-01C — frozen local forwarding baseline

The first equivalent Pulse/Rust campaign completed successfully, but it does
**not establish a general 1–3% Pulse wall-clock overhead**. In the 1 KiB,
concurrency-4 case, Rust has lower latency: Pulse's mean paired block-p50 is
**0.456 ms higher (+24.0%)**, with an exploratory 95% interval of **+0.090 to
+0.753 ms (+4.2% to +44.5%)**. That relative interval is above the hypothesized
1–3% band. The other five ordinary cells' intervals cross zero; this does not
demonstrate parity. All samples, including unfavorable ones, remain in the
frozen report.

This completes the local results deliverable for [#301](https://github.com/pulse-compute/pulse/issues/301),
following [PERF9-01A](README.md) and [PERF9-01B](MEASUREMENTS.md).
It measures **bounded copying under Fastly host handoff**, not a zero-copy
body-handle shortcut. Both guests forward opaque binary data with the same
16 KiB scratch buffer, caps, deadlines, header policy and ownership contract.
Semantic parity was qualified before measurement. No product implementation,
sampling rule, support promise or release gate changes in PERF9-01C.

## What the observations support

- Rust wins the ordinary 1 KiB/c4 paired latency comparison. Its Wasm artifact
  is also smaller: 15,359 versus 42,040 bytes. Pulse adds 26,681 bytes in this
  minimal fixture; those sizes do not predict a larger application's size.
- Both guests completed every measured request without an unexpected error,
  plus the paced-origin, slow-client, deadline and cancellation/recovery cases.
  This is evidence for these bounded workloads, not saturation capacity.
- Rust's mean measured process CPU/attempt is lower in nine of ten cells;
  Pulse's is lower in slow-origin/c4. These are descriptive process counters,
  not isolated guest costs or statistically established CPU differences.
- The injected-ABI fixture reports 1,310,720 bytes of Pulse linear memory and
  1,114,112 bytes of Rust linear memory, a 192 KiB difference. Payload scratch
  is 16 KiB in each. Local Viceroy process memory is a different measurement.

The tables below are reproduced by `results.cjs` from the hash-pinned raw
archive identified by `baseline.json`. They contain no new timing run.
P means Pulse; R means Rust; c1/c4 means one/four concurrent request lanes.

<!-- perf9-results:start -->

### Campaign and provenance

Measured requests: **6,144**; unexpected errors: **0**. Excluded warmups: **160**. Separate diagnostics: **12**, each with a successful recovery request.

Attempt timestamps (UTC, including qualification/setup/diagnostics): 2026-10-13T02:57:14.702Z through 2026-10-13T03:00:37.154Z.

Local linux/x64, kernel 6.18.44; AMD EPYC 9V74 80-Core Processor. Available parallelism 8; CPU quota `800000 100000`; memory limit 8192.000 MiB. Shared-machine activity was not controlled.

Node v24.19.0; Viceroy 0.21.1; TypeScript 5.9.3; AssemblyScript 0.28.18; json-as 1.5.0.

```text
rustc 1.90.0 (1159e78c4 2025-09-14)
binary: rustc
commit-hash: 1159e78c4747b02ef996e55082b704c09b970588
commit-date: 2025-09-14
host: x86_64-unknown-linux-gnu
release: 1.90.0
LLVM version: 20.1.8
cargo 1.90.0 (840b83a10 2025-07-30)
```

Clean tested source: `2670f2ad6a2d3495cc0ac08c67978a195edbaa9c`; tree: `01f2a7186c04aa9c7786f66c89f5daba567d544e`. The public upload and merged commits in baseline.json have this same tree; only commit metadata differs.

| Identity | SHA-256 |
| --- | --- |
| Raw measurements | 45c1728e43c0da98cbb90e0872ac6949ea73c8656c79da40b581cc46ef0cf2f4 |
| Parity qualification | ed6e2ec17c7883cc4b2d984c138998f7bb232ccff2765600cb894e65968d2ad5 |
| Raw archive | 8775a8f0f6551cb2ff70be8a533636052601423ba572f0c5bff1bc4ebb06c392 |
| Archive manifest | 3e239894584f438faa8087eb7e7c8124475aeb002b4c137fe80e4076e5bbaaa3 |
| Viceroy executable | 881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9 |
| Node executable | bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12 |
| Rust compiler | e6abf55ab1859e7c990be77fd593f51661ea99fb2fde626ae9f4108aaa34e7fa |
| Cargo | 51de284e8bb0d03dcee595a0fb1cb3a952fe9e7e4b953a8b1467b7f71725b561 |
| Rust target libraries (aggregate) | bfa55a926d3f0d7be690254a34f87701da48d2edeba9b44b8f2946bc2cfb1a37 |
| Workspace lockfile | 2b7fb127800ce3723ffa450f7978c1cb72b86238850cd5da4695cfc23b460ec3 |

| Guest | Wasm bytes | SHA-256 | ABI-fixture linear memory bytes | Payload scratch bytes |
| --- | --- | --- | --- | --- |
| pulse | 42040 | 3d45684127ee2900318f55be5e3057902f6fdac3863468db143b3de2fbbfdc38 | 1310720 | 16384 |
| rust | 15359 | 28069f4c4065bb4b04fd6550903a99bb02475163354e8bf13388951b14e8bb32 | 1114112 | 16384 |

Qualification: 268 ABI cases and 19 local Viceroy wire cases per guest, 98 differential cases, plus byte-identical default rebuilds.

### Completion latency

Pooled request percentiles, milliseconds, nearest rank. Pulse / Rust in each column. Echo cells have 480 requests per guest; slow cells have 48. These descriptive medians are not the paired comparison estimator.

| Cell | p50 ms P / R | p95 ms P / R | Headers p50 ms P / R |
| --- | --- | --- | --- |
| 1 KiB / c1 | 2.320 / 1.921 | 47.523 / 47.779 | 1.591 / 1.197 |
| 1 KiB / c4 | 2.389 / 1.791 | 47.404 / 46.490 | 1.839 / 1.361 |
| 64 KiB / c1 | 43.762 / 42.353 | 47.916 / 47.868 | 1.697 / 1.329 |
| 64 KiB / c4 | 41.859 / 17.743 | 48.035 / 48.577 | 2.153 / 1.706 |
| 1 MiB / c1 | 6.825 / 6.761 | 51.763 / 51.948 | 4.985 / 4.597 |
| 1 MiB / c4 | 12.144 / 12.627 | 56.409 / 55.834 | 9.467 / 9.859 |
| slow-origin / 1 MiB / c1 | 142.811 / 142.802 | 190.195 / 179.893 | 5.529 / 4.698 |
| slow-origin / 1 MiB / c4 | 152.258 / 154.718 | 206.456 / 197.739 | 9.519 / 12.166 |
| slow-client / 1 MiB / c1 | 181.095 / 181.952 | 211.893 / 212.600 | 6.775 / 6.290 |
| slow-client / 1 MiB / c4 | 186.191 / 183.482 | 277.210 / 215.893 | 8.497 / 9.423 |

### Paired comparison

Mean of block-p50s: Pulse minus Rust; positive favors Rust. Percent is the ratio of the two means minus one. Intervals are exploratory 95% paired-block bootstrap intervals, unadjusted for multiple cells. All ten cells are shown; 12-pair slow cases do not meet the predeclared 20-pair inference minimum.

| Cell | Pairs | Delta ms [95% interval] | Delta % [95% interval] | Direction |
| --- | --- | --- | --- | --- |
| 1 KiB / c1 | 30 | -5.101 [-11.639 to +0.497] | -39.84 [-73.17 to +5.99] | inconclusive at this resolution |
| 1 KiB / c4 | 30 | +0.456 [+0.090 to +0.753] | +23.98 [+4.16 to +44.53] | Rust lower latency |
| 64 KiB / c1 | 30 | +3.308 [-6.451 to +12.808] | +11.25 [-19.69 to +54.37] | inconclusive at this resolution |
| 64 KiB / c4 | 30 | +4.780 [-4.611 to +14.127] | +26.28 [-21.02 to +108.83] | inconclusive at this resolution |
| 1 MiB / c1 | 30 | -1.136 [-3.858 to +0.415] | -14.39 [-36.61 to +6.56] | inconclusive at this resolution |
| 1 MiB / c4 | 30 | +0.162 [-0.970 to +1.343] | +1.32 [-7.58 to +11.23] | inconclusive at this resolution |
| slow-origin / 1 MiB / c1 | 12 | -0.249 [-2.418 to +1.871] | -0.17 [-1.68 to +1.27] | insufficient evidence |
| slow-origin / 1 MiB / c4 | 12 | +6.831 [-4.087 to +20.499] | +4.41 [-2.63 to +13.46] | insufficient evidence |
| slow-client / 1 MiB / c1 | 12 | -0.436 [-3.019 to +2.236] | -0.24 [-1.66 to +1.25] | insufficient evidence |
| slow-client / 1 MiB / c4 | 12 | +8.959 [-5.206 to +27.564] | +4.85 [-2.79 to +15.03] | insufficient evidence |

The frozen protocol's 1–3% precision label is “inconclusive at this resolution” in 10/10 cells. This label does not negate an interval wholly above the hypothesized band.

### Throughput and process CPU

Arithmetic means of per-block rates and CPU/attempt. Response MiB/s counts the response direction only. CPU is all Viceroy threads (guest + runtime + host), excluding the Node client/origin; its window includes 20 ms settle. CPU tick resolution is 10 ms before amortization across a block. No CPU significance claim is made.

| Cell | Responses/s P / R | Response MiB/s P / R | Process CPU ms/attempt P / R |
| --- | --- | --- | --- |
| 1 KiB / c1 | 69.86 / 56.76 | 0.068 / 0.055 | 3.479 / 3.208 |
| 1 KiB / c4 | 315.98 / 354.98 | 0.309 / 0.347 | 1.521 / 1.104 |
| 64 KiB / c1 | 37.10 / 39.92 | 2.319 / 2.495 | 4.708 / 3.896 |
| 64 KiB / c4 | 153.87 / 152.97 | 9.617 / 9.561 | 2.604 / 1.688 |
| 1 MiB / c1 | 57.96 / 54.27 | 57.956 / 54.266 | 8.854 / 8.104 |
| 1 MiB / c4 | 184.74 / 173.65 | 184.742 / 173.653 | 8.021 / 7.396 |
| slow-origin / 1 MiB / c1 | 6.60 / 6.69 | 6.597 / 6.686 | 29.375 / 27.708 |
| slow-origin / 1 MiB / c4 | 24.62 / 23.77 | 24.621 / 23.769 | 15.625 / 16.875 |
| slow-client / 1 MiB / c1 | 5.38 / 5.36 | 5.375 / 5.360 | 27.500 / 25.417 |
| slow-client / 1 MiB / c4 | 20.53 / 20.44 | 20.532 / 20.444 | 12.500 / 11.875 |

### Process memory

Maximum observed values over measured blocks in each cell, MiB. RSS is sampled; HWM is the separately read process-lifetime counter, including startup and preceding cells. Both Viceroy processes persist across the shuffled campaign. Neither column is guest allocation or a per-request memory bound.

| Cell | Sampled RSS max P / R | Reported lifetime HWM max P / R |
| --- | --- | --- |
| 1 KiB / c1 | 29.359 / 28.477 | 29.109 / 28.418 |
| 1 KiB / c4 | 63.965 / 54.781 | 78.141 / 71.906 |
| 64 KiB / c1 | 61.809 / 66.262 | 71.238 / 70.695 |
| 64 KiB / c4 | 62.934 / 59.836 | 72.957 / 71.906 |
| 1 MiB / c1 | 68.656 / 69.355 | 71.238 / 70.695 |
| 1 MiB / c4 | 71.563 / 70.293 | 71.238 / 70.695 |
| slow-origin / 1 MiB / c1 | 65.547 / 69.910 | 72.957 / 71.906 |
| slow-origin / 1 MiB / c4 | 76.762 / 66.156 | 78.141 / 71.906 |
| slow-client / 1 MiB / c1 | 64.777 / 67.813 | 71.238 / 70.695 |
| slow-client / 1 MiB / c4 | 68.703 / 70.781 | 72.957 / 71.906 |

### Observed buffering

Maximum bytes per observation; Pulse / Rust. Drain waits are totals across measured blocks. These are external Node client/origin observations, not Viceroy/OS queue bounds. A zero drain count is not proof that no backpressure occurred.

| Cell | Client read bytes P / R | Client upload bytes P / R | Origin write bytes P / R | Origin drains P / R |
| --- | --- | --- | --- | --- |
| 1 KiB / c1 | 1024 / 1024 | 1112 / 1112 | 1024 / 1024 | 0 / 0 |
| 1 KiB / c4 | 1024 / 1024 | 1112 / 1112 | 1024 / 1024 | 0 / 0 |
| 64 KiB / c1 | 65350 / 65350 | 65625 / 65625 | 65536 / 65536 | 480 / 480 |
| 64 KiB / c4 | 65350 / 65350 | 65625 / 65625 | 65536 / 65536 | 480 / 480 |
| 1 MiB / c1 | 65350 / 65350 | 1048667 / 1048667 | 65536 / 65536 | 7680 / 7680 |
| 1 MiB / c4 | 65350 / 65350 | 1048667 / 1048667 | 65536 / 65536 | 7680 / 7680 |
| slow-origin / 1 MiB / c1 | 16384 / 32768 | 1048667 / 1048667 | 16384 / 16384 | 0 / 0 |
| slow-origin / 1 MiB / c4 | 32768 / 16384 | 1048667 / 1048667 | 16384 / 16384 | 0 / 0 |
| slow-client / 1 MiB / c1 | 131010 / 131010 | 1048667 / 1048667 | 65536 / 65536 | 768 / 768 |
| slow-client / 1 MiB / c4 | 131010 / 131010 | 1048667 / 1048667 | 65536 / 65536 | 768 / 768 |

### Separate failure/recovery probes

Three repetitions per row. Deadline means post-header body abort; cancellation means client disconnect after the origin observed an unknown-length chunked upload prefix. Elapsed times describe harness observation, not acknowledged host cleanup.

| Guest | Probe | Outcome | Elapsed min–max ms | Healthy recoveries |
| --- | --- | --- | --- | --- |
| pulse | deadline | aborted | 1508.091–1513.600 | 3/3 |
| pulse | cancel | cancelled | 1.515–2.288 | 3/3 |
| rust | deadline | aborted | 1503.779–1509.090 | 3/3 |
| rust | cancel | cancelled | 1.186–5.212 | 3/3 |

<!-- perf9-results:end -->

## Interpretation and limits

The ordinary cases contain 30 paired blocks of 16 requests per guest. The four
slow cases contain 12 paired blocks of four requests per guest and remain
descriptive. Seed 90102 shuffles cell order and balanced Pulse-first/Rust-first
block order. Eight warmups per guest/cell are excluded. The primary estimate
uses **mean block-p50s**, with 4,000 whole-pair bootstrap resamples. Requests
inside a concurrent block are not treated as independent inference samples.
See the [frozen protocol](MEASUREMENTS.md#sampling-protocol) for exact workload
and measurement boundaries.

Pooled medians and the paired estimate answer different questions. For example,
the 1 KiB/c1 pooled medians are 2.320/1.921 ms, while the mean paired block-p50
difference is −5.101 ms with an interval crossing zero. The 64 KiB/c4 pooled
medians are 41.859/17.743 ms, yet the paired interval also crosses zero. Blocks
vary substantially; selecting one statistic as a universal overhead would be
misleading. Ordinary p95 completion times are roughly 46–56 ms despite much
smaller header medians. The report does not identify the cause of those tails:
network/host wait, scheduling and runtime work are not causally separated.

The predeclared 1–3% precision label requires a relative interval no wider than
two percentage points. None qualifies. That conservative precision label must
not obscure the Rust advantage or the interval above 3% in 1 KiB/c4. Intervals
are per-cell and unadjusted for multiple comparisons; serial correlation and
shared-machine drift may remain. No additional campaign was selected to obtain
a preferable result.

The process-memory readings also have an unresolved limitation: some sampled
RSS maxima exceed the separately reported HWM values (for example, ordinary
1 KiB/c1). Both columns preserve the original procfs observations. This campaign
does not establish the cause of that discrepancy, so neither is treated as an
exact allocation bound. Process HWM also carries earlier cells' history; cell
order is retained in the raw schedule. These short measurements do not diagnose
scalar retention, leaks, or long-duration memory stability.

The slow client and origin are a separate Node harness. It validates incoming
bytes incrementally, uses one shared immutable payload, and returns the response
after upload EOF. Client upload writable observations can exceed 1 MiB including
HTTP framing; those are not guest scratch allocations. Successful guest close
hands completion to the host and can precede slow-client receipt. The cancellation
times do not prove host cleanup completion or pending-request cancellation.

Guest-only CPU, host-only CPU, host/OS queue occupancy and deployed Fastly data
are unavailable. No subtraction of CPU from latency is called network wait.
All timing here is local Linux Viceroy; injected-ABI memory proof stays separately
labeled. No geographic, billing, POP or live Fastly conclusion follows.

## Reproduce the frozen report

The raw bundle is **`Pulse-PERF9-01B-evidence.zip`**, supplied with the maintainer
handoff for PR #311. Raw measurements and binaries are retained outside Git;
the repository contains their hashes, the scripts and this readable report.
Exact numerical replay requires that bundle. Its expected SHA-256 is
`8775a8f0f6551cb2ff70be8a533636052601423ba572f0c5bff1bc4ebb06c392`.

Use this PERF9-01C checkout with the lockfile-pinned workspace dependencies
restored and built as described in [the parity preflight](README.md#reproduce).
The replay invokes no Rust compiler, Viceroy, network service or timing workload.
Python is used below only to extract the ZIP; the verifier is Node code.

```sh
sha256sum /path/to/Pulse-PERF9-01B-evidence.zip
# Compare the digest above before extracting into a new directory.
python3 -m zipfile -e /path/to/Pulse-PERF9-01B-evidence.zip /tmp/perf9-baseline
node wasm/test/performance/perf9/results.cjs --check /tmp/perf9-baseline
node wasm/test/performance/perf9/results-checks.cjs /tmp/perf9-baseline
```

The verifier checks the frozen manifest and every archived file, resolves old
absolute paths through the manifest inside the extracted root, recomputes the
existing PERF9-01B summaries/intervals, and invokes the existing PERF9-01A parity
validator on relocated artifact references. It checks actual default rebuild
bytes and Viceroy configurations too. Raw report bytes remain unchanged; it
does not create or overwrite their original absolute paths. Missing, altered,
wrong-campaign or source-drifted evidence fails. This verifies retained evidence;
it does not re-execute the original correctness corpus or attest a deployed binary.

To regenerate only the marked tables, run `results.cjs --write` with the same
extracted root, then `--check`. Review narrative changes separately; prose is
not generated. `baseline.json` deliberately fixes one campaign. Do not repoint
it or replace this report to hide an unsuccessful or slower later run.

## Run a new campaign

For the original measured code tree, use merged commit
`11587c0f2f2b8afc70431ad18900fb0b182773df`. The measured local commit and public
upload commit have the identical Git tree recorded above. Install the pinned
workspace, Rust 1.90.0/wasm32 target and Viceroy 0.21.1 using the
[preflight instructions](README.md#reproduce), then run alone from a clean,
committed checkout:

```sh
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/scripts/run-wasm-tests.cjs \
  --task perf9-01b-measurements --report .test-results/perf9-01b-new-attempt1.json
node wasm/test/performance/perf9/measure.cjs --check /absolute/path/to/new/measurements.json
```

The task rebuilds and qualifies both guests before sampling. Verify the aggregate
terminal status and complete task coverage as well as the detailed report.
Record new source/tree, tool binaries, environment and artifact hashes. Preserve
the entire new attempt and its qualification directory separately. A new run
reproduces the protocol, not identical timing values. Do not use the frozen
report verifier to certify new measurements, pool environments, or retry selected
unfavorable blocks. See [measurement instructions](MEASUREMENTS.md) for explicit
smoke/standard profiles, locks and interruption handling.

## Attempt history and remaining work

| Retained attempt | Outcome and disposition |
| --- | --- |
| `perf9-01b-5qA6mO` | Initial smoke failed before sampling: child PID differed from procfs namespace. Fixed owned-child resolution. |
| `perf9-01b-ExC5zV` | Smoke cells completed; declared-length partial-upload cancellation never reached the origin before the five-second harness timeout on either guest. Retained failure. |
| `perf9-01b-GEAY7w` | Smoke passed using the already-qualified unknown-length chunked cancellation path. No declared-length incremental cancellation claim. |
| `perf9-01b-zexO8l` | First standard launch rejected a stale lock before qualification or measurement. The completed smoke receipt and absence of a live measurement process were checked; the lock was retained separately. |
| `perf9-01b-EMEss3` | Full standard campaign passed after lock recovery, with no blocks dropped or individually retried. This is the sole frozen performance baseline. |

PERF9-01A/B implementation validation and failed attempts remain in the raw
bundle. PERF9-01C adds evidence replay/reporting checks only. This is development
evidence, not a release seal. Issue closure and merge remain human decisions;
this PR does not close #272 or #301 automatically.

The baseline is now available before scalar-lifetime or other runtime changes.
Further experiments should state their question first: an independently repeated
campaign on a quieter host to investigate latency variability, finer CPU/queue
instrumentation to attribute overhead, or a separately authorized deployed Fastly
campaign. These are follow-ups, not hidden conditions for reporting this result.
