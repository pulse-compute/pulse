# MEM9-02 — bounded Fastly numeric regions

Implements the first slice proposed in MEM9-01 and requested after #315 merged.
Related: [#289](https://github.com/pulse-compute/pulse/issues/289). This reduces
proven numeric-loop retention; it is not general handle-table reclamation.

## Implementation

`canonical-native-numeric.js` owns private analysis and emission. The Fastly
realization selects `fastly-numeric-regions-v1`; canonical/Node default emission
is unchanged. The provider does not rewrite arithmetic expression strings.

The proof starts without incoming numeric facts, inspects each expression and
write independently of `valueKind`, and intersects definite initialization at
branches. Loop entry plus closure of every write under numeric operations proves
the invariant by induction. Initialization only inside a loop is not assumed at
its exit. No data-dependent or coercive input is silently unboxed. Unsupported
regions keep ordinary boxed Native execution.

Eligible straight-line regions contain numeric initializers/assignments and
existing bounded pure loops. Nested loop branches, break/continue, numeric
conditionals and discarded prefix/postfix updates are supported. Assignment or
update results nested inside another expression are deliberately excluded.
Arithmetic remains f64, in the original order, including NaN, signed zero,
infinities, fractions and the 2^53 boundary.

Private f64 globals carry values across existing control blocks. Per-slot write
bits reset at region entry and prevent zero-trip/conditional writes from replacing
untouched handles. Every written slot is boxed through the existing constructor
at the region exit, before generic code/effects. Existing boxes never mutate;
there is no new drop/release operation, host import, forced GC or pooling.
The original control IDs, visit weights, caps and continuation sites remain.

The first slice excludes helper/shared-stage bodies, package-owned application
emitters, schema-inactive stub builds, guest-linked builds, and entire budgeted
read-loop, generated-output and
body-transform plans. It also excludes unknown live-ins, property/element reads,
collection writes, helper calls, strings and other generic operations inside a
region. All existing cumulative budget and failure behavior stays intact.

Manifests record policy, selected statement/local IDs, and declined-loop reasons.
Existing source/artifact hashes bind the selected emission. No public flag or
configuration contract is added; the arena-elision flag remains independent.

## Retention and unchanged allocation gate

Clean measured source: `3dbcfb08993d9384e118da83de66e4cde7b1c874`, tree
`2b60945dab9eb8887806b2ca8ee89d143cb8a89e`. Node 24.19.0, AssemblyScript 0.28.18,
json-as 1.5.0; lockfile-pinned workspace. Raw archive pins are in `evidence.json`.

All **44 cases** passed: boxed/numeric × default/elided, each with ordinary and
observed escaped/Unicode/small controls plus the 0/1/64/128/256 reduced sweep.
Raw responses and encoded-payload/digest assertions agree across all four cells.
Each diagnostic case also passes the nine existing handle-ownership probes.

| Small-body result, 524,288 additions | Boxed default | Numeric default | Boxed elided | Numeric elided |
| --- | ---: | ---: | ---: | ---: |
| Total retained handles | 524,609 | 68 | 524,609 | 68 |
| Numeric handles | 524,547 | 6 | 524,547 | 6 |
| Managed bytes after diagnostic full GC | 66,668,592 | 3,726,208 | 65,620,016 | 2,677,632 |
| Ordinary Wasm bytes | 98,467 | 98,646 | 98,464 | 98,643 |

| Outer iterations | Boxed handles | Total handles with numeric regions |
| --- | ---: | ---: |
| 0 | 67 | 67 |
| 1 | 2,369 | 68 |
| 64 | 131,393 | 69 |
| 128 | 262,465 | 69 |
| 256 | 524,609 | 68 |

Both arena settings have those handle counts. Numeric lowering boxes at most the
accumulator and final two counters; existing counter-cache hits explain the
67–69 variation. Storage no longer grows with arithmetic iterations in this
region. At the full small case, managed retention falls by 62,942,384 bytes.

The **unchanged 128 MiB allocation assertion** passes with both settings:

| Peak guest linear capacity in original gate | Boxed | Numeric |
| --- | ---: | ---: |
| Default arena | 110 MiB, pass | 27.5 MiB, pass |
| Arena elided | 148 MiB, existing failure | 18.5 MiB, pass |

The controls' Wasm SHA-256 values exactly match MEM9-01 (`f5692ffd…` default,
`bd125878…` elided). No fixture arithmetic, payload, cap or gate was weakened.
Observed instrumentation matches ordinary control capacity/response bytes.
Full GC is diagnostic and runs after semantic assertions; it is not timed or
added to production. Managed bytes, linear capacity and process RSS are distinct.

## Uninstrumented cost

A separate campaign ran **60 process samples / 5,244 requests**: 1/11/41/128/256
requests, three repeats, both arena settings, counterbalanced boxed/numeric order.
Each request gets a fresh Wasm instance. Each sample uses its own process; no
forced collection or pooling. All responses pass exact SHA-256 checks. Workload:
the original full arithmetic with the small `a` payload.

This measures injected-host end-to-end execution, including Wasm validation,
module/instance setup, host work and response checks. It is not Viceroy, deployed
Fastly latency, or an application-wide speedup. Process RSS includes Node/V8,
allocator retention and runtime code. Repeated measurements do not establish a
cross-request leak or a confidence interval. Quantiles use floor((n−1)×p); cold
one-request cells have only three observations.

| Arena / requests | Median wall ms, boxed → numeric | P95 wall ms, boxed → numeric | Median CPU ms, boxed → numeric | Median process peak RSS MiB, boxed → numeric |
| --- | ---: | ---: | ---: | ---: |
| default / 1 | 142.63 → 13.87 | 142.63 → 13.87 | 174.31 → 17.32 | 111.5 → 49.3 |
| default / 11 | 139.25 → 3.41 | 314.92 → 9.04 | 154.29 → 4.24 | 243.9 → 89.5 |
| default / 41 | 130.01 → 3.54 | 204.31 → 10.81 | 145.35 → 4.53 | 243.8 → 186.7 |
| default / 128 | 122.71 → 3.07 | 193.62 → 7.42 | 137.20 → 3.69 | 243.6 → 186.7 |
| default / 256 | 122.87 → 3.18 | 182.37 → 7.78 | 137.75 → 3.86 | 244.8 → 186.8 |
| elided / 1 | 146.60 → 11.85 | 146.60 → 11.85 | 177.34 → 15.72 | 110.5 → 48.2 |
| elided / 11 | 134.34 → 2.68 | 174.80 → 9.13 | 150.48 → 3.38 | 240.8 → 77.5 |
| elided / 41 | 145.12 → 2.71 | 240.54 → 6.76 | 161.56 → 3.24 | 240.8 → 128.1 |
| elided / 128 | 131.93 → 2.68 | 196.54 → 6.31 | 146.93 → 3.28 | 241.1 → 153.8 |
| elided / 256 | 136.48 → 2.65 | 214.85 → 5.89 | 151.59 → 3.23 | 241.6 → 153.9 |

## Qualification and limits

The `fastly-numeric-regions` regression compares optimized Native with boxed
Native and ordinary JavaScript. It covers aliases, collection snapshots/spread,
independent subsequent regions, numeric edges and truthiness, nested and zero-trip
loops, break/continue, unsupported collection/mixed/nested-update paths, sequential
and out-of-order parallel effects, send failure, deadlines and fresh-instance
recovery. Independent admission tests reject spoofed kinds, unknown live-ins,
one-arm and zero-trip initialization. Control block metadata and guards match.
The test is registered in Native and its existing lowering release shard.

The unit/native/javascript/conformance profiles plus selected Fastly and request-budget
tasks have passing results for all **150 selected tasks** at `864d1d17bad6dd610fcdd5b28e997e1411b04801`.
The recovered original report contains 149 passes and remains marked running after
the workspace disconnected; it is preserved unchanged. The missing
`fastly-native-platform-capabilities` task passed in a separate recovery run on
the same tracked source. This is combined development evidence, not a terminal
150-task run or release checkpoint. Generated test residue was preserved outside
the checkout. The final outbound-payload assertion is checked separately on the
documentation handoff commit; measured product sources are unchanged.
No deployment, publication or release seal is performed here. The one-line shard
mapping is only regression coverage, not a change to release authority.

Generic scalar temporaries still accumulate handles. Numeric values initialized
from unknown input, exported each iteration, or flowing through unsupported
operations do not receive this optimization. N deliberately retained snapshots
still require O(N) storage. #289 stays open for the maintainer to assess residual
workloads and scope; this PR does not promise universal bounded memory.

## Replay and attempt history

```sh
node wasm/test/performance/mem9-02.cjs --out /tmp/mem9-02-retention
node wasm/test/performance/mem9-02.cjs --check /tmp/mem9-02-retention/report.json
node wasm/test/performance/mem9-02-cost.cjs --out /tmp/mem9-02-retention /tmp/mem9-02-cost
node wasm/scripts/run-wasm-tests.cjs --task fastly-numeric-regions
```

Use a clean commit, unset `NODE_OPTIONS`/`JSON_CACHE`, and a new output directory
for each attempt. After extracting the archive, verify `manifest.json` file
hashes. The retention validator can replay after setting its parsed report's
`directory` to the extracted retention directory in memory; raw receipts stay
unchanged. The archive includes the independent cost coverage/hash checker.

Retained failed development attempts:

- Semantic fixture 1 used array `push` in a pure loop and array-shaped parallel
  authoring. Replaced those with already-supported indexed assignment and keyed
  parallel authoring. Product admission was not widened.
- Retention 1 refused to start because generated documentation was uncommitted.
- Retention 2 completed all 44 worker cases, then failed the aggregate's overly
  strict equal-handle-count assertion. Final counter-cache hits differ by one.
  Corrected to the proven three-output bound and reran the complete campaign.
- Retention 3 is the passing clean campaign. Cost 1 passed all 60 samples.
- Initial maintenance/documentation-release checks caught the new regression
  task missing from its shard. Added the mapping; both checks passed on retry.

Later commits add semantic coverage and documentation only; the measured product
sources and diagnostic/cost scripts remain unchanged. Exact source/tree identity,
reports, logs, recipes, generated source and Wasm artifacts accompany the handoff.
