'use strict';
const runtime = require('@pulse-compute/runtime/host');
const { validateResourceCatalogue } = require('@pulse-compute/wasm-contracts/resources/embedded');
const stores = new WeakMap();
function bindBinaryResourceCatalogue(catalogue, application) {
  let store = stores.get(catalogue);
  if (!store) {
    validateResourceCatalogue(catalogue);
    const bytes = new Map(catalogue.blobs.map(blob => [blob.id, Uint8Array.from(Buffer.from(blob.data, 'base64'))]));
    store = runtime.createBinaryResourceStore(catalogue.records.map(record => ({ id: record.id, bytes: bytes.get(record.blobId) })));
    stores.set(catalogue, store);
  }
  runtime.bindBinaryResources(application, store);
}
module.exports = { bindBinaryResourceCatalogue };
