# PERF8-06: explain arena-removal memory behavior

Human direction: isolate the guest capacity regression and host RSS behavior
before changing allocation policy. Class: evidence; scope: evidence-only.
No named entry point exactly matches this investigation. The ordinary instruction
chain applies to performance experiments and this internal note. Production
compiler, runtime, provider, dependency installation, limits and defaults are
unchanged. Nothing is added to default CI or release profiles.

## Reproduce

Use the existing lockfile-pinned workspace, Node 24.19.0, unset NODE_OPTIONS and
JSON_CACHE, and commit the source before recording evidence. No Rust rebuild is
needed: this ticket isolates the two Pulse variants; PERF8-05 retains the Rust
comparison. Choose a new output directory outside the tracked source:

```bash
node wasm/test/performance/gc-baseline.cjs --out /tmp/pulse-perf806
node wasm/test/performance/gc-baseline.cjs --check /tmp/pulse-perf806/report.json
```

The runner preserves raw JSON, compile logs, generated source, control and
experimental Wasm, and a terminal campaign report. Workers are serial. Failed
attempts retain their files and must not be relabeled as completed. Do not use
these diagnostic runs as timing evidence or production qualification.

## Guest experiment

The unchanged Fastly allocation fixture builds and validates its ordinary
artifact. Its unpatched/patched hashes must reproduce PERF8-05; the patched
128 MiB failure remains an expected adoption blocker. Experimental artifacts
are compiled separately from the same generated source; they never pass through
or weaken the production ABI admission policy. The existing mock host executes
them with a process-local numeric diagnostic import.

The diagnostic ASC entry edits only its in-memory standard library source map,
after checking complete pinned ITCMS and TLSF hashes. It records allocation
sizes/types, currently managed bytes, GC thresholds/states, completed cycles,
full collection calls, and each growth request. At growth, it traverses free
lists to record total/largest free blocks. Numeric host callbacks allocate no
guest trace objects. Managed bytes include unreachable objects until collection;
post-full-collection figures establish what that collector still retains.

Controls/interventions:

- Trace-only capacity must match the uninstrumented artifact for both original
  payloads and a one-character payload.
- Full guest collection every 65536 allocations tests periodic collection timing.
- Full guest collection before allocations of at least 65536 bytes tests pressure
  from large requests. Neither is proposed production policy.
- Request-sized memory growth replaces doubling only in a diagnostic artifact;
  its allocation histogram and exact responses must match trace-only.
- A reduced version changes only the outer loop bound to an exported diagnostic
  variable. Run 0/1/64/128/256 iterations with one-character input, asserting the
  exact adjusted total and response digest. At 256 it must reproduce capacity.
- After validating the response, collect, then destructively clear the value
  table and collect again. This tests root retention, invalidates all handles,
  and discards the instance immediately. It is not a safe runtime cleanup API.

No input, assertion, production limit, GC setting or installed package is changed.
Wasm capacity is reserved linear address capacity, not process resident memory.
The existing fixture is a Fastly ABI mock under Node, not Viceroy or deployment.

## Host experiment

Build the exact two small schema artifacts from PERF8-05, verify both hashes,
and reuse its request execution and checkpoint schedule. Run observed/yielding
and unobserved request loops, natural and separate forced-host-GC processes,
three repetitions each: 24 workers, 6144 requests. Alternate variant order.
Add V8 GC performance entries, heap statistics and heap-space statistics at the
existing 1/11/41/128/256 checkpoints. Observed workers retain only weak references
to guest memories; unobserved workers have no guest census. The two schedules
must be analyzed separately.

RSS covers the whole process. V8 heap committed/physical bytes and live guest
capacity do not sum to RSS; external and arrayBuffers overlap. A zero weak-memory
census plus remaining RSS cannot identify every native allocation or establish
allocator fragmentation. Forced Node GC is not guest __collect(). GC performance
event delivery is asynchronous; drain queued events before saving the receipt.

## Findings (2026-10-10 America/Denver)

**GC is present, but the Fastly value table keeps scalar temporaries reachable.**
Removing the arena also changes geometric growth and collector scheduling.
Those are separate from the Node host's heap-sizing response.

### Guest roots and the first divergence

The generated fixture's `host_value_number` caches integers below 65536. Its
accumulator starts at 70000, so every one of 524288 additions creates another
`__PulseFastlyValue`. `__pulse_fastly_put` appends a strong reference to the
request-instance value table; generated `__pulse_drop` is a no-op. The owners
are `packages/provider-fastly/src/build/native-platform-capabilities.js` and
`wasm/packages/runtime-core-as/src/compiler/canonical-native-support.js`.
This is within-request retention, not evidence of a cross-request leak.

The small-payload run has 524609 table entries, matching the traced count of
81-byte value objects (runtime type 14). Full GC after the response leaves
66668480 managed bytes unpatched. Clearing that table and collecting leaves
7907280: a reduction of 58761200 bytes. The backing storage and other global
roots remain; this intervention does not imply safe early handle reclamation.
The patched figures are exactly 1 MiB lower in both states.

The reduced small-payload workload retains 67, 2369, 131393, 262465 and 524609
entries at 0, 1, 64, 128 and 256 outer iterations. Output totals and digests are
checked at every point. At 256, its capacity matches the ordinary small case.

The first growth divergence is allocation 6: unpatched requests the 1048576-byte
arena and grows from 2 to 20 pages; patched omits that growth. A subsequent
2097184-byte buffer makes the sequences 20 → 55 pages versus 2 → 37 pages.
Later small requests double those different starting capacities. For escaped
input the growth sequences, in 64 KiB pages, are:

- Unpatched: 2 → 20 → 55 → 110 → 220 → 440 → 880 → 1760 (110 MiB).
- Patched: 2 → 37 → 74 → 148 → 296 → 592 → 1184 → 2368 (148 MiB).

The decisive final patched growth is allocation 524862: a 960140-byte string
request, rounded with allocator overhead to 992927 bytes. Only 525620 free
bytes remain (largest block 525596), so fragmentation alone cannot satisfy it.
It needs 16 additional pages but the growth policy requests 1184, doubling
74 MiB to 148 MiB. Its managed-allocation entry snapshot is 76037376 bytes,
below the 93863616-byte automatic collection threshold. Trace snapshots on
growth identify the latest managed allocation; allocator requests/free lists
are measured directly at the failed search.

### Controlled guest outcomes

Each cell is final guest capacity in MiB; trace-only reproduces the uninstrumented
artifact exactly. Both original payloads and a small payload produce exact
expected responses/digests in every applicable mode.

| Escaped input intervention | Unpatched | Patched |
| --- | ---: | ---: |
| Original / trace only | 110 | 148 |
| Full GC every 65536 allocations | 110 | 148 |
| Full GC before allocations ≥65536 bytes | 110 | 74 |
| Request-sized growth instead of doubling | 79.625 | 79.25 |

For Unicode and one-character inputs, original capacity is 110 MiB unpatched
and 74 MiB patched. The 148 MiB reversal specifically requires the escaped
case's later allocation pressure. Request-sized growth preserves allocation
histograms but causes **799/828 growth events**, versus 7/7 under the default
policy. This illustrates a tradeoff, not a qualified allocator optimization.
The full-GC intervention also has unmeasured latency/CPU cost. Neither ships.

The original patched 128 MiB assertion still fails. Do not enable PERF8-05's
arena patch based only on a diagnostic policy that passes this fixture.

### Host heap behavior

The two schema artifact hashes exactly reproduce PERF8-05. Below are medians
of three independent processes for the unobserved request loop, in MiB. The
observed/yielding loop is recorded separately and also shows larger patched
heap capacity at 256 requests.

| Default Node policy | Unpatched | Patched |
| --- | ---: | ---: |
| Natural RSS, 41 requests | 100.89 | 60.70 |
| Natural RSS, 256 requests | 88.87 | 97.67 |
| Natural V8 heap capacity, 256 | 28.25 | 54.50 |
| Natural V8 physical heap, 256 | 26.53 | 46.88 |
| Post-forced-GC RSS, 256 | 67.48 | 74.23 |
| Post-forced-GC V8 physical heap, 256 | 24.80 | 30.71 |
| Post-forced-GC nursery physical space, 256 | 13.29 | 18.96 |

Natural unobserved workers perform 8/9/8 major collections unpatched and 1/1/1
patched over the full 256 requests. All 30 post-GC censuses across the observed
forced workers have zero live Wasm memories. Remaining RSS therefore must not
be equated with retained guest capacity. More host heap capacity, particularly
nursery space, persists after collection in the patched workers.

The second intervention gives both variants `--max-semi-space-size=4` (a maximum
8 MiB `new_space`) in 12 fresh workers, reusing the exact artifacts and unchanged
host worker. After forced GC at 256, median RSS is **65.49/63.82 MiB** and V8 heap
capacity is **18.87/19.37 MiB**. The post-GC RSS penalty disappears. Natural-GC
RSS remains **66.16/82.96 MiB**, so capping the nursery is not a general solution;
collection timing and retained host objects before major collection still matter.

This establishes a host heap-sizing contribution; it does not account for every
RSS byte. Reduced external-memory pressure is consistent with the different
major-collection schedules, but the exact V8 trigger has not been isolated.
Two additional `--trace-gc` runs confirm differing major-collection frequency;
they report incremental finalization/old-space requests, not an explicit
external-memory-pressure reason. Preserve that uncertainty. No Node flags are
recommended for production and no timing claims come from these diagnostics.

Reproduce the nursery intervention after the default campaign:

```bash
node wasm/test/performance/gc-host-counterfactual.cjs /tmp/pulse-perf806/report.json /tmp/pulse-perf806-nursery
node wasm/test/performance/check-gc.cjs /tmp/pulse-perf806/report.json
```

### Evidence identity and next action

Default campaign: clean local source `f9c94be5eb33a5d0f06a7d98d5153e4b5a753f10`,
tree `3c848b92343e953c958992fa23966be5dc5a5a95`. Public source commit
`4b2d7a43e067e125ec67389a537a13c25b60b3fc` has the identical tree.
Nursery intervention: clean local source `c1b15bb077e5274024e1f914af0de46b3fd43007`,
tree `2b747c4c5f641b6e6f300b24417e77287e3513f3`; public equivalent
`aaf1b1f11cf90627aba9398b9c265bb9162e11e9`. Only the new counterfactual driver
was added between them. Raw source identities are preserved. Node 24.19.0,
AssemblyScript 0.28.18 and json-as 1.5.0. Later changes record results and correct the opt-in suite classification;
the measured runtime workers and production sources stay unchanged.

The completed campaign contains 40 guest cases and 24 host workers/6144 requests;
the nursery intervention contains 12 workers/3072 requests. Both original
control hashes match PERF8-05. Report admission and 12 rejection cases pass.
The initial trace-only pilots and root-release pilot are separate development
evidence, not substituted for the clean-source campaign. No failed run was
relabeled. Full release profiles, Viceroy, deployed Fastly and Catalog rebuilds
are outside this diagnostic ticket.

The next bounded product investigation should address scalar temporary lifetime
or proven unboxed scalar lowering. Preserve aliases, collections and effect
continuations; do not blindly mutate cached values or clear the handle table
mid-request. Then requalify arena removal against the existing gate and both
short/long host sweeps. Adding another collector, increasing limits or shipping
these diagnostic GC policies is not supported by this evidence.

Repository validation also found a PERF8-05 suite-registration omission: the
opt-in `schema-cache-arena` task was excluded from release profiles but missing
from the suite-shape check's explicit experiment list. PERF8-06 corrects that
list and asserts exclusion from every default profile. No release work is added.
The first unit attempt ended without a terminal summary and is unresolved;
the structured rerun passed 13 tasks before reporting this exact suite-shape
failure. Keep both attempts. Validation after the correction resumes at
`suite-shape`; split development coverage is not a clean full release replay.

The corrected 46-task remainder passes with a terminal report. Together with
the earlier 13 passing tasks, this covers all 59 unit tasks across preserved
split runs. Maintainer, documentation, documentation-release and declared scope
checks also pass. The initial incomplete run and the diagnosed registration
failure remain in the evidence bundle.
