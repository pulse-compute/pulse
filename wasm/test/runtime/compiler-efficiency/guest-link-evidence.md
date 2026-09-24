# Guest-link optimization evidence

Evidence-only follow-up to PR #74, based on `latest` at
`dfe6a60b4df1eade7ac9464db4003748c84465e3`. No named implementation Entry Point
matches this experiment; the ordinary instruction chain applies. Production
optimization settings, audit policy and receipts remain unchanged.

The [machine-readable capture](guest-link-evidence-result.json) contains all
24 runtime samples, artifact hashes, source/tool identities and the terminal
outcome. The [opt-in harness](guest-link-evidence.cjs) reproduces the four cells.

## Findings

1. **The existing guest-link command does not schedule the default optimizer
   pipeline.** `optimizationPostures` in
   `wasm/packages/wasm-guest-link/src/constants.js` supplies optimization/shrink
   levels and `--strip-debug`; size mode also supplies `--converge`. With the
   pinned Binaryen executable, `--debug` reports only `strip-debug` for default
   mode and two `strip-debug` iterations for size mode. The levels configure
   passes; `-Oz` actually schedules a default optimization pipeline. The proof
   records the exact configured arguments and observed pass names for all four
   cells. AssemblyScript optimization still runs earlier; this finding concerns
   the post-link stage specifically.
2. **PR #74's unrestricted postpass changes static data segmentation.** Its
   `-Oz` pipeline runs memory packing. The original Node default artifact has
   21 segments; the packed control splits away zero-filled spans. Pulse's
   `assertFinal` requires exact validated segments. Reissuing a hash alone is
   insufficient for integration under that contract.
3. **Skipping memory packing retains useful gains and passes the existing
   structural audit.** Add `--skip-pass=memory-packing` to the bounded flags.
   Every candidate passes the actual `assertFinal` against its original
   validated primary/guest/memory-owner facts, plus `memoryLayoutProof`, exact
   data segments, MVP features, ABI/memory limits and shape checks. Maximum
   parameters remain seven. All baseline receipts accept their original bytes;
   all reject changed candidate bytes with `PULSE_GUEST_FINAL_AUDIT_FAILED`.
   No new production receipt is issued by this experiment.

| Target / profile | Wasm B, before → after | Reduction | Largest body B, before → after |
| --- | ---: | ---: | ---: |
| node-default | 39,354 → 36,100 | 8.27% | 3,299 → 3,024 |
| node-size | 39,151 → 35,926 | 8.24% | 3,299 → 3,024 |
| fastly-default | 113,006 → 108,804 | 3.72% | 4,546 → 4,530 |
| fastly-size | 94,784 → 91,447 | 3.52% | 3,383 → 3,140 |

These replace PR #74's 7–9% guest-size figures **for the candidate that preserves
current audit requirements**. Memory packing explains the difference. The
original PR #74 measurements remain valid for its experimental artifact copies.

## Runtime and memory observations

Each cell has one fresh build with an empty materialized-guest cache. Baseline
and candidate derive from the same artifact. Three fresh-process samples per
variant alternate order. Each probe constructs a module, executes its first
request, warms 25 requests, then times 100 successful ES256 verifications with
fresh request instances. Valid, wrong-signature and disallowed-algorithm cases
also pass independently; Fastly rejection stages remain 217 and 212. The clock
is fixed at 2,000,000,000 seconds. Values below are median (minimum–maximum).

| Target / profile / variant | First module ms | First request ms | 100 warm requests ms | Process peak RSS MB |
| --- | ---: | ---: | ---: | ---: |
| node-default / baseline | 0.50 (0.47–0.55) | 25.99 (24.79–26.08) | 269.19 (265.35–271.56) | 137.13 (137.03–139.33) |
| node-default / merged | 0.43 (0.38–0.51) | 24.58 (24.23–25.35) | 259.99 (247.91–261.65) | 137.19 (136.78–138.31) |
| node-size / baseline | 0.50 (0.47–0.62) | 27.26 (23.93–28.58) | 279.01 (266.97–288.45) | 139.61 (138.38–140.30) |
| node-size / merged | 0.45 (0.41–0.57) | 24.59 (23.98–24.92) | 265.02 (254.03–266.91) | 137.51 (137.15–137.83) |
| fastly-default / baseline | 0.55 (0.52–0.56) | 7.90 (7.60–8.13) | 266.33 (252.08–282.14) | 182.73 (182.49–183.72) |
| fastly-default / merged | 0.60 (0.58–0.60) | 7.93 (7.60–9.89) | 273.53 (268.22–297.19) | 182.92 (182.86–184.16) |
| fastly-size / baseline | 0.54 (0.53–0.57) | 8.64 (8.56–8.99) | 280.90 (257.11–284.92) | 153.12 (152.79–182.07) |
| fastly-size / merged | 0.58 (0.56–0.60) | 8.50 (8.30–8.83) | 271.74 (268.41–275.60) | 180.57 (176.83–182.70) |

The Node warm samples favor the candidate; Fastly warm ranges overlap. First
module and first request results are mixed, so this does not establish uniformly
faster cold loads. First request follows module construction and may reuse V8's
compiled-code cache. The proof does not isolate JIT tiers.

Node retains 37 value handles and one effect for the successful request; this
fixture exposes no retained-value budget snapshot. Fastly remains at 32 fixed
64-KiB pages (2 MiB). Whole-process RSS includes the harness, dependencies and
transient instances. In Fastly size mode its median rises from about 153 MB to
181 MB, with overlapping ranges; there is **no consistent memory improvement**.
Further memory work should separate host heap, linear-memory instance lifetime
and JIT/code memory rather than infer memory gains from smaller artifacts.

These are Node/V8 and Fastly ABI harness observations, not Viceroy or deployed
qualification, and cover this ES256 fixture rather than every guest operation.
The focused run does not measure compiler RSS or claim a compile-time saving.
PR #74's serial cold-build evidence remains the compilation reference.

## Bounded next implementation pass

The concrete owner is `wasm/packages/wasm-guest-link/src/pipeline.js`, where
`runTool('wasm-opt', ...)` sits between composition validation and final
inspection/auditing. Explicitly schedule the chosen optimizer pipeline in that
existing invocation, retain the bounded inlining settings, and disable memory
packing while exact segments are contractual. Update the owned posture/config
and provenance records as required; regenerate final audits and provider
packaging identity from the resulting bytes. Keep current profiles as comparison
controls and replay guest-link rejection tests plus target semantics.

That is an integration hypothesis supported by this capture, not a completed
integration or permission to relax audit contracts. After that bounded proof,
prioritize memory attribution and decomposition of remaining monolithic code;
no further broad optimizer search is needed for this decision.

## Reproduce and evidence identity

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-guest-link-evidence --report .test-results/compiler-efficiency/guest-link-evidence/proof.json
```

The task is explicitly outside ordinary release-profile membership. Detailed
Wasm/WAT, original receipts, optimizer traces and measurements remain under
`wasm/.test-results/compiler-efficiency/guest-link-evidence/`. The terminal
runner report is `attempt-02.json`: four cells and 24 runtime probes passed in
56.64 seconds. Attempt 01 is retained separately; its exact-segment assertion
exposed memory packing. The passing run disables that optimization instead of
loosening the audit.

Measured code revision: `ac183a2b4289f9cd1cc9594a07f94d797b95cd55` (clean tree).
Harness SHA-256: `4923f0667da7bf14a54f17a14a1c0df564ff79f9291476706b3dff22f1bc5868`.
Node: `v24.19.0`. Binaryen: `129.0.0-nightly.20260428`.
The result JSON records the shared harness, lockfile and tool hashes. Subsequent
committed changes only add this evidence record and its compact raw samples.
