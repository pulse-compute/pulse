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

## Input provenance

Pulse baseline is `1c9874b464d48ef7d3d73beec11dbe411c84302e`; Node is v24.19.0.
Receipts bind diagnostic source bytes, lockfile, input payload and derivation
source separately from this baseline commit. The small and mixed inputs are
fresh compiler planning captures from this checkout. Mixed includes reused
mounts/helpers, conditional continuation, explicit error handling and HTTP/events.
It deliberately does not require combined error/event Wasm emission (the known
separate #329 limitation). Binding values and predicates are not captured.

The fresh Catalog comparison pins source `54a5bb5876f228a5778b66fb9beb2b2007cf5d18`
and API tree `94cfc2e5fd5fcfdc536e6d82ef61b8ea65e5496d`. All 268 API blobs plus the
root package manifest and instructions matched their Git hashes before and after
the build. Source access was explicitly approved after the initial rejection;
the GitHub connector supplied the files because shell Git lacked credentials.
No Catalog implementation or configuration was edited.

The fresh build used Pulse `c18acc70fded0695ea22ef732b90e1e7fadca8d4`, whose
production source is unchanged from the integration baseline above. API package
resolution linked to this built workspace; Catalog's checked-in beta.5 package
declarations were not rewritten. This is source-build diagnostic evidence, not
installed-package qualification. Profile/host is Fastly Native; reporting is
`info`; report capture is enabled; recipe is `experimental-native-bounded-size`;
WAT and JSON-cache-arena elision are off. AssemblyScript is 0.28.18, json-as 1.5.0,
and each compiler invocation retains a 600,000 ms timeout. Full sanitized compiler
flags and toolchain versions are in the machine receipt.

Build plus project resolution completed in 585,501 ms; validated artifact report
collection took another 38,393 ms. The final Wasm is 2,840,977 bytes. The unmodified
40,728,001-byte report has SHA-256
`82b628db399c2331f682b482b744d03ffc81f0e43ae37c6f3fa9091daacdef19`.
The collector currently leaves capsule revision/fingerprint fields null; the
external receipt binds the report hash to the verified source and recipe instead.

The retained historical VIS05 capsule is kept separately; its source revision is
unknown. Both captures have 255 registrations, 214 definitions, 6,398 authored
use sites and 141 helper calls, but their payload and analytics hashes differ.
Historical results are not relabeled as fresh results. Neither payload nor private
application source is committed here.

To reproduce the fresh input, check out the pinned Catalog source and prepare the
Pulse workspace dependencies/build. In the isolated API checkout, resolve
`@pulse-compute/{pulse,runtime,crypto,jwt,s3,provider-node,provider-fastly}` to the
corresponding Pulse workspace packages. From the Pulse repository root, run this
with `CATALOG_API` set to the absolute Catalog `apps/api` path and `CAPTURE` to a
new output file, then use that file with the diagnostic commands above:

```sh
node <<'JS'
const fs = require('node:fs');
const { resolveProject } = require('./wasm/packages/cli/src/project-config');
const { buildProject } = require('./wasm/packages/cli/src/project-execution');
const { collectArtifactReport } = require('./wasm/packages/cli/src/internal/report/retained');
const project = resolveProject({ cwd: process.env.CATALOG_API, profile: 'fastly' });
const built = buildProject(project, {
  experimentalNativeBoundedSize: true, timeoutMs: 600000, emitWat: false
});
fs.writeFileSync(process.env.CAPTURE,
  JSON.stringify(collectArtifactReport(built.files.manifest).capsule), { flag: 'wx' });
JS
```

Build timings are retained in the report, so a new build need not reproduce its
whole-payload hash. Verify source/recipe identity and each new input hash, then
require limited-mode parity with that input's own canonical rows and coverage.

## Findings

The machine record is [measurements.json](./measurements.json). It retains all
16 attempted measurement runs, including three timed-out exhaustive experiments
and superseded watchdog/layout-of-measurement attempts. Development failures and
their corrections are listed separately. Published source checkpoints `4eecb1b` and `c546ec0` preserve earlier diagnostic
implementations. `sourceCommitMap` binds local evidence commits to identical
published trees; worker hashes bind measured uncommitted diagnostic bytes. No
large Catalog payload is committed.

### Fresh source-pinned comparison

All three fresh runs used the same new report and unchanged diagnostic code at
`c18acc70`. The external budget remains 60 seconds, 1,536 MiB RSS and 1,024 MiB V8
heap per run, including input decoding and validation.

| Mode | Observed result | Derivation | External peak RSS |
| --- | --- | ---: | ---: |
| Limited | Exact baseline parity: 10,000 rows, 7 consumers, 6,384 sites; row cap | 909.91 ms | 655.5 MiB |
| Unrestricted | **Incomplete at 60 seconds**; at least 392,379 emission attempts; 132/255 consumer iterations finished | No terminal derivation time | 657.0 MiB |
| Owner relations with focused queries | 28,812 relations; all 255 iterations finished; static coverage remains partial | 213.68 ms | 688.8 MiB including validation and focused oracles |

The fresh limited run again covers only 3 consumers with named-binding rows,
9,438 consumer/site pairs and 330 paths, with 562 additional path rows. It reaches
the row ceiling at 21,474 work steps and 44 hops. Identity/deduplication takes
863.60 ms (95% of derivation); graph construction takes 6.93 ms, traversal self
time 3.10 ms, expansion self time 16.63 ms and sorting 15.19 ms. Input validation
takes 14.15 s, normalization 1.46 s, raw encoding 182 ms, normalized encoding
879 ms, stringification 35 ms and initial viewer-model construction 51 ms.

The fresh unrestricted run observes 516,533 work steps, 72-hop witnesses and no
duplicate IDs before its last progress event. Time, not RSS, stops it. Emission
attempts are a lower bound; full unique-row count and full materialized size are
still unknown. This meets the investigation's explicit watchdog stop condition.
Different progress totals between runs are not a capacity or speed comparison
on this shared host.

The fresh relationship joins again predict 983,012 pre-deduplication expansion
attempts. Three selected consumers match their entire focused canonical oracle
row lists, including IDs, paths, lanes and uncertainty:

| Consumer | Relations | Rows | Raw traversal | Projection | Focused oracle |
| --- | ---: | ---: | ---: | ---: | ---: |
| Highest expansion middleware | 212 | 6,843 | 8.84 ms | 912.48 ms | 667.29 ms |
| Median route | 54 | 2,328 | 4.89 ms | 355.38 ms | 450.40 ms |
| Error registration | 1 | 14 | 3.02 ms | 1.22 ms | 4.32 ms |

Projection is not consistently faster than a focused canonical derivation; the
benefit under investigation is avoiding eager expansion across every consumer.
All 10 binding-inventory queries take 3.25 ms after a 37.42 ms index build; 9
bindings have authored sites. The same partial-evidence caveats apply.

The fresh truncated report is 40,728,001 raw / 7,111,986 normalized bytes. Its raw
analytics facts excluding rows are 5,618,861 bytes; facts plus all owner relations
are 44,186,789 raw / 4,470,853 normalized bytes. The owner table alone remains
38,567,905 raw / 2,060,366 normalized bytes. These shapes have different coverage
and contents; they are not a same-coverage savings comparison. Sampled heap peaks
are 471.0 MiB for limited mode and 351.8 MiB for focused relations; external RSS
includes input validation, retained report data and later queries.

### Historical capture and fixture results

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

The fresh source/build comparison now confirms this discovery recommendation.
It closes the source-access blocker, not whole-Catalog equivalence or application
qualification. VIS-07 still owns the semantic and compatibility work above.

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
  seal are deferred. Fresh Catalog source-build comparison completed with exact
  limited parity, an explicit unrestricted timeout and selected-consumer parity.
