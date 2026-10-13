# CI9-03 — Native shard balance and documentation output reuse

This bounded implementation follows CI9-01's audit and the merged CI9-02
recovery controller. It changes CI scheduling and preview orchestration, with no
runtime/compiler change, task removal, release-proof reuse or production delivery.
Schema phase profiling remains a separate follow-up; the current conservative
fast selector and full schema corpus remain unchanged.

## Native plan

The single Native job becomes `native-a` and `native-b`, with 25 tasks each today.
A one-time longest-processing-time greedy partition of the audit sample determines
an explicit reviewed list for B; A contains the rest. Neither CI nor the runner
reads timing observations to decide coverage. The registry remains the coverage
owner, each group retains registry order, new tasks enter A and missing B anchors
fail the plan contract. There are seven portable shards and still 145 tasks.

| Historical sample projected onto plan | Task occupancy |
| --- | ---: |
| Previous Native job | 776.477 s |
| Native A | 388.378 s |
| Native B | 388.099 s |
| RSA, now the longest projected portable shard | 434.171 s |

[projection.json](projection.json) retains every Native task weight, the grouping
method and the original report's SHA-256/source/status. The original MEM9-02 report
remains `running`, with 149 recorded passes; this projection is not qualification.
The idealized task-only floor changes from 12.94 to 7.24 minutes. This is **not a
hosted speedup measurement**. The extra job repeats install/build, and runner
availability, queueing and contention can offset the projected benefit. Total
assertion work is unchanged. Measure same-candidate hosted end-to-end latency
and summed job elapsed time before making a performance claim.

The existing always-running aggregate still requires every shard, exact selected
coverage, the tested merge SHA/workflow run and the latest available attempt for
each shard. A failed retry cannot fall back to an earlier pass. `fail-fast: false`
and unconditional shard evidence uploads remain. The Node floor, fast selection
and release seal are unchanged. `taskElapsedSumMs` now records summed shard task
occupancy alongside the existing task wall span; neither includes setup/build.

## Documentation preview

The previous workflow built the site in `docs:check`, again in the documentation
release validator and again for preview sealing. `documentation-preview.cjs`
keeps the complete generated-file check, then calls the release validator once.
Its existing `onValidatedSite` callback supplies the validated temporary site to
the unchanged sealer before cleanup. It performs no network delivery and does
not read a cached site directory. Only a successful preview step can upload the
candidate, so earlier output cannot be advertised after a failed validation.

The release validator retains maintenance/publication, package/catalog, CLI,
configuration, source-link, metadata, generated-reference and hosted-site checks.
The canonical builder validates its output on every invocation, independently
of the CLI `--check` convenience option. No validation assertion was removed.

Focused tests verify exact Native coverage and ordering, future task inclusion,
missing/duplicate/stale/failed shard rejection, workflow matrix and upload guards,
preview validation order, missing/duplicate callbacks and failures at each stage.
An opt-in local integration check instruments the real preview path to require
one site build, independently builds/seals the same source and requires identical
candidate manifests and complete object checksum files; a modified object fails
verification. The extra independent build is qualification only, not a CI step.

```sh
node wasm/test/ci/assert-portable-validation.cjs
node wasm/test/ci/assert-fast-validation.cjs
node wasm/test/ci/assert-validation-routing.cjs
node wasm/test/docs/assert-documentation-preview.cjs --integration
```

Hosted timing comparisons remain outstanding. The old hosted observation in
CI9-01 belongs to a different source and is not a controlled before/after sample.
