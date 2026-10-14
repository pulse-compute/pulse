# MEM9-06A — Fastly numeric runtime eligibility

Recorded 2026-10-14. Related [#289](https://github.com/pulse-compute/pulse/issues/289).
Depends on MEM9-04 (#336) and MEM9-05 (#338). This is an evidence-only
investigation. Production selection is unchanged; MEM9-06B owns enablement.
Generic scalar lifetime remains unresolved and #289 stays open.

## Separate verdicts

| Runtime / configuration | Verdict for the next implementation | Evidence and restriction |
| --- | --- | --- |
| Schema-inactive, no linked guest (`stub`) | Eligible | Exact semantic and host-trace parity; numeric roots stay bounded without a collector. Keep the existing proof and budget exclusions. |
| Schema-inactive, current crypto linked guest | Eligible within the tested contract | Real ES256 and RSA-2048 RS256 signing before and after numeric work, independently verified signatures, fixed 32-page memory and all final-link audits pass. This is not qualification of arbitrary guests, every RSA width or every crypto operation. |
| Schema-active + linked, default JSON cache arena | Blocked | Both unchanged production and the prototype build and pass final-link audits, then trap at execution. All four ordinary/observed artifacts reproduce `WebAssembly.RuntimeError: unreachable`. Numeric regions do not fix the pre-existing configuration failure. |
| Schema-active + linked, explicitly elided arena | Conditional evidence only | ES256 fixture passes, including schema decoding. Do not infer that all schema/guest combinations are eligible or silently select arena elision. Keep this combination separate from the initial MEM9-06B scope. |

Recommended MEM9-06B scope: enable the existing numeric proof for schema-inactive
stub and current linked runtime paths, retaining all current ABI, runtime,
package-owned emitter and budget gates. Keep schema-active linked builds out of
that initial change. The existing schema/nonlinked path remains as qualified
previously. No allocator redesign or handle reclamation is necessary for these
numeric regions.

The default-arena failure is an observed execution blocker, not a proven root
cause diagnosis. Memory pressure is consistent with the fixed heap and with
elision making the fixture pass, but the exact failing allocation has not been
isolated. Do not describe a successful link audit as runtime qualification.

## Why the runtimes differ

AssemblyScript's pinned `rt/stub` is a bump allocator with no tracing collector:
`__collect` is a no-op and `__free` can only discard the last block. Numeric
allocation avoidance requires no collection; written values are boxed at region
exits using the existing immutable handle representation. It does not release
previous handles or mutate boxes visible through aliases or collections.

Guest-linked Fastly uses the provider's fixed-memory runtime plus ITCMS. The
allocator reuses/coalesces free blocks and collects on exhaustion. Its dynamic
region is `[540928, 2097152)`. Rust stack/static data, primary static data and the
16,640-byte private invocation frame retain their existing disjoint ranges.
Memory stays at 32 pages (2 MiB); there is no `memory.grow`. Numeric f64 slots do
not widen the allocator, frame or pointer contract. All final artifacts continue
through the production Binaryen link/audit path, including observed artifacts.

The current linked manifest identifies `pulse.crypto.es256-rs256.verify-and-sign.v3`;
its prebuilt guest SHA-256 is
`b1d09f10fddf7587cb9e87f959fa908457e076e207db078fc101390c70e4aecf`.
This investigation does not authorize new guest ABIs or providers.

## Prototype and measurement

The test-only module-cache wrapper loads the Fastly writer with the existing
`host-numeric-regions-v1` policy. That removes schema/guest selection gates for
this experiment while reusing the identical proof, f64 renderer and budget
exclusion. It restores both module caches immediately. Production modules are
not edited, and normal production builds still select zero regions in every
campaign cell. The host policy name is a diagnostic technique, not a new public
Fastly flag or a production policy recommendation.

Each fixture combines an entry handler, two pure helper calls and two shared
stage invocations. Five numeric loops each execute 0 or 256 additions. Separate
fixed-cost negative cases retain unknown-live-in and 257-iteration loops. The
fixture exercises aliases, arrays, object snapshots/spread, reassignment after
suspension, repeated owner entry, signed zero, NaN, infinities, fractional and
large-number arithmetic, break/continue and early stage exit. Linked fixtures
sign before/after entry numeric work; Node crypto independently verifies both
signatures. The test proof also asserts that budgeted selection is disabled.

Each cell builds production/prototype × ordinary/observed artifacts. Each
successful artifact runs two normal fresh instances and an early-exit instance.
Responses, host traces and outbound requests agree exactly across strategies and
observation modes. Control-block metadata and guard-state counts agree. No
production allocation strings are rewritten to force a desired result.

The observer changes compiler inputs in memory only, with pinned runtime hashes.
It counts actual guest table entries, exposes the allocator's current span, and
for linked builds samples ITCMS managed bytes after a diagnostic full collection.
It adds no host import. Post-GC handle counts remain unchanged, and all nine
existing ownership/numeric probes pass (mask 511). Diagnostic exports are not
part of the product ABI.

Allocator span is `offset - startOffset` for stub and `endOffset - startOffset`
for fixed memory, sampled before diagnostic collection. It includes allocator
layout/free-space effects and is neither live bytes nor peak allocation. In the
RS256 fixture the prototype span can be larger despite fewer live managed bytes,
because collection/reuse occurs at different times. Linear capacity, allocator
span, managed bytes and table entries must not be conflated. No RSS or timing
claim is made.

## Recorded retention result

Measured source: `930951874b43746593087065e43baefb260afd28`, tree
`888986c47bee4190e5c997772df1eef04c8f21a3`. Clean and unchanged before/after.
Documentation is committed later. These are the 256-addition cells; each request
runs five measured regions (1,280 additions), alongside fixed-cost declined loops.

| Configuration | Handles, production → prototype | Managed bytes after GC, production → prototype | Linear capacity, production → prototype |
| --- | ---: | ---: | ---: |
| stub / default | 1,917 → 619 | unavailable → unavailable | 2,621,440 → 1,310,720 |
| ES256 / default | 1,986 → 688 | 767,936 → 618,464 | 2,097,152 → 2,097,152 |
| RS256 / default | 1,999 → 701 | 781,520 → 632,048 | 2,097,152 → 2,097,152 |
| schema-linked / elided | 1,993 → 695 | 769,728 → 620,256 | 2,097,152 → 2,097,152 |

For stub, ES256 and RS256, adding 1,280 measured additions creates 1,280
additional numeric roots in production and **zero additional numeric roots**
in the prototype. The remaining hundreds of roots include the deliberately
unoptimized 257-iteration/live-in cases. This proves avoidance for the selected
regions, not general handle reclamation.

## Qualification and limits

The final pinned campaign covers eight cells: stub/ES256/RS256 × 0/256 work,
plus schema-linked ES256 at 256 with default/elided arenas. It checks complete
coverage, immutable source before/after, file hashes, ordinary/observed parity,
retaining positive controls and bounded numeric roots. It rejects missing cells,
changed source identities and altered artifact hashes. This is 32 builds,
84 successful executions and four expected default-arena execution traps.

The existing `fastly-numeric-regions` and `guest-link-audit-diagnostics` tasks
passed. They provide broader existing proof/failure/ownership and final-audit
regressions in addition to this campaign. Dependency restore and TypeScript
build passed. Exact commands, source identities and archive hashes are in
[evidence.json](evidence.json).

The unit profile stops at the existing CLI report import-boundary violation:
`wasm/packages/cli/src/internal/report/snapshot.js` imports
`@pulse-compute/wasm-compiler/canonical-project-compiler` outside the approved
list. Two tasks passed before this failure; the remaining unit selection did not
run. The direct boundary test reproduces it. The offending file and boundary
rules are unchanged from the dependency branch and `latest`; the gate is not
waived. Full release/installed-consumer acceptance remains at the sprint boundary.
No Viceroy or deployed Fastly execution is claimed.

Development attempts are retained separately: the first owner assertion assumed
stage-prefixed paths, but canonical stage paths retain their entry origin; the
first two observer imports failed resolution or loaded the runtime twice. The
final observer uses one global diagnostic accessor in the already-selected
runtime. The schema default-arena trap was then isolated from those observer
errors and reproduced in ordinary production builds. The first complete campaign
passed; a second pinned campaign adds a stronger budget-negative assertion that
actually invokes region selection. No product source changed between them.

## Replay

Restore the lockfile-pinned dependencies with lifecycle scripts disabled and run
the normal workspace build. At the measured source, in a clean checkout, use a
new output directory:

```sh
node wasm/test/performance/mem9-06a.cjs --out /tmp/mem9-06a-new
node wasm/test/performance/mem9-06a.cjs --check /tmp/mem9-06a-new/report.json
node wasm/scripts/run-wasm-tests.cjs --task fastly-numeric-regions --task guest-link-audit-diagnostics --no-report
```

The archive retains authored fixture bytes, public test-only keys, plans,
generated source, build recipes/logs, ordinary/observed Wasm, final-link audits
and responses' hashes. RSA test keys are regenerated between campaigns; exact
request key material for replay of archived artifacts is in `fixture.json`.
`--check` resolves paths relative to the extracted report directory, so original
absolute scratch paths are not required for evidence validation.
