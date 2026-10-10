'use strict';

// Observational only: keep IR facts out of serialized compiler metadata, source
// and plan hashes. A deserialized/foreign metadata object supplies no evidence.
const records = new WeakMap();
function retainRouteBehavior(metadata, handlers) {
  const routes = new Set(metadata.entries.filter(row => row.kind === 'route').map(row => row.stableId));
  records.set(metadata, Object.freeze(handlers.filter(row => routes.has(row.entryStableId)).map(row => Object.freeze({
    entryId: row.entryStableId,
    kind: row.operationIr.summary.operationKinds['router-transfer'] ? 'continuing' : 'terminal',
    basis: 'canonical-handler-ir'
  }))));
}
function routeBehaviorForMetadata(metadata) { return records.get(metadata); }
module.exports = { retainRouteBehavior, routeBehaviorForMetadata };
