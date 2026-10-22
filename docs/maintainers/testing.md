<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-10-09
review-by: 2027-04-09
pulse-doc-meta:end -->

# Testing Pulse

Pulse organizes evidence by product behavior. Every task has one registry entry, a finite timeout, an isolated temporary root, and an optional ephemeral report.

## Workspace checks

```bash
pnpm build
pnpm test
```

These commands cover the TypeScript workspace and package-level unit tests.

## Functional profiles

| Profile | Evidence |
|---|---|
| `unit` | package exports, repository boundaries, workspace hygiene, API shape, project graphs, schema registry, and continuation registry |
| `native` | lowering, canonical runtime behavior, AssemblyScript compilation, and provider-neutral Wasm execution |
| `javascript` | explicit JavaScript target support, request-owned effects, and package JavaScript realization |
| `conformance` | Node/Fastly Native/JavaScript Router, fetch, binding, schema, GRIP, logging, and target-integrity parity |
| `providers` | Fastly Native and JavaScript packaging, runtime, capability, tooling, HTTP, and platform realization |
| `cli` | commands, diagnostics, clean projects, live development, and executable documentation examples |
| `release` | functional coverage with shared corpora owned by installed acceptance, package construction, deterministic artifacts, evidence authority, and offline deployment candidates |

Run one profile or task:

```bash
node wasm/scripts/run-wasm-tests.cjs --profile unit
node wasm/scripts/run-wasm-tests.cjs --profile conformance
node wasm/scripts/run-wasm-tests.cjs --task schema-codecs
node wasm/scripts/run-wasm-tests.cjs --list
```

`wasm/test/suite/registry.cjs` owns the exact task and profile IDs. Agent
instructions, this guide, release acceptance commands and maintenance-policy
commands are checked against it by `npm run maintainer:check`. Use explicit
runner commands for named selections so stale references are detectable.

[Release acceptance](./release-acceptance.md) owns packed-consumer coverage,
installed feature gates and provider-proof boundaries. Select focused task IDs
from the registry for diagnosis; a focused result does not qualify a release.
The [events guide](../guides/events.md) owns mixed HTTP/event harness syntax.

For declared npm source exports, run the independent installed-consumer check:

```bash
node wasm/scripts/run-wasm-tests.cjs --task npm-source-installed-workflow
```

This release-profile task packs the current candidate and a separate source
dependency, pins and updates it through a local read-only registry, and verifies
Node/Fastly Native execution, trusted effects, source attribution and rejected
unsupported updates. It records a terminal acceptance report under
`wasm/.test-results/`. Ordinary third-party toolchain dependencies still require
npm access. The Fastly fixture ABI is development evidence, not live deployment.

Maintainers may bound a diagnostic rerun:

```bash
node wasm/scripts/run-wasm-tests.cjs --profile release --from cli-project-workflow
node wasm/scripts/run-wasm-tests.cjs --profile cli --through docs-example-03-fetch-composition
```

`--from` and `--through` aid investigation. A release claim requires the complete release profile.

## Compiler analytics qualification

Run the focused AN9 boundary selection on one immutable candidate:

```bash
node wasm/scripts/run-wasm-tests.cjs --task suite-shape --task cli-report-handler-topology --task cli-report-handler-associations --task cli-report-imported-inputs --task report-capsule-contract --task cli-report-viewer --task cli-report-retained-evidence --task cli-report-workflow --task cli-report-capture-proof --task cli-report-entry-proof --no-report
```

`cli-report-handler-topology` uses the product-owned
`wasm/test/fixtures/projects/report-analytics` fixture. HTTP/error and HTTP/event
variants each run under explicit `native-shrink0` and `experimental-native-bounded-size` recipes.
The same cells qualify authored definitions, mount/registration instances, repeated
use sites, helper calls and bounded associations through retained completion,
source-free passive replay, offline HTML and semantic comparison. Observation on/off
must preserve the Native plan, generated source, Wasm and optimization metadata;
112 executions check selected responses/statuses and dispatched binding order.
Changing physical bytes/recipe must not produce semantic capability/binding changes.
Static association candidates are not evidence that an operation executed.

The selection also checks imported receipt freshness/admission, missing data and older capsules,
malformed graphs, UI navigation/filter/export behavior, and existing physical capture
noninterference. The combined HTTP error-handler/event Native-generation defect is
isolated in [issue #329](https://github.com/pulse-compute/pulse/issues/329); that cell
is excluded, not counted as passing. The retired AN9-00 investigation executable
and its expected-gap assertions are no longer test requirements.

This focused selection does not replace complete functional profiles, browser visual
qualification, installed acceptance or the release seal. Keep those statuses separate
and retain the tested source identity, terminal task summary and failed attempts.

## Installed feature gates

The clean candidate's separate mandatory installed-feature replay is:

```bash
node scripts/release-feature-acceptance.cjs
```

The release seal invokes this after its complete aggregate profile. See
[installed feature acceptance](./release-acceptance.md#installed-feature-acceptance)
for the eleven gates, source/tarball identity requirements and separate
experimental and external coverage. Installed MCP acceptance belongs to this
release replay and remains outside both fast PR and aggregate release profiles. Focused runs remain development evidence and do
not replace the complete installed replay or the final release seal.

## Aggregate release seal

```bash
npm run release:seal
```

The seal restores the lockfile-pinned dependency graph, runs source checks
(maintenance/publication controls, catalogs, generated docs, links and site)
before the TypeScript build, refreshes production vulnerability and license
evidence, unit-tests the workspace, runs the complete release and installed-feature
selections, and records revision-bound evidence under
`.pulse-seal/attempts/<run-id>/`. This durable directory survives the ordinary
workspace clean command; task scratch space remains under `wasm/.test-results/`.
The release profile creates deterministic Fastly
Native and JavaScript candidate inputs and invokes the pinned downstream
JavaScript compiler locally. It does not deploy or publish either candidate.

After build and documentation checks, the seal constructs one package set in its
attempt directory. A SHA-256-pinned receipt binds every output file to
the clean checkout, commit and tree. Each packed-consumer task verifies that
receipt, current source and package bytes, then receives its own ordinary file
copies. Consumer installations, behavioral assertions and reports remain
independent. The artifact-determinism task constructs a second package set from
source and compares it with the first; it cannot reuse the second construction.
Standalone packing and focused tasks still construct their own packages.

This replaces fifteen full package constructions with two during a fresh complete
seal. Verified recovery can reuse the exact shared set and completed task proofs
from the same immutable candidate. Every attempt has its own copies and reports.
Execution is serial by default; the bounded worker mode below overlaps only
independent tasks. Documented default and
optimized size assertions run in the complete example workflows; the separate
size-only command remains available for focused diagnosis.

Each attempt writes `.pulse-seal/attempts/<run-id>/report.json`
and one log per step. `wasm/.test-results/release-seal.json` identifies the
most recently started attempt; an older attempt finishing cannot overwrite it.
The report starts as `running`, records `currentStep`, `updatedAt` and
`durationMs`, and refreshes every ten seconds even when a child is quiet. The
nested task report also refreshes every ten seconds and distinguishes execution
from cleanup. Recovery should inspect these reports before starting another run.

The attempt report exists before Node, source and prerequisite checks. A cold
checkout reaches dependency restoration without loading packaging or
documentation modules that need workspace packages. The seal requires a clean
Git candidate and rejects a supplied source revision that differs from `HEAD`
before restoration or compilation. It checks required Fastly CLI availability
early, then rechecks the source before packaging and after qualification. Node,
source, prerequisite and temporary-directory failures receive terminal reports;
unresolved source identity remains `null`, never a borrowed successful revision.
`--no-report` suppresses all attempt files, including setup failures.

The overall work deadline defaults to 55 minutes and is recorded as `deadlineAt`.
Use `--timeout-minutes <minutes>` (1–1440) to set an explicit finite budget.
Each child receives the smaller of its step limit and the remaining overall
budget. Expiry cancels active work, prevents later steps and records a failed
seal with `PULSE_RELEASE_SEAL_DEADLINE`; it does not qualify partial work.

Step deadlines terminate the supervised process tree, escalating from TERM to
KILL after ten seconds, with one further second to settle output. Temporary
cleanup has a separate thirty-second deadline; failure or interruption cannot
produce a passing receipt. A terminal result and report path are printed before
any separate evidence-bundle command. Pre-main qualification retains the reports on
success and failure. A missing terminal receipt after an uncatchable kill or
machine loss remains incomplete evidence, never an implied pass.

The [pre-main qualification workflow](./npm-publishing.md#pre-main-qualification)
owns the hosted work budget and artifact handoff. Publication consumes that
qualified artifact; it does not start another seal. Workflow deadlines bound
recovery, not the expected duration of a fresh seal. Qualification still requires
the complete ordered selection and a terminal passing aggregate.

### Recovering the same candidate

To recover an interrupted or failed attempt, pass its durable directory:

```bash
npm run release:seal -- --resume .pulse-seal/attempts/<run-id> --require-fastly
```

Before dependency restoration and build, resume prints the prior attempt path
and a read-only, **preliminary** summary for shared packing, release tasks and
installed-feature tasks: prior completions, passes and potentially reusable
checkpoints. It explains changed candidate, checkout or options, and counts
missing, expired, failed or unreadable checkpoint metadata. This reads receipt
metadata only; it neither restores outputs nor verifies retained artifact bytes.
An ineligible or foreign attempt directory is still rejected by the existing
same-checkout validation.

After fresh setup, a context comparison names changed categories (such as
toolchain, environment or dependency/build inputs) without printing their
values. Matching context and preliminary eligibility never authorize reuse:
each checkpoint still undergoes full proof, output and cleanup verification.
Packing and task logs print the reason before rejected work executes again.
Runner reports retain live `recovery.counts` for completed, verified reused,
executed and remaining tasks, and print those counts at termination. Completed
and executed counts include failures; they are not passing-coverage claims.
The seal report retains `resumeDiagnostics` and `resumeContext` separately from
verified checkpoint evidence.

The controller creates a new attempt and reconstructs the entire ordered release
and installed-feature selection. Each result says `executed` or `reused`, with
its immutable receipt and original proof identity. Passed tasks become reusable
only after child-process termination and successful task cleanup. Failed,
incomplete, cancelled, expired, altered or missing checkpoints run again;
recovery never turns those statuses into a pass. A corrupt or mismatched context
is rejected for reuse; the affected work executes again.

Eligibility binds the clean Git revision and tree, checkout real path, lockfile,
actual dependency/toolchain bytes and versions, freshly built outputs, options,
provider/environment hashes, task definition, prerequisite proof identities and
exact retained artifact bytes. Checkpoints expire after seven days; reusing one
does not extend its original expiry. There is no foreign-checkout or remote cache.
Qualification CI archives `.pulse-seal/` for diagnosis; those uploads do not enable
remote reuse. Environment values enter the context as hashes, not plaintext credentials.

Bootstrap, source and prerequisite checks, dependency restoration (unless the
explicit `--skip-install` option applies), build, maintenance/publication checks,
documentation, workspace unit tests, vulnerability/license refresh, external
Fastly reality and final cleanup execute on every attempt. Expensive release and
installed tasks and the exact shared package set may be recovered. The independent
second package construction remains part of the determinism task's proof.

### Bounded local seal workers

Serial execution remains the default. To overlap independent release and
installed-feature tasks in one controller-owned seal:

```bash
npm run release:seal -- --workers 4 --compiler-workers 2 --memory-budget-mib 6144 --require-fastly
```

`--workers` accepts 1–8. The memory admission budget accepts 768–65536 MiB;
the controller admits at most one worker per estimated 768 MiB. This limits
concurrency, not operating-system memory use. Measure actual process-tree RSS
before increasing the budget. `--compiler-workers` accepts 1–8, defaults to two
and is capped by the admitted workers. Native, conformance, CLI, provider, release
and external tasks use those compiler slots by default; explicit registry hints also
cover Native compilation inside unit-classified report, launcher, Assets and S3
checks. Independent package/site determinism uses existing compiled outputs and
can overlap one compiler task. Lighter tasks may occupy the remaining worker slots. This avoids
starting four heavy compilation pipelines together on a four-CPU runner.
`--workers 1` is the serial fallback. Task deadlines are unchanged.

Each worker is a private Git worktree of the clean candidate, with copied
dependencies and build outputs, worker-local workspace links and private task
temporary roots. Absolute source/tool argv paths are rebased into that worker.
The exact shared package set is constructed once before task scheduling;
consumers receive verified private copies. External Fastly reality runs freshly immediately after the workspace build, before
packing and the long suites. CLI availability and executable bytes are checked
again before terminal acceptance. Bootstrap, build and other always-fresh
controller stages remain serial. Registry scheduling
hints can declare dependencies, shared-resource locks and exclusive work;
benchmarks and timing measurements execute alone. Six short contract checks (suite shape, exports, boundaries, workspace hygiene,
feature-gate coverage and release runtime policy) finish before other selected
tasks. The installed Native rejection check also precedes the long JWT gate.
These priorities apply to serial and parallel execution; reports retain canonical
selection order and every selected task remains required. Remaining parallel
tasks use historical ordering weights. The resume measurement helper interrupts
at final validation, after feature checkpoints have been restored.

Reports preserve canonical selection order, record every active child and bind
each task to its worker. Failure or interruption cancels all active workers;
successfully cleaned passed tasks retain their recovery proofs. Resuming requires
the same worker/compiler/budget options and freshly recreated identical worker inputs.
Changing the options invalidates reuse. Worker source and executable inputs are
checked before each task, during its supervised cleanup, and by the controller
after the cleanup process exits. The controller reconciles any remaining untracked
output and records the combined removed paths; a receipt alone cannot authorize a pass. Each scheduler
slot owns its worker until cleanup finishes. The controller removes task-created,
untracked files from that disposable checkout, then verifies a clean source tree
and unchanged dependency/build bytes before recording a reusable pass. Cleanup
receipts list removed paths. Tracked changes, modified executable inputs, foreign
worktrees and cleanup failures remain failures; cleanup never resets source or
touches a sibling task's outputs. Ignored dependency/build inputs are preserved.

Worker source and executable inputs are also rechecked before terminal cleanup,
then disposable checkouts are removed while
attempt-local logs, receipts and artifacts remain. Foreign checkouts, remote
workers and independently assembled reports are not eligible for this aggregate.
Parallel execution requires reports and cannot use `--no-report`.

A retry can remove ordinary output residue left in a controller-owned worker
directory after Git has removed its registration. An unrelated repository, live
or foreign Git marker, symlinked worker path or mismatched owner is rejected.
On Linux, seal locks bind the owner process instance and procfs view as well as
its PID, so PID reuse cannot masquerade as the prior controller. Unverifiable
process views and outstanding child records from another PID namespace still
require inspection; the lock is retained.

Resume reports identify added, removed and changed environment **keys**, with
values redacted, before expensive setup begins. Unknown and changed environment inputs still invalidate reuse;
the diagnostics do not broaden the existing shell-variable exclusions. Older
reports without per-key fingerprints can report only the category change.
Proxy configuration remains bound: a managed runner that changes transport
endpoints between invocations requires fresh proofs. Use a stable execution
environment when planning to resume a long qualification.

`--no-report` disables recovery recording and cannot resume an attempt. To remove
expired terminal attempts without touching active work, run:

```bash
npm run release:seal -- --prune-recovery
```

Retain the previous attempt when reporting a retry. Its failed or interrupted
status remains historical evidence. Final evidence aggregation validates the new
attempt's complete selection, every checkpoint, successful cleanup and all bound
report/artifact hashes. Selecting a focused range or manually copying successful
reports does not create a recoverable seal. Conditional-KV failed/not-run states
and the exact Beta.6 exception retain their existing meaning.

External npm organization settings, trusted publishers, protected publication
environments, public repository administration, and the production documentation
origin do not authorize or block candidate construction. They remain explicit
publication and documentation-deployment gates after the candidate is sealed.

When the Fastly CLI and its managed local Compute engine are available, the same command also runs the external native-host proof. Require that environment explicitly with:

```bash
npm run release:seal -- --require-fastly
```

To validate an already restored dependency graph:

```bash
npm run release:seal -- --skip-install
```

The Docker-built offline dependency bundle is created and restored with:

```bash
./scripts/bundle_deps.sh
./scripts/restore_deps.sh ./pulse-wasm-deps-....tar.zst
```

The restore script reconstructs the dependency graph only. The release seal owns product validation.

After a clean passing seal, aggregate the persisted reports into the sixteen
release evidence shards and verify an exact binary patch replay:

```bash
npm run release:evidence -- \
  --base <accepted-source-ref> \
  --head HEAD \
  --label <delivery-name> \
  --out <new-output-directory>
```

The authority creates a source-only archive, binary patch, independent replay,
four-mode and target-integrity reports, migration ledger, maintainer scope,
Fastly Native and JavaScript candidates, checksums, and one delivery bundle. It
requires a clean tree and matching source revisions in every persisted report. For
recovery-aware seals it reads the selected attempt's bound paths by default and
verifies checkpoint provenance, exact report bytes and artifact manifests; an
explicit path override must match those same sealed bytes.

## Executable documentation

Documentation execution belongs to the `cli` profile because every public example is driven through installed command behavior. Separate tasks cover:

- source-bound documentation contracts;
- clean `pulse init` and live `pulse dev`;
- each canonical example’s `doctor`, `inspect`, `test`, and `build` flow.

Source-backed blocks use:

```text
&lt;!-- pulse-doc-source: examples/01-hello-json/src/index.ts --&gt;
<exact fenced source block>
&lt;!-- /pulse-doc-source --&gt;
```

Use the [documentation update loop](./documentation-system.md#update-loop)
for synchronization and source/site checks.

Command/result blocks use `pulse-doc-run` metadata and compare stable semantic fields rather than durations or absolute paths.

## Package and consumer evidence

[Release acceptance](./release-acceptance.md) owns the required package,
determinism, clean-consumer and offline-deployment coverage. For focused diagnosis:

```bash
node wasm/scripts/run-wasm-tests.cjs --task release-packages --no-report
node wasm/scripts/run-wasm-tests.cjs --task clean-machine-acceptance --no-report
node wasm/scripts/run-wasm-tests.cjs --task deployment-candidates --no-report
```

## Runner evidence

The full `Repository validation / full portable` gate aggregates seven independent
jobs: `unit`, `native-a`, `native-b`, `javascript`, `conformance-rsa`, `conformance-schema`,
and `conformance-rest`. The plan in
`scripts/maintainer-portable-validation.cjs` expands the four existing portable
profiles from the task registry. Native uses a reviewed assignment of 25 tasks
to each group, based on the CI9-01 timing sample. It preserves registry order
within each group; newly registered Native tasks enter `native-a`, while removal
of a named `native-b` anchor requires updating the plan. CI never repartitions
tasks using cached or live timings. RSA isolates `jwt-rs256`; schema isolates
`schema-codecs` and `schema-kv-parity`; the remaining conformance tasks stay in
registry order. Every registered portable task occurs exactly once.

After maintenance validates the plan and aggregate contract, each shard
installs pinned dependencies, builds in its own checkout at the tested
SHA, and uploads its terminal report and task logs even on failure. The
`full portable` aggregate runs after failed or skipped jobs as well as successful
ones. It requires successful shard jobs and complete passing reports for the
same tested SHA and workflow run. Missing, failed, cancelled, incomplete,
duplicate or mismatched evidence fails the gate. On a job retry it selects the
latest attempt for each shard in that run; a newer failed attempt cannot fall
back to an older passing report. The aggregate artifact records task counts,
attempts, durations and tested SHA. `taskElapsedSumMs` sums shard task durations;
`taskWallTimeMs` spans their first start to last finish. Both exclude dependency
setup and build steps. Compare hosted job start/end times and total worker time
on the same candidate before claiming a CI speedup from the split. This remains portable CI evidence; the
separate release seal still requires its complete candidate replay.

## Branch validation tiers

| Event target | Required validation |
| --- | --- |
| PR into any non-`main` branch | Scope declaration, documentation, maintenance, Node 22 smoke, fast portable |
| Push to any non-`main` branch | Advisory scope classification, documentation, maintenance, Node 22 smoke, fast portable |
| PR into `main` | Scope declaration, documentation, maintenance and release preparation, Node 22 support floor, all four portable profiles, pre-main release qualification |
| Push to `main` | Advisory scope classification, documentation, maintenance, Node 22 support floor, all four portable profiles |
| Manual branch dispatch | The same tier as a push to that branch |

PRs always test the merge of the event's exact base and head, including after
retargeting. Branch pushes test the pushed commit. A non-main push is suppressed
only if an open PR already represents the exact same repository and head SHA;
its PR merge validation still runs. If the read-only API lookup fails, the push
runs too. A push immediately followed by PR creation can produce two runs;
correct merge-ref evidence takes priority over eliminating that race. Main
pushes always run full validation. Tags do not trigger these workflows.

The stable `Repository validation / portable` check waits for maintenance,
Node 22 and the required portable tier. It independently derives that tier from
the event and rejects missing, skipped, cancelled or failed required jobs,
including routing and fast selection. The distinct `fast portable` and
`full portable` checks support branch-specific rules. Keep the common gate
required during and after the human-owned ruleset migration in repository setup.

Fast selection executes the base commit's path matcher and policy. PR selection
compares base to tested merge; a branch push compares its previous commit to
the pushed commit. New branches and manual dispatch compare the tested commit's
first parent. Missing base objects or malformed identities fail validation.
Known unprotected owners select a fixed cross-target core (`package-exports`,
`api-surface`, `target-support`, `node-cross-target-conformance`) plus a schema
check and focused
tasks from an explicit bounded allowlist. Direct test-file changes select their
task only when it is in that allowlist.

Protected boundaries, unknown paths, unmapped tests and empty diffs run the
entire conservative fast set: the core plus CLI command/guard, canonical API
lowering, JavaScript effect adapter, schema registry and continuation
registry checks. They never produce an empty successful selection or force a
full non-main run.

Fast selection always includes exactly one schema codec task. Known unrelated
documentation, maintenance and test changes use `schema-codecs-smoke`. It runs
the existing base proof and the same proof assertions as `schema-codecs`: one
real Native compilation, JavaScript/Native semantic and trace parity, strict
positive/negative JSON boundaries, malformed-input rejection before dispatch,
body/cache ownership and JavaScript package output. It is not full conformance.

Schema/JSON tests, shared test support, fixtures and suite selection keep
`schema-codecs`. Compiler, runtime, provider, CLI, configuration, dependency and
other owners outside that unrelated set also keep the full corpus, even when
their filenames do not mention schemas. Unknown paths and empty diffs keep it
too. A mixed change uses full coverage if any path requires it. Full coverage
replaces the smoke; it does not run both.

The exact generated context data mirror at
`wasm/packages/cli/examples/12-pulse-context-mcp/context-corpus.ts` is an exception
to the CLI rule, like installed documentation. The required documentation preview
still checks canonical inputs against the generated corpus, then checks the
installed mirror byte-for-byte. Selection alone is not an integrity receipt:
stale or manually edited output fails those checks. Executable example neighbors
remain CLI dependencies, and any other schema-sensitive path or additional
trusted-base owner in the same diff retains full schema coverage.

The smoke defers the extended admission, value/text encoding, optional-field,
scalar-record and nested/open JSON corpus to schema-sensitive changes and
main/release. The conformance profile, schema shard and release profile still
run the complete `schema-codecs` task; the smoke adds no duplicate compile to
those profiles. This reduces unrelated branch feedback time, not application
build time or Wasm size. It adds a real schema smoke to focused selections that
previously ran only the cross-target core.

The selection artifact records `schemaCoverage`, including the selected task,
full-coverage reasons and whether extended coverage is deferred. It also explains each path, rule, boundary,
selection reason, task, exclusion and source identity. It explicitly defers
full coverage to main. Fast runs require a terminal passing report with the
exact requested, selected and completed task identities at the tested SHA.
The Node 22 smoke remains a separate build and `cli-init-workflow` run in both
tiers. Fast evidence does not replace full validation before a human merges
into main, or the separate candidate replay before publication.

The runner writes `wasm/.test-results/last-run.json` atomically after every task and stores one log per task. When a task fails, task-owned `*.log` files such as npm debug logs are copied into that run's durable diagnostics directory before the temporary root is removed. On timeout it captures a Node diagnostic report, terminates the entire task process group, and reports any surviving descendants. The directory is ephemeral and should contain only evidence produced from the current tree.

Before reporting a run as passed, verify process exit, terminal report status,
the requested/selected task set, completed task count and each task result. A
zero exit with a missing or incomplete expected report is unresolved. When
`--no-report` is used, retain the terminal task results and aggregate summary;
exit status alone does not establish coverage.

Record the source revision and working-tree state alongside the toolchain,
command and artifact identities. The runner's Git commit identity alone does not
identify uncommitted changes. Label those runs as development evidence and retain
the tested diff or tree digest. Preserve failures when retrying, identify why the
rerun was bounded, and report the retry separately. Focused, split or resumed
development runs do not substitute for the complete clean-candidate release
replay or permit combining reports from different source trees. Only the release
controller's verified same-candidate recovery described above can reuse task
proofs in authoritative evidence.

### Recoverable development runs

CI9-02 adds an opt-in, checkout-local diagnostic command:

```bash
node scripts/development-recovery.cjs --profile unit --profile native
node scripts/development-recovery.cjs --resume /absolute/path/to/checkout/.pulse-development/attempts/ATTEMPT
```

Commit the tested source and install/build dependencies before starting. A fresh
run requires explicit `--profile` and/or `--task` selections. Resume accepts only
the printed attempt directory; it preserves that selection and creates a new
attempt. It never edits the earlier manifest, report, receipts or logs, even if
the old progress report is missing or truncated. Each report records executed
and reused tasks separately. Read the final status, selected/completed counts,
task outcomes and process exit before claiming a recovered development pass.

The manifest binds the clean revision/tree, actual tracked source bytes, checkout
path, installed dependency and built output bytes, Node and discovered tool
binaries, environment digest, selection and task definitions. Environment values
are not written into the manifest. Full input checks run before every task/reuse,
after executed-task cleanup and before terminal completion; `inputCheckMs`
reports their overhead. Changed inputs reject resume: start a fresh run after
source edits, dependency/tool updates or environment changes. This first version
does not support dirty trees or restore arbitrary task outputs. It restores
verified task logs and reuses diagnostic pass results only.

Passed tasks with successful cleanup can be reused for seven days; reuse does not
extend expiry. Missing, corrupt or expired receipts/logs rerun their task.
Provider, external, release and measurement/exclusive tasks always execute fresh.
Failed, interrupted and timed-out tasks also execute again. Input drift fails
the attempt and prevents a new reusable pass. A test leaving untracked source
residue can therefore stop the run; inspect and clear that residue before retrying.
The controller shares the seal's checkout lock. A live previous controller or
child process group blocks takeover; an unverifiable stale lock needs inspection.
The command does not coordinate unrelated editors or ordinary test processes:
keep this checkout idle while it runs.

Attempts live under ignored `.pulse-development/attempts`, outside the ordinary
test-result directory removed by `npm run clean`. There is no implicit lookup,
automatic pruning, remote cache or foreign-checkout reuse. Retain attempts needed
for diagnosis; remove unneeded attempts only when no controller is active.
Reports use `pulse.development-run.v1`, explicitly mark `qualification: false`,
and are rejected by the normal CI runner-report validator. A recovered development
run cannot replace fresh performance measurements, hosted CI or a release seal.
The `release-recovery-runner` unit task includes the development recovery probes,
including 149 completed passes followed by one-task recovery.

On an interruption or handoff, record the branch, base/head, uncommitted work,
report/artifact paths, completed and running checks, blockers and the next action.
A task handoff must distinguish implemented, validated, pushed and merged work.

## Provider evidence boundaries

| Evidence | Establishes | Does not establish |
| --- | --- | --- |
| Injected host or ABI fixture | Behavior under the modeled host outcomes | Real engine or deployed service behavior |
| Fastly CLI/Viceroy execution | The identified artifact ran on the identified local engine | Deployed Fastly behavior |
| Standalone live SDK probe | The tested service cases through that probe | Pulse package acceptance or untested concurrent/cross-location behavior |
| Deployed Pulse acceptance | The identified Pulse artifact passed the bounded deployed corpus | Exhaustive consistency or guarantees outside that corpus |

Report tool versions, artifact identity, execution/deployment identity where
applicable, corpus scope and pass/fail/inconclusive status separately. Executing
a real engine is not itself a passing semantic result. A caller-supplied Wasm
hash is not deployed binary attestation.

For conditional KV, the Fastly JavaScript SDK is incomplete capability mapping,
not semantic canon or an acceptance gate for other targets. Keep provider docs,
wire observations and executable behavior distinguishable when they disagree.
Retain the discrepancy and the unchanged Pulse assertion; do not compensate with
hidden retries, non-atomic prechecks or weaker expected results. Substituting one
kind of evidence for a required gate needs an explicit human-directed acceptance
policy change. See [conditional KV acceptance](./release-acceptance.md#conditional-kv-acceptance)
for the currently unresolved gates.

## Redundancy policy

- Add a task once to `wasm/test/suite/registry.cjs`; do not add a package script per test.
- Prefer the strongest end-to-end oracle that proves the behavior.
- Keep compiler goldens, runtime traces, provider results, CLI subprocess output, build manifests, and executable docs at their owning boundary.
- Do not derive expected constants from the implementation being tested.
- Remove a weaker fixture when a stronger oracle covers the same claim.

## Context resource reconstruction

`npm run context:build` is an explicit author operation using Node 24.18.0,
matching the release producer. `npm run context:check` independently reconstructs
and compares the committed corpus/vector/text/metadata closure and installed
mirrors without repair. Repository build and documentation validation run this
check. Documentation PR CI also runs `pulse-context-build`'s owned test script:
independent clean roots, reordered enumeration, locale/timezone variation,
strict binary admission and non-mutating source/output drift rejection.

These are development checks. They do not issue the candidate-bound seal or
installed-closure receipts assigned to B10-MCP-09/07, and do not replace the
full release selection. `docs:sync` copies emitted resource files but never
regenerates vectors; after changing canonical inputs, run explicit generation
and finish with the read-only check.
