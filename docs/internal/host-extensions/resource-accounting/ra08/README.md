# RA-08: capability/resource evidence and diagnostics

This internal checkpoint adds a bounded Native observer and a versioned resource
evidence sidecar for the fixed RA-07 cache → fetch → insert recipe. Static capability
demand remains separate from runtime observations. Reports distinguish logical
completion, retained backing, host claims and logical claim retirement. They do not
claim that closing an invocation or retiring a guest claim frees all host resources.

The owner requested RA-08 after RA-07 merged at
`5b99be05fae56405d2c9dc9c3610e99149f53247`. Production compiler, provider, runtime,
report schemas, CLI commands and package admission remain unchanged. The sidecar is
`hex.ra08.resource-evidence.v1`, **not `pulse report` output**. Its validator and
comparison establish a candidate boundary for later adoption review.

## Static evidence and runtime meaning

[report.cjs](report.cjs) projects each selected operation into a capability binding
with an opaque use-site identity, implementation digest, root/parent relationship,
phase, resource kinds, actions and bounded demand. Conditional fetch and insert
bindings remain present when a runtime request hits cache and skips them. Child
demand is marked `included-in-root`; summing it again with the parent envelope
would double count. Admission includes the entire cohort, cleanup reserves and one
execution-exit reserve, using the unchanged RA-07 profile.

The report identifies both the canonical parent plan and experimental expanded
plan. It does not promote the synthetic children into compiler-proven operations.
Binding IDs derive from effect-site IDs and are meaningful only with that plan.
They are not a cross-build source-matching algorithm. The retained plan provides
the original source location; synthetic children inherit the parent's location.

| Evidence | Meaning | Does not establish |
| --- | --- | --- |
| Static binding and resource envelope | Possible work and its declared capacity | That a conditional child ran |
| Charged handles / backing bytes / records | Current logical ledger obligations | RSS or exact live host resource count |
| Logically finished root | No further business work from that root | Backing or host reclamation |
| Released / consumed / transferred retirement | Guest claim retirement after an adapter observation | Universal close semantics or physical reclamation |
| `uncertain-or-fenced` state | A retained uncertain outcome or a consuming-call fence | A confirmed host leak |
| `uncertainHostClaims` | Handle charges specifically in that state | All outstanding work after a trap |
| Retained backing bytes | Backing charges still in the ledger | That the allocator has reclaimed them |

A normal miss ends with zero charged handles and 262,785 retained backing bytes.
Its two request inputs transfer, its pending request is consumed, and four handle
claims release. The cache backing records can be marked uncertain while the fetch
backing remains owned; neither is counted as an uncertain **host handle**. A failed
fetch wait retains three possible host claims regardless of whether the injected
host actually consumed its input or allocated outputs.

Admission diagnostics report requested capacity, configured limit and shortfall
for handles, backing bytes, records and effects, linked to the whole cohort. A
cohort shortage is not attributed arbitrarily to one conditional child. Static
profile values and report arithmetic are cross-checked by the schema.

## Native collection and boundedness

[observer.as.ts](observer.as.ts) observes claim-state writes into separate fixed
storage. It records numeric state transitions, execution-scoped record ordinals,
root and producing child site. Attribution is set at adapter claim-allocation
points, including fetch decoding during continuation resumption; the current
driver slot alone is insufficient. It never exports the claim's raw payload, provider
handle, memory address, cache key, request URL, body content or exception text.
Record ordinals are fresh on slot reuse; report scope IDs prevent interpreting the
same ordinal in two executions as the same resource.

[build.cjs](build.cjs) adds checked observation anchors to generated RA-07 source;
it does not change production files or the RA-07 harness. The observer performs no
hostcalls and adds no imports. It writes only its own static tables and counters.
The independent [host.cjs](host.cjs) reuses RA-07's host with a post-run read-only
snapshot. Every normal test compares the full observed behavior against the same
unobserved compiled control: results, errors, calls, cleanup, authority, deadlines,
remaining host resources and existing accounting must match.

Default event capacity is 256, with an optional every-fourth-transition sampler.
Capacity can be 0, 8, 64, 256 or 4,096. Count-only mode keeps counters and final
records with a one-byte event-bank placeholder because the compiler rejects a
zero-length static buffer. Fixed counter storage is 256 bytes; record identity and
producer tables take 128 bytes per original root; each retained event takes 28
bytes. These are declared observer-bank bytes, not total instance memory or code
cost. They are outside the RA-07 business-resource reservation.

Collection reports separately count retained, sampled-out and capacity-dropped
transitions. Aggregates continue when the event list fills. Counters saturate at
one million transitions, flag partial aggregate coverage, and never wrap. Tests
force the same saturation branch at eight transitions. Record identity continues
to update after saturation so final retained records remain attributable.

Final-record coverage, aggregate coverage and event-list coverage are independent.
A truncated or sampled event list can coexist with complete counters and a complete
final ledger snapshot. A trap, containment fault or lost observation prevents a
complete execution claim. Counter saturation makes aggregate comparison unavailable.
An absent or disabled observer produces `runtime: null`, not fabricated zeroes.

## Schema and comparison

[schema.cjs](schema.cjs) uses an exact allowlist: unknown fields and versions are
rejected. It checks bounds, reference integrity, root/record conservation, resource
kind classification, profile identity, cohort demand, transition counters, sample
ordering, shortfalls and completeness. Valid reports are bounded to two MiB.

[cli.cjs](cli.cjs) is an internal reader, with a bounded file-size check:

```sh
node docs/internal/host-extensions/resource-accounting/ra08/cli.cjs validate miss.report.json
node docs/internal/host-extensions/resource-accounting/ra08/cli.cjs compare hit.report.json miss.report.json
```

A comparison requires matching expanded plans, resource profiles, binding evidence
and unobserved execution-artifact hashes, plus complete aggregate observations on
both sides. Otherwise the delta is unavailable with a reason; missing or trapped
observations never compare as zero. Recompiling identical generated source under another module name can change
optimized Wasm layout. The comparison keeps its exact executable identity check;
matched observer variants therefore reuse one compiled control artifact.
Observer settings can differ when the underlying
execution artifact matches and aggregate coverage is complete. The comparison is an
observed charge delta, not a performance result or causal attribution. Per-record
identity is intentionally not compared across execution scopes.

The schema authenticates structure and consistency, not the truth of arbitrary
external input. These are trusted local evidence artifacts, not signed attestations
or a telemetry ingestion security boundary. The production report's existing build
facts and import audit remain separate. Integrating this sidecar into its schema,
viewers and public compatibility contract requires adoption work.

## Reproduction and evidence

```sh
node docs/internal/host-extensions/resource-accounting/ra08/check.cjs /tmp/hex-ra08-fresh
node docs/internal/host-extensions/resource-accounting/ra07/check.cjs /tmp/hex-ra08-control-fresh
```

Use fresh output directories. [check.cjs](check.cjs) retains exact input snapshots,
source and artifact digests, complete paired host traces, validated reports and a
comparison example. The matrix covers direct and 2/8/16/32-parent cohorts, ordinary
core-fetch siblings, unused/disabled identity, uncertain host outcomes, cleanup
failures, expiry, cancellation, traps, redaction, malformed reports, sampling,
truncation and saturation. Five compiled mutations must fail behavioral or schema
oracles; a compiler error alone is not detection.

The final run passed **70 cases and five compiled mutation oracles**. The unchanged
RA-07 replay passed **81 cases and seven mutations**.

[example-hit.json](example-hit.json), [example-miss.json](example-miss.json) and
[example-compare.json](example-compare.json) are directly reviewable sidecars.
[evidence.json](evidence.json) records final counts and identities.
[evidence.tar.gz](evidence.tar.gz) retains every formal attempt and the RA-07 replay,
including the initial count-only build failure, a comparison-identity correction,
the mixed-core attribution failure and their retries. The fourth run passed; final
review then tightened profile isolation and record-lifetime validation before the
fifth run.
Exploratory probes are identified separately from qualification evidence. Raw
fixture traces intentionally retain synthetic handles and values for the independent
host oracle; those debug traces are separate from the redacted standard sidecars.

RA-09 remains matched execution-cost and unused-path measurement. This checkpoint
only records artifact and explicit observer-bank sizes; it makes no latency, RSS
or zero-overhead claim. RA-10 still needs real-host readiness, consumption and
cleanup qualification. Structural observer integration, portable schema adoption,
real-host namespace/lifetime evidence and non-Native parity remain open.
