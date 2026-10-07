# `@pulse-compute/mcp`

`@pulse-compute/mcp` is a supported Beta host extension for bounded MCP HTTP
integration. Its synchronized candidate version is `1.0.0-beta.7`; registry
publication awaits the [release-owner handoff](../maintainers/npm-publishing.md#mcp-package-handoff).
It has zero runtime dependencies and does not depend on the Pulse CLI or corpus.

```bash
npm install @pulse-compute/mcp@1.0.0-beta.7
```

Use this command once the candidate has been published. Before publication, use
the matching candidate registry and exact candidate versions.

## Supported host imports

| Import | API | Host boundary |
| --- | --- | --- |
| `@pulse-compute/mcp` | `createMcpHttpHandler`, `PROTOCOL_VERSION`, `DEFAULT_LIMITS` | Fetch request/response adapter |
| `@pulse-compute/mcp/node` | `createMcpNodeHandler` | Node HTTP bridge |

Both CommonJS and ESM imports have TypeScript declarations. Implementation
subpaths and `package.json` are not public imports. Use these APIs in ordinary
host code outside Pulse guest handlers; there is no Native guest lowering.
Node 22.14+ and Node 24 are supported.

The adapter implements bounded stateless Streamable HTTP discovery and tools.
It projects a fixed Entities catalog and schemas, admits tool input, and sends
one request to the governed JSON-RPC endpoint. The endpoint retains selection,
effects and output authority. Optional OAuth resource-server admission uses an
external authorization server and authenticated introspection; the adapter does
not issue tokens. Its fixed limits and redacted errors remain in force.

The [package contract](https://github.com/pulse-compute/pulse/blob/v1.0.0-beta.7/packages/mcp/README.md) documents construction,
limits, authorization, protocol versions and supported client qualification.
There is no stdio transport, resource/prompt API, filesystem access or execution
service in this package.

## Start with the Pulse context server

Copy the [Pulse context MCP example](../../examples/12-pulse-context-mcp/) from
the matching CLI package. It serves starter plans, search, contract reads,
maintained examples and diagnostic help from an immutable bundled corpus. All
Pulse dependencies use the exact synchronized candidate version. The host
composes the Node launcher and MCP bridge over loopback HTTP; it needs no
repository checkout or upstream service at runtime.

`mcp-installed` is the single mandatory release-owned installed MCP gate, kept
outside fast PR and aggregate release profiles. The generic package's selected
packed-consumer check covers exact legal files, the two exports, CommonJS/ESM
imports and TypeScript consumers. The context-app installed onboarding journey
is separately tracked by PMCP-07.
