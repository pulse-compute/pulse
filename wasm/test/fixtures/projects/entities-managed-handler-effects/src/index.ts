import { EntityRouter, jsonRpc } from '@pulse-compute/entities';
import {
  directManagedCall,
  dynamicPromise,
  lookupCustomer,
  notifySystem,
  recursiveManagedCall,
  unsupportedTypeScript,
} from './handlers.js';

void directManagedCall;
void dynamicPromise;
void recursiveManagedCall;
void unsupportedTypeScript;

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true }),
});

rpc.on('customer.lookup', {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput',
}, lookupCustomer);

rpc.on('system.notify', {
  input: null,
  output: null,
}, notifySystem);

export default async function handler(ctx: unknown) {
  return rpc.handle(ctx as never);
}
