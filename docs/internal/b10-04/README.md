# B10-04 — Beta.10 CI decision

Date: 2026-10-18. Decision issue [#377](https://github.com/pulse-compute/pulse/issues/377).
Target: `latest`. Work class: decision/evidence; no implementation in this PR.

**Keep the existing mixed scheduler, two workers, one compiler slot and the
release/installed barrier.** Select four bounded follow-ups: log-close reliability,
nonblocking full worker verification, a conditional command-local inspection memo,
and compiler-hint correction with an evidence-gated configuration decision.
Do not adopt two compiler slots until a complete controlled comparison succeeds.

This decision uses the completed investigation artifacts. It does not claim that
all investigation acceptance is complete: B10-00 / #373 remains open because its
two-compiler attempt failed. That uncertainty is a gate on configuration adoption,
not a reason to delay the demonstrated reliability repair or this planning result.

## Baseline and evidence reconciliation

The planning baseline is clean `latest`
`b188b3c8aa161820f400647a37307b8e45f1cdc8`, tree
`7b053a1a1fe8948b8f404724fd7877ba9744a2e0`. It includes merged PRs #383, #384,
#385 and #386. [evidence.json](evidence.json) binds the input report hashes,
candidate identities, selected implementation-owner comparisons and projections.

| Evidence | Original identity and outcome | What it supports |
| --- | --- | --- |
| Beta.9 hosted baseline | [Run 38865225416](https://github.com/pulse-compute/pulse/actions/runs/38865225416), `8ee88d27e605f712fdf1e56fb2439ded352f73fd`, tree `bc5cbd64519fdd047e16c5143f1c70b1e21d5933`; released `fda16de1` has the same tree | Historical 65m40s release tests / 10m09s installed / approximately 76m42s seal; not directly comparable to the local projections |
| [B10-00](../b10-00/README.md) | `74bf891ffe54865cca4869bf7c45d86ff172f34f`, tree `c79155d6e115d58f13c362d4784a081248dd2df7`; local 2/1 passed 190+11 with cleanup; 2/2 failed after 167 passes, one failure and 22 not run | Local passing release 49m32s, installed 9m46s, seal 60m12s; substantial compiler-slot pressure and a concrete log-close supervision vulnerability; no successful two-slot speedup |
| [B10-01](../b10-01/README.md) | `804c69afe743a3f31d2033aa8cf1b121f2dafb21`, tree `6fc0ccd355feddf06cda36e0e13baec201a9d8de`; four tasks passed in 929.078s, separate primitive/worker probes | Cost attribution and narrow preparation/verification opportunities; not a full seal or a common timing candidate with B10-00 |
| [B10-02](../b10-02/README.md) | Source `b5aa67295fca1af35361b4cdcee50562290e8ebf`; simulations use only the complete B10-00 passing attempt | All 190 release + 11 installed responsibilities mapped; fixed host lanes lose to the mixed pool at equal resource budgets |
| [B10-03](../b10-03/README.md) | Merged as this planning baseline / PR #386 | Exact context-data mirror routing fix and retained generated integrity; PR-only benefit, no release-stage saving credited |

The inspected runner, scheduler, recovery/checkpoint owners, registry, guest
inspector and hosted release workflow are unchanged between the measured
candidates and this baseline. All 334 B10-02 mapped source files are also
unchanged since that map. This supports using the findings for intervention
selection; it does not transfer qualification or durations to the new baseline.
B10-01's measured observer hash differs from the final retained observer, as
its report already explains: final diagnostic fixes/analysis postdated measurement.

Keep the reported limitations: B10-00 is one sequential pair with non-identical
observer/environment identities; sampled RSS is a lower bound, not a memory
admission guarantee. Its paired-subset 1.078 aggregate slowdown excludes failed
and unrun work. B10-01 preserves an initial dirty-checkout failure, five incomplete
auxiliary traces and a separate unit-run residue observation. None is relabeled
as passing complete evidence. Exact hashes in machine reports govern tool
identity; package/version display labels alone are insufficient.

## Ranked intervention ledger

Ranking combines reliability, plausible critical-path benefit and cost of
preserving proof. The figures below are different kinds of evidence and must
not be summed.

| Rank / intervention | Measured or projected opportunity | Risk, memory and maintenance | Decision |
| --- | --- | --- | --- |
| 1. Repair log-close supervision | Exact extracted function failed under three 1,200ms controller stalls after complete writes; no direct wall saving quantified | Bounded stream/error/cleanup supervision must remain real; small owner surface | P0, implement #387 first |
| 2. Audit hints and evaluate 2/2 | Old fixed-duration mixed release projection 47m38s → 28m13s (19m25s); release+installed 57m13s → 33m24s (23m49s). Not a forecast under corrected hints | Real compiler processes do not equal whole-task tokens; contention, cleanup and memory remain unresolved | P0 audit in #390; reuse #373 for full trials; default stays 2/1 until successful evidence |
| 3. Offload full worker verification | Empty-worker median 4.317s; 2.580s synchronous controller portion. Across 201 tasks, 8.64min controller occupancy is only a linear scale estimate | Extra owned verifier execution and I/O can contend; cancellation, mutation races and admission ownership need regression proof | P1, #388; preserve every full-byte check initially, change where work runs |
| 4. Memo immutable guest facts within one command | Same 36,378-byte guest: 574.64 / 547.98 / 522.63ms, identical complete inspection hashes; extra read/hash median 0.083ms | Eligible repeat count is unknown; key completeness, result mutation and retained memory need bounds | Conditional P1, #389; first count eligible repeats, implement only if proof and useful benefit exist |
| Already delivered: context routing | Exact mirror avoids unnecessary full schema; no paired hosted timing | Required canonical/generated checks remain; mixed sensitive paths still select full schema | Keep #376/#386 separate; zero release savings booked |

B10-01's JWT pair spent 319.20s in 1,076 Binaryen calls, but these include distinct
inspection, disassembly, merging and optimization responsibilities. They are not
1,076 interchangeable memo hits. Likewise repeated asc tuples lack complete
transitive input equivalence. Independent installed test/build construction is
an oracle, not accidental repetition. The roughly 0.23s installed byte check and
0.06s verified package copy are not useful deletion targets.

## Ordered implementation set

| Ticket | Model / effort | Size | Order and stop gate |
| --- | --- | --- | --- |
| [B10-CI01 #387](https://github.com/pulse-compute/pulse/issues/387) — reliable log closure | Sol 6.1 / High | M | First. Reproduce then repair stalled-controller supervision while preserving failures and bounded cleanup |
| [B10-CI02 #388](https://github.com/pulse-compute/pulse/issues/388) — asynchronous full verification | Sol 6.1 / XHigh | L | After #387. Retain exclusive worker ownership and all existing verification points; revert/defer if safe ownership or benefit is unproven |
| [B10-CI03 #389](https://github.com/pulse-compute/pulse/issues/389) — command-local immutable inspection memo | Sol 6.1 / High | M | Independent scope gate; do not compete with timed trials. No useful eligible repeats or incomplete key/lifetime proof means explicit deferral, not cache expansion |
| [B10-CI04 #390](https://github.com/pulse-compute/pulse/issues/390) — hints and configuration disposition | Sol 6.1 / High | M plus #373 trials | Phase A audit can start immediately. Phase B follows #387 and a stable disposition of #388/#389; only successful complete measurements can enable a setting change |

Full issue bodies, acceptance, rollback, owners and measurement requirements are
retained in [work-items.json](work-items.json). The model/effort values are work
recommendations, not account assignments. No change is considered implemented
because an issue exists.

#390 has two ordered deliverables to avoid a dependency cycle: first commit
conservative resource-hint corrections at 2/1; then #373 measures one stable
patched candidate; finally #390 records the setting disposition or prepares the
minimal configuration change supported by those measurements. #373 remains the
measurement owner. A result of **retain 2/1** is valid; an incomplete comparison
must stay explicitly incomplete and be carried into #382, not quietly closed.

The resource audit starts with `cli-report-resource-inventory`, `s3-body-read`
and `shared-stage-o19`, which execute Native work under non-compiler hints,
but must inspect all selected tasks. Hint corrections may initially serialize
more work. Measure that cost separately; do not hide it by simultaneously
increasing concurrency. Existing B10-02 projections preserve old hints and must
be refreshed before forecasting a corrected scheduler.

## Alternatives not selected

| Alternative | Reason / revisit condition |
| --- | --- |
| Dedicated Node/Fastly lanes | Same-budget 2/2 projection is 43m57s combined versus mixed 33m24s, 10m33s slower. Three-worker host lanes also lose to the three-worker mixed pool. Whole cross-target tasks dominate; no lane migration |
| Remove release/installed barrier | Only 3.9s projected benefit at mixed 2/2 and none at 2/1; insufficient to justify new aggregation/failure semantics |
| Add a third/fourth worker | Three-worker mixed 2-compiler projection improves, but no safe resource/preparation evidence. More lanes are not free capacity |
| General compiled-artifact or historical-result cache | Full transitive input equivalence is unproven; installed independence, deterministic production and candidate/host authority cannot be collapsed |
| Persistent/batched Binaryen service | Large orchestration opportunity, but no demonstrated bounded interface, state isolation, cancellation or oracle parity. Revisit only after the small inspection memo proves insufficient and a bounded prototype is separately scoped |
| Delete/reuse installed or schema proofs | Independent construction remains meaningful; 29 schema compilations showed no matching tuple group. Retain composed application and four-mode evidence |
| Weaken worker hashes or drop reconciliation scans | Not needed for the selected offload; changes the proof rather than its scheduling. No timestamp/stale-receipt shortcut |
| Repeat CI9-03 site consolidation / general docs bypass | Consolidation is already delivered; generated consistency remains required. B10-03 addresses only one concrete PR routing trigger |
| Extract Fastly provider release cycle | RC-era or later architectural decision, outside Beta.10 |

## Performance expectation and release gate

Sub-30-minute release tests remain an exploratory target, not a release promise.
The local idealized two-compiler release projection is 28m13s, but applying the
incomplete paired-subset slowdown uniformly yields 30m25s. The current-setting
model also underpredicts observed release+installed stages by about 2m06s.
Neither error can be treated as a universal correction. Corrected hints, changed
preparation and hosted resource limits can move the result again. There is no
defensible integrated minute total yet, and no basis to inflate scope to hit 30.

Use separately identified clean control/changed candidates for code comparisons,
matching tools, workloads, inputs and runner conditions. Use one identical patched
candidate for 1-vs-2 compiler trials, with fresh complete selections and no
checkpoint reuse. Record order/warm state and failures; repeat only to resolve
material variance. Do not pool independent trials into a new seal or add
overlapping controller/inspection/concurrency estimates.

Before #382 qualification, every selected issue must have an implemented and
validated result or an explicit recorded deferral/rollback. Carry #373's actual
status, the chosen 2/1 or proven setting, #376's PR-only change, and #371's separate
provider status. Freeze source/tree, dependencies and tool bytes, retain
independent installations/deterministic construction, verify complete latest
attempt coverage and outputs, and retain host-specific realization and cleanup.
Require a fresh complete qualification at any proposed hosted setting before
adopting that setting. Passing local microbenchmarks cannot authorize it.

This decision record plus its linked implementation issues completes #377's
planning deliverable. It does not merge changes, approve protected architecture,
qualify the present baseline, or publish Beta.10. The human retains those actions.
