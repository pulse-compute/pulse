'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const stores = new WeakMap();
const views = new WeakMap();
const executions = new WeakMap();
const applications = new WeakMap();
function fail(reason) {
  throw new PulseRuntimeContractError('PULSE_BINARY_RESOURCE_INVALID', `Binary resource ${reason}.`);
}

// Trusted host construction. Copy each backing once, never expose its buffer.
// Build tooling validates content identity and admission budgets before emitting
// these explicit bytes. This function performs no loading or discovery.
function createBinaryResourceStore(entries) {
  if (!Array.isArray(entries)) fail('store requires explicit byte entries');
  const records = new Map(), backing = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(entry.id) || records.has(entry.id)
      || !(entry.bytes instanceof Uint8Array)) fail('store entry is invalid');
    let data = backing.get(entry.bytes);
    if (!data) {
      const bytes = Uint8Array.prototype.slice.call(entry.bytes);
      data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      backing.set(entry.bytes, data);
    }
    records.set(entry.id, data);
  }
  const store = Object.freeze(Object.create(null));
  stores.set(store, records);
  return store;
}

function createResourceContext(store, execution) {
  let state = executions.get(execution);
  if (!state) {
    if (store !== undefined && !stores.has(store)) fail('store is not host-owned');
    state = { store, records: stores.get(store), mapped: new Map() };
    executions.set(execution, state);
  } else if (state.store !== store) fail('store changed during execution');
  function check(view) {
    execution.checkOpen();
    const data = views.get(view);
    if (!data || data.owner !== state) fail('view belongs to another execution');
    return data.bytes;
  }
  function read(view, offset, width, operation) {
    const bytes = check(view);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength
      || width > bytes.byteLength - offset) fail('offset is out of bounds');
    const value = bytes[operation](offset, true);
    if (!Number.isFinite(value)) fail('float is not finite');
    return value;
  }
  function utf8(view, offset, length) {
    const bytes = check(view);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0
      || length < 0 || length > 12288 || offset > bytes.byteLength || length > bytes.byteLength - offset) fail('UTF-8 range is invalid');
    if (offset < bytes.byteLength && (bytes.getUint8(offset) & 192) === 128) fail('UTF-8 boundary is invalid');
    const end = offset + length;
    for (let at = offset; at < end;) {
      execution.checkOpen();
      const a = bytes.getUint8(at++);
      if (a < 128) continue;
      const count = a >= 194 && a <= 223 ? 1 : a >= 224 && a <= 239 ? 2 : a >= 240 && a <= 244 ? 3 : 0;
      if (!count || at + count > end) fail('UTF-8 is malformed');
      const b = bytes.getUint8(at);
      if (a === 224 && b < 160 || a === 237 && b >= 160 || a === 240 && b < 144 || a === 244 && b >= 144) fail('UTF-8 scalar is invalid');
      for (let n = 0; n < count; n++) if ((bytes.getUint8(at++) & 192) !== 128) fail('UTF-8 is malformed');
    }
    execution.checkOpen();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length));
  }
  return Object.freeze({
    map(id) {
      execution.checkOpen();
      if (typeof id !== 'string' || !state.records?.has(id)) fail('identity is unavailable');
      if (state.mapped.has(id)) return state.mapped.get(id);
      const view = Object.create(null);
      Object.defineProperties(view, {
        byteLength: { get() { return check(this).byteLength; } },
        readU8: { value(offset) { return read(this, offset, 1, 'getUint8'); } },
        readU32LE: { value(offset) { return read(this, offset, 4, 'getUint32'); } },
        readF32LE: { value(offset) { return read(this, offset, 4, 'getFloat32'); } },
        readUtf8: { value(offset, length) { return utf8(this, offset, length); } },
        toJSON: { value() { fail('view cannot be serialized'); } }
      });
      views.set(view, { owner: state, bytes: state.records.get(id) });
      state.mapped.set(id, Object.freeze(view));
      return view;
    }
  });
}

function bindBinaryResources(application, store) {
  if (!application || !['object', 'function'].includes(typeof application) || !stores.has(store)
    || applications.has(application) && applications.get(application) !== store) fail('application binding is invalid');
  applications.set(application, store);
  return application;
}
module.exports = { createBinaryResourceStore, createResourceContext, bindBinaryResources,
  applicationResources: application => applications.get(application) };
