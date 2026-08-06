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
