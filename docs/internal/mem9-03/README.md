# MEM9-03 — residual scalar retention map

Status: **diagnostic implementation and measurement complete**. Related:
[#289](https://github.com/pulse-compute/pulse/issues/289),
[MEM9-01](../mem9-01/README.md), [MEM9-02](../mem9-02/README.md).
Human direction: “Implement MEM-03”, interpreted as the residual retention map.
Class: evidence; scope: evidence-only. No product, ownership, allocation-budget,
public-support, CI-selection or release behavior changes.

No named repository Entry Point matches this diagnostic campaign. The ordinary
root, Wasm and documentation instruction chain applies; writes are limited to
the four `wasm/test/performance/mem9-03*` probes and this internal report.

## Finding and next implementation

MEM9-02 still bounds its eligible Fastly numeric region. General scalar lifetime
is **not resolved**. Constant-size application state still produces increasing
handle-table roots in helpers, shared stages, unknown-input arithmetic, replaced
strings/fields, stub and linked runtimes, Node Native, and budgeted read-loop
plans. This ticket supplies the map for the next fix; it does not itself reduce
those counts, and #289 should remain open.

Prioritize the next implementation as follows. This ordering combines measured
impact with proof/ownership risk, rather than treating synthetic workload counts
as application-frequency data.

| Priority | Bounded follow-up | Evidence and required qualification |
| --- | --- | --- |
| 1 | Extend proven numeric coverage to pure helpers and actual shared-stage bodies; investigate the flat-loop cap separately | Roughly two additional Fastly roots per addition in the sampled range, versus at most two extra roots for the eligible control. Preserve helper aliases, stage frames, transfers and continuation ownership. The 512 flat-loop case is an explicit admission limit, not a failure of an admitted region. |
| 2 | Qualify numeric elimination for Node Native and the stub/linked Fastly variants in separate changes | Unbudgeted Node flat arithmetic adds five entries per iteration. Linked Fastly has the same residual table growth inside fixed 2 MiB linear memory. Node uses host values; linked Fastly also has a separate crypto guest and partitioned memory. Neither can inherit the existing Fastly proof without target-specific qualification. |
| 3 | Design general temporary lifetime for mixed values, unknown live-ins and collection writes, then budgeted plans | Replaced strings and fields are the largest Node entry-growth cases here; strings are also the largest Fastly managed-byte delta. These require coercion, alias, cache and escape rules beyond numeric-region widening. Preserve cumulative charging and exhaustion behavior in budgeted plans. |

Strings deserve priority by measured impact even though their implementation is
less isolated. Do not free on `__pulse_drop`, mutate cached boxes, or clear the
table: existing aliases, immutable snapshots and continuation locals remain
valid. The snapshot control below deliberately needs storage proportional to N.
Future acceptance must distinguish live data from temporary overhead and retain
the existing numeric-region and memory-budget gates.

## Measured matrix

Clean source: `bb45ed4e6a52131acaceef85b584274e64558d47`, tree
`3dd73a21992d8f23f1a2f3055b8ccc064f40410c`. Source identity is checked before and
after the campaign. Node 24.19.0, TypeScript 5.9.3, AssemblyScript 0.28.18,
json-as 1.5.0. Dependency/lockfile hashes and environment are retained in the raw
report. Default JSON arena only; arena elision was isolated in MEM9-01/02 and is
not varied here.

**33 cells / 132 successful executions:** eleven fixtures × 0/64/512 additions,
with ordinary and observed execution on both Node Native and the injected Fastly
ABI host. Each response is checked against an independently constructed expected
value. Fastly observation also preserves exact response, host trace, outbound
requests and linear capacity. This is fixture evidence, not deployed Fastly or
Viceroy evidence, a timing benchmark, or a release qualification checkpoint.

| Workload | Fastly roots, N=0 / 64 / 512 | Node entries, N=0 / 64 / 512 | Fastly managed-byte increase, 0→512 |
| --- | ---: | ---: | ---: |
| Eligible nested numeric control | 19 / 20 / 21 | 21 / 365 / 2,773 | 224 |
| Flat numeric loop, cap boundary | 19 / 20 / 1,043 | 21 / 341 / 2,581 | 122,752 |
| Unknown live-in from schema input | 18 / 146 / 1,042 | 22 / 342 / 2,582 | 122,752 |
| Replace fixed-length string | 18 / 211 / 1,555 | 20 / 468 / 3,604 | 196,592 |
| Overwrite one object field | 20 / 148 / 1,044 | 25 / 473 / 3,609 | 122,752 |
| Deliberately retain N numeric snapshots | 18 / 146 / 1,042 | 20 / 340 / 2,580 | 130,912 |
| Pure helper body | 19 / 147 / 1,043 | 21 / 341 / 2,581 | 122,752 |
| Shared middleware stage | 34 / 160 / 1,056 | 54 / 374 / 2,614 | 122,400 |
| Schema-inactive stub runtime | 11 / 139 / 1,035 | 19 / 339 / 2,579 | Not available: no collector |
| ES256 guest-linked runtime | 55 / 182 / 1,078 | 41 / 361 / 2,601 | 122,512 |
| Budgeted read-loop plan | 30 / 157 / 1,053 | 19 / 146 / 1,042 | 122,640 |

The nested control performs N additions using outer caps 0/8/64 and inner cap 8.
Every cap is within the existing numeric proof's 256 limit. The flat-loop fixture
uses caps 0/64/512: the last is valid Native authoring but declines numeric-region
selection. Its manifest records `unsupported-operation-or-live-in`; the private
numeric analyzer's cap test identifies this specific cause. Do not interpret
the change between 64 and 512 as an admitted-region regression. Node's nested
control also executes additional counter operations, so use the flat loop for
the five-entry-per-iteration Node comparison.

Other controls use a 70,000 accumulator, outside Fastly's small-integer cache.
The string fixture replaces a five-character result each iteration; it does not
grow the returned string. The field fixture overwrites one object. The snapshot
fixture returns and verifies every saved number. The shared-stage fixture checks
that the plan contains a stage, executes a fixture fetch and then the arithmetic;
ordinary no-effect middleware was found to inline and is not mislabeled as a
shared stage. The read-loop fixture executes one KV suspension with an inner
arithmetic loop; it measures the plan-wide budgeted exclusion, not many repeated
reads or a general continuation-lifetime stress test.

The linked fixture actually signs using an ES256 guest, the production linker
and fixed-memory runtime. Its deterministic scalar-1 TEST key is public fixture
material, never a credential. This fixture has no schema. An attempted combined
schema+ES256 Node build failed the guest-link “forbidden start section” check;
that combination has no retention result here and requires separate investigation.

## What the numbers do and do not count

Fastly observations count the strong `__pulse_fastly_values` table by kind. Node
observations count the actual `ValueHeap.values` map by JavaScript value kind.
They are different memory domains: an entry count is not a cross-target byte
comparison. Node collections hold actual JavaScript values; Fastly collections
refer to child handles. Node heap/RSS bytes are not estimated here.

At N=512 the string fixture retains 520 Fastly string roots versus 7 at N=0,
and 1,030 Node string entries versus 6. Most other Fastly growth is numeric.
The full per-kind breakdown is in `evidence.json` and the raw receipts.

Constant-size fixture state demonstrates overhead beyond semantically live
history, but this is **not an exact garbage census**. Table roots include bounded
runtime caches and setup/response values as well as overwritten temporaries.
Fastly's cached small loop counters contribute to the observed two-root slope;
do not extrapolate that slope past the cache range or call every counted entry
individually reclaimable. For snapshots, N values remain legitimately needed
through response construction; reclaiming those would be incorrect. Returning
the whole array also incurs live array and response serialization storage.

Managed bytes are measured after a diagnostic full GC **after** semantic checks.
Table counts remain unchanged by collection. The observer checks the pinned
ITCMS source hash and patches its in-memory source to expose the completed-cycle
total; installed files and production sources are untouched. The linked total
covers AssemblyScript managed memory, not the separate Rust crypto heap.
Stub builds have no post-GC measurement.

Ordinary and observed linear capacities agree in all cells. All nonlinked schema
cells reserve 2,621,440 bytes, while linked cells stay at their fixed 2,097,152
bytes. Capacity is not live memory: the fixed linked capacity conceals its
122,512-byte increase in retained managed storage. No limit is raised, no forced
collection is added to production, and no timing claim uses these observers.

## Coverage boundary and evidence

This is a representative map, not exhaustive #289 closure. Effectful helper
bodies, package-owned application emitters, generated-output and body-transform
plans, combined schema+linked builds, larger string/collection graphs,
cancellation/error paths and long continuation sequences are not qualified by
this matrix. Existing MEM9-02 regression coverage remains separate. Future
implementation should add the affected ownership/correctness cases before
claiming bounded temporary retention for those paths.

The machine validator requires terminal status, the exact matrix, clean source
identity, unchanged ending identity, matching worker receipts, file hashes,
semantic response hashes, the selected control region and bounded control roots.
It recomputes the summary. Six negative mutations reject nonterminal,
incomplete/duplicate, changed-source, changed-row and changed-hash evidence.

Focused `fastly-numeric-regions`, `pure-source-helpers` and `shared-stage-o19`
checks passed (3/3) on `3b69fa5c9c5c8f2630559ca544df9b8210d5e3e3`.
The unit-plus-numeric selection terminated **failed** after 3 of 63 selected
tasks: 2 passed, `boundaries` failed, 60 did not run. The same import-boundary
failure reproduces on untouched base `2497084d1d2e000f0d70ef2a0874af6a0dba116c`:
`wasm/packages/cli/src/internal/report/snapshot.js` imports
`@pulse-compute/wasm-compiler/canonical-project-compiler` outside the test's
approved importer list. It is preserved, not waived or fixed in this evidence
ticket. Product and existing test sources are identical across these commits.
Repository maintenance/documentation checks are recorded in `evidence.json`.
No full release/installed-consumer campaign or external deployment was run.

## Replay and attempts

```sh
node wasm/test/performance/mem9-03.cjs --out /tmp/mem9-03-new
node wasm/test/performance/mem9-03.cjs --check /tmp/mem9-03-new/report.json
node wasm/test/performance/mem9-03.cjs --self-test /tmp/mem9-03-new/report.json
node wasm/scripts/run-wasm-tests.cjs --task fastly-numeric-regions --task pure-source-helpers --task shared-stage-o19
```

Use a clean checkout of the measured commit, lockfile-pinned prepared dependencies,
unset `NODE_OPTIONS`/`JSON_CACHE`, and a new output directory. Workers compile
through ordinary admission, run in separate processes and preserve failures.
After extracting the raw archive, `--check <extracted>/campaign2/report.json`
uses that file's directory, so the original absolute paths need not exist.
The archive manifest hashes its contents; `evidence.json` pins the archive and
the original campaign report. No new routine CI/release task is registered.

Retained development attempts include the combined schema/linked rejection,
missing guest-unit/final-policy wiring in the initial diagnostic build, and an
invalid Node fetch fixture corrected to a real `Response`. An initial no-effect
middleware probe inlined; the final fixture asserts actual stage ownership.
Campaign 1 completed all 30 worker cells but failed aggregate validation because
the supposed control used a flat cap of 512. Campaign 2 preserved that as an
explicit residual, added the eligible nested control and passed all 33 cells.
The original failed campaign and unit report remain failed in the archive.
