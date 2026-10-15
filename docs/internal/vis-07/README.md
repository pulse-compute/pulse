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
