# RPT8-16: indirect-call diagnosis and containment

Decision: **a bounded direct-only containment model is feasible**. A module-wide
indirect-call rejection can conceal useful direct-call evidence for roots that
cannot reach an opaque instruction through known direct calls. This experiment
locates opaque sites and computes their transitive callers. It does not resolve
indirect targets, replace production graph capture, or upgrade Report metrics.

This is independent of RPT8-15's entry-boundary experiment. There is no compiler
rebuild, partitioning change, runtime optimization, schema change or new CI lane.

## Run

From the repository root with lockfile-pinned workspace dependencies:

```bash
node docs/internal/rpt8-16/proof.cjs
node docs/internal/rpt8-16/containment.cjs artifact.wasm
node docs/internal/rpt8-16/containment.cjs artifact.wasm attribution.json capsule.json
node wasm/scripts/run-wasm-tests.cjs --task cli-report-graph-diagnostics --no-report
```

The optional attribution must match the exact artifact hash, imported count and
physical function census. The optional capsule must validate its own identity and
select that same artifact. Unknown entry mappings stay unknown. Entry and route
summaries classify **recorded body sets**, including associated carriers/helpers;
they are not isolated handler sizes or full endpoint execution paths.

The command reads an existing Wasm file with the pinned Binaryen dependency and
emits a diagnostic JSON object. It performs no optimization, re-emission, compiler
invocation or source loading. The result can include a large direct-edge inventory
and should be redirected to a local evidence file. Function indices, operation
kinds, counts and artifact identity are retained; raw source, disassembly, function
names, import names and data strings are not returned. Private consumer evidence
is not checked into this directory.

## Proof boundary

The analyzer reuses the production graph parser's exact comment/string masking,
module field parsing, function census/name reconciliation and exhaustive direct
call checks. It loads a separate test copy to expose scanner helpers; the production
module and its exports are unchanged.

Before constructing a direct-edge projection, it records every indirect,
reference, tail-call and table operation in its containing defined function.
Unknown control outside a function fails closed, except element `ref.func`
references, which describe possible table contents and never become guessed call
edges. Table declarations and element segments are counted separately. A table's
presence alone does not imply every function calls through it.

Only for this experiment, already recorded opaque tokens and table/element markers
are masked in a text projection fed to the existing direct-edge validator. This
projection is not executable Wasm and never becomes an available production graph.
Definition/import counts, final indices, names, all direct targets, call shapes and
module scope must still reconcile. Parser or budget failure produces no result.

From the opaque-function set, reverse direct-edge traversal marks all affected
callers, including recursive cycles. An unaffected mapped root may expose its
validated defined direct-call body union. A root that reaches opaque control gets
`unavailable`, not a lower bound disguised as a complete result. Missing roots also
stay unavailable. The result is explicitly `diagnostic-only`; qualified closure
results use `proven-direct-closure`, never Report's `available` graph state.

Imports terminate this analysis: imported implementation code, host callbacks,
startup execution outside the selected roots, data and execution frequency are
outside the result. Even an unaffected closure is not a claim of complete endpoint
reachability. Root body unions overlap and cannot be added across registrations.

Budgets remain 160 MiB WAT, 100,000 functions, 100,000 unique direct edges,
100,000 opaque sites, and 1,000,000 traversal work items per query. No existing
production budget or rejection policy is weakened.

## Evidence

`proof.cjs` covers a cycle leading to an indirect call, unrelated clean roots,
shared/repeated calls, import boundaries, missing mappings, hostile strings and
nested comments, reference/tail/table instructions, malformed text, bad call
shapes, unresolved identities and artifact mismatches. The ordinary production
parser still rejects the same indirect artifact.

A real Binaryen-generated Wasm fixture contains a table, one indirect call and
three defined functions. The analysis isolates one affected function and two
unaffected functions. The fixture executes its clean export, dynamic table call,
and out-of-range trapping case. Its bytes remain identical after analysis.

A retained large-consumer artifact was analyzed without rebuilding. Its indirect
site was localized to a defined function and its immediate callers; reverse
containment left a substantial independent set of functions and recorded route
body sets unaffected. All unaffected function closures were exercised. Exact
indices, consumer counts and raw results remain in private session evidence.
Historical Report graph state and measurements remain unchanged.

## Production follow-up gate

The result supports a separate proposal for retaining direct edges plus explicit
opaque-function diagnostics and evaluating availability per root. That proposal
must specify versioned sidecar/capsule compatibility, missing-root behavior,
aggregate traversal budgets, precise UI scope and non-additive accounting. It must
prove capture noninterference and keep old unavailable evidence unavailable.

A static-table adapter would require independently proven target sets and table
mutation semantics. This experiment supplies neither and makes no inferred edge.
General dynamic-target resolution remains deferred.
