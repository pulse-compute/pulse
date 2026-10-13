# CI9-01 — qualification workload audit

Audit date: 2026-10-13. Baseline: `latest` at
`44a20f5b395dfc30014e7fb588bdf39ec107b259` (MEM9-02 merged).

The next useful work is developer-run recovery, better Native shard balance,
and attribution of the full schema task. Beta.8 already implemented much of the
original CI9 proposal. This audit adds a read-only inventory and timing observer;
it changes no task selection, workflow, deadline, scheduling or qualification
policy. The diagnostic's own tests are invoked directly, like the existing CI
contract probes; no new qualification task is registered.

## Current workload

| Owner | Tasks | Meaning |
| --- | ---: | --- |
| Entire registry | 280 | Includes focused diagnostics and experiments, not 280 mandatory checks |
| Unit | 59 | Contains compilation-heavy report and launcher checks as well as cheap contracts |
| Native | 50 | One current full-portable shard |
| JavaScript | 7 | One current full-portable shard |
| Conformance | 29 | Split into RSA (1), schema (2), and remaining cases (26) |
| Portable union | 145 | Each task occurs once across six shards |
| CLI | 34 | Separate profile, not all in portable CI |
| Providers | 12 | Separate profile, not all in portable CI |
| Release profile | 179 | Full release selection after installed-corpus exclusions |
| Installed feature gates | 11 | Separate mandatory release stage |

The release and portable selections share 139 task IDs. This is overlap across
independent evidence boundaries, not 139 safe deletions. Six portable tasks
are deliberately replaced in release by the same corpora exercised through
installed packages: S3 read/write, request budgets, multifile identity, HTTP
input outcomes and adversarial KV. `installedCorpusOwners` records those owners.
The 11 installed-feature task IDs are disjoint from the release profile.
There are no exact duplicate normalized invocations in the current registry;
that finding does not rule out repeated compilation or overlapping assertions
inside different tasks.

Counts and source hashes are in [audit.json](audit.json). The generator also
emits the full inventory, invocations, profile membership, timeouts and effective
seal scheduling hints when `--summary` is omitted.

## Dependencies and evidence boundaries

| Lane/stage | Prerequisites and outputs | Reuse or parallelism already present |
| --- | --- | --- |
| Non-main fast CI | Trusted-base path selection; pinned dependencies; build; selected task report | Fixed cross-target core plus bounded focused selection; full schema replaces smoke for sensitive/unknown changes |
| Main portable CI | Maintenance contract; independent pinned install/build in each of six shards; same-SHA/run aggregate | Six hosted shards; latest-attempt-only aggregation; missing/skipped/failed evidence fails |
| Node support floor | Node 22 install/build and `cli-init-workflow` | Independent runtime-version evidence; cannot be replaced by a Node 24 pass |
| Seal bootstrap | Clean candidate, exact Node/tool availability, dependency restoration unless explicitly skipped | Fresh each attempt |
| Seal source checks/build | Source/catalog/maintenance/publication/docs/site validation, then TypeScript build | One fresh source-check receipt; shared pack verifies it instead of rerunning source checks |
| Fastly reality / dependency audit / workspace tests | Built candidate and identified tools; vulnerability/license freshness | Fresh each attempt, before the long task stages |
| Worker preparation | Clean candidate plus dependency/build copies and private workspace links | Controller-owned local worktrees; source/input identity checked at barriers |
| Shared packaging | Candidate, build, source-check receipt, exact package bytes | One shared package set; private consumer copies; a second independent construction remains required for determinism |
| Release tasks → installed-feature tasks | Shared pack, worker inputs, fixed selections and per-task cleanup | Two sequential controller stages; tasks within each may use bounded workers and verified same-candidate checkpoints |
| Final validation/cleanup | Candidate/tool/input/artifact identities, complete selected evidence, successful cleanup | Always fresh; no hand-combined reports accepted |
| Post-main publication/docs | Verified pre-main qualification and accepted merge binding | Consumes the qualification; does not begin a fresh seal |

Canonical owners: `wasm/test/suite/registry.cjs`,
`scripts/maintainer-{fast,portable}-validation.cjs`, `scripts/validate-release.cjs`,
`scripts/release-{source-checks,shared-pack,recovery,checkpoints,parallel}.cjs`,
`scripts/release-feature-acceptance.cjs`, and the workflows recorded by hash in
the snapshot. This table is a reviewed stage dependency map, not a claim that
arbitrary task imports have been proven independent.

## What Beta.8 already solved

- Shared packing reduced the documented complete-seal package constructions
  from fifteen to two. Installed-consumer assertions still run independently.
- Same-candidate recovery verifies revision/tree, checkout, dependencies, built
  outputs, tools, options, environment, task definitions, prerequisites, outputs
  and cleanup. Checkpoints expire after seven days. Archive upload is diagnostic;
  it is not a remotely reusable cache.
- Serial and bounded-worker release execution already exist, with resource locks,
  dependencies, exclusivity and compiler slots. Six cheap checks run first.
- Hosted qualification currently requests **two workers and one compiler slot**
  with a 6144 MiB admission budget. Raising workers alone does not raise compiler
  concurrency; that budget is an estimate, not an enforced RSS ceiling.
- Main portable CI is already sharded. Non-main selection is already conservative
  and change-aware, with a schema smoke for known unrelated changes.
- Source checks are already front-loaded. Publication already consumes pre-main
  qualification. Rebuilding either mechanism would duplicate existing work.

## Measurements and limits

Two sources are kept separate. Neither is a fresh Beta.9 release seal.

**Local MEM9-02 sample.** The restored report at
`864d1d17bad6dd610fcdd5b28e997e1411b04801` contains 149 completed passing task
results and remains marked `running` after the disconnect. Its recorded elapsed
snapshot is 36.85 minutes; completed task occupancy totals 35.34 minutes. It
contains every portable task, so those observations can be mapped to the current
six-shard plan. The missing provider task passed in a separate 116.90-second
rerun. The audit preserves both reports independently and never turns them into
a terminal aggregate or a release proof.

| Current portable shard | Observed tasks | Sum of task elapsed time |
| --- | ---: | ---: |
| Unit | 59/59 | 4.32 min |
| Native | 50/50 | **12.94 min** |
| JavaScript | 7/7 | 0.56 min |
| Conformance RSA | 1/1 | **7.24 min** |
| Conformance schema | 2/2 | 2.82 min |
| Conformance rest | 26/26 | 6.76 min |

These are serial task observations projected onto today's shard plan, not hosted
shard wall times. They exclude install/build, queueing, parallel contention and
artifact upload. The idealized task-only floor is 12.94 minutes, dominated by
Native. Splitting RSA first would leave that Native floor unchanged. The single
RSA task was 434.17 seconds; schema codecs 152.11 seconds; the Native entities
workflow 95.36 seconds. Historical ordering weights are priorities, not fresh
cost measurements, and must not be presented as durations.

**Hosted PR #316 sample.** The
[fast job](https://github.com/pulse-compute/pulse/actions/runs/38451955965/job/115485008456)
and [documentation job](https://github.com/pulse-compute/pulse/actions/runs/38451955963/job/115484911702)
both tested merge `a9578ea39938e52738da5b7dcacb56c741816809`.
The fast runner passed 11 tasks in **150.09 seconds**; schema codecs accounted
for **128.82 seconds (85.8%)**. Between command starts, pinned tool/dependency
setup took 5.74 seconds and the TypeScript build 2.05 seconds. In this sample,
a new dependency cache has a much smaller available saving than schema work.
This is one protected compiler/runtime change; it does not measure unrelated
changes that already use the schema smoke.

The docs job executes three site builds: `docs:check` invokes the site check,
`documentation-release.cjs` builds a validated temporary site, then `docs:site`
constructs the preview. The respective command-start intervals were **5.04,
9.58 and 4.54 seconds**. Those intervals include other checks and small gaps;
they are not pure build durations or a promised saving. Reusing the validated
site within that same job is a concrete overlap candidate. The seal already
uses the validated-site callback and should retain that behavior.

[hosted-observations.json](hosted-observations.json) records timestamps, method,
source, run/job IDs and decoded-log hashes. Local input hashes are in `audit.json`;
raw runner evidence remains in `Pulse-MEM9-02-evidence.zip` from the MEM9-02
handoff (archive SHA-256 `13ab2ee809cd485ee633ccfad0cfd67b07586941c6f44ec26a6717eade1a2c4c`).

Not measured here: a complete fresh/resumed seal, worker preparation cost,
whole-process-tree peak RSS/CPU, per-fixture compiler attribution, retry failure
rates, or hosted full-shard timings. The existing seal measurement helper itself
labels Node-observed CPU/RSS and launch counts as partial observations. Do not
raise memory admission or compiler concurrency using these task durations alone.

## Overlap disposition

| Candidate | Decision |
| --- | --- |
| Three docs site builds in one job | Consolidate validated output in a small follow-up; retain source/link/package checks and preview hashing |
| Repeated install/build across jobs | Separate Node versions and identities matter; same-Node immutable setup artifacts need measurement and input validation before sharing |
| Portable vs release task IDs | Keep both acceptance boundaries; no cross-source proof reuse |
| Workspace vs installed consumer tests | Keep; six exact-corpus transfers are already explicit |
| Schema smoke plus full schema | Selector already substitutes one for the other; no duplicate to remove |
| Second deterministic package construction | Keep independent; required oracle, not avoidable duplicate packing |
| CLI docs examples vs provider/runtime fixtures | No assertion-level equivalence established; remove nothing on names alone |
| Installed ARC-named gate | Currently proves package-owned execution/provider loading from installed Pulse packages; external application naming alone is not a removal criterion |

## Bounded execution handoff

| Next work | Deliverable and acceptance | Effort |
| --- | --- | --- |
| CI9-02: developer recovery first | Extend durable, explicit recovery to ordinary diagnostic runs. Bind exact source/diff or clean tree, dependency/tool/input bytes, selection and task definitions; preserve failed attempts and cleanup. A resumed development run remains development evidence. Exercise interruption, missing/truncated/corrupt evidence, changed inputs and source, and one-task recovery after 149 completions. Reuse the existing recovery machinery where appropriate. | L |
| CI9-02: cache boundary | Inventory lookup may be content-addressed within the existing candidate/checkout boundary. Current release authority forbids foreign-checkout, remote and cross-source proof reuse. Any broader qualification cache requires a separate approved contract; no new remote cache is implied by this audit. | Design constraint |
| CI9-03: Native shard balance | Split/rebalance the long Native selection using an explicit deterministic plan. Every portable task exactly once; same merge SHA/run/attempt checks and always-running aggregate; preserve failed-shard diagnostics. Measure hosted end-to-end and total worker time on the same candidate before claiming a gain. | M–L |
| CI9-03: fast schema attribution | Measure code generation, compiler launches and execution inside the full schema corpus. Consolidate only demonstrated shared setup; retain every semantic assertion and full selection for compiler/runtime/provider/schema-sensitive changes. Compare identical-candidate cold and warm samples. | M |
| CI9-03: docs output reuse | Carry the already validated site into preview sealing in the same job, using the existing callback pattern. Preserve generated-doc, metadata, link, package and publication-control checks; prove identical preview manifests. | S–M |

Keep full main/release coverage, Node-floor evidence, independent determinism,
provider-reality boundaries and human merge/publication authority. Preserve the
current diagnostic-friendly full-CI shard failure collection; do not casually
replace `fail-fast: false` with cancellation. Release workers already cancel
active work on failure and retain cleaned successful proofs.

The decision after CI9-01 is to implement CI9-02's bounded development recovery,
then rebalance Native. Schema profiling is the next fast-PR optimization target.
Defer raising compiler concurrency until actual process-tree resource use is
available. These priorities are based on the observations above, not an assumed
repeat of the earlier 40–50-minute release gates.

## Reproduce the audit

```sh
node scripts/qualification-audit.cjs > /tmp/qualification-inventory.json
node scripts/qualification-audit.cjs --summary \
  --report /path/to/qualification/regression.json \
  --report /path/to/qualification/recovery.json > /tmp/qualification-audit.json
node wasm/test/ci/assert-qualification-audit.cjs
```

Report paths are explicit; the tool does not scan caches or follow artifact paths
inside a report. It accepts runner schema 2, rejects malformed/duplicate coverage
and invalid durations, preserves each source/status independently, and separates
reused historical durations from new measurements. It does not run tasks or
make any qualification decision. File hashes identify the exact observation
inputs; owner hashes bind the currently inspected registry and policy sources.
A source revision in an input report is reported provenance, not attestation of
uncommitted bytes or an assertion of equivalence to today's checkout.

The focused observer probes and portable-aggregate contract probes passed. The full
unit profile passed **59/59** in 3.36 minutes at
`7cb9588d41d3d0982ff5734518aec31f1eec104b`. Maintenance/documentation results are recorded in the PR. This audit deliberately performs no
new full seal or benchmark campaign.
