# Project lifecycle

The normal Pulse application loop is:

```text
pulse init
  → pulse doctor
  → pulse test
  → pulse dev
  → pulse build
```

Each command resolves the same project root, `.pulse/config.ts`, selected
profile, handler graph, schemas, provider bindings, target, and output
directory. Provider and target selection come from configuration; no command
silently changes them.

## Cold-start checklist

Use this checklist when starting a project with an agent or handing one to a
new collaborator. Detailed commands and contracts stay in the linked guides.

1. **Name the goal and execution constraints.** Record the intended API, provider,
   Native or JavaScript target, exact synchronized Pulse package version, required
   bindings and network/offline constraints. The generated default is Node Native;
   configure another supported profile explicitly. Check the
   [authoring contract](../reference/handler-authoring.md) and
   [target support](../reference/compatibility-matrix.md) before adding behavior.
2. **Check only the tools this workflow needs.** Confirm supported Node/npm and
   access to the exact package versions and dependencies used by the
   [published CLI bootstrap](../../README.md#start-here). A denied registry or
   download is an environment-access failure; a missing executable needs setup;
   a capability rejection needs a supported provider/target or source change.
   Fastly CLI/Viceroy belongs to the separate provider-reality step, not Native
   compilation or a configured-provider build.
3. **Keep a passing baseline.** Follow the [first-project commands](../getting-started.md),
   install the generated exact dependencies, then run `npm run doctor`, `npm test`
   and `npm run build` before adding features. Save those results. Use the installed
   CLI's `npm exec -- pulse docs --json` to locate version-matched offline docs;
   use generated scripts for subsequent commands. When testing fails, inspect
   the harness's effective request and helper defaults before changing the
   application or its expectations.
4. **Use MCP only after verifying the connection.** The optional
   [context server workflow](../../examples/12-pulse-context-mcp/README.md#workflow)
   explains protocol/profile selection and discovery/tool listing. Confirm those
   responses and the corpus version; a hosted URL alone establishes neither a
   working connection nor access to tools. Use `pulse.search` to find contracts,
   `pulse.read` to retrieve cited IDs, `pulse.example` for maintained files and
   `pulse.diagnostic` for a diagnostic's suggested checks. `pulse.start` returns
   Node Native/JavaScript starter plans; hosting the server on Fastly does not
   add Fastly starter generation. Keep tool requests on the project's exact version.
5. **Validate state at the right boundary.** For Fastly, follow the
   [separate-request write/read and distinguishable CAS recipe](./deploying-fastly.md#stateful-validation).
   The [exact Native fixture's KV reset](#fastly-native-fixture-kv-lifetime)
   cannot prove cross-request persistence. Keep fixture, local provider-engine
   and deployed-service observations distinct; retain failing/unknown outcomes.
6. **Leave a factual verification record.** Include each command and exit/result,
   actual artifact/report path, observed source/package/artifact identities,
   verification level and remaining unknowns. Use the existing
   [evidence-status interpretation](./troubleshooting.md#agent-evidence-status)
   when sharing command results. Record unavailable evidence as unknown; do not
   infer a revision, freshness, deployment or qualification from a successful build.

## 1. Initialize

```bash
pulse init ./my-app
cd ./my-app
npm install
```

`pulse init` writes a conventional application, project configuration, test
harness, package manifest, and TypeScript configuration. It pins the
synchronized Pulse package versions but does not run a package manager or make
an installation network request.

## 2. Diagnose the configured project

```bash
pulse doctor
```

`doctor` validates project discovery, configuration, entry and schema
resolution, output containment, provider support, required bindings, and
external tool readiness. Run it after changing profiles, targets, bindings, or
toolchains and before producing a candidate artifact.

Use JSON when a script or issue report needs stable diagnostics:

```bash
pulse doctor --json
```

## 3. Execute the test harness

```bash
pulse test
```

`test` runs the cases in the configured `tests/pulse.harness.ts` through the
selected provider's local conformance runtime. It proves the canonical program,
fixtures, provider mapping, and expected results. It does not prove a remote
origin, deployed resource, or provider service.

Event cases use `kind: 'event'`, a canonical frame, and an ordered exact
`expect.emitted` list. They are available only when the selected provider and
target expose the bounded event test adapter.

## 4. Run the development lifecycle

```bash
pulse dev
```

`dev` is a foreground process. It watches the reachable handler and schema
graph, recompiles on change, serves through the selected provider's local
runtime, and shuts down on normal process signals. Development values and
fixtures remain local inputs; they do not provision deployment resources.

For a mixed HTTP/event project, `dev` serves only HTTP requests. It does not
open an event listener or injection endpoint; use the harness for bounded event
execution.

### Fastly Native fixture KV lifetime

Fastly Native applications using conditional KV (`getVersioned`,
`insertIfAbsent`, `compareAndSwap`) select the exact-Wasm fixture ABI executor
for `test` and `dev`. That executor creates a fresh KV authority and seeds it
from the supplied fixtures for each invocation. Within one request, a write
can be read back; the next request starts again from `dev.kv`. Harness cases
also remain isolated. A successful write is not proof of cross-request
persistence on this fixture path.

For that executor, `dev --json` ready and successful compile/reload events
include `executionEvidence.kind: "fastly-native-fixture-abi"`,
`providerRealityValidated: false`, and `kvFixture` with
`lifetime: "invocation"`, `initialization: "supplied-fixtures"`, and
`crossRequestPersistence: false`. Human startup/reload output explains the
same boundary once per lifecycle event. A reload that leaves this executor
reports `executionEvidence: null`; failed reloads retain the last good program.
The disclosure contains no fixture values or credentials. Other provider and
execution paths have their own state lifetimes.

Use the [Fastly stateful validation recipe](./deploying-fastly.md#stateful-validation)
for persistence and contention checks in an actual local provider engine, then
qualify deployed behavior separately.

## 5. Build the selected target

```bash
pulse build
```

`build` realizes the exact provider and target in the active profile:

- Node Native emits Pulse-owned Wasm and the Node host-contract metadata.
- Node JavaScript emits a deterministic executable CommonJS source package.
- Fastly Native emits compact direct-host-ABI `bin/main.wasm`.
- Fastly JavaScript emits a deterministic source/deployment closure and
  downstream runtime candidate.

A successful build produces a candidate artifact. It does not publish a
package, deploy documentation, create provider resources, deploy a service, or
activate traffic.

Continue with the separate [Node build and execution
guide](./deploying-node.md) or [Fastly deployment-candidate
guide](./deploying-fastly.md). For a complete resource-backed application, follow
the [context MCP workflow](../../examples/12-pulse-context-mcp/README.md#compiled-application-workflow):
select a profile, check and build its package, then run the exact Native module
locally. Its compatibility Node host has a separate startup command.

## Inspect when you need the plan

`pulse inspect` is an observability command, not a required lifecycle stage:

```bash
pulse inspect --json
```

Use it to examine target support, project eligibility, the reachable graph,
effects, continuations, schemas, package-owned lowering, provider requirements,
bindings, and Native plan identity.

## Compile when you need the provider-neutral boundary

`pulse compile` is the advanced provider-neutral Native command:

```bash
pulse compile
```

It emits the portable `pulse_host` Wasm contract and its canonical Native plan.
It does not realize the configured provider. A JavaScript-selected project may
still use `compile` when its source is Native-eligible, but that separate
artifact does not change the selected JavaScript target.

Use `build` for the normal application artifact. `compile` is not a prerequisite;
run it only when you specifically need the portable Native boundary, inspection
evidence, or a host integration input.

## Failure path

When a lifecycle command fails:

1. rerun `pulse doctor --json`;
2. use `pulse inspect --json` to compare project requirements with target and
   provider decisions;
3. resolve the first source-located or binding-specific diagnostic;
4. rerun the failed lifecycle step.

See [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md),
[Provider and target compatibility](../reference/compatibility-matrix.md),
[Static events and outbound emission](./events.md),
[Troubleshooting](./troubleshooting.md), and [Diagnostics and
remediation](../reference/diagnostics.md).
