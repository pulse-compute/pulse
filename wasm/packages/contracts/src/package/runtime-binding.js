'use strict';

// Static, package-owned data. No host values, executable JS or provider paths.
const VERSION = 'pulse.package-runtime-binding.v1';
const ABI = 'pulse.package-wasm.v1';
const CAPABILITIES = Object.freeze(['http.snapshot', 'time.wall-clock', 'crypto.sha256', 'crypto.hmac-sha256']);
const MAX_WASM_BYTES = 1024 * 1024;
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw new TypeError('Invalid package runtime binding record.');
}
function identity(value) { return typeof value === 'string' && /^[a-zA-Z0-9@._/:-]{1,256}$/.test(value); }
function normalizeRuntimeBinding(value, owner) {
  record(value, ['version', 'id', 'contractId', 'package', 'kind', 'mediaType', 'data']);
  if (value.version !== VERSION || value.kind !== 'package-runtime-wasm' || value.mediaType !== 'application/wasm'
    || !identity(value.id) || !identity(value.package) || !identity(value.contractId)
    || owner && (owner.package !== value.package || owner.contractId !== value.contractId)) throw new TypeError('Invalid package runtime binding identity.');
  const data = value.data;
  record(data, ['abi', 'wasm', 'sha256', 'operations']);
  if (data.abi !== ABI || typeof data.wasm !== 'string' || data.wasm.length > Math.ceil(MAX_WASM_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.wasm)
    || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)
    || !Array.isArray(data.operations) || data.operations.length < 1 || data.operations.length > 16) throw new TypeError('Invalid package Wasm binding.');
  const names = new Set();
  const operations = data.operations.map(operation => {
    record(operation, ['name', 'configuration', 'capabilities']);
    if (!identity(operation.name) || names.has(operation.name) || typeof operation.configuration !== 'string'
      || operation.configuration.length > 8192 || !Array.isArray(operation.capabilities)
      || operation.capabilities.some(c => !CAPABILITIES.includes(c))
      || new Set(operation.capabilities).size !== operation.capabilities.length) throw new TypeError('Invalid package runtime operation.');
    names.add(operation.name);
    return Object.freeze({ name: operation.name, configuration: operation.configuration,
      capabilities: Object.freeze([...operation.capabilities].sort()) });
  });
  return Object.freeze({ ...value, data: Object.freeze({ abi: ABI, wasm: data.wasm, sha256: data.sha256, operations: Object.freeze(operations) }) });
}
function failure() { return new TypeError('Invalid package Wasm ABI or memory bound.'); }
const { createHash } = require('node:crypto');
// Inspect the actual memory section; a trusted module still must declare a
// maximum. Checking only memory size after execution would not impose a bound.
function assertMemoryBound(bytes) {
  let p = 8, memories = 0;
  const types = [], functions = [], imports = [], exports = new Map();
  function leb(end = bytes.length) { let n = 0, shift = 0; for (let i = 0; i < 5 && p < end; i++) {
    const b = bytes[p++]; n += (b & 127) * 2 ** shift; if (!(b & 128)) return n; shift += 7;
  } throw failure(); }
  function name(end) { const n = leb(end); if (p + n > end) throw failure(); const value = bytes.toString('utf8', p, p + n); p += n; return value; }
  function signatureType(end) {
    const count = leb(end), result = [];
    for (let i = 0; i < count; i++) {
      const type = bytes[p++];
      if (p > end || ![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(type)) throw failure();
      result.push(type);
    }
    return result;
  }
  while (p < bytes.length) {
    const id = bytes[p++], size = leb(), end = p + size;
    if (end > bytes.length) throw failure();
    if (id === 1) {
      const count = leb(end);
      for (let i = 0; i < count; i++) {
        if (bytes[p++] !== 0x60) throw failure();
        types.push({ parameters: signatureType(end), results: signatureType(end) });
      }
      if (p !== end) throw failure();
    }
    if (id === 2) {
      const count = leb(end);
      for (let i = 0; i < count; i++) {
        const module = name(end), field = name(end);
        if (bytes[p++] !== 0) throw failure();
        const type = leb(end); functions.push(type); imports.push({ module, name: field, type });
      }
      if (p !== end) throw failure();
    }
    if (id === 3) { const count = leb(end); for (let i = 0; i < count; i++) functions.push(leb(end)); if (p !== end) throw failure(); }
    if (id === 7) {
      const count = leb(end);
      for (let i = 0; i < count; i++) { const field = name(end), kind = bytes[p++], index = leb(end); if (kind === 0) exports.set(field, index); }
      if (p !== end) throw failure();
    }
    if (id === 5) {
      memories = leb(end); if (memories !== 1 || leb(end) !== 1) throw failure();
      const min = leb(end), max = leb(end);
      if (min > max || max > 32 || p !== end) throw failure();
    }
    p = end;
  }
  if (memories !== 1) throw failure();
  function expect(type, parameters, results) {
    const actual = types[type];
    if (!actual || JSON.stringify(actual) !== JSON.stringify({ parameters, results })) throw failure();
  }
  const i32 = 0x7f;
  for (const entry of imports) {
    if (entry.module === 'pulse_package' && entry.name === 'input_len') expect(entry.type, [i32], [i32]);
    else if (entry.module === 'pulse_package' && entry.name === 'input_read') expect(entry.type, [i32, i32, i32], [i32]);
    else if (entry.module === 'env' && entry.name === 'abort') expect(entry.type, [i32, i32, i32, i32], []);
    else throw failure();
  }
  for (const name of ['start', 'resume', 'buffer', 'capacity', 'output_ptr', 'output_len', 'aux_ptr', 'aux_len']) {
    if (!exports.has(name)) throw failure();
    expect(functions[exports.get(name)], name === 'resume' ? [i32] : [], [i32]);
  }
}
function validateRuntimeBinding(input) {
  const artifact = normalizeRuntimeBinding(input);
  const wasm = Buffer.from(artifact.data.wasm, 'base64');
  if (wasm.toString('base64') !== artifact.data.wasm
    || createHash('sha256').update(wasm).digest('hex') !== artifact.data.sha256) throw failure();
  const module = new WebAssembly.Module(wasm);
  assertMemoryBound(wasm);
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== 'function' || !(entry.module === 'pulse_package' && ['input_len', 'input_read'].includes(entry.name)
      || entry.module === 'env' && entry.name === 'abort')) throw failure();
  }
  const exports = new Map(WebAssembly.Module.exports(module).map(e => [e.name, e.kind]));
  for (const name of ['start', 'resume', 'buffer', 'capacity', 'output_ptr', 'output_len', 'aux_ptr', 'aux_len']) {
    if (exports.get(name) !== 'function') throw failure();
  }
  if (exports.get('memory') !== 'memory') throw failure();
  return { artifact, module };
}

function validateRuntimeInvocation(effect, artifacts) {
  const payload = effect.payload;
  record(payload, ['artifact', 'binding', 'operation', 'configuration']);
  if (effect.kind !== 'package.invoke' || effect.providerKind !== 'package' || effect.operation !== 'invoke'
    || effect.capability !== 'package.invoke' || effect.result !== 'string'
    || Object.keys(payload).length !== 4 || !identity(payload.artifact) || !identity(payload.binding)
    || !identity(payload.operation) || typeof payload.configuration !== 'string' || payload.configuration.length > 8192
    || effect.runtimeInputs?.length) throw new TypeError('Invalid static package runtime invocation.');
  const matches = artifacts.filter(a => a.kind === 'package-runtime-wasm' && a.id === payload.artifact
    && a.package === effect.package && a.contractId === effect.contractId);
  if (matches.length !== 1 || !matches[0].data.operations.some(o => o.name === payload.operation && o.configuration === payload.configuration)) {
    throw new TypeError('Package runtime invocation requires its exact declared artifact and operation.');
  }
  return matches[0];
}

module.exports = Object.freeze({ PACKAGE_RUNTIME_BINDING_VERSION: VERSION, PACKAGE_WASM_ABI_VERSION: ABI,
  PACKAGE_RUNTIME_HOST_CAPABILITIES: CAPABILITIES, MAX_WASM_BYTES, normalizeRuntimeBinding, validateRuntimeBinding, validateRuntimeInvocation });
