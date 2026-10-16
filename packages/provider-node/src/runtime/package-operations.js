'use strict';

const { timingSafeEqual } = require('node:crypto');
const { validateRuntimeBinding: validateRuntimeArtifact, validateRuntimeInvocation } = require('@pulse-compute/wasm-contracts/package/runtime-binding');
const snapshots = new WeakMap();
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const MAX_BYTES = 65536, MAX_MEMORY = 32 * 65536;
function failure(code = 'PULSE_PACKAGE_OPERATION_FAILED') {
  const error = new Error('Package operation could not complete.'); error.code = code; return error;
}
function active(options) {
  options.requestBudget?.check();
  if (options.signal?.aborted) throw options.signal.reason || failure('PULSE_REQUEST_CANCELLED');
}
function dataRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw failure('PULSE_PACKAGE_BINDING_INVALID');
}
function text(value, max = 512) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[^\x20-\x7e]/.test(value)) throw failure('PULSE_PACKAGE_BINDING_INVALID');
  return value;
}
function normalizePackageBindings(input = {}) {
  dataRecord(input, Object.keys(input));
  if (Object.keys(input).length > 32) throw failure('PULSE_PACKAGE_BINDING_INVALID');
  const result = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    text(name, 128);
    dataRecord(value, ['package', 'contractId', 'artifact', 'operations', 'secret', 'keyId', 'keyVersion', 'trustDomain', 'origin']);
    if (!Array.isArray(value.operations) || !value.operations.length || value.operations.length > 16
      || new Set(value.operations).size !== value.operations.length) throw failure('PULSE_PACKAGE_BINDING_INVALID');
    const origin = new URL(text(value.origin));
    if (origin.protocol !== 'https:' || origin.origin !== value.origin) throw failure('PULSE_PACKAGE_BINDING_INVALID');
    result[name] = Object.freeze({ package: text(value.package, 256), contractId: text(value.contractId, 256),
      artifact: text(value.artifact, 256), operations: Object.freeze(value.operations.map(v => text(v, 128))),
      secret: text(value.secret, 256), keyId: text(value.keyId), keyVersion: text(value.keyVersion),
      trustDomain: text(value.trustDomain), origin: origin.origin });
  }
  return Object.freeze(result);
}

function validatePackageOperations(metadata, bindings) {
  for (const effect of metadata.providerOperations || []) {
    if (effect.capability !== 'package.invoke') continue;
    const binding = bindings?.packages?.[effect.payload?.binding];
    if (!binding || binding.package !== effect.package || binding.contractId !== effect.contractId
      || binding.artifact !== effect.payload.artifact || !binding.operations.includes(effect.payload.operation)) {
      throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
    }
  }
}

// Host-only capture: consume no stream here. Transport supplies exact, already
// bounded content bytes. Never derive an original target from a Web Request.
function capturePackageHttp(input, options = {}) {
  const origin = new URL(text(options.origin));
  if (origin.protocol !== 'https:' || origin.origin !== options.origin
    || !['inbound', 'outbound'].includes(options.direction)) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
  const method = text(input.method, 32), target = text(input.target, 16384);
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method) || !target.startsWith('/') || target.startsWith('//')
    || /[#\\\s]/.test(target)) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
  if (!Array.isArray(input.headers) || input.headers.length > 128
    || !(input.body instanceof Uint8Array) || input.body.length > MAX_BYTES) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
  const headers = []; let size = 0;
  for (const pair of input.headers) {
    if (!Array.isArray(pair) || pair.length !== 2) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
    const name = text(pair[0], 256), value = pair[1];
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || value.length > 16384
      || /[^\x09\x20-\x7e]/.test(value)) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
    size += name.length + value.length;
    if (size > 131072) throw failure('PULSE_PACKAGE_SNAPSHOT_INVALID');
    headers.push(Object.freeze([name, value]));
  }
  const handle = Object.freeze({});
  snapshots.set(handle, { method, target, origin: origin.origin, authority: origin.host, scheme: 'https',
    headers: Object.freeze(headers), body: new Uint8Array(input.body), direction: options.direction,
    signal: options.signal, closed: false });
  return handle;
}
function closePackageHttp(handle) {
  const value = snapshots.get(handle);
  if (value) { value.closed = true; value.body.fill(0); snapshots.delete(handle); }
}
function headerBytes(headers) {
  // LE u32 count followed by LE length + ASCII name, length + ASCII value.
  const parts = []; let size = 4;
  for (const pair of headers) for (const value of pair) { const b = enc.encode(value); parts.push(b); size += 4 + b.length; }
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); view.setUint32(0, headers.length, true);
  let pos = 4;
  for (const part of parts) { view.setUint32(pos, part.length, true); pos += 4; bytes.set(part, pos); pos += part.length; }
  return bytes;
}

async function executePackageOperation(effect, options = {}, secretLookup) {
  active(options);
  let instance, key, inputs, hostResult, output;
  try {
    if (effect.kind !== 'package.invoke' || effect.providerKind !== 'package' || effect.operation !== 'invoke'
      || effect.capability !== 'package.invoke' || effect.result !== 'string') throw failure();
    const payload = effect.payload;
    dataRecord(payload, ['artifact', 'binding', 'operation', 'configuration']);
    if (Object.keys(payload).length !== 4) throw failure();
    const bindings = normalizePackageBindings(options.packageBindings);
    const binding = bindings[payload.binding];
    if (!binding || binding.package !== effect.package || binding.contractId !== effect.contractId
      || binding.artifact !== payload.artifact || !binding.operations.includes(payload.operation)) throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
    const matches = (options.packageArtifacts || []).filter(a => a.id === binding.artifact && a.package === binding.package && a.contractId === binding.contractId);
    if (matches.length !== 1) throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
    validateRuntimeInvocation(effect, matches);
    const { artifact, module } = validateRuntimeArtifact(matches[0]);
    const operation = artifact.data.operations.find(o => o.name === payload.operation);
    if (!operation || operation.configuration !== payload.configuration) throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
    const handle = snapshots.has(options.packageHttp) ? options.packageHttp
      : Object.getOwnPropertyDescriptor(options.packageHttp || {}, payload.binding)?.value;
    const snapshot = snapshots.get(handle);
    if (!snapshot || snapshot.closed || snapshot.signal?.aborted || snapshot.origin !== binding.origin) throw failure('PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE');
    const now = (options.packageWallClock || (() => Math.floor(Date.now() / 1000)))();
    if (!Number.isSafeInteger(now) || now < 0 || now > 999999999999999) throw failure();
    inputs = [enc.encode(operation.configuration), enc.encode(operation.name), enc.encode('{}'),
      enc.encode(snapshot.method), enc.encode(snapshot.target), enc.encode(snapshot.scheme), enc.encode(snapshot.authority),
      headerBytes(snapshot.headers), new Uint8Array(snapshot.body), enc.encode(String(now)),
      enc.encode(binding.keyId), enc.encode(binding.keyVersion), enc.encode(binding.trustDomain), enc.encode(snapshot.direction)];
    const allowed = new Set(operation.capabilities);
    function permitted(index) {
      return index <= 2 || index >= 3 && index <= 8 && allowed.has('http.snapshot')
        || index === 9 && allowed.has('time.wall-clock') || index >= 10 && index <= 12 && allowed.has('crypto.hmac-sha256')
        || index === 13 && allowed.has('http.snapshot');
    }
    function memoryRange(ptr, length) {
      const memory = instance.exports.memory;
      if (!Number.isSafeInteger(ptr) || !Number.isSafeInteger(length) || ptr < 0 || length < 0
        || ptr + length > memory.buffer.byteLength || memory.buffer.byteLength > MAX_MEMORY) throw failure();
      return new Uint8Array(memory.buffer, ptr, length);
    }
    const imports = { env: { abort() { throw failure(); } }, pulse_package: {
      input_len(index) { if (!permitted(index) || !inputs[index]) return -1; return inputs[index].length; },
      input_read(index, ptr, capacity) {
        if (!permitted(index) || !inputs[index] || capacity < inputs[index].length) return -1;
        memoryRange(ptr, inputs[index].length).set(inputs[index]); return inputs[index].length;
      },
    } };
    instance = new WebAssembly.Instance(module, imports);
    if (instance.exports.capacity() < 65536 || instance.exports.capacity() > 262144) throw failure();
    let status = instance.exports.start();
    for (let count = 0; count <= 4; count++) {
      active(options);
      if (snapshot.closed || snapshot.signal?.aborted) throw failure('PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE');
      const size = instance.exports.output_len();
      if (size < 0 || size > MAX_BYTES) throw failure();
      output = new Uint8Array(memoryRange(instance.exports.output_ptr(), size));
      if (status === 0) return dec.decode(output);
      if (count === 4 || ![1, 2, 3].includes(status)) throw failure();
      const algorithm = status === 1 ? 'SHA-256' : 'HMAC-SHA256';
      if (!allowed.has(status === 1 ? 'crypto.sha256' : 'crypto.hmac-sha256')) throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
      const expected = options.cryptoTarget === 'javascript' ? 'runtime-builtin' : 'guest-source:pulse-hmac-as';
      if (!options.cryptoRealization?.algorithms?.some(a => a.algorithm === algorithm && a.available && a.realization === expected)) throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
      const crypto = options.cryptoVerifier?.bytes;
      if (status === 1) hostResult = await crypto.sha256(output);
      else {
        if (!key) {
          if (typeof secretLookup !== 'function') throw failure('PULSE_PACKAGE_CAPABILITY_UNAVAILABLE');
          const value = await secretLookup(binding.secret);
          active(options);
          if (snapshot.closed || snapshot.signal?.aborted) throw failure('PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE');
          // Host binding bytes use the existing secret string contract (UTF-8).
          if (typeof value !== 'string' || value.length > 4096) throw failure();
          key = enc.encode(value);
          if (key.length < 32 || key.length > 4096) throw failure();
        }
        hostResult = await crypto.hmacSha256(key, output);
        if (!(hostResult instanceof Uint8Array) || hostResult.length !== 32) throw failure();
        if (status === 3) {
          if (instance.exports.aux_len() !== 32) throw failure();
          const tag = memoryRange(instance.exports.aux_ptr(), 32);
          const valid = timingSafeEqual(hostResult, tag); hostResult.fill(0);
          hostResult = Uint8Array.of(valid ? 1 : 0);
        }
      }
      output.fill(0); active(options);
      if (snapshot.closed || snapshot.signal?.aborted) throw failure('PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE');
      if (!(hostResult instanceof Uint8Array) || hostResult.length !== (status === 3 ? 1 : 32)) throw failure();
      memoryRange(instance.exports.buffer(), hostResult.length).set(hostResult);
      const length = hostResult.length; hostResult.fill(0); hostResult = undefined;
      status = instance.exports.resume(length);
    }
    throw failure();
  } catch (error) {
    active(options);
    throw failure(['PULSE_PACKAGE_CAPABILITY_UNAVAILABLE', 'PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE'].includes(error.code) ? error.code : undefined);
  } finally {
    key?.fill(0); if (hostResult instanceof Uint8Array) hostResult.fill(0);
    output?.fill(0); inputs?.forEach(v => v.fill(0));
    if (instance) new Uint8Array(instance.exports.memory.buffer).fill(0);
  }
}
function capturePackageRequest(request, body, options = {}) {
  const bindings = normalizePackageBindings(options.packageBindings);
  const handles = Object.create(null);
  try {
    const headers = require('../javascript/node-adapter.js').nodeRequestHeaderPairs(request);
    for (const [name, binding] of Object.entries(bindings)) {
      handles[name] = capturePackageHttp({ method: request.method, target: request.url, headers,
        body: body || new Uint8Array() }, { origin: binding.origin, direction: 'inbound', signal: options.signal });
    }
  } catch (error) { Object.values(handles).forEach(closePackageHttp); throw error; }
  return Object.freeze({ version: 'pulse.provider-package-http.v1', options: Object.freeze({ packageHttp: Object.freeze(handles) }),
    close() { Object.values(handles).forEach(closePackageHttp); } });
}
module.exports = Object.freeze({ capturePackageRequest, normalizePackageBindings, capturePackageHttp, closePackageHttp,
  validateRuntimeArtifact, validatePackageOperations, executePackageOperation });
