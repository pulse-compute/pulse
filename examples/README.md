# Pulse canonical examples

These are complete canonical projects using the conventional
`.pulse/config.ts` workspace, dedicated deterministic test harnesses,
async-shaped managed handlers, and the same `pulse` commands as a user
application. Examples 01, 02, 03, 05, 07, 11, and 13 use the project-level
`@pulse-compute/pulse` application root. Example 09 retains
`@pulse-compute/runtime` and `Router` as the explicit low-level authoring path.
Examples 10 and 12 use `@pulse-compute/entities` with external host adapters.

Enter an example directory and run its documented lifecycle:

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

Example 10 documents its JavaScript and Native entity workflows.
Example 11 runs mixed HTTP and event cases on Node JavaScript or Node Native.
Its development server remains HTTP-only; event input is available through the
bounded test/reference adapter rather than a public listener.
[Example 12](./12-pulse-context-mcp/) is a practical read-only Pulse context MCP
server. Its `npm run build` prepares the standalone host, and `npm start` serves
MCP discovery and five tools from that build. `pulse dev` serves the underlying
JSON-RPC app for development. See its README for the candidate install status.
