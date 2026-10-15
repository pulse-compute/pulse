# MEM9-04 — Numeric regions in pure helpers and shared stages

Recorded 2026-10-14. This is scoped implementation evidence for the residual
numeric retention identified by [MEM9-03](https://github.com/pulse-compute/pulse/pull/334).
It does not close [#289](https://github.com/pulse-compute/pulse/issues/289).

## Implementation boundary

The existing Fastly numeric-region proof now runs inside synchronous pure
helpers and shared HTTP stages. Helper selection occurs after expression alias
decisions and before numeric globals are emitted. Existing invocation resets
and return cleanup remain intact. Stage regions box written values before
effects, transfers and generic consumers; immutable snapshots remain valid
across suspension and subsequent writes to the same local.

Regions contain no calls, effects or early returns. The existing proof
vocabulary, 256-iteration cap, policy identifier, authoring admission, host ABI,
continuation frames and budget behavior are unchanged. Unknown parameters do
not become numeric proof merely through annotations. Declined helper loops
remain generic, including their inner fragments. Effectful helpers, strings,
unknown live-ins, larger loops, Node and stub/linked runtime paths remain outside
this extension. This reduces proven numeric allocation; it is not general
scalar reclamation.

## Measured result

Clean implementation commit `e865712633126b2ae630c28984ea9c07dbce0695`, tree
`26470454defc87db98cdf86c6d3d8c799332487e`, was unchanged before and after the
campaign. The final documentation commit adds only this evidence record.

The campaign passed 12 cells / 48 executions: helper and stage owners, default
and elided JSON arenas, and 0/64/256 additions per invocation. Each request
invokes its owner twice. Each cell runs boxed and optimized ordinary artifacts
and their diagnostic-observed counterparts through the injected Fastly ABI.
The existing pinned ITCMS observer collects after response completion.

| Owner | Additions per invocation | Boxed handles | Numeric handles |
| --- | ---: | ---: | ---: |
| Pure helper | 0 | 23 | 23 |
| Pure helper | 64 | 215 | 24 |
| Pure helper | 256 | 791 | 24 |
| Shared stage | 0 | 48 | 48 |
| Shared stage | 64 | 238 | 49 |
| Shared stage | 256 | 814 | 49 |

Handle counts are identical under both arena settings. At 256 additions per
invocation, managed bytes after full GC decrease by 89,872 bytes for helpers
and 89,520 bytes for stages. Optimized handles grow by only one from the
zero-work case. Live output boxes remain legitimate roots. These are retention
fixture results, with no latency, CPU or deployed-performance claim.

Exact responses, outbound payloads, host traces, ordinary/observed capacity,
source identity and artifact hashes passed. Six incomplete or tampered report
mutations were rejected. The compact [receipt](evidence.json) records every
cell and pins the raw archive and report by SHA-256. The archive contains
generated source, plans, manifests, Wasm, recipes, worker receipts, logs and
per-file hashes; fixture dependency directories are omitted.

## Correctness and qualification

All seven focused tasks passed: `fastly-numeric-regions`, `pure-source-helpers`,
`pure-loop-helpers`, `pure-argument-helpers`, `shared-stage-o19`,
`canonical-native-wasm` and `bounded-read-loops`.

The existing numeric-region task now covers repeated helper calls, caller
loops, two actual shared-stage families, snapshots across suspension and local
overwrites, early exits, failure/deadline parity, unknown numeric parameters,
negative zero, NaN, infinity, fractions and large integers. Optimized Fastly is
compared with boxed Fastly and authored JavaScript. Control ownership and guard
counts match. Default/Node emitted source for both measurement plans is
byte-identical to untouched base `2497084`.

The unit profile passed two tasks, then failed `boundaries`; 59 tasks were
unrun. The existing CLI report importer
`wasm/packages/cli/src/internal/report/snapshot.js` imports
`@pulse-compute/wasm-compiler/canonical-project-compiler` outside the approved
entrypoint list. MEM9-03 reproduced this on untouched base `2497084`. This
change does not modify either that importer or its boundary test. The gate
remains blocked, with no waiver. Full release and installed-consumer acceptance
are deferred to the sprint boundary.

Maintainer/documentation synchronization and checks, documentation release
validation and whitespace checks passed. Scope classification is hardening,
inside developer preview, with no protected boundaries changed. No routine
qualification task or release shard was added.

Development logs retain three fixture corrections: duplicate local identifiers
were rejected by existing admission; state values had to be strings; and IEEE
assertions were changed to value comparisons because existing JavaScript and
AssemblyScript number-to-string formatting differs. None widened admission or
changed product numeric formatting. The corrected fixture and final integrated
regression passed.

## Replay

Restore dependencies from the pinned lockfile and run the normal build first.
Use the measured commit in a clean checkout and a new output directory:

```sh
node wasm/test/performance/mem9-04.cjs --out /tmp/mem9-04-new
node wasm/test/performance/mem9-04.cjs --check /tmp/mem9-04-new/report.json
node wasm/scripts/run-wasm-tests.cjs --task fastly-numeric-regions
```

The `--check` command also validates the extracted archive's
`campaign/report.json`; it resolves retained artifacts relative to that report.
The injected ABI and diagnostic full-GC observation are qualification tools,
not production collection behavior.
