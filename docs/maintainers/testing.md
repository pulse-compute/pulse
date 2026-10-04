<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
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
| `release` | every functional profile plus package construction, deterministic artifacts, packed clean-consumer acceptance, evidence authority, and offline deployment candidates |

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

Finite generated output has a separate installed-consumer acceptance task:

```bash
node wasm/scripts/run-wasm-tests.cjs --task str03b-installed
```

It needs the lockfile-pinned build/pack dependencies and npm registry access for
non-Pulse dependencies. All Pulse packages come from exact local candidate
tarballs served by a read-only loopback registry; lifecycle scripts are disabled.
The consumer and its copied fixture run outside the checkout without workspace
package links. Every installed Pulse file is verified against its tarball before
and after both targets' CLI and wire tests. Atomic acceptance reports under
`wasm/.test-results/str03b-installed-*/` record terminal status, source/tree/diff,
package and fixture hashes, installed-file digests, Wasm identities, workflow
results, cleanup and memory observations. Keep failed attempts distinct from
final clean-source evidence. This task is explicitly selected, like the STR-02
installed tasks; it is not implicitly part of the portable or aggregate release
profiles and does not authorize publication or promote experimental output.

The event mechanism has focused provider-neutral tasks, plus one project-level
workflow task included in the `cli` and `release` profiles:

```bash
node wasm/scripts/run-wasm-tests.cjs --task events-static-topology --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-javascript-runtime --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-emit-javascript --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-native-runtime --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-node-reference --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-cli-workflow --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-conformance --no-report
node wasm/scripts/run-wasm-tests.cjs --task events-candidate-seal --no-report
```

`events-native-runtime` proves exact event dispatch, schema payload handles,
effect/continuation resume, event-only and mixed artifacts, conditional ABI
shape, two-build reproducibility, and HTTP-only byte identity. It is a
provider-neutral runtime proof and does not activate provider event transport.
`events-node-reference` proves Node JavaScript/Native direct parity, Native emit
suspension/resume, exact accepted frames, bounded FIFO ingress, cancellation,
failure categories, instance isolation, no loopback, zero JavaScript/Asyncify
imports, and zero fallback. It does not exercise a public listener or Fastly.
`events-cli-workflow` proves mixed HTTP/event harness cases, exact emitted-frame
expectations, Node JavaScript/Native project parity, event catalog packaging,
compile-only inspection, and the exact Fastly fail-closed eligibility boundary.
`events-conformance` drives the canonical bounded corpus through Node
JavaScript and Native and compares every semantic projection exactly, including
limits, queues, cancellation, redaction, state isolation, completion, and the
absence of loopback or a call surface. `events-candidate-seal` packs the
event-facing public package closure, installs it offline, type-checks author and
host consumers, verifies deterministic tarballs, and emits the EV9 candidate
decision plus blocker ledger. The candidate seal is evidence-only and does not
assign a release or publish anything.

Replay the existing Fastly HTTP regression through an explicitly selected
workspace-local Viceroy 0.20.1 binary; this does not claim Fastly event support:

```bash
PULSE_VICEROY_BIN=/path/to/viceroy-0.20.1/viceroy \
node wasm/scripts/run-wasm-tests.cjs \
  --task provider-fastly-compute-reality \
  --no-report
```

Event cases are an explicit harness discriminant; existing request cases remain
unchanged:

```ts
export default [
  {
    name: 'health',
    request: { method: 'GET', path: '/health' },
    expect: { status: 200, text: 'ok' },
  },
  {
    name: 'ingress',
    kind: 'event',
    event: {
      type: 'input.received',
      schema: 'events.Input',
      payload: { sequence: 7 },
    },
    expect: {
      status: 'completed',
      emitted: [{
        type: 'output.accepted',
        schema: 'events.Output',
        payload: { accepted: true, sequence: 7 },
      }],
    },
  },
]
```

`expect.emitted` is ordered and exact. It proves host acceptance only; it does
not imply delivery, automatic loopback, or a public injection command.

The source-bound [`examples/11-events`](../../examples/11-events/) project runs
the same mixed HTTP/event topology through `doctor`, `inspect`, `test`, and
`build`. Its `dev` command remains HTTP-only.

Maintainers may bound a diagnostic rerun:

```bash
node wasm/scripts/run-wasm-tests.cjs --profile release --from cli-project-workflow
node wasm/scripts/run-wasm-tests.cjs --profile cli --through docs-example-03-fetch-composition
```

`--from` and `--through` aid investigation. A release claim requires the complete release profile.

## Installed feature gates

The clean candidate's separate mandatory installed-feature replay is:

```bash
node scripts/release-feature-acceptance.cjs
```

The release seal invokes this after its complete aggregate profile. See
[installed feature acceptance](./release-acceptance.md#installed-feature-acceptance)
for the ten gates, source/tarball identity requirements and separate experimental,
private and external coverage. Focused runs remain development evidence and do
not replace the complete installed replay or the final release seal.

## Aggregate release seal

```bash
npm run release:seal
```

The seal restores the lockfile-pinned dependency graph, regenerates production
vulnerability and license evidence, validates maintenance and source publication
controls, builds and unit-tests the workspace, checks synchronized documentation,
runs the release profile, and records revision-bound evidence under
`wasm/.test-results/`. The release profile creates deterministic Fastly
Native and JavaScript candidate inputs and invokes the pinned downstream
JavaScript compiler locally. It does not deploy or publish either candidate.

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
requires a clean tree and matching source revisions in every persisted report.

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

Synchronize or check generated documentation with:

```bash
pnpm docs:sync
pnpm docs:check
```

Command/result blocks use `pulse-doc-run` metadata and compare stable semantic fields rather than durations or absolute paths.

## Package and consumer evidence

The release profile:

- constructs all publishable package tarballs from the canonical release catalog;
- checks package metadata, exports, exact versions, dependency rewriting, and payload hygiene;
- builds release packages and the documentation site twice and compares byte identities;
- installs every exact Pulse candidate while a loopback-only read-only registry keeps the `@pulse-compute` scope fail-closed;
- resolves third-party dependencies from the canonical npm registry instead of repacking development-install artifacts;
- exercises fresh Native Node, JavaScript Node, Native Fastly, GRIP, and Router projects without workspace links;
- builds the representative Fastly JavaScript source closure twice, compiles one exact closure with the pinned runtime toolchain, and records the no-deploy/no-publish boundary.

Run a focused package or consumer proof when diagnosing:

```bash
node wasm/scripts/run-wasm-tests.cjs --task release-packages --no-report
node wasm/scripts/run-wasm-tests.cjs --task clean-machine-acceptance --no-report
node wasm/scripts/run-wasm-tests.cjs --task deployment-candidates --no-report
```

## JWT and crypto proof seals

The `1.0.0-beta.6` JWT/crypto packages build on the focused crypto seal,
which replays the
configuration, JavaScript runtime, Native guest-source, shared cross-target
corpus, and real Fastly Compute proofs. First record the one phase-boundary
aggregate replay, then run the seal:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --profile unit \
  --profile native \
  --profile javascript \
  --profile conformance \
  --profile providers \
  --report .test-results/crypto-c4/relevant-aggregate.json
node wasm/scripts/run-wasm-tests.cjs --task crypto-verification-seal --no-report
```

The seal writes `wasm/.test-results/crypto-c4/phase-c-seal.json` and the shared
corpus proof writes
`wasm/.test-results/crypto-c4/crypto-cross-target-conformance.json`. Both
reports contain status, target realization, toolchain, boundary, and size
evidence; neither contains keys, messages, authenticators, or ambient backend
errors. The preserved Phase C seal records the earlier package boundary. JWT
composition is now sealed in
`wasm/.test-results/jwt-d4/jwt-phase-d-seal.json`, and the complete four-cell
target proof is sealed in
`wasm/.test-results/jwt-e4/jwt-phase-e-seal.json`.

Consolidate those records with the guest-memory decision, guest-link pipeline,
current documentation, and synchronized package identity using:

```bash
node wasm/scripts/run-wasm-tests.cjs \
  --task jwt-evidence-consolidation \
  --no-report
```

The task writes
`wasm/.test-results/jwt-f0/jwt-f0-evidence-consolidation.json`, verifies
preserved hashes, and proves the JWT/crypto implementation evidence remains
internally consistent. It does not publish, promote, deploy, or activate
anything.

## Runner evidence

The full `Repository validation / full portable` gate aggregates six independent
jobs: `unit`, `native`, `javascript`, `conformance-rsa`, `conformance-schema`,
and `conformance-rest`. The plan in
`scripts/maintainer-portable-validation.cjs` expands the four existing portable
profiles from the task registry. RSA isolates `jwt-rs256`; schema isolates
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
attempts, durations and tested SHA. This remains portable CI evidence; the
separate release seal still requires its complete candidate replay.

C02's three hosted PR samples completed in 7m59s, 7m58s and 7m37s,
compared with W01's 20m15s serial run. Queue time and total runner usage
are separate from task duration. Each shard still builds its own pinned
workspace; there is no dependency cache.

## Branch validation tiers

| Event target | Required validation |
| --- | --- |
| PR into any non-`main` branch | Scope declaration, documentation, maintenance, Node 22 smoke, fast portable |
| Push to any non-`main` branch | Advisory scope classification, documentation, maintenance, Node 22 smoke, fast portable |
| PR into `main` | Scope declaration, documentation, maintenance and release preparation, Node 22 support floor, all four portable profiles |
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
replay or permit combining reports from different source trees.

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
