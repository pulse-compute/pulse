# PS-10 B: expression/control emission and final assembly

This completes the second slice of the [PS-09 extraction map](../ps09/README.md),
following [PS-10 A](../ps10a/README.md). Human direction: “👍 proceed with B.”
No named Entry Point matches the private emitter refactor; ordinary root/Wasm
instructions apply, with root/docs for this repository-only record. Class:
hardening; scope: inside-developer-preview; no protected contract changes.

Base: `d02a002d0b2134fec8239392041af40de3e8f142` (`latest`, PR #204 merged).
The complete production extraction and diagnostic fingerprints are recoverable in
[`57794f2382f9`](https://github.com/pulse-compute/pulse/commit/57794f2382f9f02e6f1740edca896e165db31d5c),
tree `12fecd66eb0913f3f691f63d85e4f3d428119c4d`.

## Completed ownership

Paths are under `wasm/packages/runtime-core-as/src/compiler/`.

| Owner | Responsibility | Lines |
| --- | --- | ---: |
| `canonical-native-expressions.js` | Private alias/retention decisions, stable expression naming, deferred expression and pure-helper declarations | 311 |
| `canonical-native-control.js` | Block/entry construction, resume requirements, error guards, partition layout, weighted allowance and run-loop rendering | 433 |
| `canonical-native.js` | Ordered orchestration, source join, manifest and result assembly | 203 |

The root generator is **42 lines**, down from 822 after A and 1,000 before PS-10.
Its file shrinks from 843 to 203 lines in B (originally 1,339). The new explicit
seams add 104 total production lines in B; this is a responsibility split, not a
code-size or performance optimization. A's context/schema/support owners remain
unchanged, and the complete extraction uses the five private files PS-09 planned.

Expression aliasing and retention maps stay private to preparation. Control
receives a stable `exprName`; declarations are rendered only at their original
assembly point. All traversal counters, active ownership and entry maps stay
inside control construction. Only finished blocks/maps pass to layout, support
and result assembly; no mutable builder session is shared between owners.

The root visibly orders schema, crypto, event/decoder guards, expression
preparation, flow views, control construction/layout, runtime support, allowance
validation and final assembly. Control layout and allowance remain separate
calls so the allowance check stays after support preparation. Final helper
rendering stays late, and the source join preserves every section and blank line.

Public exports, error type/details, options signature, versions, naming,
annotations, chunk targets, weighted guard allowance, manifest, plan/provider
validation and optimizer settings remain unchanged. Error stacks naturally point
to the extracted files. Existing Fastly consumers still receive identical portable
source. The two schema/census diagnostic fingerprint lists include the new owners;
no historical optimization campaign is revived.

## Validation

[results.json](results.json) binds source identities, complete task coverage,
corpus/diagnostic comparisons and performance observations. Dependencies are the
existing lockfile-pinned bundle on Node 24.19.0. No dependencies, registered tasks,
CI steps or seal checkpoints are added.

- All 13 PS-09 fixtures match the base generator's entire result in original and
  JSON-copied form: **26 matching source/hash/manifest/block results**. Repeated
  emission, input preservation, PS-09 hashes and the shared-stage 307/315
  expression-identity distinction are preserved.
- **16 malformed-input comparisons** preserve error name/code/message/detail and
  public error type. They cover expression/control rejection, effect/continuation
  lookup, loop/router boundaries, deferred pure helpers and overflow. Competing
  faults confirm schema/event/decoder, control-before-helper and
  allowance-before-helper ordering.
- All 15 moved nested function declarations, including the pure-helper body
  renderer, retain their exact text. Workspace build passed.
- **131/131 tasks passed**: all unit (45), JavaScript (7), Native (48) and
  conformance (29) tasks, plus event-Native and Fastly platform support. All task
  processes and the runner's cleanup checks passed on the published production tree.
- Maintainer/documentation synchronization and checks, documentation release
  validation, whitespace and scope declaration passed.

The corpus ran from local commit `4a959f4` before connector publication; its tree
matches the published extraction exactly. Performance and functional tasks use
the published commit. An initial diagnostic harness launch could not resolve the
contract from the repository root; it ran no comparison cases. Selecting the
existing repository contract path fixed the harness, and all 16 comparisons then
passed.

These are development checks, not a release seal. Functional tasks use four
isolated worktrees with the existing runner's deadlines, descendant cleanup and
incremental reports. Their assignments cover each selected task exactly once;
registry dependencies/exclusive-resource hints were checked before splitting.
Previous task durations only balance assignments and are not a performance claim.
The full selection completed in 7.28 minutes. Some existing tasks leave untracked
fixture directories in their isolated checkout; no tracked source changed. The
reports remain under `wasm/.test-results/ps10b-validation/`; fixture residue
stays in the owned worktrees.

## Performance and artifacts

All six artifact hashes match across all four campaigns and all three build
samples per cell. Native artifact sizes remain 808, 39,479 and 2,933 bytes;
JavaScript sizes remain 379, 14,035 and 742 bytes.

Native median changes (first pair / repeat pair):

| Fixture | Build time | Compiler peak RSS | Warm request time |
| --- | ---: | ---: | ---: |
| minimal-request | -6.9% / +0.7% | -0.6% / +0.5% | +12.6% / +15.9% |
| schema-effect | +13.9% / -9.0% | -1.0% / -6.5% | -0.3% / +1.2% |
| multi-route | +2.0% / -1.0% | +0.2% / -1.1% | +7.0% / +10.8% |

The initial schema build-time increase prompted the repeat, which reversed the
change. No sustained compile/RSS regression is established. Small warm timings
vary even though the executable artifacts are identical; these observations do
not establish an execution change caused by moving the emitter's JavaScript code.

The performance harness/protocol/settings/toolchain remain unchanged, and both
serial pairs precede parallel functional validation. Every original PS-08 report
field and observation is retained in the compact evidence by factoring out shared
metadata and ordered fixture identities. No observations are discarded. These
small samples are descriptive; they neither set a gate nor establish statistical
significance. PS-11 can measure the completed extraction against a fresh control.
