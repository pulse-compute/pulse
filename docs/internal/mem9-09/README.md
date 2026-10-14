# MEM9-09A — synchronous Fastly handle tracing

Related: [#289](https://github.com/pulse-compute/pulse/issues/289),
[integration PR #349](https://github.com/pulse-compute/pulse/pull/349),
[approved ownership design](../mem9-08/README.md).
Target: `codex/mem9-integration`, based on
`5476571935083ba8c6c03eda56bf9fbc3aae81db` after MEM9-07/08.
Human direction: implement MEM9-09 after the ownership design, then recover,
validate and resume the interrupted work. Class: architecture; scope:
architecture-change. Merge and release remain human-owned.

This implements **09A only**. It is not closure of #289, completion of 09B/09C,
full integration compliance or deployed-provider qualification. Historical
MEM9-08 review status is preserved as history; its subsequent merge and the
instruction to implement authorize this bounded first slice.

## Implementation and proof boundary

The canonical emitter describes roots from the same structures that declare
result/local/state slots. The provider independently validates the descriptor
and roots its header snapshot and occupied scalar/integer/character/literal
caches. Unknown control/expression/capability owners disable the whole plan.
The final provider writer overrides intermediate/caller ownership options.

Only unlinked, schema-active/incremental, unbudgeted synchronous canonical
Fastly plans qualify. Helpers, stages, Router error lanes, events, effects,
continuations, package application emitters and opaque capabilities remain
excluded. Node, stub and linked runtimes retain their existing path. Private
manifest reasons expose exclusions; this adds no public option, import or
authoring feature. The current contract is recorded in
[architecture contracts](../../architecture/current-contracts.md#fastly-native-handle-ownership).

Checkpoints occur after completed expressions have rooted or discarded their
values, on pure-loop control edges, and after numeric-region outputs are boxed.
Nested expression calls cannot collect; no helper/caller frame crosses a
checkpoint. Existing failures suppress tracing. All local slots remain roots,
including out-of-scope values. This conservative retention is intentional.

Eligible values use a sparse map and monotonically increasing positive IDs.
An iterative mark pass follows collection handle edges and direct rope object
edges separately, preserving distinct handles that reference the same object.
The visitor reads stored edges without allocating lazy arrays or flattening
ropes. A complete survivor map replaces the old map, dropping historical
insertion capacity. Invalid edges abort before publication. Removed IDs cannot
alias new allocations; exhaustion fails through value error stage 1 before wrap.
`__pulse_drop` stays a no-op and the existing managed GC owns physical reclamation.

Cache insertion records occupied slots once, instead of scanning 132,101
possible slots per pass. Failed insertions cannot add zero pins. Caches retain
their prior identity, immutability and bounds. The trigger remains the design's
`max(1024, live mappings after the previous pass)` new mappings. Table/tracer
space tracks the reachable graph plus allocations between safe points; a large
single operation, conservative local, live snapshot or rope can still retain
substantial memory. Linear memory need not shrink.

## Recovered evidence and cost

[Recovery inventory](recovery.json) preserves prior attempts and hashes. The
interrupted implementation had no committed MEM9-09 head or PR. An initial
cache-capacity scan roughly doubled long-workload cost; the recovered occupied
index removed that scan. Those historical measurements are not relabeled as
qualification of the final source.

[Final cost record](cost.json) pins source commit `f02293d`, dependency lock,
Node/AssemblyScript identity, emitted Wasm hashes, all raw samples and terminal
status. The sole uncommitted input was the recorded architecture-document edit;
production/test code was committed and unchanged throughout. AssemblyScript is
0.28.18 and the diagnostic compiler independently asserts json-as 1.5.0.

Each cell uses 10 warmup pairs and 40 randomized pairs, with 2,000 paired bootstrap
resamples. Timing covers fresh-instance `_start`, including the injected Fastly
host calls, and excludes compilation/instantiation. Production artifacts have
no diagnostic exports or forced GC. Process CPU and calling-thread CPU are
reported separately. These are local wall/CPU distributions, not deployed
latency or provider reality. Alternate triggers (256 and 4,096) are diagnostic
artifacts; controls are reused between trigger groups, so cross-group JIT warmth
can differ. Their results inform the tradeoff, not a precise ranking of triggers.

Default 1,024 trigger, median wall milliseconds (traced / retained):

| JSON arena | Inner iterations | Median ms | Paired mean delta 95% CI, ms |
| --- | ---: | ---: | ---: |
| Default | 0 | 0.196 / 0.189 | -0.064 to +0.230 |
| Default | 128 | 0.733 / 0.667 | +0.054 to +0.133 |
| Default | 4,096 | 9.296 / 10.073 | -0.873 to -0.435 |
| Elided | 0 | 0.175 / 0.169 | -0.012 to +0.431 |
| Elided | 128 | 0.706 / 0.619 | -0.140 to +0.119 |
| Elided | 4,096 | 8.916 / 10.740 | -2.024 to -1.326 |

The long case improves, but the default-arena short case has a measured cost
regression. Retain 1,024 as the first-slice tradeoff for review; no universal
percentage gate is invented and no blanket performance improvement is claimed.
Wasm grows by 4,244 bytes: 82,256 versus 78,012 bytes with the default arena;
82,253 versus 78,009 with elision. Thread-CPU medians track wall medians; process
CPU includes other engine threads and is not interpreted as request CPU alone.

Separate allocator-observed artifacts preserve exact output and use the same
arena setting. At 4,096 inner iterations:

| Metric | Default traced / retained | Elided traced / retained |
| --- | ---: | ---: |
| Managed bytes after diagnostic full GC | 1,620,336 / 8,130,240 | 571,760 / 7,081,664 |
| Peak outstanding managed bytes | 3,594,608 / 8,404,064 | 1,585,680 / 7,298,816 |
| Linear-memory capacity bytes | 5,242,880 / 10,485,760 | 1,835,008 / 14,680,064 |
| Cumulative managed bytes allocated | 10,391,328 / 9,444,800 | 9,342,752 / 8,396,224 |

Tracing allocates more cumulative metadata while retaining much less live data.
Allocator observations include block overhead; they are distinct from handle
counts, map capacities and host RSS. No RSS reduction is claimed. Full GC and
allocator hooks are absent from all timed artifacts.

## Validation and remaining work

The focused ownership task checks exact retained-control output, JS semantic
parity, postfix/assignment aliases, self-assignment, collection overwrite/spread,
live snapshots, nested break/continue, signed zero/NaN/infinity, cache identity,
request state, provider header roots and response handoff. Runtime-only probes
qualify cyclic graphs, direct rope edges without their old IDs, no flattening,
duplicate IDs for one object, stale/invalid IDs, ID exhaustion and atomic failure.
Forced-safe-point diagnostics are separate from ordinary retention and cost runs.
Negative descriptor/unknown-owner/control tests fail closed before execution.

The recovered lifetime pass showed 243 mappings versus 28,819 retained at 4,096
iterations, 139 pinned cache entries, peak table capacity 1,365, and 5,000 bytes
of peak tracing-structure payload. The payload measurement excludes allocator
headers, the old table and transient rehash copies; whole-artifact peak managed
bytes above capture their aggregate effect. The final registered-task rerun and
unit/provider/schema regression results are recorded in the follow-up check
record before this PR is ready for review.

09B must audit helper/stage frames, error lanes and effect/resource lifecycles
one owner family at a time. 09C requires separate reviewed Node root transport,
budget-contract and stub/linked allocator proposals; none is enabled here.
Before integration into `latest`, reconcile intervening changes (including #353),
freeze a clean combined source and run the full required compliance/installed/
provider matrix through its existing controllers. #349 stays draft until then;
the original drafts and #289 remain open for the final coverage/residual decision.
