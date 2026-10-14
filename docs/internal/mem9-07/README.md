# MEM9-07 — budget-preserving Fastly numeric regions

PR [#350](https://github.com/pulse-compute/pulse/pull/350) targets
`codex/mem9-integration` ([#349](https://github.com/pulse-compute/pulse/pull/349)).
Related [#289](https://github.com/pulse-compute/pulse/issues/289) remains open.

## Implemented boundary

Unlinked Fastly bounded read-loop plans admit the existing numeric-region proof,
including independently initialized pure helper and shared-stage regions. Every
eliminated uncached number pays the original charge at its evaluation point.
Cached integer/boolean operations retain the original cache admissions; inequality
retains both equality and negation admissions. Numeric truth tests evaluate their
operand once. Region exits materialize already-charged values, with no refund or
double charge. Failure remains latched and terminal. No host import, public
option, allocator change, loop/effect cap increase or reclamation is introduced.

This implements the Fastly read-loop portion of the broader MEM9-07 proposal.
Node budgeted plans, output/body-transform plans, and linked-guest budgeted plans
remain boxed. Node has a rotating scalar cache with different accounting;
extending this realization to it would require its own design and qualification.
Unknown live-ins, collection writes, mixed values and effectful helper bodies
remain outside the numeric proof. General temporary lifetime work belongs to
MEM9-08/09 and is not solved here.

## Development evidence

The recovered clean implementation is local commit
`e9a8e4ab560de9307800f6eb6e0e04c8e4f180dc`, tree
`5881f767738fe29d9e05071ab21959b3223d386e`. Published implementation commit
`87f5f5aa8bfba2adbe8fa985ccfe820e88ba9c16` has the identical tree; only commit
metadata differs. This documentation is added after verification.

All eight selected tasks passed with terminal coverage and cleanup:
`fastly-numeric-budgets`, `fastly-numeric-regions`, `canonical-native-wasm`,
`bounded-read-loops`, `bounded-loop-helpers`, `request-budget-transport`,
`boundaries`, and `hidden-contracts`. Workspace build, maintenance, synchronized
documentation, documentation-release simulation and scope classification passed.
The new task is part of the Native profile and existing lowering evidence shard.
[checks.json](checks.json) records source identities, terminal coverage, results,
measurements, hashes and earlier failed/interrupted attempts. One generated
bounded-read-loop fixture remained after testing; it was retained outside the
checkout. Tracked implementation bytes stayed unchanged.

| Injected-host fixture | Boxed handles | Numeric handles | Charged units (both) | Charged bytes (both) |
| --- | ---: | ---: | ---: | ---: |
| Stub read-loop | 586 | 193 | 677 | 25,098 |
| Schema read-loop | 591 | 198 | 688 | 25,348 |

This is about 67% fewer retained handles in these fixtures, with exact response,
charge and host-trace parity. Tests cover cache transitions, IEEE values,
conditional branches, nested loops, break/continue, aliases, snapshots, repeated
helper/stage invocations, transport/deadline failures and fresh-instance recovery.
At production exhaustion, both artifacts stop at 1,048,576 charged units and
33,553,170 charged bytes with stage 173 and the same effect/resource trace.
Reduced byte/value limits cover intermediate exhaustion; cached and exit-box
operations cannot recover a latched failure. The unchanged linear-memory ceiling
and unchanged import set are checked on actual Wasm.

Earlier fixture failures (over-cap stress source, stage-path assumption and
wall-clock nondeterminism) were corrected without changing caps or weakening
comparisons. The maintenance check initially caught missing release-shard
registration. The interrupted pre-recovery final run has no retained terminal
report and is not counted as passing. Its temporary raw logs did not survive;
this recovery reran the complete focused selection on clean source.

## Remaining qualification

These are focused development checks using injected hosts, not final compliance,
Viceroy/deployed Fastly evidence, or a CPU/latency/RSS claim. Full compliance and
installed-consumer/release checks remain at the final reviewed integration head,
after MEM9-07/08/09 and reconciliation with intervening `latest` changes. #349
stays draft until that work is complete. A merge of this follow-up into the
integration branch does not authorize merging #349 into `latest` or closing #289.
