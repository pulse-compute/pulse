'use strict';
// Trusted provider profile producer. Selection follows the existing canonical
// forwarding validator; no authored profile, test limit or emitter callback.
const fs = require('node:fs');
const path = require('node:path');
const { resourceAdmission: admission } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { resourceLedgerSource } = require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native');
const REALIZATION = 'fastly.native.forwarding.fixed-v1';
const empty = () => ({ handles: [], allocations: [], records: 0, cleanupSteps: 0 });
const fixed = (id, bytes) => ({ id, kind: 'fixed', bytes, copies: 1 });
function profile(plan, bindings) {
  if (!plan.capabilities.includes('request.body.forward')) return null;
  const effect = plan.effects[0];
  const init = effect.inputs.find(x => x.name === 'init').value;
  const headers = init.entries.find(x => x.key.value === 'headers')?.value.entries || [];
  const url = effect.inputs.find(x => x.name === 'url').value;
  const backend = bindings.backends.find(x => x.index === 0)?.backend;
  if (plan.effects.length !== 1 || effect.grouped || url.kind !== 'literal' || typeof url.value !== 'string'
    || typeof backend !== 'string' || !backend || !Number.isInteger(bindings.maxDurationMs)
    || bindings.maxDurationMs < 1 || bindings.maxDurationMs > 30000) throw new TypeError('Unproved forwarding accounting profile');
  const encodingBytes = Buffer.byteLength(url.value) + Buffer.byteLength(backend)
    + headers.reduce((n, h) => n + Buffer.byteLength(h.key.value) + Buffer.byteLength(h.value.value), 0);
  const work = { handles: [{namespace:'http.request',count:2},{namespace:'http.body',count:4},
    {namespace:'http.pending',count:1},{namespace:'http.response',count:2}],
    allocations: [fixed('scratch',33920),fixed('encoding',encodingBytes)], records:1, cleanupSteps:0 };
  const cleanup = {...empty(),cleanupSteps:10};
  const exit = { handles:[{namespace:'http.response',count:1},{namespace:'http.body',count:1}],
    allocations:[fixed('error-text',64)],records:0,cleanupSteps:2 };
  const required = {handles:11,backingBytes:33984+encodingBytes,records:15,cleanupSteps:12,effects:1};
  const result = admission.createPlan({version:admission.VERSION,realization:REALIZATION,
    selected:[{site:'forward',count:1,profile:{version:admission.PROFILE_VERSION,owner:'provider-fastly',
      operation:'bounded-forward',realization:REALIZATION,effects:1,work,cleanup,
      exclusions:['request-context','value-wrappers','diagnostic-storage','driver-identity-storage','non-forwarding-driver-responses']}}],
    exit,occupied:Object.fromEntries(admission.DIMENSIONS.map(k=>[k,0])),limits:required});
  if (!result.admitted || Object.keys(required).some(k=>result.required[k]!==required[k])) throw new Error('Forwarding resource inventory drift');
  const storageBytes = 1024 + result.required.records * 128;
  if (storageBytes > 2147483647 || !Number.isSafeInteger(encodingBytes)) throw new RangeError('Forwarding resource representation');
  return Object.freeze({ ...result, encodingBytes, storageBytes, durationNs:bindings.maxDurationMs*1000000,
    selection:'canonical-terminal-forwarding', executionIdentity:'private-single-invocation-wasm-instance',
    unprofiled:'general-fetch-decoding-cache-composition-and-javascript' });
}
function source(selected) {
  if (!selected) return '';
  return resourceLedgerSource(true) + `\nconst __FRA_ENCODING: u64 = ${selected.encodingBytes};\nconst __FRA_BACKING: u64 = ${selected.required.backingBytes};\nconst __FRA_STORAGE: u32 = ${selected.storageBytes};\nconst __FRA_DURATION: u64 = ${selected.durationNs};\n`
    + fs.readFileSync(path.join(__dirname,'native-forwarding-accounting.as.ts'),'utf8');
}
module.exports = { profile, source };
