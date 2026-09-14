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

The `1.0.0-beta.4` JWT/crypto packages build on the focused crypto seal,
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
