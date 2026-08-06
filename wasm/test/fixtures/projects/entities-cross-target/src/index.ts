import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import {
  echoUnicode,
  invalidOutput,
  lookupCustomer,
  notifySystem,
} from './handlers.js'

const rpc = new EntityRouter({
  adapter: jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true }),
})

rpc.on('customer.lookup', {
  input: 'entities.LookupInput',
  output: 'entities.LookupOutput',
  metadata: { title: 'Lookup customer', tags: ['entities', 'conformance'] },
}, lookupCustomer)

rpc.on('echo.雪', {
  input: 'entities.EchoInput',
  output: 'entities.EchoOutput',
  metadata: { title: 'Unicode echo' },
}, echoUnicode)

rpc.on('invalid.output', {
  input: 'entities.InvalidOutputInput',
  output: 'entities.InvalidOutput',
}, invalidOutput)

rpc.on('system.notify', {
  input: null,
  output: null,
}, notifySystem)

export default async function handler(ctx: any) {
  return rpc.handle(ctx)
}
