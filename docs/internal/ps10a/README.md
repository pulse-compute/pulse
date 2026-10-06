# PS-10 A: Native preparation and support emission

This implements slice A of the [PS-09 extraction map](../ps09/README.md).
Human direction: implement PS-10. The map requires one reviewed slice at a time;
expression/control extraction and final assembly remain PS-10 B after this review.
No named Entry Point matches this private compiler refactor. The ordinary
root/Wasm instructions apply to production and diagnostic helpers, and root/docs
to this repository-only record. Class: hardening; scope: inside-developer-preview.

Base: `8b634eefcf3963f001adf00a78ce86adb619589c` (`latest`, PS-09 merged).
The production extraction is recoverable as
[`1704055fa1bc`](https://github.com/pulse-compute/pulse/commit/1704055fa1bc1d7538162a01cbb8dee49a924085),
tree `378791af3acd15ed02a755e0e170f8b5f6de1b48`. Subsequent changes update two
existing diagnostic callers and record results; production bytes stay identical.

## Ownership after slice A

All production paths below are under `wasm/packages/runtime-core-as/src/compiler/`.

| Owner | Responsibility | Lines |
| --- | --- | ---: |
| `canonical-native-context.js` | Reference-preserving plan indexes, expression collection, local naming/errors, event/decoder emission preconditions and later flow views | 228 |
| `canonical-native-schema.js` | Existing schema composition around the current codec owners | 194 |
| `canonical-native-support.js` | Imports, globals, state/stage support, resume readiness/clearing, start/event/result ABI exports | 167 |
| `canonical-native.js` | Public export, ordered calls into those owners, existing expressions/control/dispatcher, final source/manifest/result | 843 |

The original file had 1,339 lines. Its generator is now 822 lines, down from
1,000; expression/control and final assembly remain the largest responsibility
for B. Total production lines increase by 93 because of explicit module seams;
this is an ownership refactor, with no code-size or performance improvement claim.

Context owns derived views, not mutable emission state. Expression aliases,
retention decisions, block/entry maps and traversal counters remain local to the
root generator. Input expression references and all insertion/traversal ordering
are preserved. Event/decoder checks still follow schema/crypto composition, and
flow preparation remains after expression sharing. Runtime support receives
completed block/resume data. Support fragments that were evaluated during final
assembly are still rendered there, preserving error/evaluation order.

The existing runtime/event/plan contracts, complete plan validator and provider
requirement authority remain unchanged. Schema/crypto/stage accessors reuse their
existing implementations. The public generator export, error class contract,
options signature, versions, flags, ABI, manifest and source formatting remain
unchanged. Error stack locations naturally follow the extracted JavaScript files.

Two retained diagnostics (`schema-cost-profile.cjs` and `gen01-census.cjs`) used
to expose the schema function by rewriting the monolith's module text. They now
call the private schema module directly and include the new owners in their
source fingerprints. Fastly's existing private diagnostic loader remains in use.
The schema-attribution controls and a GEN01 source-attribution fixture verify
byte-exact fragments and complete source-byte accounting without replaying the
historical benchmark campaign.

## Evidence

[results.json](results.json) binds the tested sources, profile outcomes, corpus
and performance observations. Validation uses the existing installed lockfile
bundle on Node 24.19.0. No dependency, registered task, CI step, seal checkpoint,
optimizer setting or public contract is added.

- All 13 PS-09 fixtures matched the original generator's entire result: source,
  source hash, manifest and blocks. Both original and JSON-copied plan forms were
  compared separately, for 26 matching results. The shared-stage 307/315-expression
  distinction remains intact. Input JSON and PS-09 source hashes also match.
- Six malformed-input comparisons preserve error name/code/message/detail and
  the public error type, including event-before-decoder and
  schema-before-event/decoder failure ordering.
- Source AST comparison confirmed unchanged bodies for the remaining expression
  and control functions, expression traversal, contract loaders and schema
  composition. Workspace TypeScript build passed.
- Complete unit/JavaScript selection passed **52/52 tasks**; Native passed
  **48/48**; conformance plus event-Native/Fastly-platform support passed
  **31/31**. Native and conformance used two isolated worktrees of the production
  commit. The unit retry used the diagnostic-caller fix with identical production
  bytes. Both compiler lanes ran after the serial measurements.
- Maintainer/documentation synchronization and checks, release documentation
  validation, whitespace and deterministic scope declaration passed.

The first unit attempt failed because schema attribution still expected the
schema function in the old file. Updating the two diagnostic callers resolved
that dependency; the failed report is retained separately from the completed
retry. The first corpus launch refused uncommitted source before running a case;
the completed capture used the committed production tree above. These are
focused development results, not a release seal. Existing per-task deadlines and
incremental reports remained active during profile execution.

## Performance and artifacts

Two serial before/after PS-08 pairs ran before functional validation. Each
campaign passed six fixture/target cells and used the unchanged harness,
protocol, dependencies, settings and machine; the existing comparator accepted
both pairs. All six artifact hashes, including the three Native Wasm artifacts,
were identical across all four campaigns and all three build samples per cell.

Native median changes (first pair / repeat pair):

| Fixture | Build time | Compiler peak RSS | Artifact bytes |
| --- | ---: | ---: | ---: |
| minimal-request | +4.3% / -6.4% | +0.2% / +0.4% | 808, unchanged |
| schema-effect | -0.9% / -6.6% | +10.4% / -1.5% | 39,479, unchanged |
| multi-route | -4.8% / -9.8% | +0.4% / +0.2% | 2,933, unchanged |

The first schema RSS increase prompted the second pair. Across both campaigns,
unchanged-code schema samples ranged from 297.8 to 335.5 MiB and refactor samples
from 318.8 to 336.6 MiB. The repeat reversed the median difference. These small
samples do not establish a sustained regression or improvement. Native warm
request median changes ranged from -11.6% to +6.7%; identical executable artifacts
and observed variation do not support attributing those movements to this refactor.
PS-11 should use a fresh compatible control when measuring the completed cleanup.
