'use strict';
const assert = require('node:assert/strict');
// An independent synthetic host: no Fastly disposition claims. Timed runs turn
// trace arrays off, but keep ownership validation and identical payload work.
function instantiate(module, options = {}) {
  let x, next = [0, 0], remaining = 100, acquisitions = 0, reads = 0, disposals = 0, notes = 0;
  const live = new Set(), trace = [];
  const log = options.trace === false ? () => {} : (...event) => trace.push(event);
  const key = (namespace, handle) => `${namespace}:${handle}`;
  const instance = new WebAssembly.Instance(module, {
    fixture: {
      acquire(namespace, slot) {
        acquisitions++; log('acquire', namespace, slot);
        if (slot === options.acquireFailure) return -1;
        const handle = next[namespace]++; live.add(key(namespace, handle)); return handle;
      },
      read(namespace, handle, pointer, size) {
        if (options.verify !== false) assert.ok(live.has(key(namespace, handle))); reads++; log('read', namespace, handle, size);
        if (options.readTrap) throw new WebAssembly.RuntimeError('fixture read trap');
        if (options.readFailure) return -1;
        new Uint8Array(x.memory.buffer, pointer, size).fill(127);
        return size;
      },
      dispose(namespace, handle) {
        if (options.verify !== false) assert.ok(live.has(key(namespace, handle)), 'duplicate or foreign disposal');
        disposals++; log('dispose', namespace, handle);
        for (let i = 0; options.verify !== false && i < options.width; i++) assert.equal(x.ticket(i), 0, 'cleanup precedes ticket invalidation');
        if (options.disposeTrap) throw new WebAssembly.RuntimeError('fixture disposal trap');
        if (options.disposeUnknown) return 1;
        live.delete(key(namespace, handle)); return 0;
      },
      remaining() { return remaining; }
    },
    observer: { note(event, slot) { notes++; log('note', event, slot); } }
  });
  x = instance.exports;
  return { x, trace, expire() { remaining = 0; }, snapshot() {
    return { acquisitions, reads, disposals, notes, live: [...live].sort(), error: x.error(), deliveries: x.deliveries(), checksum: x.checksum(),
      states: Array.from({ length: options.width }, (_, i) => x.state(i)), tickets: Array.from({ length: options.width }, (_, i) => x.ticket(i)),
      backing: Array.from({ length: options.width }, (_, i) => x.length(i)) };
  } };
}
module.exports = { instantiate };
