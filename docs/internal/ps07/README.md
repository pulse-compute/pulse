# PS-07: retire frozen Fastly driver qualification replays

Human direction: implement PS-07 from the next-stream plan. No named Entry Point
matches this historical test/evidence retirement; the root and Wasm instructions
apply. Scoped owners are the O-10/O-11 replay files, test registry, suite-shape
exclusions, historical notes and this deletion ledger. Class: hardening; scope:
inside-developer-preview.

Base: `latest` at `8f2b02b3815ff144b94d59b01f809e7793be67c5`.
The [PS-01 inventory](../ps01/README.md) identified historical
compiler-efficiency replays as maintenance cost outside the seal. This slice
retires the completed O-10/O-11 shared Fastly settlement qualification only.

## Why this cluster

O-10 compared current artifacts against frozen O-08 source/recipe hashes and the
pre-factoring revision `5142725930ef8c481ad16b5b7ca2e8ebaab4ee6f`. O-11 additionally
required the entire production closure to match the fixed candidate
`2e08f1eaabcadbf400fc776fb64f55354b6d62e0`, dynamically loaded historical provider
source and replayed a paired benchmark campaign. Those are historical experiments,
not current-head regression owners. Neither exports a helper used by retained
code; O-11 was the sole caller of its Python resource wrapper.

The provider implementation and supported compiler options remain owned by their
existing contracts. O-09, O-08 and other shared compiler-efficiency helpers remain
in place. In particular, the O-11 **regression-observed** performance verdict is
preserved in its historical note and archived raw observations.

## Deletion ledger

Paths below are relative to `wasm/test/runtime/compiler-efficiency/`. Each link
recovers the exact deleted file from the immutable base revision.

| Removed file | Lines | Bytes | Surviving owner / disposition |
| --- | ---: | ---: | --- |
| [o10-driver-factoring.cjs](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o10-driver-factoring.cjs) | 93 | 7,129 | O-09 behavior; platform request-budget regression; historical size comparison archived |
| [o11-driver-qualification.cjs](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o11-driver-qualification.cjs) | 230 | 19,122 | O-09 behavior; historical paired performance campaign archived |
| [o11-compiler-resource.py](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o11-compiler-resource.py) | 15 | 638 | Only called by the retired O-11 replay |
| [o10-evidence.json](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o10-evidence.json) | 398 | 13,996 | Raw historical identities and structural results remain recoverable in Git |
| [o11-evidence.json](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o11-evidence.json) | 12,183 | 425,199 | Raw observations and regression/inconclusive results remain recoverable in Git |

Removed totals: **338 executable lines** in three replay/helper files and
**12,581 JSON lines / 439,195 bytes** of frozen results. The five deleted files
total 12,919 lines / 466,084 bytes. Registry removal deletes eight further lines
and suite-shape exclusion cleanup deletes two. Added documentation is accounted
for separately by the PR diff; JSON lines are not presented as compiler code.

## Surviving coverage

| Obligation | Current owner |
| --- | --- |
| Ordered, exactly-once settlement; ticket ownership/freshness; sibling draining; fatal/recoverable error priority; production/diagnostic trace parity | `fastly-driver-behavior-o09`: 42 HTTP scenarios, 14 priority probes and four ticket suites |
| Error-driver fatal-return fence under a request deadline, grouped timeout, transport failure and success | `wasm/test/provider/assert-fastly-request-budget.cjs`, called by `fastly-native-platform-capabilities` |
| Native Fastly platform imports/exports, normal no-error applications and explicit Native optimization option | `fastly-native-platform-capabilities` |
| Old exact source/Wasm sizes, named companion attribution and paired CPU/RSS/runtime results | Immutable historical O-10/O-11 notes and JSON; no claim that old-byte equality is a current product contract |

Unique historical failures in the removed harnesses concerned their own dynamic
module loader, inspector access and measurement assumptions. They do not become
new product regressions. The request-budget integration regression introduced
with O-10 remains in its current platform owner.

## Execution and cost impact

Both tasks were introduced as `external`, with release exclusions, in commits
`2e08f1eaabcadbf400fc776fb64f55354b6d62e0` (O-10) and
`459f704645cde3d78d270e7f7e195862bf442c01` (O-11). Registry history contains no
subsequent admission of either name to a standard profile. Neither ever ran as
part of the aggregate seal; O-11 invoked O-09 only during its manual campaign.

| Inventory | Before | After |
| --- | ---: | ---: |
| Registered tasks | 259 | 257 |
| Removed tasks selected by any standard profile | 0 | 0 |
| Release tasks | 163 | 163 |
| Installed feature gates | 10 | 10 |

All seven standard profiles retain the exact same ordered task names. Direct
release task time removed is **0 ms**: these replays had zero release executions.
The historical O-11 manual run took 244 seconds; that is not seal time saved.
No new aggregate timing was taken and no fresh-seal speedup is claimed. The gain
is removal of stale runnable machinery and checked-in result bulk.

## Validation

Development validation used the base revision above with the PS-07 working-tree
patch, Node 24.19.0 and a fresh pnpm 12.4.2 frozen-lockfile installation with
lifecycle scripts disabled. Source changes are limited to the files in this PR;
the production sources, lockfile and public option definitions have no diff.

- Workspace TypeScript build passed.
- The complete unit profile plus `fastly-driver-behavior-o09` and
  `fastly-native-platform-capabilities` passed **47/47 tasks in 184.447 seconds**.
  Terminal status and exact ordered coverage were checked. O-09 took 27.203 s and
  retained all 42 HTTP scenarios, 14 priority probes and four ticket suites. The
  platform task took 82.050 s, including the request-budget integration regression
  and explicit experimental Native optimization coverage.
- Exact before/after comparison preserved all seven ordered standard profiles;
  the ten installed-feature gates remain registered. Suite-shape passed in unit.
- Reference search found no remaining executable callers of the deleted files or
  registered task names. Historical inventory entries and immutable recovery
  links are intentionally retained. All five deleted files exist at the base.
- Maintainer synchronization/check, documentation synchronization/check, release
  documentation validation, whitespace and scope declaration checks passed.

These are focused development results. The deleted tasks contributed no work to
the previously qualified aggregate; this retirement does not claim a new seal.
