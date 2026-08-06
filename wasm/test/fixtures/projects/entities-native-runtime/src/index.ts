import { EntityRouter, jsonRpc } from '@pulse-compute/entities';
import { lookupCustomer, notifySystem } from './handlers.js';

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true }),
});

rpc.on('customer.lookup', {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput',
  metadata: { title: 'CATALOG_ONLY_NATIVE_SENTINEL' },
}, lookupCustomer);

rpc.on('system.notify', {
  input: null,
  output: null,
}, notifySystem);

export default async function handler(ctx: any) {
  return rpc.handle(ctx);
}
