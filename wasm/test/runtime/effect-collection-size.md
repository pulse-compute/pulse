# B10-06 payload-size review

This opt-in measurement answers whether adding bounded effect collections makes
applications larger when they do not use the feature. It is review evidence for
PR #406, not a new performance promise or release gate. No product code changes
are included in the measurement follow-up.

## Findings

Six unchanged handlers have **zero raw-Wasm byte growth**, both as portable core
modules and as full Fastly Native artifacts. These cover no effects, a single
ordinary fetch, and static keyed parallel groups with 1, 4, 16 and 32 members.
None imports `effect_collection_count`.

All twelve unchanged Native comparisons also have identical Wasm code sections.
Data-section hashes differ (the generated guest embeds its plan identity), so
the full artifacts are not byte-identical. Gzip deltas range from -9 to +5 B;
zero raw-size growth should not be described as identical compressed payloads.

| Unchanged handler | Core Wasm, before → after | Fastly Native, before → after |
| --- | ---: | ---: |
| No effects | 808 → 808 B | 27,707 → 27,707 B |
| Single fetch | 1,419 → 1,419 B | 37,417 → 37,417 B |
| Static parallel, 1 | 1,782 → 1,782 B | 43,833 → 43,833 B |
| Static parallel, 4 | 2,745 → 2,745 B | 45,684 → 45,684 B |
| Static parallel, 16 | 6,575 → 6,575 B | 50,487 → 50,487 B |
| Static parallel, 32 | 11,712 → 11,712 B | 56,174 → 56,174 B |

The existing Fastly JavaScript **application source bundle** grows by 4,510 B
for every unchanged fixture. The no-effect bundle grows from 524,917 to 529,427 B
(0.86%), or from 100,390 to 101,321 B with gzip (+931 B). This measures the
provider's actual unminified source bundler, including its shared runtime closure;
it does not measure the downstream `js-compute` Wasm deployment artifact.

On the candidate, static and dynamic groups produce the same ordered array of
text responses:

| Capacity | Static core | Dynamic core | Static Fastly Native | Dynamic Fastly Native |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1,782 B | 1,843 B | 43,833 B | 44,127 B |
| 4 | 2,745 B | 2,796 B | 45,684 B | 46,004 B |
| 16 | 6,575 B | 6,601 B | 50,487 B | 50,850 B |
| 32 | 11,712 B | 11,636 B | 56,174 B | 56,614 B |

Increasing dynamic capacity from 1 to 32 adds 9,793 B to this core module
(about 316 B per extra slot). That is capacity growth, not a per-slot surcharge
over static parallel. The static fixture reconstructs the ordered array from a
keyed result object; the dynamic fixture receives an array directly. Full Fastly
Native adds 294–440 B versus the corresponding static fixture in this sample.
Declared capacity determines the generated slot bank, not runtime list length.

## Reproduce and provenance

Use separate clean checkouts, each with the lockfile-pinned dependencies installed
with lifecycle scripts disabled and `npm run build` completed. Workspace package
links must resolve within their respective checkout. The script launches one
process per checkout to prevent module-cache contamination and refuses dirty
source trees or mismatched lockfiles. It writes transient fixtures under the
ignored `wasm/.test-results` directory and removes them on completion.

Recorded baseline: `e3eabe23c8ea353f6631d8972e94f58fa930444c` (`latest`, before B10-06).
Recorded candidate: `1663051cbacdf64439106e604b20abbc64271eef` (B10-06 implementation).
Node: 24.18.0, Linux x64. Both use the same lockfile hash. The report records tree,
fixture, script and artifact hashes, raw/gzip sizes and Native code/data hashes.

```sh
node wasm/test/runtime/measure-effect-collection-size.cjs \
  --compare /absolute/baseline-checkout /absolute/candidate-checkout \
  > /tmp/effect-collection-size.json
```

The recorded [JSON report](effect-collection-size.json) covers 6 baseline and 10
candidate cells. Each cell compiles and checks the expected response on the core
Native host and the injected Fastly ABI host before recording its size. Collection
imports must be absent in controls and present in dynamic cells. JavaScript source
bundling must succeed. The aggregate is `passed` only after both snapshots finish
and unchanged source identities match. No service deployment occurs.

Initial attempts stopped because the fresh baseline lacked built TypeScript
dependencies; after building that checkout the full comparison passed. A second
complete comparison adds code/data-section hashes to distinguish equal size from
identical bytes. This evidence refers to the pinned implementation, not the later
evidence-only commit that contains this report.

These small fixtures do not establish a universal zero-overhead guarantee.
Gzip size is diagnostic and is not the Fastly artifact quota. This does not measure
latency, GC, RSS, retained response payloads, installed package size or a deployed
Fastly service. Those claims require different experiments.
