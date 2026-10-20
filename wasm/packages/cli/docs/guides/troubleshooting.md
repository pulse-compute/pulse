# Troubleshooting

Start with the command that owns the workflow:

```bash
pulse doctor --json
```

Then use:

```bash
pulse inspect --json
```

The diagnostic `code` is the stable diagnostic code and identifier. `category`, `remediation`, and `docs` are included in CLI JSON, failed doctor checks, configured expected test errors, and local development error responses.

See [Managed handler TypeScript and
JavaScript](../reference/handler-authoring.md) for source-form boundaries and
the [compatibility matrix](../reference/compatibility-matrix.md) for
target-selection boundaries, then use the [diagnostics
reference](../reference/diagnostics.md) for exit codes and common failures.

## Reading command results

Capture the exit status, stdout and stderr separately. With `--json`, completed
results normally go to stdout; command-level diagnostic failures go to stderr.
For example, a missing project produces `PULSE_CONFIG_NOT_FOUND` on stderr with
exit 2, and a missing report produces `PULSE_REPORT_EVIDENCE_MISSING` with exit 3.
An empty stdout is not a successful empty result. A completed doctor audit can
also contain failed checks and exit 1; inspect its `summary` and `checks`.
`pulse dev --json` is a stream of individual events, not one JSON document.

| Observation | What it establishes | What to do next |
|---|---|---|
| `--plan` or `--dry-run` succeeds | Command intent and project selection resolved; the command did not execute. | Run the intended command when its side effects are wanted. |
| `doctor` passes | The selected audit checks passed; warnings may remain unless `--strict` is used. | Read warnings, then run the relevant tests and build. |
| `inspect` succeeds | Inspection completed for the selected target. | Check project eligibility and capabilities; advisory Native failure does not select a fallback. |
| Tests pass | The selected cases passed through their configured execution path. | Verify case coverage; external service health and deployment remain separate. |
| `report` succeeds | Required retained evidence is eligible for reporting. | Read unavailable/unknown evidence and coverage; report success is not a release seal. |

For project commands, verify the resolved root, configuration file and profile.
Use an explicit directory and `--profile` when needed; profile precedence is the
flag, then `PULSE_PROFILE`, then the configured default. Recover from a discovery
error by correcting that selection, not by creating a second configuration in an
unrelated directory.

For a missing or stale report, build or compile the intended Native profile and
retry; reporting never builds automatically. `report --artifact` reads retained
artifact evidence without loading project code, whereas project inspection and
doctor compile source and may invoke trusted toolchains. Neither a successful
report nor a version string establishes freshness of a different checkout.

### Agent evidence status

Use `--evidence-status` on `init`, `doctor`, `inspect`, `test`, `compile`,
`build` or `report` for one `pulse.command-evidence` JSON object with
`presentationVersion: 1`. The flag implies JSON output; adding `--json` is
redundant. It cannot be combined with `--html` and does not apply to the
`dev` event stream. Existing output without this flag is unchanged.

```bash
pulse compile --plan --evidence-status
pulse report --evidence-status
pulse report --artifact ./dist/pulse-compile.json --evidence-status
```

The envelope contains `command`, `cliVersion`, `outcome`, `exitCode`,
`evidence` and the original command JSON in `result`. For reports, `result`
is the authoritative report v1 capsule, with its original evidence hash.
The projection is outside that capsule and its hash; it is an interpretation
of this invocation, not another signed receipt or a replacement integrity check.
To save a replayable capsule, use `report --json` or save only `result`.

| Field/value | Interpretation |
|---|---|
| `outcome: planned` | Resolution succeeded with `--plan`/`--dry-run`; no command execution or report validation occurred. |
| `outcome: completed` | This command completed with exit 0. It does not establish complete coverage or qualification. |
| `outcome: failed` | Read `exitCode` and the original `result`. Completed failed audits/tests remain on stdout with exit 1; thrown diagnostics remain on stderr, including usage exit 2 and report evidence exit 3. |
| `evidence.state: verified-completed-artifact` | The report owner admitted the completion marker, required evidence and Wasm bytes through existing integrity checks. |
| `evidence.state: historical-capsule` | The saved capsule passed schema, identity and evidence-hash checks. Referenced artifact bytes were not checked by this replay. |
| `evidence.state: missing`, `invalid`, `stale`, `incompatible` | Existing public report diagnostics rejected the evidence. No rejected identity is promoted into the projection. |
| `evidence.state: not-collected` | No report evidence was admitted by this command. A successful build, compile or `inspect --artifact` is not a report verification. Use `report` for that check. |
| `evidence.snapshot: current-inputs-matched` | Retained project inputs, profile and recipe matched during this invocation. This is not an ongoing freshness promise. |
| `evidence.snapshot: current-project-unchecked` | Completed artifact replay verified retained evidence without comparing the current project. |
| `evidence.snapshot: historical` | Historical replay; no current-project comparison, regardless of timestamps or source identity fields. |
| `evidence.snapshot: not-checked` | No freshness claim is available, including after failure. |

`evidence.identity` reuses the capsule hash, build evidence ID, primary artifact
ID/hash/bytes/stage, artifact count and selected context. It is `null` when
evidence was not admitted. `artifactBytes` distinguishes `verified` from
`not-checked`; capsule integrity alone does not verify retained Wasm files.

`evidence.source` reports `revision`, `dirty` and `sourceFingerprint` separately
as `{ state, value }`. A recorded value is `available`; null is `unknown`.
In particular, `dirty: false` is available evidence, while null is not a clean
checkout. These fields describe the recorded source, not the current checkout.
The projection never consults Git or replaces null with an inferred value.

`evidence.coverage.inventory` preserves each inventory's status, observed and
expected counts and reason, including partial resources and implementations.
Absent optional inventories/analytics are `unavailable`, with null counts and
reason `not-recorded`; absence is not zero or complete. The bounded analytics
summary covers handlers, registrations, use sites and helper calls.
`measurements` counts recorded facts by availability and exact/bounded/partial
coverage; it does not add byte values or invent missing measurements. A zero
recorded count does not establish an empty measurement universe. Missing
optional sidecars remain explicit. Read `result` for individual facts, reasons,
evidence scopes and any additional coverage dimensions. Coverage is null when
no report evidence was admitted.

`qualification: not-established-by-this-projection` applies even when every
recorded inventory is complete. Command success and retained build evidence do
not establish complete implementation, runtime/provider acceptance, external
service health, deployment or a release seal. Existing scoped evidence inside
the result remains available for separate review.

## Compilation failures

Read nested diagnostics under `error.diagnostics`. Fix the first concrete source/schema diagnostic rather than the top-level `PULSE_PROJECT_COMPILE_FAILED` wrapper. A Native eligibility failure never causes an automatic JavaScript retry; select a JavaScript profile deliberately only when that is the intended target.

## Provider failures

Use `pulse inspect --json` to compare compiler requirements with provider bindings. Fastly Native builds realize compact direct-host-ABI Wasm, while Fastly JavaScript builds produce a distinct source/deployment closure. External Fastly reality execution still requires the Fastly CLI and remains a separate environment-dependent gate. See [Fastly deployment candidates](./deploying-fastly.md).

## Runtime failures

Use a configured `pulse test` case to reproduce schema errors, fetch failures, and timeout behavior without relying on a live origin.

## Event eligibility and harness failures

Use `pulse inspect --json` to compare event registrations and emission
callsites with `events.targetSupport`. Node JavaScript and Native expose the
bounded reference adapter; Fastly event projects fail before output with
`PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED` or
`PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED`. Pulse will not translate the event plane
through HTTP or GRIP and will not switch targets.

For `PULSE_TEST_EVENT_INVALID`, check the explicit `kind: 'event'`
discriminant, use exactly one `schema` field, include payload only for a
non-null schema, and keep `expect.emitted` as an ordered array. See [Static
events and outbound emission](./events.md).
