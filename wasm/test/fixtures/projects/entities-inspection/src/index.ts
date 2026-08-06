import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { lookupCustomer, notifySystem } from './handlers.js'

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: false }),
})

rpc.on('customer.lookup', {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput',
  metadata: { title: 'Lookup customer', tags: ['tools', 'customer'] },
}, lookupCustomer)

rpc.on('system.notify', {
  input: null,
  output: null,
  metadata: { title: 'Notify system' },
}, notifySystem)

export default async function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
