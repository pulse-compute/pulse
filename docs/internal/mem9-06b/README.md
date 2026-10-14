# MEM9-06B — Fastly numeric allocation avoidance

MEM9-06B enables the schema-inactive paths qualified by
[MEM9-06A](../mem9-06a/README.md). It extends the existing numeric proof and f64
emitter to Fastly's stub runtime and current selected crypto guest-linked runtime.
It is stacked on PR #341, with the #338/#336 prerequisites; #289 remains open.

## Implementation boundary

The final Fastly writer selects `fastly-numeric-regions-v2` for nonlinked builds
and `fastly-linked-numeric-regions-v1` for the validated selected crypto guest.
The shared generator determines schema activation from the actual codec source.
The linked policy rejects active schemas, including with JSON arena elision.
Caller/intermediate numeric options cannot override the final provider decision.
Other linked realizations receive no numeric policy.

Existing schema/nonlinked and Node behavior is preserved. Definite numeric
initialization, f64 operations, loop bounds and budget exclusions remain owned
by the existing proof. Unknown live-ins, 257-iteration flat loops and budgeted
plans retain boxed behavior. No allocator, handle reclamation, guest ABI, memory
range, effect/continuation semantics, public syntax or configuration changes.

Schema-active linked/default-arena execution remains the separate failure
identified in 06A. This change neither fixes it nor enables the elided variant.
Both variants are source-level negative controls: production source is exactly
equal to the boxed control, with `schema-active-linked` as the exclusion reason.

## Recorded result

Measured source: `8b655d0f5fc3b583bd9ffb1f1050bf199045d81e`, tree
`7d415643e69f171bca16ac5a13cb1046524403a1`, clean and unchanged before/after.
This record is committed after measurement. At 256 additions per measured
region, five invocations perform 1,280 additions per request:

| Runtime | Handles, boxed → production | Managed bytes after GC, boxed → production | Linear capacity, boxed → production |
| --- | ---: | ---: | ---: |
| Stub | 1,919 → 621 | unavailable | 2,621,440 → 1,310,720 |
| ES256 linked | 1,988 → 690 | 768,160 → 618,688 | 2,097,152 → 2,097,152 |
| RS256 linked | 2,001 → 703 | 781,744 → 632,272 | 2,097,152 → 2,097,152 |

Increasing measured work from zero to 1,280 additions adds 1,280 numeric roots
to the boxed control and **zero** to production in all three runtime families.
The deliberately declined loops still retain roots. This is allocation
avoidance for proven regions, not general scalar reclamation. The fixture adds
explicit fetch timeouts relative to 06A, accounting for two additional handles.

Linked artifacts retain the fixed 32-page capacity and pass every final-link
audit with zero `memory.grow`. Current allocator span and live managed bytes are
different measurements: RS256's production span is larger (1,331,200 versus
1,243,392 bytes)
despite lower post-GC managed bytes because collection/reuse timing differs.
Stub has no tracing collector, so its managed-byte observation is unavailable.
No latency, throughput, process RSS, peak-memory or deployed Fastly claim is made.

## Qualification

The manual campaign uses the actual production writer and a restored boxed
control. The 06A prototype wrapper is not used. It covers stub/ES256/RS256 at
0/256 additions plus two schema-linked exclusions: **eight cells, 24 builds,
96 successful executions and 72 intentional failure cases**. There are ordinary
and observed builds for both strategies. The observer is the pinned 06A
diagnostic compiler, with no new product import/export or installed-file edit.

Fixtures cover entry, repeated helper calls, two shared-stage invocations,
aliases, snapshots/spread, IEEE edges and early exits. Linked builds sign before
and after numeric work; Node independently verifies both ES256 and RSA-2048
RS256 signatures. Responses, host traces, outbound bytes and error outcomes
match the boxed control exactly. Transport failure, explicit deadline expiry
and cancellation fail as intended, followed by successful fresh-instance
recovery. All nine diagnostic ownership probes pass; collection leaves handle
counts unchanged. This is not exhaustive crypto-operation/key-width acceptance.

Coverage, immutable source identity and artifact hashes are validated, including
negative checks for missing cells, changed source and altered hashes. The
existing `fastly-numeric-regions` task now includes the runtime-specific
regressions; no task, release shard or timeout budget is added.

Focused task results and exact commands are in [evidence.json](evidence.json).
The unit profile stops at the existing CLI report import-boundary violation:
`snapshot.js` imports `canonical-project-compiler` outside its approved list.
Two tasks pass before the boundary failure; the remaining selection does not
run. Both relevant files are unchanged from `latest`. The gate is not waived.
Full release/installed-consumer acceptance remains deferred to the sprint
boundary. No Viceroy or deployed execution is claimed.

Development attempts exposed a test-fixture gap: `neverHeaders` without an
authored timeout used the blocking wait and did not test expiry. The retained
failed logs document this. Adding explicit timeouts to authored fixture source
and an AbortController cancellation case made the strengthened regression pass.
No generated product source was rewritten to force the measurement.

## Replay

Restore lockfile-pinned dependencies with lifecycle scripts disabled and run the
workspace build. At the measured source in a clean checkout:

```sh
node wasm/test/performance/mem9-06b.cjs --out /tmp/mem9-06b-new
node wasm/test/performance/mem9-06b.cjs --check /tmp/mem9-06b-new/report.json
node wasm/scripts/run-wasm-tests.cjs --task fastly-numeric-regions --task canonical-native-wasm --task fastly-native-http-shell --task fastly-native-http-effects --task fastly-native-platform-capabilities --no-report
```

The raw archive retains fixtures and public test-only keys, generated source,
plans, compiler recipes/logs, ordinary/observed Wasm, final-link audits, reports
and focused-check logs. `--check` resolves archived paths relative to the report
directory. RSA keys are regenerated between campaigns; archived `fixture.json`
contains the exact test material used for its artifacts.
