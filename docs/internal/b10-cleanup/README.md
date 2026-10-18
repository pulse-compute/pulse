# B10 — cleanup blocker investigation

Continuation of [#373](https://github.com/pulse-compute/pulse/issues/373),
after #395 landed. Class: evidence. No production code changes.

The file-resurrection symptom reproduces without Pulse. An ordinary Node child
creates `src/index.ts`, removes its directory, and reports it absent. The parent
also observes absence and a clean Git status, then removes the directory again.
After that invocation finishes, a later filesystem inspection finds the file
again, containing the same five bytes (`probe`).

This isolates an environment/filesystem problem outside Pulse's cleanup code.
It does **not** identify the restoring process or establish the mechanism.
Do not describe it as a proven late writer in the Fastly fixture, or weaken
clean-candidate verification to accommodate it.

The operational workaround is to conduct the next trials in a separate clean
checkout under `/tmp`. On the identical candidate, the full, unchanged
`fastly-native-platform-capabilities` task passed there, followed by both
production worker cleanup passes and a fresh admission check. No residual files
needed harness removal. Subsequent inspection also found the checkout clean.
This is bounded development evidence for that workaround, not a complete seal
or a guarantee that the environment cannot interfere again.

## Provenance and observations

All production-task observations used clean revision
`c8488990059e3e8834f35e1fcf9bd5d33786ddef`, tree
`ffa59287268aeec47709d0a24e64281f676b342e`, and Node 24.18.0. These documentation
files were added afterward. Existing lockfile-pinned dependencies and build
outputs were copied into the isolated checkout; absolute workspace links were
rebound locally. Worker setup and verification bind actual dependency/build
bytes. Input digests contain absolute paths and are not expected to compare
identically across checkout locations. No installation or product source change
was used to make the task pass.

[results.json](results.json) records the observations, hashes, original failure,
source and Node identities, and complete terminal task result. It retains the
following limitations explicitly:

- The first full replay reproduced residue after reported removal but also
  failed because the diagnostic driver omitted its task-log directory. It is
  failed development evidence, not a passing control.
- The deadline-only traced replay passed. Its task process observed `ENOENT`
  through exit after removing the fixture. The cleanup process later observed
  new file inode numbers with the last authored modification times. This
  supports the resurrection observation; it does not identify its writer.
- A standalone Node probe without Pulse imports reproduced resurrection in the
  original checkout. Tiny disposable Git worktrees did not reproduce it, and a
  later short observation in the original checkout also stayed clean. The
  behavior is intermittent; checkout location is a tested workaround, not a
  complete causal model.
- Syscall tracing could not start because `PTRACE_TRACEME` was denied. No
  escalation or access-control change was attempted.
- The isolated full task passed in **116.728 seconds**, including cleanup.
  Its terminal log contains all **227 transport ABI checks** and **95 deadline
  ABI cases**, in addition to the preceding platform assertions. Viceroy HTTP
  replays explicitly skipped because `PULSE_VICEROY_BIN` was unset; this is not
  provider reality evidence. Duration is not a concurrency or speedup result.

## Reproduction

[environment-probe.cjs](environment-probe.cjs) is the exact standalone probe.
Run it from a disposable Git checkout with a `wasm/` directory using the pinned
Node binary. It imports only Node built-ins. Preserve its stdout, then inspect
Git status and the printed fixture path from a subsequent invocation. The probe
removes only its own uniquely named directory; if it returns afterward, preserve
the bytes/metadata before removing that same directory. Do not run this probe
inside a qualification candidate while a trial is active.

[worker-probe.cjs](worker-probe.cjs) is the exact driver used for the passing
isolated observation:

```sh
node worker-probe.cjs /tmp/clean-pulse-checkout /absolute/new-output-directory
```

The checkout must have the exact candidate and restored dependencies/build
outputs. The driver uses the existing one-worker setup, full production task,
`runTask`, cleanup, and fresh admission verifier. It creates no checkpoints and
changes no registry selection or compiler hints. Setup/removal are not timed as
part of the task. Inspect the terminal result **and** `afterTask`,
`afterAdmission`, next-admission result, task log, and a subsequent clean Git
status; the diagnostic's top-level status alone does not certify all barriers.
The copied driver retains its measured bytes rather than retroactively changing
its status aggregation. It is not a release controller or authoritative receipt.

The successful task log is [isolated-fastly.log](isolated-fastly.log); the plain
Node probe stdout is [environment-probe.log](environment-probe.log).

## Disposition

No cleanup retry loop, ignore rule, source reset, verification bypass, scheduler
change, or configuration increase is warranted by these observations. Production
cleanup/admission correctly exposed inconsistent filesystem state. Preserve the
failed seal and failed replay as failures.

Resume #373 using one pinned, clean isolated candidate for **both** complete
2-worker/1-compiler and 2-worker/2-compiler trials, matching tool/input/runner
identities and memory limits, no checkpoints, and a sufficient deadline. Capture
complete 190 release + 11 installed task coverage, resource observations and
terminal cleanup. If files reappear there, stop and retain the failure; do not
silently retry into passing evidence. Hosted evidence remains necessary before
adopting a hosted setting. Keep **2/1**, keep #373 open, and retain its explicit
carry into #382 until the comparison is accepted.

Maintainer synchronization/check, documentation synchronization/check, and
local documentation-release validation passed. Synchronization produced no
generated changes. No new full unit/release qualification is claimed for this
documentation-only record. Human review retains merge and release authority.
