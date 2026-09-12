'use strict';

// Injected ABI authority for real generated Wasm evidence, never a service adapter.
// Raw persisted bytes and u64 generations remain independent of the Pulse codec.
function createConditionalKvAuthority() {
  const stores = new Map(); let next = 1n;
  return {
    stores,
    seed(store, key, wire, generation = next++) {
      if (!stores.has(store)) stores.set(store, new Map());
      stores.get(store).set(key, { wire: Buffer.from(wire), generation: BigInt(generation) });
    },
    get(store, key) { return stores.get(store)?.get(key); },
    apply(store, key, wire, mode, condition) {
      const values = stores.get(store), current = values.get(key);
      if (mode === 1 && current || condition !== undefined && (!current || current.generation !== condition)) return 4;
      while (next === current?.generation) next++;
      this.seed(store, key, wire, next++); return 1;
    }
  };
}

function attachConditionalKvHost(imports, host, options) {
  const { view, writeU32, writeU64, readBytes, readUtf8, alloc, bodies, bodyBytes, trace, now, advance } = host;
  const authority = options.authority, stores = new Map(), pending = new Map(), bodyFixtures = new Map();
  let sendingResponse = false;
  const newResponse = imports.fastly_http_resp.new;
  imports.fastly_http_resp.new = (...args) => { sendingResponse = true; return newResponse(...args); };
  const call = (stage, detail = {}) => {
    const fault = typeof options.onCall === 'function' ? options.onCall(stage, detail) || {} : {};
    advance(Number(fault.delayMs || 0));
    trace.push({ module: 'pulse_kv_evidence', name: stage, hostStatus: fault.status ?? 0, ...(fault.kvError === undefined ? {} : { kvError: fault.kvError }) });
    return fault;
  };
  imports.fastly_kv_store = {
    open(ptr, len, out) {
      const name = readUtf8(ptr, len), fault = call('open', { store: name });
      if (fault.status) return fault.status;
      if (!authority.stores.has(name)) return 10;
      const handle = alloc('kvStore'); stores.set(handle, name); writeU32(out, handle); return 0;
    },
    lookup(store, ptr, len, mask, config, out) {
      const name = stores.get(store), key = readUtf8(ptr, len), fault = call('lookup', { store: name, key, mask, config: readBytes(config, 4) });
      if (fault.status) return fault.status;
      const item = fault.observation || authority.get(name, key);
      const handle = alloc('kvLookup'); pending.set(handle, { kind: 'lookup', item, readyAt: now() + Number(fault.readyDelayMs || 0), fault });
      writeU32(out, handle); return 0;
    },
    lookup_wait_v2(handle, body, meta, capacity, written, generation, error) {
      const item = pending.get(handle); if (!item || item.readyAt > now()) throw new Error('KV lookup wait called before readiness.');
      pending.delete(handle); const fault = call('lookup_wait_v2', { capacity, observation: item.item });
      writeU32(error, fault.kvError ?? (item.item ? 1 : 3)); writeU64(generation, fault.generation ?? item.item?.generation ?? 0n);
      writeU32(written, fault.metadataLength ?? 0);
      if (fault.status) return fault.status;
      if ((fault.kvError ?? (item.item ? 1 : 3)) !== 1) return 0;
      const handleOut = alloc('body'); const bytes = Buffer.from(fault.wire || item.item.wire);
      bodies.set(handleOut, { bytes, readOffset: 0, writes: [], readyAt: now() + Number(fault.bodyDelayMs || 0) });
      bodyFixtures.set(handleOut, fault); writeU32(body, handleOut); return 0;
    },
    insert(store, ptr, len, body, mask, config, out) {
      const name = stores.get(store), key = readUtf8(ptr, len), wire = Buffer.from(bodyBytes(body));
      const mode = view().getUint32(config, true), condition = mask & 32 ? view().getBigUint64(config + 24, true) : undefined;
      const fault = call('insert', { store: name, key, wire, mode, mask, condition, config: readBytes(config, 32) });
      let code = fault.kvError;
      if (code === undefined && (!fault.status || fault.commit)) code = authority.apply(name, key, wire, mode, condition);
      bodies.delete(body); // Host takes ownership of the body.
      if (fault.status) return fault.status;
      const handle = alloc('kvInsert'); pending.set(handle, { kind: 'insert', code, readyAt: now() + Number(fault.readyDelayMs || 0) });
      writeU32(out, handle); return 0;
    },
    insert_wait(handle, error) {
      const item = pending.get(handle); if (!item || item.readyAt > now()) throw new Error('KV insert wait called before readiness.');
      pending.delete(handle); const fault = call('insert_wait'); writeU32(error, fault.kvError ?? item.code ?? 0); return fault.status ?? 0;
    }
  };
  const select = imports.fastly_async_io.select;
  imports.fastly_async_io.select = (handles, count, timeout, done) => {
    const handle = view().getUint32(handles, true), item = pending.get(handle) || (bodyFixtures.has(handle) && bodies.get(handle));
    if (!item) return select(handles, count, timeout, done);
    if (count !== 1 || timeout <= 0) throw new Error('KV select must be bounded.');
    const fault = call('select', { kind: item.kind || 'body', timeout });
    if (fault.status) return fault.status;
    const wait = Math.max(0, item.readyAt - now()); advance(Math.min(wait, timeout));
    writeU32(done, fault.readyIndex ?? (wait >= timeout ? 0xffffffff : 0)); return 0;
  };
  for (const name of ['new', 'write', 'read', 'close']) {
    const original = imports.fastly_http_body[name];
    imports.fastly_http_body[name] = (...args) => {
      const [handle] = args;
      if (sendingResponse) return original(...args);
      if (name === 'read' && !bodyFixtures.has(handle)) return original(...args);
      const fault = call('body_' + name, { handle });
      if (fault.status) return fault.status;
      const result = original(...args);
      if (name === 'read') {
        const fixture = bodyFixtures.get(handle), body = bodies.get(handle);
        if (body) body.readyAt = now() + Number(fixture.chunkDelayMs || 0);
        if (fault.written !== undefined) writeU32(args[3], fault.written);
      }
      if (name === 'write' && fault.written !== undefined) writeU32(args[4], fault.written);
      if (name === 'close') bodyFixtures.delete(handle);
      return result;
    };
  }
  const clock = imports.wasi_snapshot_preview1.clock_time_get;
  imports.wasi_snapshot_preview1.clock_time_get = (...args) => { const fault = call('clock'); return fault.status || clock(...args); };
  return { pending, bodyFixtures };
}
module.exports = { createConditionalKvAuthority, attachConditionalKvHost };
