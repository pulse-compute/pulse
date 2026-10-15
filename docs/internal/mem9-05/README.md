# MEM9-05 — Node Native numeric allocation avoidance

Recorded 2026-10-14. Related: [#289](https://github.com/pulse-compute/pulse/issues/289),
[MEM9-04](../mem9-04/README.md). This branch builds on MEM9-04
([#336](https://github.com/pulse-compute/pulse/pull/336)); merge that prerequisite
first. Generic scalar lifetime remains unresolved and #289 stays open.

## Change and boundary

The provider-neutral `pulse_host` compiler used by Node Native now selects
`host-numeric-regions-v1` for nonlinked canonical applications. It reuses the
existing numeric proof and MEM9-04 helper/stage coverage. Proven arithmetic runs
in private f64 slots, then boxes written values into ordinary host handles at
region exits. The proof still ignores type annotations and requires numeric
initialization and all reaching writes; loop caps remain at most 256.

Node's `ValueHeap` stores JavaScript values. Its collections store actual values,
not Fastly-style child handles. This change avoids allocating arithmetic
temporaries; it does not release or reuse handles, mutate boxes, clear tables,
change collection ownership, or add production GC. Aliases and snapshots retain
their previous values. Control-state identities, guard weights, effect payloads
and continuation ownership remain unchanged.

Host policy selection covers both schema/incremental and schema-inactive/stub
builds because the host value table exists independently of the guest collector.
Linked guests, package-owned application emitters, effectful helper bodies and
entire read-loop/output/body-transform budgeted plans retain existing emission.
Unknown live-ins, collection writes, coercion and larger flat-loop caps retain
the generic path. There is no public flag or authoring expansion.

The portable compiler also prepares intermediate artifacts for provider writers.
Each writer retains its final emission policy. Fastly schema, stub and linked
selection is unchanged; JavaScript source execution is unchanged. No CLI host
branch or provider discovery rule was added.

## Retention result

Measured implementation: `00548e0e40dee3689155905dcdb592dd0aefda17`, tree
`09bf40e7e4011c7d6d90f3ec9a97aff45ff722ef`. The checkout was clean and unchanged
before and after the campaign. The evidence documentation is a later commit.

All **18 cells / 72 executions** passed: entry/helper/stage owners ×
schema/stub runtimes × 0/64/256 additions per invocation. Each request invokes
the measured computation twice, so the largest cell performs 512 additions.
Boxed and optimized artifacts each run ordinarily and with diagnostic
observation. Exact responses and host execution semantics match; only the
registry's per-execution invocation-owner prefix is normalized for comparison.
Invocation sequence suffixes, payloads, effect order and continuation transitions
are retained.

| Owner/runtime | Handles at 0 | Boxed at 64 | Numeric at 64 | Boxed at 256 | Numeric at 256 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entry/schema | 23 | 663 | 25 | 2,583 | 25 |
| Helper/schema | 23 | 663 | 25 | 2,583 | 25 |
| Stage/schema | 90 | 730 | 92 | 2,650 | 92 |
| Entry/stub | 21 | 661 | 23 | 2,581 | 23 |
| Helper/stub | 21 | 661 | 23 | 2,581 | 23 |
| Stage/stub | 88 | 728 | 90 | 2,648 | 90 |

Zero-work counts are equal for both strategies. Optimized counts rise by just
two from zero work and stay flat between 64 and 256 additions. In these fixtures,
the largest cell avoids **2,558 host entries** for every owner/runtime pair.
This is bounded temporary overhead for the proven region, not a count of all
reclaimable garbage or proof that generic retention is fixed.

## Memory domains and limits

The observer counts the real `ValueHeap.values` map by JavaScript value kind.
The ordinary host's returned `valueHandleCount` agrees exactly with observed
execution, and diagnostic host GC does not remove entries from the rooted map.
The diagnostic retains the request heap after completion to inspect within-request
retention; it must not be interpreted as a cross-request leak.

Wasm linear capacity is **1,245,184 bytes** for every schema cell and
**65,536 bytes** for every stub cell, unchanged between boxed and optimized
artifacts. Guest managed bytes are explicitly unavailable (`null`), not zero.
Guest capacity is not live guest memory, and host table entries are not guest
allocations.

Raw receipts also retain `process.memoryUsage()` before and after diagnostic
host GC in separate worker processes. These heap/RSS totals include the compiler,
both artifacts, module/instance state and other host allocations. They do not
isolate bytes attributable to the value table and establish no RSS reduction.
No CPU, latency, deployed-provider or full-release claim is made. Arena elision
is not varied in this Node campaign.

## Qualification

The focused checks and their exact completion status are recorded in
[evidence.json](evidence.json). The Node regression is part of the existing
`canonical-native-wasm` task; no routine CI task or release shard was added.

The regression compares optimized and boxed Native artifacts with authored
JavaScript for numeric edges, immutable aliases, arrays/objects, repeated pure
calls, caller loops, two shared-stage families, snapshots across suspension and
subsequent local writes, early transfers, unknown inputs and generic operations.
It checks cancellation and late settlements, transport failure and fresh
invocations after failure. Existing request-budget and bounded-read-loop
qualification covers deadline/exhaustion behavior. Budgeted read-loop source
is byte-identical to the boxed control, with equal memory accounting. A real
ES256 linked build retains the old source and has no host numeric policy.

The unit profile still stops at the existing CLI report import-boundary failure:
2 passed, 1 failed, 59 unrun. The importer
`wasm/packages/cli/src/internal/report/snapshot.js` references
`@pulse-compute/wasm-compiler/canonical-project-compiler` outside the approved
list. MEM9-03 reproduced this on untouched `2497084`. It is not changed or
waived here. Full release and installed-consumer acceptance remain deferred to
the sprint boundary.

The initial Node fixture rejected a numeric fetch body; it was corrected to
send a string. A subsequent comparison failed on the registry's intentionally
distinct invocation-owner IDs; comparison now normalizes only that field's
owner prefix. Both failed development logs are retained. Product semantics were
not changed to accommodate these tests. Six incomplete/tampered campaign
mutations were rejected, including missing/duplicate cells, changed source,
altered rows and artifact hashes.

## Replay

Restore lockfile-pinned dependencies and the normal workspace build in a clean
checkout of the measured source. Use a new output directory:

```sh
node wasm/test/performance/mem9-05.cjs --out /tmp/mem9-05-new
node wasm/test/performance/mem9-05.cjs --check /tmp/mem9-05-new/report.json
node wasm/scripts/run-wasm-tests.cjs --task canonical-native-wasm --task fastly-numeric-regions --task bounded-read-loops
```

The campaign launches diagnostic workers with `--expose-gc`; production runs
do not require it. `--check` also validates the extracted archive's
`campaign/report.json` relative to its containing directory. The compact receipt
pins the archive and raw report; the archive includes per-file SHA-256 hashes,
plans, authored fixtures, generated source, manifests, Wasm and execution logs.
