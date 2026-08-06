import { EntityRouter, jsonRpc } from '@pulse-compute/entities';
import {
  badSignature,
  callbackOperation,
  crossOperationA,
  crossOperationB,
  escapeOperation,
  lookupCustomer,
  mutateInput,
  recursiveOperation,
  unresolvedReference,
  unsupportedResult,
  valueForCompletion,
} from './handlers.js';

void badSignature;
void callbackOperation;
void crossOperationA;
void crossOperationB;
void escapeOperation;
void mutateInput;
void recursiveOperation;
void unresolvedReference;
void unsupportedResult;
void valueForCompletion;

const notifySystem = (_ctx: unknown, _input: undefined) => undefined;

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
