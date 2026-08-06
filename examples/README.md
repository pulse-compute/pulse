# Pulse canonical examples

These are complete canonical projects using the conventional
`.pulse/config.ts` workspace, dedicated deterministic test harnesses,
async-shaped managed handlers, and the same `pulse` commands as a user
application. Examples 01, 02, 03, 05, 07, 11, and 12 use the project-level
`@pulse-compute/pulse` application root. Example 09 retains
`@pulse-compute/runtime` and `Router` as the explicit low-level authoring path.
Example 10 uses `@pulse-compute/entities` with an external tools facade.

For every example except 10, enter the example directory and run:

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

From this source checkout, the equivalent root command is:

```bash
pnpm pulse -- doctor examples/01-hello-json
```

See [`../docs/examples.md`](../docs/examples.md) for the capability index.

Example 10 documents its focused entity workflow. Its gate executes
catalog discovery, governed JavaScript calls, and Native artifact compilation
without claiming that the ordinary project lifecycle integration is complete.
Example 11 runs mixed HTTP and event cases on Node JavaScript or Node Native.
Its development server remains HTTP-only; event input is available through the
bounded test/reference adapter rather than a public listener.
Example 12 is only an HTTP/JSON-RPC proxy shape: it does not claim MCP protocol
ownership, discovery, SSE, or session behavior.
