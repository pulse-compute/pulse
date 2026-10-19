# B10-MCP-04 — Package-owned Native MCP binding

Implements [#434](https://github.com/pulse-compute/pulse/issues/434) under the
frozen [B10-MCP-01 protocol](../b10-mcp-01/MCP.md). Nathan White explicitly
requested this unit. Entry point: `package-lowering`; owner: `packages/mcp`;
public documentation: `docs/packages/mcp.md`.

`@pulse-compute/mcp/pulse` binds one static local EntityRouter to a terminal
MCP request handler. The package owns admission, version negotiation, discovery,
response framing and AssemblyScript transport. Entities owns operation selection,
input/output schema execution and reachable managed handlers. Tool invocation
shares the original request, artifact, continuation and effect lifecycle. It
adds no backend HTTP hop. The old host API and root Entities JSON-RPC transport
remain available.

The declared lowerer emits a deterministic binding plan and catalog. Native
source composition uses the existing Entities compiler/runtime components and
normal package admission. Node Native and Fastly Native explicitly realize the
binding. Original-source Node JavaScript supplies differential evidence. Fastly
JavaScript does not realize the required request deadline and remains unsupported
for this binding; there is no automatic fallback.

## Necessary owner and boundary changes

- Entities: reusable original-AST composition, selected schema descriptions,
  sealed local dispatch and separated root JSON-RPC transport.
- Runtime/Native host: generic package HTTP terminal completion, bounded
  deadline shortening and sanitized body/deadline failures. Native application
  v2 and the `package_http_version` handshake fail closed on older hosts.
- Compiler: generic v2 validation; no MCP syntax branch, publisher allowlist,
  compiler-release equality requirement or example-specific dispatch.
- Providers: explicit Node/Fastly Native realization; the provider retains
  request/effect/response authority. Existing v1 package behavior is preserved.
- Packaging/release evidence: the `/pulse` facade, lowerer/source payload,
  first-party Entities/runtime dependencies, packed consumer qualification and
  existing Native/release test enrollment. Package set and version are unchanged.
- Documentation/context: canonical package and contract documentation,
  generated mirrors, and deterministic corpus/resources regenerated with the
  pinned producer. These are freshness updates, not the context application
  migration.

Public API, effect/capability, continuation runtime, lowerer trust, provider
registry, target fluidity, package publication and conservatively matched
release/deployment boundaries are declared for human review. Implementation
permission does not authorize merge, publication, deployment or approval of
these boundaries.

See [VALIDATION.md](./VALIDATION.md), [binding-proof.json](./binding-proof.json)
and [checks.json](./checks.json) for development evidence and its limits.
B10-MCP-05 still owns the actual context application migration. Installed
source-free resource acceptance, seal/recovery and real Fastly/client receipts
remain B10-MCP-07/09/10.
