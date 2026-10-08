# DS-04: retained static error boundaries

Development evidence recorded 2026-10-08. Pulse base:
`4859e531019e831113ae6b92aa60039a8374b8c0` on `latest`.
Human direction: include the demonstrated DS-04 win and finish this focused change.
Before PR preparation, `latest` advanced to
`8e9e7918a11745e207bc08a253075bf9425031ac` (PRPT-06). That commit was merged;
canonical corpus outputs were regenerated, and documentation, maintainer and scope
checks passed again. Measured product-file hashes remain identical.
The original experiment is [Catalog PR 83](https://github.com/nw/catalog/pull/83).

## Implementation

The Native control emitter interns literal `(errorNextIndex, errorNextBlock)`
pairs in deterministic block order and generates retained zero-argument wrappers
around the existing error router. Dynamic stage/helper arguments continue through
the existing router directly. Compiler-owned, explicitly annotated wrappers are
accepted by the existing retention transform.

Guard positions, error semantics, original inline partition budgeting, state
packing, charged states, run-loop allowance, effects, host ABI and optimizer
settings remain unchanged. The optimization is in the default build and requires
no experimental flag. Regression coverage includes deterministic interning,
retention authority, partitioned and single-function dispatch, dynamic boundaries,
recovery, fatal errors, settlement, cancellation and stalled-dispatch allowance.

## Catalog comparison

Catalog source: `54a5bb5876f228a5778b66fb9beb2b2007cf5d18`; 367 source files
verified against the source pin. Both artifacts use the local Node Native target
with default O3/shrink0 and unchanged retention/merge settings.

| Measurement | Control | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Wasm bytes | 3,315,675 | 2,964,228 | 351,447 (10.60%) |
| gzip bytes, level 9 / mtime 0 | 654,387 | 646,478 | 7,909 (1.21%) |

The plan hash, source hash, project source hash and Wasm data-section bytes match.
All 255 emitted wrappers were independently identified in the native code section
(4,241 total body bytes), each forwarding to the same router. Generated source has
30,570 static substitutions and 5,321 dynamic calls retained. The successful build
used approximately 257 seconds and 2,102,488 KiB peak RSS; this is one observation.

The isolated installed candidate contains all 20 package tarballs and 1,072
byte-verified package files. The final repack includes subsequent documentation
and generated-corpus synchronization; the two measured product-file hashes remain
identical. This is development evidence against an uncommitted working tree, not
a clean-candidate release seal. Artifact, product-file, package and report hashes
are recorded in [measurement.json](./measurement.json).

## Qualification

- All 55 tasks in the unit profile passed. That combined attempt subsequently
  failed in the Native example loop because it included a JavaScript-only example.
  Both Native fixture loops now select Native examples explicitly.
- The final focused functional report terminated successfully with all eight
  selected tasks completed: `canonical-native-wasm`, `canonical-native-plan`,
  `application-errors`, `application-error-boundaries`, `reusable-stage-o18`,
  `pure-source-helpers`, `node-cross-target-conformance`, and
  `javascript-effect-adapter`.
- The current 137-case Catalog harness passed paired execution against the exact
  control/candidate artifact hashes. Responses, ordered traces/effects,
  continuation states, provider metadata and value/memory accounting match.
  Only artifact/plan identities were excluded. Separate processes preserve opaque
  host invocation-ID sequences; provider fixtures reset for each case.
- `maintainer:check`, `docs:check`, `documentation-release`, the TypeScript build,
  and the final 20-package pack with packed-documentation validation passed.

Failed attempts remain distinct from the final successful receipts: the initial
wrapper WAT assertion needed a multiline-compatible match; canonical MCP corpus
synchronization repaired a stale snapshot; Native fixture selection repaired the
JavaScript-only example failure; and packed documentation needed three existing
PRPT packet links to resolve outside the installed package. The first same-process
Catalog comparison differed in host invocation IDs, so final pairs use isolated
processes. An incomplete candidate replay receipt was retried sequentially and
only the completed 137-case report counts as evidence.

## Limits

The original experiment's authenticated/storage supplement was not rerun: this
packet qualifies the current 137-case harness and focused compiler tests. It is
not deployed Fastly acceptance or a latency/throughput claim. Report attribution
still maps 12 of 100 routes and establishes reachability for 0 of 100; those gaps
remain visible. The bounded-size combination is recorded below; converging-size was not rerun.
The release owner still runs the immutable candidate's required release gates.

## Bounded-size follow-up

Human direction: measure the combination. Using the same installed DS-04 packages
and pinned Catalog source, only add `--experimental-native-bounded-size`.
The completed artifact records O3/shrink2 with convergence disabled.

| Recipe | Wasm bytes | gzip9 bytes |
| --- | ---: | ---: |
| Original default | 3,315,675 | 654,387 |
| Original bounded-size (prior measurement) | 3,042,029 | 662,449 |
| DS-04 default | 2,964,228 | 646,478 |
| DS-04 bounded-size | 2,690,561 | 654,324 |

Combined bounded-size saves another 273,667 raw bytes (9.23%) versus DS-04 default,
or 625,114 bytes (18.85%) versus the original default. It adds 7,846 gzip bytes
(1.21%) versus DS-04 default; compressed size is only 63 bytes below the original
default. DS-04 default therefore remains the smallest gzip artifact of these four.

The build completed successfully in 235.122 seconds with 2,052,112 KiB peak RSS
(one observation). All 255 wrappers remain retained, with the same 4,241 total body
bytes and shared router target. Generated source and plan files are byte-identical
to DS-04 default. Bounded-size changes the optimized data-section representation
(250,212 versus 256,535 section payload bytes), so binary section identity is not
claimed for this comparison.

The completed 137-case candidate replay matches both original-default and
DS-04-default receipts exactly under the same observable comparison. It covers
responses, ordered effects/traces, continuations, provider metadata and value/memory
accounting. The original bounded-size row is prior size evidence; that artifact was
not replayed in this follow-up. See [bounded-size.json](./bounded-size.json) for
artifact, recipe, report and package identity hashes. No product code or default
recipe changes were needed. The experiment remains opt-in.
