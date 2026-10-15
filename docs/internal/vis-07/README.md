# VIS-07 — compact relationship queries

This implements the relationship model authorized by VIS-07 and targets
`vis-integration`, following the merged VIS-06 qualification. It changes report
storage and report queries, not compiler, host, runtime, physical-size accounting,
provider authority or release behavior. VIS-08 navigation and VIS-09 layout remain
separate work.

## Representation and ownership

New capture emits `pulse.report-analytics.v2`. It stores exactly the four
canonical inventories: definitions, registration instances, authored use sites
and validated helper calls, with their coverage. Registration records retain
order, mount ancestry, match/eligibility, normal/error/terminal control and
next/child/parent-return links. Sites retain operation/capability, source spans
and logical binding/reference identities. No binding value, predicate body,
source text, physical body inference, owner expansion table or association table
is added. The existing graph validator validates all retained identities,
references, ordering, ancestry, coverage and source/provenance constraints.

The nested analytics version changes; capsule version 1 and normalized storage
encoding version 1 remain unchanged. Strict old readers reject the new analytics
version. `handler-associations.js` remains the frozen v1 validator and diagnostic
oracle. Historical v1 reports keep their own retained rows, caps, IDs, evidence
hashes and exact exports. They are never upgraded during replay or rendering.
Legacy fixtures explicitly construct v1 to continue testing that path.

## Internal query contract

`wasm/packages/cli/src/internal/report/relationship-queries.js` exports
`create(analytics)`, accepting validated immutable canonical facts. The offline
HTML embeds the same engine and the contracts-owned sealed path grammar. Its
synchronous SHA-256 implementation is used only for requested identity tuples;
Node uses the existing native hash. Tests compare both implementations and their
whole query results.

| Query | Result and meaning |
| --- | --- |
| `entry(registrationId)` | Owner relations, direction (`direct`, `upstream`, `continuation`), deterministic lazy `via` witness, inherited flag, uncertainty, coverage and charged traversal work. |
| `upstream(registrationId)` | Admission predecessors, including handlers with no operations or bindings. Does not require operation/helper inventory availability. |
| `route(registrationId)` | Lazy contextual association sequence and query coverage. Includes owned sites and validated helper sites. |
| `binding(bindingId, acceptRegistration?)` | Sorted candidate consumer IDs, factored blocks, lazy rows and coverage; optional predicate scopes registration instances. |
| `site(useSiteId)` | Lazy contextual consumers of the exact authored site and coverage. |
| `rows.length`, `rows.slice(start,end)` | Exact observed row count and a requested JSON-ready page. No full expanded table is retained. Iteration is available for diagnostic equivalence. |

Queries preserve v1's accepted static semantics and exact association IDs:
consumer, site, ordered witness and lane determine identity. Direct ownership is
not execution, including for shadowed registrations. Inherited candidates remain
conditional or unknown. Normal, explicit error/recovery and event lanes remain
distinct. Events do not inherit HTTP predecessors. Shared definitions never
collapse their separate registration/mount instances.

An upstream relation's source and provenance resolve through its owner and
ordered registration IDs; a helper witness resolves through the exact retained
call. A witness is the existing deterministic static dependency explanation,
not every feasible path, a runtime trace or an effective permission grant.

Indexing is linear in facts and helper registration links. Distinct normalized
patterns are compiled once. Each requested entry builds a two-mode graph and
uses seen sets for traversal. Witness tails share predecessor nodes, avoiding
quadratic copying of continuation paths. At most the last entry result is
cached; the viewer separately caches one binding projection. Binding queries
reuse filtered owner-site arrays, and do not hash or expand consumer × site ×
path rows to find consumers. A page materializes only its requested rows.

The existing 250,000 traversal-work safety budget is retained **per entry query**.
Exhaustion is explicit partial `graph-budget-exhausted` coverage, never a complete
zero. It is a safety policy, not measured capacity. The old global 10,000-row and
64-hop materialization ceilings do not apply to v2. Paging admits at most the
existing reader record bound (100,000) per requested page. UI pages use 20 rows;
that is a display size, not a semantic cutoff. Reader byte, depth, node and string
bounds are unchanged. Consumers must inspect coverage before interpreting empty
results. Missing topology/control remains unavailable; missing operation facts
withhold associations without erasing upstream admission.

Ordering is canonical registration order, owner traversal order, sorted helper
calls and sorted site IDs. Page order is deterministic; it need not match the
historical table's final hash sort. The oracle comparison sorts by exact ID and
compares entire records, including all fields, not just counts.

## Viewer and comparison

Existing registration details now expose upstream candidates. Registration/site
association details and binding evidence page the lazy result. Binding summaries
join factored blocks, preserving grouping by mount instance and definition.
Navigation still uses existing exact registration/site/binding links. The full
JSON export is the unchanged compact capsule, independent of filters, paging or
query caches. Offline HTML retains its fixed hash-bound CSP and no network access.

Semantic comparison compares the canonical definitions, registration/control
links, sites, helper calls and binding identities. It does not reconstruct a huge
association table for comparison. The v2 retained association inventory is
unavailable, not empty/complete; v1-to-v2 contextual rows remain unresolved,
never invented removals. The analytics representation appears separately in
metadata. A control change remains a registration semantic change. Historical
v1-to-v1 comparison keeps its existing row comparison.

## Reproduce and evidence scope

Use the lockfile-pinned workspace and Node version recorded in `measurements.json`.
The diagnostic reuses the VIS-06 Linux process/RSS watchdog (600 seconds,
1,536 MiB RSS, 1,024 MiB heap, 20 ms samples), preserving incomplete attempts.
The outer receipt retains the VIS-06 supervisor version; its worker result is
`pulse.vis07-measurement.v1` and pins the actual production source file hashes.

```sh
node wasm/test/diagnostics/vis07-run.cjs /path/to/pinned-catalog-v1.json /tmp/vis07-catalog.json
node wasm/test/diagnostics/vis07-run.cjs /path/to/pinned-small.json /tmp/vis07-small.json
node wasm/test/diagnostics/vis07-run.cjs /path/to/pinned-mixed.json /tmp/vis07-mixed.json
node wasm/scripts/run-wasm-tests.cjs --task cli-report-relationships --task cli-report-viewer --task cli-report-handler-topology --task vis06-association-diagnostic --no-report
```

The worker validates the original capture, creates a **new** compact capsule from
identical canonical facts and artifacts, and gives it its own evidence hash.
It records raw/normalized sizes, creation, validation, encoding, replay, HTML,
indexing, every entry and binding query, viewer projection and requested-page
latency. Then every full per-consumer row list and every binding consumer set is
compared to the unrestricted VIS-06 oracle. No private Catalog payload is committed.
The separate fresh build receipt checks actual v2 capture on the same pinned
Catalog source and recipe; neither run is installed-package or release acceptance.

## Qualified Catalog result

Final query source: local commit `dfecaee78a56bd22989a25fe7e4e8bbf08fe7fff`,
clean at measurement start; production file hashes are in the receipt. Input
SHA-256 `82b628db399c2331f682b482b744d03ffc81f0e43ae37c6f3fa9091daacdef19` is
exactly the qualified VIS-06 fresh capture: Catalog
`54a5bb5876f228a5778b66fb9beb2b2007cf5d18`, Fastly Native,
`experimental-native-bounded-size`, Node 24.19.0, AssemblyScript 0.28.18,
report capture enabled, WAT disabled and JSON arena elision disabled.

Every **255/255 consumer row list** and **10/10 binding consumer set** matches.
That includes all **983,012 unique associations**, 217 consumers with rows,
212 consumers with named-binding rows, 6,398 sites, 919,182 consumer/site pairs,
18,730 distinct paths and 72-hop explanations. The aggregate semantic digest is
`20bff8cf8b2bd0ef5afde8e0b09a6e960d3fcd277859bd75c8cf597373eaafce`, identical
to the VIS-06 completed monolithic and partitioned oracles. Static query coverage
remains **partial / unsupported-mapping**; exhaustive equivalence is not runtime
path feasibility or proof that an operation executed. Small and mixed fixtures
also complete every consumer/binding comparison.

| Measure | Old limited capture | New compact capture from identical facts |
| --- | ---: | ---: |
| Raw complete-capsule JSON bytes | 40,728,001 | 16,296,324 |
| Actual stored bytes, including final newline | 40,728,002 | 16,296,325 |
| Raw analytics bytes | 30,050,435 | 5,618,758 |
| Normalized whole-capsule candidate bytes | 7,111,986 | 5,664,748 |
| Persisted contextual row table | 10,000 rows, truncated | Absent; generated on demand |

The complete capsule is **60.0% smaller than the capped baseline**, while queries
recover the full qualified answers. These are report-data sizes, not Wasm bytes.
The unchanged storage codec falls back to raw JSON for both whole capsules;
normalized candidate sizes above are **not** emitted-file sizes. Analytics alone
has a 1,588,318-byte normalized representation. Full unrestricted legacy
associations alone require 1,660,578,467 raw bytes; there is no successfully
normalized full legacy capsule to compare. Its earlier pipeline exceeded the RSS
watchdog after derivation completed.

| New query/capture measurement | Observed |
| --- | ---: |
| Fact index construction | 3.14 ms |
| All 255 entry projections | 111.26 ms |
| Entry median / p95 / maximum | 0.410 / 0.920 / 4.683 ms |
| All 10 binding queries | 695.64 ms |
| Binding median / maximum | 68.09 / 93.16 ms |
| Warm first 20 explanation rows | 0.040 ms |
| Maximum charged work for an entry | 1,523 of the retained 250,000 safety budget |
| New capsule creation and validation | 5.21 s |
| Storage selection/encoding | 0.62 s |
| Exact replay plus serialization checks | 14.20 s |
| HTML generation at measured commit `005af237` | 5.11 s; 16,542,205 bytes |
| Entire measurement + full-oracle qualification | 162.96 s; 736.1 MiB peak sampled RSS |

Forcing all expanded rows **only in the diagnostic** took 14.17 seconds in the new
engine versus 44.73 seconds in the canonical oracle during the same run.
Comparison, digesting and byte counting have separate recorded timings. The
entire-harness memory maximum includes both input and output captures, replay,
HTML and the partitioned oracle; it is not a browser-only memory measurement.
One entry cache and one binding viewer cache are sufficient for these measured
queries; no additional persistent index or global owner table is justified.

The first Catalog attempt also passed. Its storage-size field was misleadingly
named `normalizedBytes`; the second attempt records selected storage and candidate
encoding separately and requalifies the final exhaustion-reporting change. Both
unaltered receipts are retained. The independent 90,000-registration safety test
checks explicit partial budget exhaustion, including reverse-query aggregation.

## Fresh production capture

The same pinned Catalog source was rebuilt on published commit
`005af237c37b98de3aaace59aee42b86269a6f20` (tree-identical to the qualified local
commit). All 270 source blobs match their pinned Git identities before and after
the build. Production capture emits v2, and its canonical analytics exactly equal
the qualified facts. Final and prelink artifact sizes **and hashes are identical**
to VIS-06: final Wasm 2,840,977 bytes,
`d32d0de43ac0af868fdefce2e4c48efdfa78058337e57b24cbabd70dfd857b72`;
prelink 2,690,561 bytes,
`93c1004763ef4610899b3e94e329a7cf71f620b29dce3ae79667235931aacd32`.

Fresh raw capsule size is 16,296,323 bytes, SHA-256
`f40dcb8338d2d8ff7fe123d074cc0ab2174fa55153930e05f84f5296ed7c2b53`.
Its one-byte difference from the factored comparison capsule is build metadata;
the analytics match exactly. Observed build plus artifact collection took
425.35 seconds versus 623.89 seconds in VIS-06. Compiler durations also varied
(239.59 versus 326.87 seconds), despite identical output, so the entire wall-time
change is **not** attributed to VIS-07. The report query and storage measurements
above isolate the representation change. Both builds used the same 600-second
per-compiler timeout and no provider artifact reuse. This is workspace-source
qualification, not installed-package acceptance or a full release seal.


## Final validation

The complete registered unit profile passed **63/63 tasks in 295.76 seconds** on
clean local commit `f24898e4d8206876e180bf09f56d51090eb75ab4`, published with the
identical tree as `b3c79dd3e9cf744bd4738924b2dd78f4c3e0ee5e`. The final rerun
includes graph queries, historical compatibility, source-independent imported
replay, exact exports, schema contracts and offline viewer interactions. The
first unit attempt exposed an obsolete v1 table assertion in the imported-input
test; the test now checks v2 query answers and rejects tampered ownership facts.
The final viewer fix preserves keyboard focus at the first and last explanation
pages. Its asset bytes postdate the HTML size measurement above; the qualified
query engine is unchanged.

Production topology integration also passed 112 runtime executions across the
four HTTP/error/event and default/bounded recipes, with 54 negative topology
cases. TypeScript build, maintainer checks, documentation checks and local
documentation release simulation passed. Machine evidence retains prior failed
attempts, log hashes, immutable source identities and equivalent published trees.

Full CLI, native/JavaScript/conformance, installed-package, visual-browser and
release-seal qualification remain deferred. The unit and focused checks above,
full static Catalog equivalence and fresh production capture are the completed
scope; this PR does not claim a release seal.
