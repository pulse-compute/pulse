'use strict';
const { validateResourceCatalogue } = require('@pulse-compute/wasm-contracts/resources/embedded');

// Emitted only for an explicitly configured resource application. The IIFE
// releases temporary decoder strings/arrays after creating private backing.
function resourceJavascriptSource(catalogue, application, host = "require('@pulse-compute/runtime/host')") {
  validateResourceCatalogue(catalogue);
  const blobs = catalogue.blobs.map(blob => blob.data);
  const entries = catalogue.records.map(record => ({ id: record.id, index: catalogue.blobs.findIndex(blob => blob.id === record.blobId) }));
  return `\n(() => { const host = ${host}; const blobs = ${JSON.stringify(blobs)}.map(data => Uint8Array.from(atob(data), byte => byte.charCodeAt(0))); host.bindBinaryResources(${application}, host.createBinaryResourceStore(${JSON.stringify(entries)}.map(entry => ({ id: entry.id, bytes: blobs[entry.index] })))); })();\n`;
}

module.exports = { resourceJavascriptSource };
