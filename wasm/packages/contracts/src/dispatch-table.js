'use strict';

const DISPATCH_TABLE_VERSION = 'pulsewasm.dispatch-table.v1';
const DISPATCH_POLICY = Object.freeze({
  dispatchVersion: DISPATCH_TABLE_VERSION,
  routeIdField: 'runtimeId',
  routeIdShape: 'dense integer IDs assigned by flattened route order',
  handlerSlotField: 'slot',
  handlerSlotShape: 'dense integer slots assigned by deterministic handler table order',
  routeLookup: 'method bucket -> compiled path pattern -> runtimeId',
  executionModel: Object.freeze({
    normal: 'ordered middleware slots followed by terminal route handler slot',
    errors: 'ordered route error handler slots carried separately for runtime error unwinding',
    lifecycle: 'connect/disconnect slots carried separately for websocket lifecycle dispatch',
    channel: 'static channel literal or handler slot reference'
  }),
  codegen: 'metadata-only; Phase 6 does not emit AssemblyScript or Wasm code'
});

module.exports = {
  DISPATCH_TABLE_VERSION,
  DISPATCH_POLICY
};
