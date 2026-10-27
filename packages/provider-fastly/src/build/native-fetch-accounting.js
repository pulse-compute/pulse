'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {resourceAdmission: admission} = require('@pulse-compute/wasm-contracts/provider/toolchain');
const {resourceLedgerSource} = require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native');
const REALIZATION = 'fastly.native.fetch-text.single-v1';
const fixed = (id, bytes) => ({id, kind: 'fixed', bytes, copies: 1});
function profile(plan, bindings) {
  // Prove one visit and one decode from the canonical control tree, not merely
  // the number of static effect sites. No authored accounting configuration.
  const body = plan.entry?.body, effect = plan.effects[0];
  if (plan.entry?.kind !== 'handler' || plan.handlers.length || plan.routing || plan.packages?.application
    || plan.effects.length !== 1 || effect.kind !== 'fetch' || effect.grouped || effect.decoder !== 'text'
    || body?.length !== 2 || body[0].kind !== 'effect' || body[0].effectId !== effect.id
    || body[1].kind !== 'return' || body[1].value?.name !== 'response.text'
    || body[1].value.arguments.length !== 1 || body[1].value.arguments[0].kind !== 'local'
    || body[1].value.arguments[0].id !== effect.result?.localId) return null;
  const init = effect.inputs.find(x => x.name === 'init')?.value;
  const url = effect.inputs.find(x => x.name === 'url')?.value;
  const uniqueKeys = object => object?.kind === 'object'
    && object.entries.every(x => x.kind === 'property' && x.key?.kind === 'literal' && typeof x.key.value === 'string')
    && new Set(object.entries.map(x => x.key.value)).size === object.entries.length;
  const field = name => init?.entries?.find(x => x.key?.value === name)?.value;
  const timeout = field('timeoutMs'), headers = field('headers');
  const backend = bindings.backends.find(x => x.index === 0)?.backend;
  const bound = plan.schemas?.registry?.maxBytes;
  if (url?.kind !== 'literal' || typeof url.value !== 'string' || !uniqueKeys(init)
    || init.entries.some(x => !['timeoutMs','headers'].includes(x.key?.value))
    || timeout?.kind !== 'literal' || !Number.isSafeInteger(timeout.value) || timeout.value <= 0
    || (headers && (!uniqueKeys(headers) || headers.entries.some(x => x.key?.kind !== 'literal'
      || typeof x.key.value !== 'string' || x.value?.kind !== 'literal' || typeof x.value.value !== 'string')))
    || typeof backend !== 'string' || !backend || bindings.dynamicBackends
    || !Number.isInteger(bindings.maxDurationMs) || bindings.maxDurationMs < 1 || bindings.maxDurationMs > 30000
    || !Number.isInteger(bound) || bound <= 0 || bound > 1073741823) return null;
  const encodingBytes = 3 + Buffer.byteLength(url.value) + Buffer.byteLength(backend)
    + (headers?.entries || []).reduce((n,h) => n + Buffer.byteLength(h.key.value) + Buffer.byteLength(h.value.value), 0);
  // 12 request outputs + 40 scheduler outputs + 8 clock + 8 reused body-wait
  // outputs + 32 cleanup/exit outputs. Reader payload backing is 3B+5.
  const scratchBytes = 100, readerBytes = 3 * bound + 5;
  const work = {handles:[{namespace:'http.request',count:1},{namespace:'http.body',count:2},
    {namespace:'http.pending',count:1},{namespace:'http.response',count:1}],
    allocations:[fixed('scratch',scratchBytes),fixed('encoding',encodingBytes),fixed('reader',readerBytes)],records:1,cleanupSteps:0};
  const cleanup = {handles:[],allocations:[],records:0,cleanupSteps:5};
  const exit = {handles:[{namespace:'http.response',count:1},{namespace:'http.body',count:1}],
    allocations:[fixed('error-text',64)],records:0,cleanupSteps:2};
  const required = {handles:7,backingBytes:scratchBytes+encodingBytes+readerBytes+64,records:12,cleanupSteps:7,effects:1};
  const result = admission.createPlan({version:admission.VERSION,realization:REALIZATION,
    selected:[{site:effect.id,count:1,profile:{version:admission.PROFILE_VERSION,owner:'provider-fastly',
      operation:'single-fetch-text',realization:REALIZATION,effects:1,work,cleanup,
      exclusions:['incoming-request-context','application-values','diagnostic-storage','driver-identity-storage','successful-downstream-response','allocator-metadata']}}],
    exit,occupied:Object.fromEntries(admission.DIMENSIONS.map(k=>[k,0])),limits:required});
  if (!result.admitted || Object.keys(required).some(k => result.required[k] !== required[k])) throw new Error('Fetch resource inventory drift');
  return Object.freeze({...result,encodingBytes,readerBytes,scratchBytes,storageBytes:2560,
    durationNs:bindings.maxDurationMs*1000000,selection:'canonical-single-get-text',
    executionIdentity:'private-single-invocation-wasm-instance',
    unprofiled:'other-fetch-shapes-json-repetition-groups-dynamic-inputs-and-javascript'});
}
function hooks(selected) {
  if (!selected) return [];
  const owner = 'fetch-accounting', order = 20;
  return [
    {point:'response.error',owner,order,body:'  return __fca_error()'},
    {point:'invocation.end',owner,order,body:'  __fca_cleanup(true)'}
  ];
}
function source(selected) {
  if (!selected) return '';
  return resourceLedgerSource(true) + `\nconst __FCA_BACKING:u64=${selected.required.backingBytes};\nconst __FCA_ENCODING:u64=${selected.encodingBytes};\nconst __FCA_READER:u64=${selected.readerBytes};\nconst __FCA_DURATION:u64=${selected.durationNs};\n`
    + fs.readFileSync(path.join(__dirname,'native-fetch-accounting.as.ts'),'utf8');
}
module.exports = {profile,hooks,source};
