# PS-01 — test and seal cost attribution

Status: complete evidence audit, 2026-10-05. No test, gate, product behavior,
release policy, or workflow is changed by this packet. This repository-only
report is excluded from hosted and installed documentation by the existing
`docs/internal/` boundary. [The machine-readable ledger](cost-ledger.json)
retains every measured task duration, current profile membership, and source
report hashes.

## Decision

Start PS-02 with dependency-free bootstrap and early failure reporting. Make
PS-03's first expensive-work slice the JWT workflow/compilation matrix, followed
by explicit ownership of shared workspace/installed corpora. Historical proof
retirement is maintenance work; it is not the primary seal-speed lever.

A 50% fresh-seal reduction remains a stretch objective, not a forecast supported
by this audit. The two largest JWT tasks together occupy 27.7% of the measured
seal, and their semantic coverage cannot simply be removed. Combining measured
matrix reduction with isolated scheduling may be necessary for that target.
Resume improves recovery cost; it does not make the initial successful run faster.

## Source and evidence identity

- Audited `latest`: `3c24d1a4e79a6c47df5241cdf9b773549b076e4c`, tree
  `e29b40e13946b9cb5b56405651de87711191410a`.
- Observed `main` at audit start: `4410513f82378f1dc4f4abb868b70fd0673115c4`.
  `latest` is one documentation-purge commit ahead; no branch mutation is part
  of PS-01. Future PRs target `latest`.
- Timing source: successful [npm publication run 37324635914](https://github.com/pulse-compute/pulse/actions/runs/37324635914),
  [candidate job 111812118137](https://github.com/pulse-compute/pulse/actions/runs/37324635914/job/111812118137),
  artifact `pulse-npm-seal-37324635914-1`, ID `11353845681`.
- Measured source: `4410513f82378f1dc4f4abb868b70fd0673115c4`, tree
  `d05555070fe9e68b4e405ff4b028bdbea81c1272`; Node 24.18.0. The archived
  reports have terminal `passed`, 165/165 release tasks and 10/10 installed
  gates. The archive SHA-256 and each input report hash are in the ledger.
- The seal used `--skip-install`; the workflow installed dependencies before
  it. Local Fastly reality was explicitly `unavailable`. This is not a
  measurement of a cold install plus local Fastly qualification.
- The ten-file diff from measured source to audited source is documentation
  deployment/purge policy and its generated documentation. The registry,
  task bodies, runner, seal orchestrator, installed-feature runner and npm
  publication workflow are unchanged. The publication-control check itself
  changed; its historical timing is not a current-head benchmark.

The earlier local beta.6 handoff's 48m10.855s is a separate environment/run with
additional steps. Do not subtract this 33m04.848s observation from it and claim
an optimization. No fresh seal, compiler matrix, or consumer install was run
for this audit. Read-only artifact extraction and static analysis were sufficient.

## Measured cost ledger

| Measurement | Elapsed | Share of outer seal |
|---|---:|---:|
| Complete observed seal | 33m04.848s | 100% |
| Release step, 165 tasks | 26m27.009s | 80.0% |
| Installed-feature step, 10 tasks | 6m22.292s | 19.3% |
| All other outer work and orchestration | 15.547s | 0.8% |
| Sum of all 175 task elapsed durations | 32m48.905s | 99.2% |

Percentages are independently rounded. Outer step timestamps and nested runner
reports differ slightly: release runner 1,586,973ms; feature runner 382,179ms.
The sum of task elapsed durations is useful worker occupancy for this serial
runner. It is **not CPU time** and includes each task's setup, subprocesses,
waiting and cleanup. Aggregate CPU, whole-process-tree RSS, and a complete
compiler-invocation count were not recorded and remain unknown.

| Highest-cost task | Lane | Elapsed | Current unique coverage |
|---|---|---:|---|
| `jwt-installed-workflow` | Separate installed gate | 4m36.083s | Exact installed bytes/exports; algorithm-target workflows; rotation, cleanup, independent signature checks and composition eligibility |
| `jwt-rs256` | Conformance | 4m33.722s | 2048/3072/4096-bit semantics, malformed/padding/key boundaries, four-target issuance/verification and 4096 CLI matrix |
| `clean-machine-acceptance` | Release | 2m28.194s | Isolated candidate installation, public types/exports, copied semantic corpora and fresh CLI workflows |
| `schema-codecs` | Conformance | 1m16.341s | Rich schemas, optional/scalar/nested/open behavior, bounds and admission/serialization ordering |
| `fastly-native-platform-capabilities` | Providers | 1m01.697s | Config, Secret, KV and GRIP provider realization |
| `cli-entities-installed-workflow` | Release | 57.163s | Example 10 installed four-mode lifecycle and exact catalog/artifact/package evidence |
| `fastly-entities-native-workflow` | Native | 48.902s | Fastly Entities source workflow, emitted artifact execution and eligibility |
| `cli-project-workflow` | CLI | 39.000s | Doctor, inspect, test, compile and build behavior |
| `cli-schema-json-workflow` | CLI | 35.587s | Schema compilation, diagnostics, execution and reload |
| `events-cli-workflow` | CLI profile | 31.912s | Event/HTTP harness, Node target parity and Fastly rejection boundary |

The first five tasks total 13m56.037s (42.1%). All ten documentation example
tasks together take 85.370s (4.3%). O09 and O19 together take 21.725s (1.1%).
The table is a ranking of cost, not permission to remove those behaviors.

### What repeats, and what it costs

| Work | Observed or static count | Interpretation |
|---|---:|---|
| Full package construction inside seal | 2, 38 individual package packs | Shared candidate plus intentionally independent determinism construction |
| Full construction in entire candidate job | 3, 57 individual package packs | A third `release:pack` follows the seal; tested shared set has been deleted |
| Reuse of complete 19-package set | 14 | Already implemented; exclude three synthetic one-package guard copies |
| Shared-pack outer step | 5.315s | Further pack reduction is secondary on this host |
| Clean-machine npm installs | 8, about 13.606s combined | Timestamp deltas include log overhead; installations are not the 148s task's main cost |
| Audited consumer-install paths | 22 static successful-path calls | Clean machine 8 + Entities installed 1 + feature gates 13; this is not an instrumented whole-suite count |
| Installed JWT recorded commands | 82 | 32 builds; 12 each doctor/inspect/test/dev; one install and one cleanup script |
| Installed JWT matrices | 12 workflow + 20 composition cells | 120 harness cases; composition has 12 built and 8 expected-ineligible outcomes |
| RS256 semantic executions | 438 in retained log | 146 per key width; separate from installed JWT's 2048-bit RSA + HS256/ES256 fixture |
| Schema Wasm build requests | 29 statically counted | Eight phases; distinct feature/target artifacts and instrumented probes, not 29 proven duplicates |

The installed JWT gate does **not** call the `jwt-rs256` task. Similar runtimes
must not be presented as proof of duplicate tests. In
`wasm/packages/cli/src/project-execution.js`, `inspectProject` and
`doctorProject` independently compile Native in memory; tests, builds and dev
also prepare/compile according to target. Repeating every CLI verb across every
semantic matrix cell amplifies compilation. Command-level elapsed times are
missing from installed JWT's retained report, so expected recoverable seconds
cannot yet be assigned precisely.

The schema requests are admission 3 + base 1 + value 5 + text 4 + optional 3 +
scalar 3 + nested closed 5 + nested open 5. Instrumented admission-order probes
must survive any fixture consolidation.

### Existing CI already has fast and full lanes

| Retained workflow | Observed job span | Sum of job elapsed | What it establishes |
|---|---:|---:|---|
| Main validation, run `37323209884` | 9m01s | 27m05s | Six parallel portable shards plus maintenance, Node 22 floor and aggregation |
| Latest validation, run `37387369702` | 2m33s | 3m11s | Existing fast selection and fast portable path at the same source revision |
| npm publication, run `37324635914` | 42m47s | 42m40s | Candidate 33m31s, publish 8m25s, verify 44s; includes work outside seal |

Job span is first non-skipped job start to last completion, excluding initial
queue time. Summed job elapsed is allocated worker time, not CPU utilization.
These are different workload selections, not controlled serial/parallel A/B
measurements. `latest` PRs already use the non-main fast tier. Full portable
aggregation consumes reports; it does not replay the tasks. Node 22 is a distinct
support-line check. PS-03 should refine existing lanes rather than create a
second selection system.

## Actual task membership

There are 255 registered tasks, 165 unique release tasks, and 90 outside the
release profile. Ten of the latter are mandatory installed gates; local Fastly
reality is a separate conditional/required outer step. Other external or
release-specific qualifications also remain explicit. “Outside release” does
not mean unused or removable.

| Profile | Membership |
|---|---:|
| Unit | 41 |
| Native | 48 |
| JavaScript | 7 |
| Conformance | 29 |
| CLI | 24 |
| Providers | 12 |

The six profiles total 161 entries. `entities-node-native-workflow` and
`fastly-entities-native-workflow` each occur in two profiles, but
`expandProfile` deduplicates them. Adding six release-only tasks produces 165
executions. That profile overlap is not duplicate work.

Of 27 tasks whose entrypoint is under `test/runtime/compiler-efficiency/`,
25 are outside release. The two active tasks are:

- `fastly-driver-behavior-o09`: 18.309s; four topologies with production and
  diagnostic builds protect settlement, ticket freshness, error ordering,
  bounded resume state and public trace parity. Keep its semantic owner.
- `shared-stage-o19`: 3.416s; two target builds protect production reuse,
  continuation identity, ownership, and fallback rejection. Keep the regression;
  later move it out of historical ticket naming.

Nine `pure-*` release tasks protect supported compiler admission and runtime
semantics. Retiring optimization experiments does not justify deleting these.
`beta6-measurements`, MEM12 and historical crypto/JWT/Entities/event/guest-link
seal wrappers are also outside the aggregate release profile. Select useful
manual workloads for PS-08; retire redundant wrappers only after successor and
caller mapping. O19 and `cli-expansion-doctor` import O18's fixture: extract that
shared fixture before deleting `o18-reusable-stage.cjs`. O07 imports GEN01 helpers.

## Coverage ownership and minimum complete validation

Under current policy, the minimum authoritative seal still includes the full
165-task aggregate, ten separately required installed gates, and required
provider qualification or a candidate-specific disposition. PS-01 changes none
of those obligations. Current unit and installed-feature guard tests enforce
that division. A smaller authoritative selection requires explicit claim
migration and synchronized registry, policy and evidence validation.

| Claim | Canonical owner to retain | Proposed handling |
|---|---|---|
| Public API, admission, effects, continuations, bounds, negative cases | Existing unit/native/JS/conformance tasks | Keep semantics; consolidate setup only after claim mapping |
| Crypto algorithm/key-width/target behavior | JWT and crypto corpora | Keep full semantic dimensions; reduce repetitive CLI lifecycle crossings after measuring them |
| Installed exports, isolated dependencies and immutable package bytes | Installed acceptance | Keep; workspace behavior cannot prove installation correctness |
| Minimal compiler/Node/Fastly dependency closures | ARC01's four installed cells | Keep all four; do not replace with an all-packages installation |
| CLI commands, profiles, reload and public example correctness | CLI and executable-doc workflows | Preserve every command/target boundary; migrate duplicate semantic corpus ownership deliberately |
| Provider ABI/runtime correctness | Provider tasks plus actual local/deployed reality | Keep levels distinct; simulation cannot replace provider evidence |
| Package reproducibility | Independent second package construction | Keep; reuse would invalidate the oracle |
| Published registry contents | Publication verification | Keep outside seal as an external publication check |
| Historical size/scaling decisions | Manual benchmark/evidence records | Manual or retire replay wrappers; no direct seal-time savings assumed |

### Proven shared corpus entrypoints

These scripts invoke the same corpus entrypoint in workspace and installed modes.
This proves repetition, **not interchangeability**: option-dependent assertions,
package resolution and target cells must be reconciled in PS-03.

| Workspace release task(s) | Installed wrapper | Owner and potential release assignment |
|---|---|---|
| `s3-native-read`, `s3-write-conformance` | `wasm/test/s3/assert-packed-consumer.cjs` calls both acceptance `main` functions | S3: installed full corpus could own release; workspace tasks retain fast development use |
| `request-budget-transport` | `assert-request-deadline-packages.cjs` calls `runtime/request-budget-transport.cjs.main` | Runtime/Node: retain public typing, plan/ABI and closure additions |
| `multifile-source-identity` | `assert-multifile-packages.cjs` calls the crypto identity corpus | Compiler/CLI: preserve regenerated identity and isolation |
| `http-input-outcomes` | `assert-http-input-packages.cjs` calls the runtime HTTP corpus | Runtime HTTP: preserve all supplied provider/target cells |
| `kv-conditional-adversarial` | `wasm/test/kv/assert-packed-consumer.cjs` calls `run-k4-consumer.cjs.main` | KV: retain missing/conflict/race distinctions and external qualification |

The three unqualified wrapper filenames above are under `wasm/test/release/`.
The six implicated workspace tasks retain their individual measured durations
in the ledger; none is approved for deletion by this audit. Clean machine additionally runs packed bounded-loop/adoption
corpora; equivalence to workspace loop coverage was not established. Broad
workspace Vitest and several registered Vitest tasks also overlap, but their
combined cost is secondary to Native compilation.

### Coverage defect to repair while thinning

`assets-javascript-runtime` in `wasm/test/suite/registry.cjs` joins
`packages/assets/test/sigv4.test.ts` and
`packages/assets/test/embedded.test.ts` into one nonexistent file filter.
The retained task log reports four files / 68 tests; neither intended Assets
file ran. Other valid filters let Vitest succeed. Root workspace Vitest may
cover those files separately, so this is a confirmed **portable task coverage
gap**, not evidence that the whole seal omitted them.

PS-03 should split the two file arguments and add the smallest registry check
that exact test-file filters exist. Keep this correction visible even if it
slightly increases selected-task time.

## Ranked changes and expected payoff

| Rank | Next change | Measured budget / expected payoff | Required proof before acceptance |
|---|---|---|---|
| 1 | PS-02: dependency-free startup; early clean-source/required-tool checks; terminalize setup failures | Avoids failed attempts and late discovery; no claimed fresh-pass speedup | Cold checkout reaches install; missing prerequisites terminate early with a new terminal receipt |
| 2 | PS-03 first slice: JWT CLI/semantic matrix separation | 549.805s participating budget, 27.7% of seal; recoverable fraction unknown | Preserve all algorithms, key widths, target semantics, rotation, failures, composition and installed identity; time commands and count actual compiles |
| 3 | PS-03 next slice: release ownership of shared workspace/installed corpora | 148.194s installed parent plus participating workspace task budgets; overlap savings unmeasured | Compare option-dependent assertions; require complete per-corpus terminal reports from exact installed candidate |
| 4 | PS-04: immutable checkpoints and same-candidate resume | Avoids replaying completed work after late failure; no initial-pass gain | Exact dependency/task/toolchain/source/artifact bindings, fail-closed invalidation, attempt-local reports and policy alignment |
| 5 | PS-05: isolate and schedule independent expensive clusters | Current serial run offers wall-time opportunity; RSS/CPU budget unknown | Eliminate shared dist/cleanup/report races and measure resource use before concurrency |
| 6 | Consolidate schema and Entities fixture setup | Schema 76.341s; installed Entities 57.163s and source workflow costs | Preserve instrumented ordering probes, target/installed distinctions and full CLI contract |
| 7 | Retain tested tarballs for publication; remove post-seal reconstruction | Seconds on retained host plus simpler artifact provenance | Published candidate equals exact tested bytes; independent determinism build retained |
| 8 | PS-07: remove unused historical proof machinery | Maintenance/LOC gain; 25 excluded compiler-efficiency tasks offer zero direct release-task savings | Caller/fixture mapping and surviving semantic owners |

Budgets are upper bounds on participating task time, not predicted savings and
must not be added when parent/child work overlaps. No reduction percentage is
established until the affected slice is measured with the same environment,
source and settings.

## Concrete PS-02 and PS-03 packets

**PS-02.** `validate-release.cjs` eagerly loads `release-shared-pack` →
`pack-release` → `documentation-release` → project config/reference modules →
workspace contracts, before installation. A bounded module-resolution probe
confirmed the pre-main lookup of `@pulse-compute/wasm-contracts/logging`.
Move dependency-backed work behind restoration and retain Node-built-in-only
bootstrap/status helpers. Check candidate cleanliness and required Fastly CLI
availability early, then revalidate identities before package qualification.
Node/source checks occur before receipt creation and temporary-cache allocation
is outside the main `try/finally`; extend terminal reporting to these failures.
Preserve existing heartbeats, TERM/KILL supervision and bounded cleanup.
The candidate workflow has a 60-minute total deadline while two nested steps
individually permit 60 minutes; establish coherent parent/child deadlines and
checkpoint reporting, rather than increasing every limit.

**PS-03 first slice.** Correct the Assets path defect. Add command-level timing
and compile counters only at the two JWT harness boundaries needed to attribute
cost; run the focused matrices once if retained detail is insufficient. Assign
CLI lifecycle coverage to representative cells while retaining every command
and target boundary, and keep semantic execution on all supported algorithm/
key-width/target combinations. Retain the 20 composition outcomes and installed
byte/closure/cleanup checks. Do not alter product CLI semantics as an incidental
test optimization. Deliver an assertion-to-owner map, measured before/after,
and focused terminal reports. If the map shows no safe reduction, report it
instead of expanding the task into compiler optimization.

**PS-03 subsequent slice.** Expose clean-machine's internal corpus outcomes and
costs, then reconcile the five groups above. A full semantic corpus may become
installed-owned in the release path only when every workspace-specific assertion
has a named retained owner. Development tasks remain directly runnable. Use the
existing fast/full selection and evidence-shard machinery.

**PS-04 preparation.** Current rules prohibit pooling resumed/focused reports
into a seal. Update those rules with the implementation, including task/oracle
hashes, selected options/environment, platform/toolchain, source/tree/lockfile,
package/artifact hashes, successful cleanup and dependency invalidation. Retain
immutable attempt history. Existing fixed `release-tasks.json` and
`release-feature-acceptance.json` paths need outer-attempt ownership before
concurrent runs or resume. The current shared pack is removed at cleanup;
checkpoint retention and expiry must be explicit. Preserve raw KV failures and
not-run statuses; the beta.6 exception is not a general waiver.

## Verification and limitations

PS-01 validates terminal reports, exact selected/completed task coverage,
current registry membership and the ledger's arithmetic. It uses source
inspection to distinguish expected build/install calls from observed execution.
Full compiler invocation counts and per-command timings are intentionally
unknown rather than fabricated. A new general benchmark or full seal is not
needed to prioritize the next edits.

Required local audit-document checks: maintainer control plane, documentation
synchronization/site validation, documentation release integrity, and scope
classification. Record their actual results in the PR. No product tests or
release gates are weakened by this evidence-only packet. Merge and publication
remain under the established release authority.
