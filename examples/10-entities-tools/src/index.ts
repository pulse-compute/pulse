import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { lookupCustomer, systemStatus } from './handlers.js'

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

export default async function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}

