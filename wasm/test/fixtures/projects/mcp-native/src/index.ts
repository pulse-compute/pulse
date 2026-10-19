import { EntityRouter, jsonRpc, mcp } from '@pulse-compute/mcp/pulse'
import { lookupCustomer, systemStatus, echo, invalidOutput, localResult } from './handlers.js'

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true }),
})

rpc.on('system.status', {
  input: null,
  output: null,
  metadata: {
    title: 'Check system status',
    description: 'Checks that the governed entity request boundary is available.',
    mcp: { readOnlyHint: true },
  },
}, systemStatus)

rpc.on('customer.lookup', {
  input: 'tools.CustomerLookupInput',
  output: 'tools.CustomerLookupOutput',
  metadata: {
    title: 'Look up customer',
    description: 'Looks up one customer through the configured directory backend.',
    mcp: { readOnlyHint: true },
  },
}, lookupCustomer)

rpc.on('echo', { input: 'tools.CustomerLookupInput', output: 'tools.CustomerLookupInput', metadata: { mcp: { readOnlyHint: true } } }, echo)
rpc.on('invalid.output', { input: null, output: 'tools.CustomerLookupOutput' }, invalidOutput)
rpc.on('local.result', { input: null, output: 'tools.CustomerLookupOutput' }, localResult)

const server = mcp({ router: rpc, serverInfo: { name: 'pulse-mcp-fixture', version: '1' }, legacyProtocol: '2025-06-18' })

export default async function handler(ctx: unknown) {
  return server.handle(ctx as never)
}
