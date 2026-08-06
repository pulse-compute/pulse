# Pulse test architecture

The test registry is organized around seven product behaviors.

| Profile | Owns |
|---|---|
| `unit` | repository, package, graph, schema-registry, and continuation fundamentals |
| `native` | lowering, runtime, AssemblyScript, and provider-neutral Wasm |
| `javascript` | explicit JavaScript target realization |
| `conformance` | native/JavaScript semantic parity |
| `providers` | Fastly package and native capability realization |
| `cli` | commands, diagnostics, clean projects, and executable documentation |
| `release` | all functional profiles, package output, byte determinism, and packed consumers |

Run a profile, task, or bounded diagnostic slice:

```bash
node wasm/scripts/run-wasm-tests.cjs --profile native
node wasm/scripts/run-wasm-tests.cjs --task node-cross-target-conformance
node wasm/scripts/run-wasm-tests.cjs --profile release --from cli-project-workflow
node wasm/scripts/run-wasm-tests.cjs --list
```

Every task has one command, one evidence category, a finite timeout, and an isolated temporary root. The runner creates a separate process group, tees output to a task log, requests a Node diagnostic report before timeout termination, removes descendants, and updates its JSON report atomically.

## Evidence boundaries

1. Unit tasks establish repository shape, public API type surface, project reachability, package ownership, schema registration, and continuation safety.
2. Native tasks establish effect lowering, Router lowering, canonical runtime behavior, package-owned lowering, AssemblyScript compilation, and provider-neutral Wasm execution.
3. JavaScript tasks establish full declared target support, request-owned effects, keyed parallelism, and Assets/runtime package behavior.
4. Conformance tasks execute shared Node and GRIP corpora across native and JavaScript targets, including Router context, bodies, fetch projections, bindings, codecs, and redaction.
5. Provider tasks establish Fastly package configuration, capability realization, native HTTP effects, platform stores, GRIP, and CLI/Viceroy delegation behavior.
6. CLI tasks execute the public commands, diagnostics, project guards, live development, schema workflows, source-bound documentation, and every public example.
7. Release tasks build package candidates, compare independent artifact trees byte-for-byte, and exercise packed candidates from clean projects.

The environment-dependent `provider-fastly-compute-reality` task is deliberately outside the profiles. `npm run release:seal` executes it when the Fastly CLI can run its managed local Compute lifecycle and records an explicit unavailable state otherwise.

## Current release command

```bash
npm run release:seal
```

This is the only aggregate seal. It covers dependency restoration, repository controls, build and unit tests, documentation, every functional test profile, package and consumer evidence, artifact determinism, and available external Fastly reality.

## Registry policy

- Register a task once; compose profiles by task identity.
- Keep every non-external task reachable from `release`.
- Keep external tool availability separate from portable correctness.
- Use `--from` and `--through` only for diagnosis.
- Keep `.test-results` ephemeral and regenerate it only from the current tree.
