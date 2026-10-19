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
