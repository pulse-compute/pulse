# RPT8-15: continuing-entry attribution feasibility

Decision: **go for the bounded entry-control-body technique; no-go for automatic
production promotion or an unqualified isolated handler-size claim.** Existing
retained provenance cannot divide an optimized mixed dispatcher into per-entry
byte ranges. A test-only layout prototype preserves entry boundaries and yields
separate final control bodies for both continuing registrations in this fixture.
It changes executable bytes and adds dispatch structure. Production layout,
report schemas, and measurement semantics remain unchanged.

## Reproduce

With the repository's lockfile-pinned workspace dependencies, from the root:

```bash
node docs/internal/rpt8-15/proof.cjs
node wasm/scripts/run-wasm-tests.cjs --task cli-report-entry-proof --no-report
```

The experiment is explicitly invoked, outside aggregate test profiles. It reuses
`wasm/test/cli/assert-report-entry-proof.cjs` and its existing final-emission
observer and request cases. No production module imports the prototype. Temporary
artifacts are removed; stdout contains bounded measurements and hashes, stderr
contains cell progress. There is no Catalog rebuild or performance campaign.

## Why the retained evidence cannot answer isolated bytes

`canonical-native-report.js` associates entries with generated dispatcher chunks.
`report-capture-transform.cjs` joins those symbols to the same final optimized
module's function census. These records identify whole function bodies. Neither
record establishes per-entry instruction ranges inside a mixed body. The optional
direct-call graph also has function granularity; it does not partition a callee's
instructions among its consumers. Source-case counts or a division by consumer
count would be invented byte attribution.

The proof independently matches generated declarations using their exact ordered
program-counter cases, then joins their qualified names to the verified optimized
function census. Baseline continuation bodies mix owned and unowned control
states. It deliberately rejects a single observed entry when unowned states share
the body, and rejects missing final symbols or conflicting physical-body owners.
Thus one recorded consumer never becomes an exclusivity claim.

## Prototype boundary

A separately loaded test copy of `canonical-native-control.js` splits a chunk
when adjacent dispatcher states change `entryId`, including transitions to/from
unowned routing states. Existing terminal-handler, stage and helper partitions
keep their current implementation identities and budgets. Source replacement is
exact and fails if the owning predicate changes. It is not an environment switch,
public option, or production feature.

The prototype preserves all control states, program counters, continuation data,
plan bytes, and compile flags. It changes chunk declarations and the balanced
selector. The proof verifies generated chunk identity against final emission;
all prototype chunks survive optimization in these cells. It does not force
additional symbol retention or change the optimizer recipe.

A mapped control-body byte count includes its generated dispatch/guard call sites
and excludes separately emitted callees, shared data, and imported implementation
bytes. The proof reports observed outgoing direct-call counts where the existing
graph supports them; this is not an endpoint execution-chain claim. It never
substitutes these counts for existing Handler body, Own, Shared or Reachable.

## Bounded results

The existing `transfer-router.ts` fixture has nine entries, six route
registrations, two continuing registrations, and repeated effectful middleware.
Each cell builds the baseline and prototype with the same optimization settings.

| Target / optimization | Baseline Wasm | Prototype Wasm | Delta | Isolated continuing control entries |
| --- | ---: | ---: | ---: | ---: |
| Portable / default | 7,406 B | 7,768 B | +362 B (+4.888%) | 0 → 2 |
| Fastly / default | 42,903 B | 43,240 B | +337 B (+0.785%) | 0 → 2 |
| Portable / bounded-size | 7,043 B | 7,404 B | +361 B (+5.126%) | 0 → 2 |
| Fastly / bounded-size | 36,591 B | 36,976 B | +385 B (+1.052%) | 0 → 2 |

`bounded-size` means `experimental-native-bounded-size`. Chunk count increases
from 11 to 25 in every cell; all final chunk mappings survive. Seven request cases
run on both artifacts in every cell: **56 executions**. Assertions cover response
status/body and effect counts for ordinary response, conditional early response,
fallthrough, explicit error/recovery, repeated middleware and missing routes.
Fastly uses its local test host, not Viceroy or a deployed service. The final
graph is available in all four cells; the isolated control roots still have
11–20 direct callees outside their own body sets (imports included).

The final measured generator+asc+capture wall times were 2,175 → 2,445 ms
(portable default), 4,469 → 4,346 ms (Fastly default), 1,970 → 2,416 ms (portable
bounded-size), and 3,673 → 3,807 ms (Fastly bounded-size). These are single paired
samples with the baseline first, not a compile-performance conclusion. An earlier
run produced identical byte sizes but different timings. The proof
prints fresh timings and artifact hashes on every run. Cold-start/order effects
and observer work are included; it does not measure runtime throughput or RSS.

## Promotion gate

The small-fixture result establishes feasibility of separately measured entry
control bodies. It does not establish that changing production chunk layout is
worthwhile at application scale, that those bytes capture all authored handler
logic, or that the added dispatch calls have acceptable throughput cost.

Before a production proposal:

1. Define the metric precisely: entry control bodies versus shared callees and
   generated control overhead; retain non-additive accounting.
2. Qualify effect resume, loops, nested/mounted routing, shared helpers/stages and
   optimizer alias/elimination cases beyond this fixture.
3. Measure artifact size, compile cost and runtime effects on a representative
   large application using bounded, explicitly selected runs.
4. Obtain a separate decision on changing executable partitioning. Keep the
   observational report path from selecting or modifying compiler layout.

RPT8-14's existing containing-body view remains the production answer. RPT8-16
indirect-call analysis is independent; this proof does not widen graph support.
