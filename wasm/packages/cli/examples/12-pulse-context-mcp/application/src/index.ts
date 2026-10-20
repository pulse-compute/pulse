import { EntityRouter, jsonRpc, mcp } from '@pulse-compute/mcp/pulse'
import type { PulseContext, PulseReadonly } from '@pulse-compute/pulse'
import type { StartInput } from './schemas.js'
import { computeStart } from './start.js'

export async function start(ctx: PulseContext, input: PulseReadonly<StartInput>) {
  return ctx.call(computeStart, input, {
    inputSchema: 'context.StartInput', outputSchema: 'context.StartOutput',
  })
}
const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on('pulse.start', {
  input: 'context.StartInput', output: 'context.StartOutput',
  metadata: {"title":"Start a Pulse project","description":"Return a Node Native or JavaScript starter plan for this exact snapshot.","mcp":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false}},
}, start)
const server = mcp({
  router: rpc,
  serverInfo: {"name":"pulse-context","version":"1.0.0-beta.9"},
  limits: {"maxRequestBytes":32768,"maxResponseBytes":131072,"maxDepth":32,"deadlineMs":5000},
})
export default async function handler(ctx: PulseContext) {
  return server.handle(ctx)
}
