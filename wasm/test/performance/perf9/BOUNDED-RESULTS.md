# PERF9-02 — bounded-size forwarding results

**Bounded-size reduces this Pulse Wasm artifact by 7,027 bytes (16.7%), with
no resolved latency or process-CPU change versus default Pulse in the three
selected cases. Guest/host CPU attribution remains unavailable.** This is the
final evidence-only forwarding characterization requested in
[#313](https://github.com/pulse-compute/pulse/issues/313).

The same forwarding source and contract passed for all three artifacts. Default
Pulse remains 42,040 bytes, bounded Pulse is 35,013, and unchanged Rust is 15,359.
Bounded Pulse remains 19,654 bytes larger than Rust. Default and bounded Pulse
have the same 1,310,720-byte injected-ABI linear-memory observation; Rust has
1,114,112 bytes. The size flag does not reduce this observed guest-memory domain.

The [protocol](BOUNDED.md) preserves the selected PERF9-01B workloads and uses
balanced three-arm blocks. This is a **new campaign**. The
[original default-Pulse/Rust baseline](RESULTS.md), raw samples and hashes are
unchanged; no old and new timing data are pooled.

## Findings and stop decision

- Bounded-minus-default latency intervals cross zero in all three cases, as do
  their process-CPU intervals. The small negative 1 MiB point estimates and the
  large negative 1 KiB point estimate do not establish a speedup or 1–3% parity.
- In this new run, default Pulse has higher latency than Rust at 1 MiB/c1:
  +1.100 ms, exploratory 95% interval +0.012 to +2.172 ms. That lower endpoint
  is close to zero, and the interval is unadjusted for nine comparisons.
  The other eight latency intervals cross zero. This does not erase the
  original campaign's separate 1 KiB/c4 Rust advantage.
- Process CPU is higher for both Pulse artifacts than Rust at 1 KiB/c4, and
  for default Pulse at 1 MiB/c1, with positive exploratory intervals. The other
  CPU comparisons cross zero. These are process-level observations with coarse
  counters, not guest costs or a causal account of overhead.
- Bounded build wall times and ASC RSS observations are recorded below. Only
  three fresh builds per artifact were collected; their ranges overlap. No
  statistically established compile-time or compiler-memory improvement is claimed.

No product or compiler code, optimization default, routine CI/release selection
or deployment changes. The optional scalar-retention diagnostic was deferred;
these results neither establish nor dismiss #289's mechanism. This ticket stops
at the measured size reduction, unresolved bounded/default timing and CPU
differences, and documented CPU-attribution gap. No further performance run is
required by this experiment.

<!-- perf9-bounded-results:start -->

## Frozen campaign

Measured requests: **4320**; unexpected errors: **0**. Excluded warmups: **72**. Separate profiled requests: **96**. Each cell has 30 three-arm blocks and 480 measured requests per artifact.

Attempt (UTC): 2026-10-13T04:15:30.790Z through 2026-10-13T04:17:48.516Z. Unprofiled sampling: 2026-10-13T04:16:49.733Z through 2026-10-13T04:17:44.090Z.

Clean measured source: `28d89fea2e76d03097888ce7b663eaee5501c3d5`; tree `e102a0cc5a603afc18913ef11564f1130ee2590e`. Reporting/replay files were added afterward; measured scripts remain hash-identical.

Local linux/x64, kernel 6.18.44; AMD EPYC 9V74 80-Core Processor; 8 available CPUs; cgroup CPU quota `800000 100000`; memory limit 8192.000 MiB. No other assistant build/test workload ran during sampling; unrelated shared-machine activity was not controlled.

Node v24.19.0; Viceroy 0.21.1; TypeScript 5.9.3; AssemblyScript 0.28.18; json-as 1.5.0; Rust/Cargo 1.90.0, wasm32-unknown-unknown. Exact identities and compiler recipes remain in the raw receipt.

| Identity | SHA-256 |
| --- | --- |
| Raw report | ecc8216bd8da79c8955c711ab2ca7121ad427ce8cfb9a60aa36f8d3ee4665bd2 |
| Archive | ca063d3e9268aa7ed98b1f30041bb5d136c864393c8beaec75938bd390c449af |
| Manifest | daa886a03679b0ba530e5744530dad1d2a754e1a0351b4cb3451515dc3766560 |
| Viceroy | 881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9 |
| Workspace lockfile | 2b7fb127800ce3723ffa450f7978c1cb72b86238850cd5da4695cfc23b460ec3 |

## Artifact and build domains

| Artifact | Wasm bytes | Wasm SHA-256 | Guest linear memory bytes |
| --- | --- | --- | --- |
| default | 42040 | 3d45684127ee2900318f55be5e3057902f6fdac3863468db143b3de2fbbfdc38 | 1310720 |
| bounded | 35013 | 384320f6b77505a180d1b1b592413fc60c11400b9636b15f6c2b55610cfc04d8 | 1310720 |
| rust | 15359 | 28069f4c4065bb4b04fd6550903a99bb02475163354e8bf13388951b14e8bb32 | 1114112 |

Three fresh builds per artifact, Latin-square order; all repeat hashes match. Pulse default and bounded have identical generated AssemblyScript source hashes. Payload scratch is 16,384 bytes for every artifact. Qualification passed 268 ABI cases and 19 real Viceroy wire cases per artifact, plus 98 differential cases for each Pulse/Rust pairing.

| Artifact | Build wall ms: each observation | Median ms | Peak compiler RSS MiB: each observation |
| --- | --- | --- | --- |
| default | 6243.2 / 4983.8 / 4478.4 | 4983.8 | 321.6 / 303.9 / 294.5 |
| bounded | 4550.9 / 4795.4 / 4176.2 | 4550.9 | 309.9 / 303.2 / 298.4 |
| rust | 510.7 / 457.6 / 503.9 | 503.9 | 117.9 / 118.4 / 118.4 |

Build times are descriptive project-build observations (three per arm), not a compiler-speed significance test. Pulse RSS is the maximum individual ASC process including re-exec; Rust RSS is the maximum individual waited Cargo/rustc descendant. These are different process compositions, not simultaneous build-tree memory or a pure language-memory ratio.

## Unprofiled latency and throughput

Columns use **default Pulse / bounded Pulse / Rust**. Pooled request percentiles are descriptive and differ from the paired block estimator. Rates are arithmetic means of per-block rates; response MiB/s counts only the response direction.

| Cell | Completion p50 ms | Completion p95 ms | Headers p50 ms | Responses/s | Response MiB/s |
| --- | --- | --- | --- | --- | --- |
| 1 KiB / c4 | 2.904 / 2.830 / 1.825 | 46.942 / 46.535 / 46.325 | 2.134 / 2.040 / 1.461 | 260.14 / 303.53 / 343.00 | 0.25 / 0.30 / 0.33 |
| 1 MiB / c1 | 8.424 / 8.096 / 7.190 | 52.920 / 51.940 / 52.009 | 5.857 / 5.492 / 5.182 | 54.52 / 54.10 / 59.74 | 54.52 / 54.10 / 59.74 |
| 1 MiB / c4 | 12.105 / 11.905 / 12.140 | 52.283 / 53.768 / 58.689 | 9.950 / 9.873 / 9.976 | 210.81 / 198.75 / 194.06 | 210.81 / 198.75 / 194.06 |

All nine paired comparisons are retained. Delta means left minus right; positive favors right. Estimator: difference of mean block-p50s, 4,000 paired-block bootstrap resamples, exploratory unadjusted 95% intervals. Relative delta is the ratio of mean block-p50s minus one. Zero-crossing intervals do not establish equivalence.

| Cell | Left minus right | Delta ms [95% interval] | Delta % [95% interval] | Direction |
| --- | --- | --- | --- | --- |
| 1 KiB / c4 | bounded − default | -2.313 [-5.836 to +0.100] | -43.864 [-66.410 to +3.471] | inconclusive at this resolution |
| 1 KiB / c4 | default − rust | +2.058 [-2.075 to +6.287] | +63.996 [-37.735 to +327.046] | inconclusive at this resolution |
| 1 KiB / c4 | bounded − rust | -0.255 [-3.277 to +1.561] | -7.939 [-54.156 to +89.070] | inconclusive at this resolution |
| 1 MiB / c1 | bounded − default | -0.240 [-1.605 to +1.423] | -2.766 [-17.081 to +16.985] | inconclusive at this resolution |
| 1 MiB / c1 | default − rust | +1.100 [+0.012 to +2.172] | +14.496 [+0.148 to +29.456] | rust lower latency |
| 1 MiB / c1 | bounded − rust | +0.860 [-0.602 to +2.710] | +11.329 [-7.326 to +37.827] | inconclusive at this resolution |
| 1 MiB / c4 | bounded − default | -0.074 [-1.213 to +1.151] | -0.615 [-9.677 to +9.901] | inconclusive at this resolution |
| 1 MiB / c4 | default − rust | -1.207 [-3.131 to +0.327] | -9.093 [-20.405 to +2.849] | inconclusive at this resolution |
| 1 MiB / c4 | bounded − rust | -1.281 [-3.877 to +0.773] | -9.651 [-25.115 to +6.560] | inconclusive at this resolution |

## Unprofiled process resources

CPU includes every Viceroy thread (guest + Wasmtime/runtime + host), excluding the Node client/origin. Windows include the original 20 ms settle; procfs resolution is 10 ms before block amortization. RSS maxima are sampled; HWM is a separate lifetime counter, including startup and prior cells. Neither is guest allocation.

| Cell | CPU ms/attempt D / B / R | Sampled RSS max MiB D / B / R | Lifetime HWM max MiB D / B / R |
| --- | --- | --- | --- |
| 1 KiB / c4 | 1.896 / 1.938 / 1.146 | 61.852 / 65.238 / 58.871 | 73.063 / 81.223 / 68.340 |
| 1 MiB / c1 | 10.333 / 9.604 / 9.208 | 66.438 / 72.902 / 68.141 | 73.063 / 81.223 / 68.340 |
| 1 MiB / c4 | 7.458 / 7.313 / 8.063 | 71.918 / 80.672 / 68.730 | 73.063 / 81.223 / 68.340 |

Process CPU differences use a paired-block bootstrap of CPU/attempt; intervals do not improve counter resolution or isolate guest execution.

| Cell | Left minus right | CPU ms/attempt delta [95% interval] |
| --- | --- | --- |
| 1 KiB / c4 | bounded − default | +0.042 [-0.313 to +0.333] |
| 1 KiB / c4 | default − rust | +0.750 [+0.417 to +1.146] |
| 1 KiB / c4 | bounded − rust | +0.792 [+0.583 to +1.000] |
| 1 MiB / c1 | bounded − default | -0.729 [-1.708 to +0.250] |
| 1 MiB / c1 | default − rust | +1.125 [+0.229 to +2.083] |
| 1 MiB / c1 | bounded − rust | +0.396 [-0.771 to +1.479] |
| 1 MiB / c4 | bounded − default | -0.146 [-0.438 to +0.146] |
| 1 MiB / c4 | default − rust | -0.604 [-2.250 to +0.646] |
| 1 MiB / c4 | bounded − rust | -0.750 [-2.417 to +0.521] |

## Separate guest-profile coverage

New servers after unprofiled sampling; 32 sequential 1 MiB requests per artifact, guest epoch sampling requested at 50 µs. Raw sample counts below describe retained profile coverage only. They are not comparable CPU costs, CPU shares, or calibrated CPU milliseconds.

| Artifact | Successful profiled requests / profiles | Guest-stack samples | Empty stacks |
| --- | --- | --- | --- |
| default | 32 / 32 | 1482 | 0 |
| bounded | 32 / 32 | 1444 | 0 |
| rust | 32 / 32 | 1241 | 0 |

Guest CPU, host/runtime CPU, kernel CPU and unknown CPU shares: **unavailable**. The all-thread sampling denominator is absent; calibrated CPU milliseconds are unavailable.

<!-- perf9-bounded-results:end -->

## Why CPU attribution is unavailable

Pinned Viceroy 0.21.1 advertises guest, perfmap, jitdump and vtune strategies.
Its [exact source](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/execute.rs)
passes native profiling strategy to Wasmtime and samples guest stacks through
epoch callbacks driven by a sleeping thread. Its
[dependency pin](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/Cargo.toml)
is Wasmtime 39.0.2. Guest profiles locate functions, but do not supply a
process-wide CPU sampling denominator or calibrated per-request guest CPU.

On this machine, `perf_event_paranoid` is 2. The valid 128-byte
`perf_event_open` probe opened, enabled and read a software task-clock counter;
the hardware-cycle event returned ENOENT. The `perf` executable was absent.
An attempted package-index fetch failed at restricted setgroups/seteuid
operations, so no profiler package was installed. An earlier malformed
56-byte probe returned E2BIG; that is retained as a corrected probe failure,
**not** evidence that perf permissions were categorically denied.

The available tools therefore did not produce a symbolized all-thread native
CPU capture. JIT strategy support alone is insufficient to classify executable
guest code, imports, runtime/host code, kernel and unknown samples. We do not
derive guest milliseconds from epoch counts, subtract guessed host overhead
from process CPU, or label wall-minus-CPU as network time. No Viceroy fork,
privilege change or host modification was made for attribution.

## Limits

This is local Viceroy, not deployed Fastly, a saturation test, or a general
language comparison. Long completion tails and block-to-block variation remain.
Pooled request medians and the mean block-p50 estimator can differ substantially,
especially at 1 KiB. Exploratory intervals are unadjusted; time correlation and
uncontrolled shared-machine activity may remain. Throughput is descriptive.

Process-lifetime HWM includes earlier cells and startup. Sampled RSS can exceed
the separately reported HWM, as in the frozen baseline; the cause remains
unresolved. Neither reading establishes an exact allocation bound, per-request
retention, or a leak. ABI linear memory is a separate exact-artifact observation.
Profiles were captured only after unprofiled servers stopped; their request
times are excluded from all performance comparisons.

## Replay and attempt history

The handoff supplies `Pulse-PERF9-02-evidence.zip`; its exact hash is pinned in
`bounded-baseline.json` and above. It retains raw builds, receipts, Wasm files,
generated inputs, blocks, profiles, feasibility probes and both campaign
attempts. Disposable compiler target/cache duplicates are excluded. No original
baseline bundle is replaced.

With this checkout's pinned dependencies restored and built, extract into a
new directory and replay offline:

```sh
sha256sum /path/to/Pulse-PERF9-02-evidence.zip
python3 -m zipfile -e /path/to/Pulse-PERF9-02-evidence.zip /tmp/perf9-bounded
node wasm/test/performance/perf9/bounded-results.cjs --check /tmp/perf9-bounded
```

Replay checks the pinned manifest and every archived file, original clean
source identity, measured script hashes, compiler receipts, binary qualification,
raw blocks, profiles, recomputed summaries and generated tables. Old absolute
evidence paths resolve through the verified manifest during synchronous
validation; no files are written at those paths. It needs no Rust compiler,
Viceroy process or new timing run. `--write` regenerates only the marked tables;
narrative interpretation remains reviewed prose. Missing or altered evidence
fails closed. Replay verifies retained evidence rather than rerunning semantic
oracles or attesting deployed code.

| Attempt | Outcome |
| --- | --- |
| `perf9-02-shphDV` | Failed before any build or sample: stale PERF9-01B lock. The old receipt was terminal passed and no live measurement process existed; the lock was retained before retry. |
| `perf9-02-EA2j5v` | Passed the complete campaign, including qualification, every block and separate profiling. No block was dropped or individually retried. |
| Build smoke and profile feasibility | Passed development probes before the clean campaign; excluded from performance inference. |

This is development evidence, not a release seal. Merge and issue closure remain
human decisions; there is no automatic closing keyword for #313.
