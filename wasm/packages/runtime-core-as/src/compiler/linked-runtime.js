"use strict";
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const file = path.join(__dirname, 'fixed-memory-runtime.as.ts');
function linkedRuntime() {
  const source = fs.readFileSync(file);
  return Object.freeze({ module: file.slice(0, -3), evidence: Object.freeze({
    version: 'pulse.linked-primary-runtime.v1', owner: '@pulse-compute/wasm-runtime-core-as',
    file: 'src/compiler/fixed-memory-runtime.as.ts', bytes: source.length,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    primaryHeapStart: 540928, primaryHeapEndExclusive: 2097152,
    staticAndShadowStackEndMaximum: 524288, shadowStackBytes: 32768,
    invocationFrameExcluded: true, memoryGrow: false, bulkMemory: false,
    initialization: { version: 'pulse.primary-initialization.v1', export: '__pulse_initialize', parameters: [], results: [], oncePerInstance: true, failure: 'discard-instance' }
  }) });
}
function prepareLinkedPrimary(generated) {
  const runtime = linkedRuntime().evidence;
  const source = generated.source + `
export function __pulse_primary_layout_end(): i32 { return <i32>__heap_base }
export function __pulse_primary_runtime_identity(): string { return "${runtime.version}:${runtime.sha256}" }
`;
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
  return Object.freeze({ ...generated, source, sourceHash,
    manifest: Object.freeze({ ...generated.manifest, sourceHash, linkedRuntime: runtime }) });
}
module.exports = { linkedRuntime, prepareLinkedPrimary };
