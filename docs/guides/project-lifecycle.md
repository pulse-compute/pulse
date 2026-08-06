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
guide](./deploying-fastly.md).

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
