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

## Example walkthroughs

Every runnable example below uses the shared purpose and request/response-first
layout. Code and checked Inspect/Doctor excerpts precede setup and test evidence.
Report excerpts replay completed Native build evidence, not runtime traffic.

| Example | Input | Report evidence |
|---|---|---|
| [Hello JSON](01-hello-json/README.md) | HTTP | Default Native profile |
| [Request schema](02-request-schema/README.md) | HTTP and schema errors | Default Native profile |
| [Fetch composition](03-fetch-composition/README.md) | HTTP with fetch fixtures | Default Native profile |
| [Dynamic endpoint probes](03-fetch-composition/dynamic-probes/README.md) | Bounded HTTP endpoint lists | Default Native profile |
| [Fastly capabilities](05-fastly-capabilities/README.md) | HTTP with provider fixtures | Default Native profile |
| [Opaque binary proxy](07-opaque-proxy/README.md) | HTTP with opaque response bytes | Default Native profile |
| [Router lowering](09-router-lowering/README.md) | HTTP routing and middleware | Default Native profile |
| [Entities tools facade](10-entities-tools/README.md) | JSON-RPC | Explicit `node-native` profile |
| [Static events](11-events/README.md) | HTTP and event frames | Default Native profile |
| [Pulse context MCP](12-pulse-context-mcp/README.md) | JSON-RPC and MCP walkthroughs | JavaScript-only; no Wasm Report |
| [ES256 bearer verification](13-jwt-es256/README.md) | HTTP bearer fixtures | Default Native profile |

Two other example-named directories are explicitly private test support:
`wasm/examples/assets-package-out` is a compiler/package fixture, and
`packages/mcp/examples/resource-directory` is an authorization/write-negative
fixture for `mcp-installed`. Their READMEs retain those boundaries; neither is a
public application walkthrough.
