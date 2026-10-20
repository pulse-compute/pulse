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
  metadata: __TOOL_METADATA__,
}, start)
rpc.on('pulse.read', {
  input: 'context.ReadInput', output: 'context.ReadOutput',
  metadata: __READ_METADATA__,
}, read)
rpc.on('pulse.example', {
  input: 'context.ExampleInput', output: 'context.ExampleOutput',
  metadata: __EXAMPLE_METADATA__,
}, example)
rpc.on('pulse.diagnostic', {
  input: 'context.DiagnosticInput', output: 'context.DiagnosticOutput',
  metadata: __DIAGNOSTIC_METADATA__,
}, diagnostic)
const server = mcp({
  router: rpc,
  serverInfo: __SERVER_INFO__,
  limits: __MCP_LIMITS__,
})
export default async function handler(ctx: PulseContext) {
  return server.handle(ctx)
}
