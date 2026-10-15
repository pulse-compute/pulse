# VIS-06 — association discovery

Repository-only diagnostic evidence for the VIS workstream. No production files,
public CLI flags, runtime behavior, capsule schemas, or reader limits change.
PR target: `vis-integration`. Full release qualification is deferred by the owner.

## Reproduction

Use the lockfile-pinned workspace dependencies, with lifecycle scripts disabled,
and build the workspace. Run from the repository root on Linux:

```sh
node wasm/test/diagnostics/vis06-inputs.cjs /tmp/vis06-inputs
node wasm/test/diagnostics/vis06-run.cjs /tmp/vis06-inputs/mixed.json limited /tmp/vis06-mixed-limited.json
node wasm/test/diagnostics/vis06-run.cjs /tmp/vis06-inputs/mixed.json unrestricted /tmp/vis06-mixed-unrestricted.json
node wasm/test/diagnostics/vis06-run.cjs /tmp/vis06-inputs/mixed.json relations /tmp/vis06-mixed-relations.json
node wasm/test/diagnostics/vis06-run.cjs /path/to/catalog.json relations-focused /tmp/vis06-catalog-focused.json
node wasm/scripts/run-wasm-tests.cjs --task vis06-association-diagnostic --task cli-report-handler-associations --no-report
```

Repeat the three modes for `small.json` and a canonical or normalized Catalog
capsule. The runner refuses to overwrite an earlier receipt. Optional trailing
arguments are timeout milliseconds, RSS MiB and V8 heap MiB (defaults: 60,000,
1,536 and 1,024). These are **external experiment budgets**, not discovered
physical capacity or proposed product limits. SIGINT/SIGTERM, timeout, RSS,
heap OOM, exceptions and missing completion all produce incomplete receipts.
An uncatchable parent kill can leave a `running` receipt; it is not a success.
RSS is sampled externally every 20 ms with a checked child process identity;
sampling can overshoot a threshold. Heap maxima are sampled, not exact peaks.

## What is measured

`vis06-derivation.cjs` loads the actual canonical derivation in a private module.
Exact-count source anchors fail closed on implementation drift. Only this copy
removes the 10,000-row, 250,000-work and 64-hop association ceilings. It retains
canonical pattern matching, cycle/visited handling, ordering, uncertainty and
association identity construction. Limited-mode output must equal the validated
input's rows and coverage. Nothing changes the original module or require cache.

The runner validates input through production capsule validation, or production
topology validation for freshly compiled diagnostic fixtures. Generated
unrestricted output is **not a valid new production capsule**: the original
evidence hash is not rewritten, and the production reader/validator still uses
its original ceilings. If the normalizer's bounded copy rejects generated output,
an isolated diagnostic copy can measure the same normalization sort with a plain
structured clone. This does not relax input validation or reader admission.

Stages distinguish input decoding/validation, site/helper indexes, per-consumer
routing graph construction, traversal, site expansion, identity/deduplication,
sorting, normalization, raw/normalized encoding and initial viewer projection.
Nested derivation timings have inclusive and self time; do not sum inclusive
times. RSS includes Node, the retained input, validation and later projections,
not only the association table. Timings are single observations on a shared host.
No browser first paint, layout or release qualification is claimed.

The existing algorithm does **not** enumerate all feasible runtime paths. Its
visited sets retain deterministic continuation witnesses per graph node.
“Unrestricted” means exhaustive execution of that existing static algorithm over
the retained facts, not complete runtime control-flow proof. Policy truncation,
upstream incompleteness, ambiguous static matches, and physical watchdog failure
remain distinct.

## Prototype boundary

The prototype records consumer/owner/path/uncertainty relationships before
use-site expansion. Route queries join owner definitions and accepted helper
calls to authored sites on demand; binding queries reverse those owner-level
relations. A few focused route traversals rebuild directly from raw facts to
measure the uncached path. No graph database, persisted format, cache policy or
replacement architecture is introduced.

Route semantic digests cover the **entire canonical association row**, including
identity, ordered path, lane, conditionality, coverage and evidence. Binding
consumer sets are checked against those expanded route rows. This is a factoring
experiment sharing the existing admission algorithm, **not an independent proof
that the existing algorithm is semantically correct**. VIS-07 must still test its
new implementation against this oracle and the accepted static semantics.
Empty query arrays are never a non-use assertion; callers must retain input and
traversal coverage. Relationships with no binding operation are retained too.

## Input provenance and acceptance limitation

Pulse baseline is `1c9874b464d48ef7d3d73beec11dbe411c84302e`; Node is v24.19.0.
Receipts bind diagnostic source bytes, lockfile, input payload and derivation
source separately from this baseline commit. The small and mixed inputs are
fresh compiler planning captures from this checkout. Mixed includes reused
mounts/helpers, conditional continuation, explicit error handling and HTTP/events.
It deliberately does not require combined error/event Wasm emission (the known
separate #329 limitation). Binding values and predicates are not captured.

Catalog is the retained VIS05 capsule: 255 registrations, 214 definitions,
6,398 authored use sites and 141 helper calls. Its recorded recipe is Fastly
Native, `experimental-native-bounded-size`, AssemblyScript 0.28.18. Its source
revision/fingerprint are absent. Automatic approval review rejected reading the
private Catalog source repository, so a fresh Catalog SHA/build comparison remains
blocked. Historical-capture results must not be labeled fresh application results.
No Catalog implementation changes belong in this PR.

## Findings

The machine record is [measurements.json](./measurements.json). It retains all
13 attempted measurement runs, including two timed-out exhaustive experiments
and superseded watchdog/layout-of-measurement attempts. Development failures and
their corrections are listed separately. Published source checkpoints `4eecb1b` and `c546ec0` preserve earlier diagnostic
implementations. `sourceCommitMap` binds local evidence commits to identical
published trees; worker hashes bind measured uncommitted diagnostic bytes. No
large Catalog payload is committed.

| Input / mode | Observed result | Derivation | External peak RSS |
| --- | --- | ---: | ---: |
| Small / limited and unrestricted | 2 rows, 1 consumer, 2 use sites; complete | 2.15 / 1.63 ms | 44.8 / 41.5 MiB |
| Mixed / limited and unrestricted | 160 rows, 16 consumers, all 28 sites; traversal exhausted, static coverage partial | 14.73 / 11.04 ms | 53.1 / 53.2 MiB |
| Historical Catalog / limited | 10,000 rows, 7 consumers, 6,384 of 6,398 sites; row cap | 907.58 ms | 611.2 MiB |
| Historical Catalog / unrestricted | **Incomplete at 60 seconds**; at least 543,585 emission attempts, 0 duplicates observed, 164 of 255 consumer iterations finished | No terminal derivation time | 661.6 MiB |
| Historical Catalog / owner relations | 28,812 relations; all 255 consumer iterations finished; static coverage still partial | 200.12 ms | 619.6 MiB including validation and focused oracle comparisons |

Catalog's limited result represents only **3 consumers with named-binding rows**,
although 7 consumers have some operation association. It contains 9,438 distinct
consumer/use-site pairs, 330 distinct witness paths, and 562 additional rows due
to alternate paths for the same pair. It hits the row ceiling at 21,474 charged
steps and a maximum 44-hop witness. These are not full-graph cardinalities.

The unrestricted stop reached 700,886 work steps and 72-hop witnesses without
altering cycle handling. The last progress receipt is a lower bound, not the
exact row count at termination. The process was below the RSS watchdog; **time**
caused the stop. We did not raise the experiment budget to pursue brute force.
Full unique-row count, full materialized byte size and its normalization/encoding
cost therefore remain unknown. No later stage is counted as completed.

The owner-relations experiment predicts **983,012 site/helper expansion attempts
before identity deduplication** by summing canonical owner joins. This is not a
completed unique-association oracle. Eagerly expanding and hashing every route
query also exceeded 60 seconds, even after owner traversal completed in 211 ms.
Replacing storage but still eagerly projecting all rows would preserve the main
cost.

### Cost attribution

In the final limited Catalog run, 854.21 of 907.58 ms (94%) is in association
identity construction and deduplication. Routing graph construction uses 5.47 ms,
traversal self time 7.10 ms, expansion self time 12.62 ms and sorting 23.80 ms.
No duplicate row IDs were found before truncation; the expensive work is largely
creating distinct contextual records, not eliminating exact duplicates.

The same limited pipeline spends 14.22 seconds validating the input, 1.30 seconds
normalizing, 253 ms encoding raw JSON, 609 ms building the normalized encoding,
21 ms stringifying it and 27 ms constructing the viewer model. Validation and
memory figures include the existing report/reader pipeline and must not be
attributed solely to association derivation. This is a shared-host observation,
not a latency benchmark or a new performance guarantee.

| Observed representation | Raw bytes | Normalized bytes | Coverage / comparison boundary |
| --- | ---: | ---: | --- |
| Small diagnostic input with expanded associations | 6,274 | 4,224 | Complete planning fixture, not an emitted report |
| Mixed diagnostic input with expanded associations | 169,135 | 41,850 | Exhausted static algorithm; ambiguous matches remain partial |
| Historical Catalog report with 10,000 rows | 33,776,509 | 3,575,339 | Truncated production report, excluding trailing newline |
| Catalog raw analytics facts, excluding association rows | 5,618,612 | Not separately measured | Existing canonical facts, including original coverage metadata |
| Catalog facts plus all prototype owner relations | 44,186,540 | 4,470,570 | Diagnostic analytics only; broader traversal than truncated report |

The last two report/analytics shapes are deliberately **not** presented as a
same-coverage before/after savings percentage. The prototype owner relation table
alone is 38,567,905 raw bytes / 2,060,366 normalized bytes. It is still expanded
consumer × owner × witness data, and is not the proposed canonical persisted
model. It establishes where factoring helps, while showing why blindly storing
that intermediate table is not enough.

### Focused queries

The final focused run chooses the consumer with the most predicted expansion,
a median route by expansion count and the last error registration. Each complete
projected row list equals an unrestricted canonical derivation for that consumer,
including IDs, ordered paths, lanes, uncertainty and evidence.

| Consumer | Owner relations | Association rows | Raw traversal | Site projection | Canonical focused oracle |
| --- | ---: | ---: | ---: | ---: | ---: |
| Highest expansion middleware | 212 | 6,843 | 4.85 ms | 806.66 ms | 995.72 ms |
| Median route | 54 | 2,328 | 4.00 ms | 251.23 ms | 348.98 ms |
| Error registration | 1 | 14 | 7.82 ms | 1.61 ms | 12.03 ms |

All 10 binding-inventory consumer queries complete in 5.23 ms after a 29.63 ms
owner index build; 9 bindings have retained authored sites. These are static
candidate sets, not effective access grants. In particular, an empty result for
the tenth binding is not a proven non-use result under partial evidence.

Small and mixed fixtures have identical whole-input semantic digests across
limited, unrestricted and relation-projected results; reverse binding sets also
match. Catalog has **selected-consumer parity only**. Whole-Catalog equivalence
is unqualified because the exhaustive oracle stopped. Missing control, old
unavailable topology, ordering, cycles, absent binding operations, absent use
sites, all three independent ceilings, error lanes and watchdog failures have
focused regression coverage.

## VIS-07 decision

Proceed with a compact **raw relationship model and focused projections** as the
next hypothesis. Preserve registration instances, control/lane facts, helper
ownership, authored sites, binding identity and uncertainty. Measure reverse
indexes and lazy explanations separately. Do not eagerly materialize the roughly
million contextual expansion attempts, and do not promote the intermediate
28,812-row owner table to canonical storage without further measurement.

Do **not** retire production association rows on this evidence alone. VIS-07 must
establish its semantic query contract, upstream admission without binding uses,
historical format/export/comparison compatibility, and equivalence against an
oracle that can be evaluated in bounded consumer partitions. Per-consumer oracle
execution avoids retaining the entire Cartesian expansion and is the next
measured approach; it is not claimed as implemented here.

The fresh Catalog source SHA/build remains a separate acceptance blocker. Obtain
authorized access to `nw/catalog`, pin its exact source and recipe, regenerate
the production baseline, and repeat these measurements before treating the
historical findings as current-application qualification.

## Validation

- Lockfile-pinned pnpm 12.4.2 offline install with scripts disabled, and workspace
  TypeScript build passed.
- Focused registered selection: suite shape, VIS-06 diagnostic (201 assertions),
  and the unchanged production association contract passed; 3/3 tasks, 5.94 s.
- Maintainer policy, generated documentation checks, local documentation-release
  simulation, scope declaration and whitespace checks passed (see PR).
- The diagnostic is directly selectable and deliberately excluded from normal
  functional/release profiles. No new heavyweight gate is added.
- Full qualification, browser/layout gates, installed acceptance and release
  seal are deferred. Fresh Catalog source qualification is blocked, not passed.
