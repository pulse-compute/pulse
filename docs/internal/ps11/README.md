# PS-11: compiler cleanup closeout

The mapped PS-10 cleanup is complete. The public generator now orchestrates the
five private owners planned in [PS-09](../ps09/README.md); its body is **42 lines**,
down from 1,000. Generated behavior and measured artifacts are preserved. The
accepted result is clearer ownership; these measurements establish no speed or
Wasm-size improvement.

Human direction: implement PS-11 from the October 5 next-stream task plan.
No named Entry Point matches this repository-only closeout; ordinary root/docs
instructions apply. Class: evidence; scope: evidence-only. PS-10 A/B are merged
as PRs #204/#205. Final candidate: `718ebe31a35363e30a0c6281367bbbeba2fd516b`.

## Final ownership and affected files

All production paths are under `wasm/packages/runtime-core-as/src/compiler/`.

| Owner | Responsibility | Lines |
| --- | --- | ---: |
| `canonical-native-context.js` | Original-reference plan indexes, names/errors, emission guards and flow views | 228 |
| `canonical-native-schema.js` | Composition around existing schema codec owners | 194 |
| `canonical-native-expressions.js` | Private aliases/retention, stable names and deferred declarations | 311 |
| `canonical-native-control.js` | Blocks/entries, resume requirements, routing, layout, allowance and run loop | 433 |
| `canonical-native-support.js` | Imports/globals, value/state/stage/resume support and ABI exports | 167 |
| `canonical-native.js` | Ordered orchestration, source join, frozen manifest/result assembly | 203 |

The original root file was 1,339 lines; the six files total 1,536 (**+197**),
including explicit inputs and module seams. The smaller orchestrator is not a
total-code reduction. Two existing diagnostics, `schema-cost-profile.cjs` and
`gen01-census.cjs`, now reference the schema owner directly and fingerprint the
new owners. No compiler/provider authority, public export, flag, ABI, optimizer
mode, registered task, CI gate or seal checkpoint changed in this extraction.

Aliases and traversal state stay private to their builders. The root preserves
schema/crypto → event/decoder guards → expression preparation → control/layout →
runtime support → allowance check → deferred rendering/assembly. Completed values
pass between owners; expression references, block IDs, declaration order and
failure order remain stable. [PS-10 A](../ps10a/README.md) and
[PS-10 B](../ps10b/README.md) document each reviewed slice.

## Parity and final integration

Verified retained [PS-10 B evidence](../ps10b/results.json) covers **26** complete
source/hash/manifest/block comparisons across 13 existing fixtures, **16**
diagnostic comparisons, the workspace build and **131** passing functional tasks.
Every original terminal task report matches its committed digest and passed exit
and runner cleanup checks. All six production file hashes match the final merged
candidate; only two internal documentation files differ from the tested production
commit. This is verified reuse for the closeout, not a seal receipt.

The merged candidate has the exact tree tested by PR #205. Its Repository
validation, Documentation and Maintainer scope workflows all completed successfully.
Fresh PS-11 campaigns also checked all six fixture/target cells before timing and
checked every timed request's output. The PS-11 diff selects documentation and
maintenance checks; no release action or aggregate seal is required. Those final
checks are recorded in the PR; the unchanged functional selection is not replayed.

## Measurements

The unchanged [PS-08 harness](../ps08/README.md) ran serially from clean control
`8b634eefcf3963f001adf00a78ce86adb619589c` and the final candidate. Control product,
harness and build inputs are identical to the original PS-08 baseline; only
PS-08/PS-09 documentation differs. Both fresh reports and the archived PS-08
baseline pass the existing compatibility comparator with matching fixtures,
dependencies, Node/toolchain, settings, protocol and hardware/OS.

[results.json](results.json) retains every fresh observation and both comparisons,
plus source identities, hashes, ownership inventory and retained validation links.
Campaigns completed in 29.62 / 30.27 seconds. All six artifact hash arrays match the fresh
control, final candidate and original PS-08 baseline across all three build samples.

Fresh control → final medians (milliseconds; RSS in MiB):

| Fixture / target | Build ms | Compiler RSS MiB | Artifact bytes | Warm p50 ms |
| --- | ---: | ---: | ---: | ---: |
| minimal-request / JS | 421.4 → 406.9 (-3.4%) | 126.9 → 126.5 (-0.3%) | 379, unchanged | 0.211 → 0.213 (+0.8%) |
| minimal-request / Native | 1179.0 → 1195.8 (+1.4%) | 258.4 → 257.0 (-0.6%) | 808, unchanged | 0.390 → 0.409 (+5.0%) |
| schema-effect / JS | 418.2 → 451.1 (+7.9%) | 126.9 → 126.5 (-0.3%) | 14,035, unchanged | 0.515 → 0.561 (+8.9%) |
| schema-effect / Native | 2180.3 → 2388.3 (+9.5%) | 303.1 → 323.9 (+6.9%) | 39,479, unchanged | 1.528 → 1.515 (-0.9%) |
| multi-route / JS | 433.7 → 463.5 (+6.9%) | 127.8 → 127.3 (-0.4%) | 742, unchanged | 0.206 → 0.229 (+11.3%) |
| multi-route / Native | 1355.1 → 1370.5 (+1.1%) | 260.7 → 260.8 (+0.0%) | 2,933, unchanged | 0.559 → 0.484 (-13.3%) |

Fresh runtime median deltas; warm p95 is also reported:

| Fixture / target | Cold load | First request | Warm p50 | Warm p95 |
| --- | ---: | ---: | ---: | ---: |
| minimal-request / JS | +2.8% | +2.3% | +0.8% | +11.1% |
| minimal-request / Native | +6.4% | -1.9% | +5.0% | +26.6% |
| schema-effect / JS | -0.1% | +0.0% | +8.9% | +20.0% |
| schema-effect / Native | +4.7% | +0.4% | -0.9% | +32.8% |
| multi-route / JS | +7.4% | +4.9% | +11.3% | +15.7% |
| multi-route / Native | -13.0% | -6.1% | -13.3% | -27.7% |

Against the archived PS-08 baseline, Native build medians changed by −13.5%,
−3.9% and −0.1% for minimal/schema/multi-route; artifact sizes remain identical.
This older comparison is context, not causal attribution. The fresh schema build
median is +9.5% and compiler RSS +6.9%; compatible measurements of the same final
schema code across PS-10 B and PS-11 range from 2,279–2,590 ms build and
303.2–323.9 MiB median ASC RSS. The observed movement does not establish a
sustained regression or improvement.

Each cell has three build/cold processes and ninety warm requests clustered in
three processes. OS caches are uncontrolled. Native requests include Wasm
validation/compilation/instantiation and mandatory disposal. RSS is the maximum
individual ASC high-water mark, not summed process/request memory. Separate
request cleanup remains unavailable. These three small Node fixtures do not
measure a large catalog, live Fastly, ESP32, wire throughput or release publication;
small samples are not a significance test or a new performance gate.

## Remaining bounded responsibilities

| Responsibility | Current body size | Disposition |
| --- | ---: | --- |
| Expression operation rendering | `renderExpression`: 197 lines | The largest remaining operation switch has one owner. Split by operation family only when a concrete semantic change needs it; preserve assignment/short-circuit order and reverse aliasing |
| Schema composition | `nativeSchemaCodecSource`: 178 lines | Existing codec seams are reused. A later validation deletion needs a specific equivalence argument and surviving rejection owner |
| Control construction/layout | 203 / 175 lines; inner sequence/block renderers 79 / 73 | Separate construction and layout already bound the state. Keep IDs, loop patching, routing guards, partition charging and weighted allowance together |
| Manifest/result assembly | `assembleNativeResult`: 103 lines | Mostly frozen field construction; no urgent further split is justified |

Line counts are navigation facts, not gates. The source frontends, Native-plan
admission, provider requirements and artifact realization remain with their
existing authorities outside this mapped cleanup. PS-11 stops here; further
optimization needs a separately scoped problem and measured objective.
