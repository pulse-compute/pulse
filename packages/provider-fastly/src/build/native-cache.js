'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resourceAdmission: admission } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { resourceLedgerSource } = require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native');
const KINDS = Object.freeze(['cache.getText', 'cache.putText']);
const IMPORTS = Object.freeze(['fastly_cache:lookup', 'fastly_cache:insert', 'fastly_cache:get_state',
  'fastly_cache:get_body', 'fastly_cache:close', 'fastly_http_body:read', 'fastly_http_body:close',
  'fastly_http_body:abandon', 'fastly_http_resp:close', 'fastly_async_io:is_ready']);
function fail(message) { throw Object.assign(new TypeError(message), { code: 'PULSE_FASTLY_CACHE_CONTRACT' }); }
function fields(value) {
  if (value?.kind !== 'object' || value.entries.some(e => e.kind !== 'property' || e.key?.kind !== 'literal' || e.value?.kind !== 'literal')) fail('Cache payload must be a literal record.');
  const pairs = value.entries.map(e => [e.key.value, e.value.value]);
  if (new Set(pairs.map(e => e[0])).size !== pairs.length) fail('Duplicate cache payload fields.');
  return Object.fromEntries(pairs);
}
function validText(s) { return typeof s === 'string' && Buffer.from(s).toString('utf8') === s; }
function profile(plan, bindings) {
  if (!plan.effects.some(e => KINDS.includes(e.kind))) return null;
  if (plan.effects.some(e => !KINDS.includes(e.kind)) || plan.effects.length > 64 || plan.entry?.kind !== 'handler'
    || plan.handlers.length || plan.routing || plan.helpers?.length || plan.stages?.length || plan.callables?.length
    || plan.packages?.application || !Number.isInteger(bindings.maxDurationMs) || bindings.maxDurationMs < 1 || bindings.maxDurationMs > 30000) fail('Cache requires a plain cache-only Native handler and the original finite request duration.');
  const seen = new Set();
  function body(statements) {
    for (const s of statements) {
      if (s.kind === 'effect') { if (seen.has(s.effectId)) fail('Repeated cache site.'); seen.add(s.effectId); }
      else if (s.kind === 'effect-group') for (const member of s.effectIds) { if (seen.has(member)) fail('Repeated cache group site.'); seen.add(member); }
      else if (!['local', 'return'].includes(s.kind)) fail('Cache control flow is not yet admitted.');
    }
  }
  body(plan.entry.body);
  if (seen.size !== plan.effects.length || plan.effects.some(e => !seen.has(e.id))) fail('Cache site inventory does not cover the canonical control tree.');
  const sites = plan.effects.map(e => {
    if (e.package !== '@pulse-compute/cache' || e.contractId !== 'pulse.cache' || e.kind !== 'cache.' + e.operation || e.capability !== e.kind) fail('Cache operation identity mismatch.');
    const p = fields(e.inputs.find(x => x.name === 'payload')?.value), put = e.kind === 'cache.putText';
    const names = put ? ['key', 'text', 'ttlMs'] : ['key', 'maxBytes'];
    if (Object.keys(p).length !== names.length || names.some(k => !Object.hasOwn(p,k)) || !validText(p.key)
      || Buffer.byteLength(p.key) < 1 || Buffer.byteLength(p.key) > 4096) fail('Invalid cache key or payload.');
    if (put ? !validText(p.text) || Buffer.byteLength(p.text) > 1048576 || !Number.isInteger(p.ttlMs) || p.ttlMs < 1 || p.ttlMs > 86400000
      : !Number.isInteger(p.maxBytes) || p.maxBytes < 1 || p.maxBytes > 1048576) fail('Invalid cache payload bound.');
    return Object.freeze({ ...p, put });
  });
  const count = sites.length, reads = sites.filter(s=>!s.put).length;
  const handles = count + reads + 2, records = handles + 5, cleanupSteps = count + 2 * reads;
  // One static ABI scratch area, exit bytes, original clock and wait outputs,
  // one readiness flag/site. Payload encodings occur only once per operation.
  const scratchBytes = 256 + 16 + count;
  const encodingBytes = sites.reduce((n,s) => n + Buffer.byteLength(s.key) + (s.put ? Buffer.byteLength(s.text) : 0), 0);
  const readerBytes = sites.reduce((n,s) => n + (s.put ? 0 : 3 * s.maxBytes + 1), 0);
  const fixed = (id,bytes) => ({id,kind:'fixed',bytes,copies:1});
  const work = {handles:[{namespace:'cache.lookup',count:sites.filter(s=>!s.put).length},
    {namespace:'http.body',count}].filter(h=>h.count>0),
    allocations:[fixed('scratch',scratchBytes),fixed('encoding',encodingBytes),fixed('reader',readerBytes)],records:1,cleanupSteps:0};
  const exit = {handles:[{namespace:'http.response',count:1},{namespace:'http.body',count:1}],allocations:[fixed('error-text',64)],records:0,cleanupSteps:2};
  const limits = {handles,backingBytes:scratchBytes+encodingBytes+readerBytes+64,records,cleanupSteps:cleanupSteps+2,effects:count};
  const realization = 'fastly.native.cache.v1';
  const result = admission.createPlan({version:admission.VERSION,realization,selected:[{site:'cache-invocation',count:1,profile:{version:admission.PROFILE_VERSION,owner:'provider-fastly',operation:'bounded-cache-invocation',realization,effects:count,work,cleanup:{handles:[],allocations:[],records:0,cleanupSteps},exclusions:['application-values','result-records-and-serialization','incoming-request-context','driver-identity-storage','successful-downstream-response','allocator-metadata','host-memory']}}],exit,occupied:Object.fromEntries(admission.DIMENSIONS.map(k=>[k,0])),limits});
  if (!result.admitted || admission.DIMENSIONS.some(k=>result.required[k]!==limits[k])) fail('Cache resource profile drift.');
  // Literal payloads are deliberately absent from the public resource report.
  return { ...result, selection:'canonical-cache-only', count, cleanupSteps, scratchBytes, encodingBytes, readerBytes,
    storageBytes:1024+128*records,durationNs:bindings.maxDurationMs*1000000,
    executionIdentity:'private-single-invocation-wasm-instance', sites };
}
function report(p) { if (!p) return p; const { sites, ...result } = p; return Object.freeze(result); }
function imports(plan) {
  if (!plan.effects.some(e=>KINDS.includes(e.kind))) return [];
  const read=plan.effects.some(e=>e.kind==='cache.getText'),write=plan.effects.some(e=>e.kind==='cache.putText');
  return IMPORTS.filter(x=>x==='fastly_cache:insert'?write:x.startsWith('fastly_cache:')||x==='fastly_http_body:read'||x==='fastly_async_io:is_ready'?read:x==='fastly_http_body:abandon'?write:true);
}
function hooks(p) { return p ? [
  {point:'response.error',owner:'cache-accounting',order:20,body:'return __cache_error();'},
  {point:'invocation.end',owner:'cache-accounting',order:20,body:'__cache_cleanup(true);'}
] : []; }
function source(p) {
  if (!p) return '';
  const chooser=(name,type,values)=>`function __cache_${name}(index:i32):${type}{switch(index){${values.map((v,i)=>`case ${i}:return ${typeof v==='string'?JSON.stringify(v):v};`).join('')}}unreachable();return ${type==='string'?'\"\"':type==='bool'?'false':'0'};}`;
  let cursor=0;const slots=p.sites.map(s=>{const slot=cursor;cursor+=s.put?1:2;return slot;});
  const namespaces=p.sites.flatMap(s=>s.put?[3]:[5,3]).concat([2,3]);
  return resourceLedgerSource(true) + `\nconst __CACHE_COUNT:i32=${p.count},__CACHE_HANDLES:i32=${p.required.handles},__CACHE_RECORDS:i32=${p.required.records};
const __CACHE_BACKING:u64=${p.required.backingBytes},__CACHE_SCRATCH:u64=${p.scratchBytes},__CACHE_ENCODING:u64=${p.encodingBytes},__CACHE_READER:u64=${p.readerBytes},__CACHE_DURATION:u64=${p.durationNs};
const __CACHE_STORAGE:u32=${p.storageBytes};
const __CACHE_STEPS:i32=${p.cleanupSteps};
const __CACHE_READS:bool=${p.sites.some(s=>!s.put)},__CACHE_WRITES:bool=${p.sites.some(s=>s.put)};\n` +
    chooser('slot','i32',slots) + chooser('ns','u32',namespaces) + chooser('writer_slot','bool',p.sites.flatMap(s=>s.put?[true]:[false,false]).concat([false,false])) +
    chooser('put','bool',p.sites.map(s=>s.put)) + chooser('key','string',p.sites.map(s=>s.key)) + chooser('text','string',p.sites.map(s=>s.text||'')) +
    chooser('bound','i32',p.sites.map(s=>s.maxBytes||0)) + chooser('ttl','u64',p.sites.map(s=>(s.ttlMs||0)*1000000)) +
    fs.readFileSync(path.join(__dirname,'native-cache.as.ts'),'utf8');
}
module.exports = {KINDS,IMPORTS,profile,report,imports,hooks,source};
