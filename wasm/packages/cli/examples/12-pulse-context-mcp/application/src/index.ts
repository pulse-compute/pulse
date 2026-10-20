import { EntityRouter, jsonRpc, mcp } from '@pulse-compute/mcp/pulse'
import type { PulseContext, PulseReadonly } from '@pulse-compute/pulse'
import type { StartInput, ReadInput, ExampleInput, DiagnosticInput } from './schemas.js'
import { computeStart } from './start.js'
import { computeRead } from './read.js'
import { computeExample } from './example.js'
import { computeDiagnostic } from './diagnostic.js'

export async function start(ctx: PulseContext, input: PulseReadonly<StartInput>) {
  return ctx.call(computeStart, input, {
    inputSchema: 'context.StartInput', outputSchema: 'context.StartOutput',
  })
}
export async function read(ctx: PulseContext, input: PulseReadonly<ReadInput>) {
  return ctx.call(computeRead, input, {
    inputSchema: 'context.ReadInput', outputSchema: 'context.ReadOutput',
  })
}
export async function example(ctx: PulseContext, input: PulseReadonly<ExampleInput>) {
  return ctx.call(computeExample, input, {
    inputSchema: 'context.ExampleInput', outputSchema: 'context.ExampleOutput',
  })
}
export async function diagnostic(ctx: PulseContext, input: PulseReadonly<DiagnosticInput>) {
  return ctx.call(computeDiagnostic, input, {
    inputSchema: 'context.DiagnosticInput', outputSchema: 'context.DiagnosticOutput',
  })
}
const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on('pulse.start', {
  input: 'context.StartInput', output: 'context.StartOutput',
  metadata: {"title":"Start a Pulse project","description":"Return a Node Native or JavaScript starter plan for this exact snapshot.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, start)
rpc.on('pulse.read', {
  input: 'context.ReadInput', output: 'context.ReadOutput',
  metadata: {"title":"Read a Pulse contract","description":"Read one cited corpus ID; continue with the returned UTF-16 nextOffset.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, read)
rpc.on('pulse.example', {
  input: 'context.ExampleInput', output: 'context.ExampleOutput',
  metadata: {"title":"Retrieve a Pulse example","description":"Retrieve maintained starter files by exact corpus ID, with pagination.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, example)
rpc.on('pulse.diagnostic', {
  input: 'context.DiagnosticInput', output: 'context.DiagnosticOutput',
  metadata: {"title":"Explain a Pulse diagnostic","description":"Explain an exact diagnostic with citations and suggested local checks.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, diagnostic)
const server = mcp({
  router: rpc,
  serverInfo: {"name":"pulse-context","version":"1.0.0-beta.9"},
  limits: {"maxRequestBytes":32768,"maxResponseBytes":131072,"maxDepth":32,"deadlineMs":5000},
})
export default async function handler(ctx: PulseContext) {
  return server.handle(ctx)
}
