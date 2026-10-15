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

Measurements and the VIS-07 decision are recorded below after the campaign.
