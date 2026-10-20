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
  metadata: __TOOL_METADATA__,
}, start)
const server = mcp({
  router: rpc,
  serverInfo: __SERVER_INFO__,
  limits: __MCP_LIMITS__,
})
export default async function handler(ctx: PulseContext) {
  return server.handle(ctx)
}
