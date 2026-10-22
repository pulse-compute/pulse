# `@pulse-compute/mcp`

**npm:** [`@pulse-compute/mcp`](https://www.npmjs.com/package/@pulse-compute/mcp)

`@pulse-compute/mcp` is a supported Beta extension for bounded MCP HTTP
integration, published as `1.0.0-beta.9` in the synchronized release set.
Its static binding depends on Entities and Runtime; it does not depend on the Pulse CLI or corpus.

```bash
npm install @pulse-compute/mcp@1.0.0-beta.9
```

Use matching exact versions of Pulse packages.

## Start with the Pulse context server

Use the [Pulse context example](../../examples/12-pulse-context-mcp/README.md#workflow)
from the matching CLI package. It serves five read-only tools—starter plans,
search, contract reads, maintained examples and diagnostic help—from an
immutable bundled corpus. The application uses the static `/pulse` binding and
shared `ctx.call`; select Node Native, Fastly Native or explicit Node JavaScript.
It needs no repository checkout or upstream service at runtime.

## Static Native binding

`@pulse-compute/mcp/pulse` supplies `mcp`, plus the Entities `EntityRouter` and
`jsonRpc` constructors used in its static declaration module. Select Fastly
Native for deployment; Node Native and Node JavaScript support differential
execution. Fastly JavaScript lacks the required request deadline and is rejected.

```ts
import { EntityRouter, jsonRpc, mcp } from '@pulse-compute/mcp/pulse'
import { lookup } from './operations.js'

const tools = new EntityRouter({ adapter: jsonRpc({ acceptEmptyObjectForNoInput: true }) })
tools.on('lookup', { input: 'app.LookupInput', output: 'app.LookupOutput',
  metadata: { description: 'Read one public record', mcp: { readOnlyHint: true } } }, lookup)
const server = mcp({ router: tools, path: '/mcp',
  serverInfo: { name: 'public-docs', version: '1' } })
export default async function handler(ctx: any) { return server.handle(ctx) }
```

Declare schemas through the normal project schema module. One local router,
module-level registrations, literal binding options and one direct terminal
`handle(ctx)` return are required. The compiler selects those operations and
emits `mcp-catalog.json`. MCP projects their schemas; Entities performs input
validation, operation execution and output validation inside the same request.
There is no internal HTTP hop or backend URL on this facade. The trusted
package lowerer owns its source contribution and uses the normal compiler
protocol; it has no example-specific compiler path or JavaScript fallback.

Defaults are an exact `/mcp` path, POST only, no supplied Origin, 32 KiB request,
32 levels of JSON nesting, 128 KiB protocol response, 24 KiB complete tool result
including modern metadata, and a 5,000 ms execution deadline. Limits may only be
reduced. Request byte accounting includes actual body bytes. Duplicate singleton
headers do not bypass admission. The host keeps effect and cancellation authority;
the package frames deadline/body failures as bounded MCP errors, preserving an
admitted ID. Tool results include matching JSON text and structured content.

Modern `2026-07-28` is the default. Set `legacyProtocol: '2025-06-18'` explicitly
to accept the stateless legacy initialization/ping profile. Modern headers and
metadata never fall back to legacy. Notifications return empty 202 responses
without dispatch. Origin allowlists, authorization, callbacks, dynamic registries,
SSE, sessions, prompts, and MCP Resources are outside this binding. Embedded
Pulse binary Resources are a separate application facility.

See the [Pulse context example](../../examples/12-pulse-context-mcp/README.md#workflow)
for installation, profile selection and tool requests. A local build,
actual local host execution and deployed-service acceptance remain separate
checks.

<a id="supported-host-imports"></a>

## Separate JavaScript host adapters

| Import | API | Host boundary |
| --- | --- | --- |
| `@pulse-compute/mcp` | `createMcpHttpHandler`, `PROTOCOL_VERSION`, `DEFAULT_LIMITS` | Fetch request/response adapter |
| `@pulse-compute/mcp/node` | `createMcpNodeHandler` | Node HTTP bridge |

Both CommonJS and ESM imports have TypeScript declarations. Implementation
subpaths and `package.json` are not public imports. Use these APIs in ordinary
host code outside Pulse guest handlers. The `/pulse` facade above owns Native lowering.
Node 22.14+ and Node 24 are supported.

The adapter implements bounded stateless Streamable HTTP discovery and tools.
It projects a fixed Entities catalog and schemas, admits tool input, and sends
one request to the governed JSON-RPC endpoint. The endpoint retains selection,
effects and output authority. Optional OAuth resource-server admission uses an
external authorization server and authenticated introspection; the adapter does
not issue tokens. Its fixed limits and redacted errors remain in force.

The [package contract](https://github.com/pulse-compute/pulse/blob/v1.0.0-beta.9/packages/mcp/README.md) documents construction,
limits, authorization, protocol versions and supported client qualification.
There is no stdio transport, resource/prompt API, filesystem access or execution
service in this package.
