import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { start, search, read, example, explainDiagnostic } from './handlers.js'

const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on('pulse.start', { input: 'context.StartInput', output: 'context.StartOutput', metadata: {
  title: 'Start a Pulse project', description: 'Plan a json-api, schema-api, fetch-api or router-api for node/native or node/javascript. Version must match the bundled snapshot. Returns context only.',
  mcp: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
} }, start)
rpc.on('pulse.search', { input: 'context.SearchInput', output: 'context.SearchOutput', metadata: {
  title: 'Search Pulse context', description: 'Deterministic lexical search; query at most 256 UTF-8 bytes, at most five results. Optional category and paired provider/target filters; offset continues the same query/version.',
  mcp: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
} }, search)
rpc.on('pulse.read', { input: 'context.ReadInput', output: 'context.ReadOutput', metadata: {
  title: 'Read a Pulse contract', description: 'Read one bundled corpus ID with citations. Offset is a UTF-16 position returned by nextOffset, never a filesystem path or URL.',
  mcp: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
} }, read)
rpc.on('pulse.example', { input: 'context.ExampleInput', output: 'context.ExampleOutput', metadata: {
  title: 'Retrieve a Pulse example', description: 'Retrieve one of 01-hello-json, 02-request-schema, 03-fetch-composition or 09-router-lowering. Optional files are exact corpus IDs from availableIds. Up to five whole records per page; offset continues the selected list.',
  mcp: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
} }, example)
rpc.on('pulse.explain_diagnostic', { input: 'context.DiagnosticInput', output: 'context.DiagnosticOutput', metadata: {
  title: 'Explain a Pulse diagnostic', description: 'Explain one exact public diagnostic code from this snapshot and suggest local checks. Does not run doctor or inspect a client project.',
  mcp: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
} }, explainDiagnostic)

export default function handler(ctx: unknown) { return rpc.handle(ctx as never) }
