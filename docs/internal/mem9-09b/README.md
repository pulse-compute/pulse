# MEM9-09B — Fastly frames and effects

Human direction: “No let's finish the work, proceed with 09B.”
Base: `codex/mem9-integration` at `bc008e3690d65f3f916fe60e4a4884ba0f71dc6a`,
after #354. Target: `codex/mem9-integration`; related #289 and #349.
Class: architecture. Protected boundaries: runtime target realization,
effect/continuation ownership and the release controller's regression selection.
No single Entry Point spans the canonical emitter and provider owners; ordinary
root, Wasm, provider and docs instructions apply. Merge remains human-owned.

## Owner audit

| Owner | Lifetime and checkpoint rule |
| --- | --- |
| Pure helper frame | Existing globally declared local slots; no checkpoint inside the helper, including loops. Earlier caller operands and borrowed returns reach the outer expression boundary first. |
| Async helper frame | Declared locals and helper-return global are roots. Arguments transfer before entry; return transfers before the caller clears the result. Existing non-nesting validation remains required. |
| Shared stages | All stage locals and every registration's effect-result slot are roots. Existing stage accessors select registration slots; ready-flag clearing does not clear results. Stage entry/reset and exit ordering are unchanged. |
| Router errors | Error moves into the declared Router local before recovery. No collection during construction or settlement; a latched guest/provider failure suppresses tracing. |
| Effect groups | All sibling payloads enter provider slots before the suspend checkpoint. Guest results, provider payloads and ready results are traced independently of flags. No checkpoint runs inside effect dispatch, polling, resolution or authenticated settlement. |
| Opaque resources | Fetch wrappers and values carrying response/body resources are pinned on insertion for the invocation. No new close/cancel operation. Forwarding marker/result are explicit roots; the remaining forwarding integers are resource IDs, lengths, modes or pointers. |
| Provider caches/state | Header snapshot, occupied cache index and guest request-state arrays retain existing semantics. Managed request strings, redaction strings, byte buffers and S3's direct wrapper references remain ordinary managed references. |

The explicit effect allowlist covers fetch, config/secret, KV, conditional KV,
time/digest and existing first-party GRIP, Assets, JWT and S3 adapters. Their
provider calls are synchronous between guest checkpoints; persistent integer
value ownership flows through the shared payload/ready slots. Per-effect pending
IDs, invocation tickets, timeout/outcome arrays and counters are not handles.
S3's direct body-wrapper array retains its existing cleanup ownership; the new
pin also preserves the integer mapping. Linked JWT realizations remain excluded.

Both guest and provider root descriptors reject missing entries before source
composition. Unknown frame versions, frame statements, effects, expressions and
capabilities disable tracing. Event and package-owned application emitters,
Node, stub, linked and allocation-budgeted paths retain their prior lifetime
behavior. No ABI, public option, authoring syntax or effect protocol changes.

## Evidence and limits

`fastly-handle-frames` compares real traced and retained Wasm under both arena
settings. It exercises caller operands, borrowed pure returns, early and repeated
async helper calls, repeated stage registrations, caller-local survival, group
results arriving out of order, schema/transport/deadline recovery, cancellation,
late completion cleanup and closed-invocation duplicate rejection. Diagnostic
root probes isolate provider-only payload/ready owners and guest results after
flag clearing. Opaque forwarding and S3 handoff/discard/failure paths compare
exact host traces and binary output.

Increasing fixed-working-set loops measure mapping/capacity bounds independently
of legitimate resource pins. Pure helper work can allocate substantially between
checkpoints; pins, conservative local slots and live ropes still retain data.
Wasm capacity, allocator-observed managed bytes and host RSS are different metrics.
No deployed-provider or process-RSS improvement is claimed.

## Qualification on the frozen source

[Check record](checks.json), [initial task report](qualification1.json), [retry report](qualification2.json),
[lifetime observations](lifetime.json) and [raw paired measurements](cost.json)
identify local source `821f6e8dec43813f66d5f798b89fe2c54be7084e` and published
source `80cdabeda67f550c10aa7cfb085880ffa69e4064`. Both have Git tree
`7229ce985bfd715a026928c588da5a1100276e83`; only commit metadata differs.
The checkout was clean when the cost campaign and initial qualification started.
The retry used clean local source `61786c250cb0c60f0e743cc350d8065fe4ef39dc`,
published as `2b5d46a73e9a85678a07e3b956885b03fb6e00bf`, with identical tree
`7ff04cb63d96426b8ef74dc845920d33ca0fa7b7`. Only one test-fixture line differs;
production/compiler/provider source is identical. This evidence/documentation
receipt follows testing.

All 158 selected task IDs have passing development results across two runs:
the complete unit, Native, JavaScript and conformance profiles plus the six
explicit Fastly provider tasks listed in the initial report. The initial run
ended with 148 passed, one failed and nine unrun. `application-error-boundaries`
failed because its direct layout fixture omitted the ownership descriptor
required since 09A. Production callers already provide that descriptor. Adding
`ownership: { enabled: false }` to the fixture repaired the test without changing
production code. The retry passed the repaired task and all nine unrun tasks.
This is not a terminal 158-task run or a reusable full qualification checkpoint.

Coverage includes the unchanged 09A regression, the new 09B
regression, numeric regions/budgets, continuation behavior and cross-target
parity. Workspace TypeScript build, maintenance, documentation,
documentation-release and release-preflight checks passed. The scope declaration
is consistent and still requires human review. These are development checks,
not the complete release/installed-consumer or external-provider qualification.
The Fastly suite passed its compiled ABI fixtures, including 227 transport-recovery
checks and 95 fetch-deadline cases. Viceroy-dependent socket-reset and deadline
HTTP replays were skipped because `PULSE_VICEROY_BIN` is unavailable; these are
not provider-reality passes.

The 09B test rejects 97 individually missing guest roots and separately rejects
missing provider roots. Under each arena setting it compares 12 main cases,
nine resource cases and three terminal failure cases, with additional
cancellation/late-completion and isolated owner probes. A development failure
exposed a real error-path defect: suppressing every allocation after a latched
provider failure prevented the normal terminal 502/504 response. The fix allows
that allocation while leaving tracing suppressed; regressions preserve the
original failure code/stage, response and host trace. Earlier fixture-construction
and nondeterministic-clock failures are recorded separately in the check record.

## Retention and cost

The ordinary 09B fixed-working-set loop retains the following mappings. Each
`n` adds 128 churn iterations; helper/stage/effect work also runs when `n = 0`.
Both arena settings have the same mapping and collector-capacity results.

| n | Traced live mappings | Retained control mappings | Peak map capacity | Peak collector scratch payload bytes |
| --- | ---: | ---: | ---: | ---: |
| 1 | 514 | 2,369 | 1,365 | 8,932 |
| 8 | 761 | 7,745 | 1,365 | 8,932 |
| 32 | 725 | 26,180 | 1,365 | 8,932 |

This establishes a plateau for this fixed working set. Conservative locals,
live ropes, pure-helper allocations between checkpoints and invocation-long
resource pins remain explicit residuals; resource churn is not independently
bounded by this result.

The cost campaign used ten warmup pairs and 40 randomized measured pairs per
cell, with 2,000 paired bootstrap resamples. Timing covers production `_start`
and injected host calls, excluding compilation and instantiation. Simulated
deadline delays are not real network latency. Diagnostic allocation observers
and forced terminal GC are separate from timed artifacts. Wall time, process
CPU, thread CPU, distributions and raw samples are preserved in `cost.json`.

| Arena | n | Traced wall median (ms) | Retained wall median (ms) | Paired mean delta 95% interval (ms) |
| --- | ---: | ---: | ---: | --- |
| Default | 0 | 1.067 | 0.911 | [-0.379, 0.551] |
| Default | 1 | 1.332 | 1.046 | [0.284, 0.814] |
| Default | 32 | 9.208 | 9.288 | [-0.554, 0.429] |
| Elided | 0 | 1.143 | 0.892 | [-0.282, 0.552] |
| Elided | 1 | 1.300 | 0.997 | [-0.019, 0.312] |
| Elided | 32 | 9.257 | 9.168 | [-0.230, 0.541] |

The default-arena short case regresses by about 0.29 ms in median wall time;
its paired mean interval also excludes zero. Elided short-case thread CPU
regresses (paired mean interval [0.045, 0.315] ms), although its wall interval
crosses zero. Neither long-case wall interval establishes a speedup. Review
these costs with the memory benefit; no universal performance improvement is
claimed. Tracing adds 5,996 production Wasm bytes under either arena setting.

For the long (`n = 32`) cost fixture, separate allocator observations show:

| Metric (bytes) | Default traced | Default retained | Elided traced | Elided retained |
| --- | ---: | ---: | ---: | ---: |
| Managed outstanding after diagnostic GC | 1,695,616 | 5,372,256 | 647,040 | 4,323,680 |
| Peak managed outstanding | 3,516,528 | 5,565,264 | 1,599,184 | 4,515,008 |
| Cumulative managed allocation | 8,075,104 | 7,146,624 | 7,026,528 | 6,098,048 |
| Linear-memory capacity | 5,242,880 | 10,485,760 | 1,835,008 | 7,340,032 |

Allocator observations include allocator overhead. Lower retained memory comes
with greater cumulative allocation in this fixture. These are not process RSS
or Rust comparisons.

The unchanged 524,288-addition stress fixture and 128 MiB gate pass with both
arena settings: 28,835,840 bytes (27.5 MiB) default and
28,835,840 bytes (27.5 MiB) elided. Exact escaped output,
digest and independent collections also pass. The elided result is higher than
09A's 19,398,656 bytes (18.5 MiB). 09B admits this digest-effect fixture to tracing;
the capacity regression remains a review item despite passing the unchanged cap.

This increment does not complete MEM9-09C or final integrated compliance. Latest
reconciliation (including #353), installed-consumer and final provider qualification
remain with #349. Historical 09A receipts keep their original source identities.
