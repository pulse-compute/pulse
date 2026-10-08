'use strict';
// Bounded physical census. No compiler, disassembler, source or provider imports.
const assert = require('node:assert/strict');
const MAX_BYTES = 64 * 1024 * 1024, MAX_RECORDS = 100000;
function reader(bytes) {
  return { at: 0, byte() { assert.ok(this.at < bytes.length, 'truncated Wasm'); return bytes[this.at++]; },
    uint() { let n = 0; for (let i = 0; i < 5; i++) { const b = this.byte(); assert.ok(i < 4 || b <= 15, 'invalid u32'); n += (b & 127) * 2 ** (7 * i); if (!(b & 128)) return n; } throw Error('invalid u32'); },
    skip(n) { assert.ok(n <= bytes.length - this.at, 'truncated payload'); this.at += n; },
    text() { const n = this.uint(), start = this.at; this.skip(n); return bytes.subarray(start, this.at).toString('utf8'); } };
}
function inspectWasm(input) {
  const bytes = Buffer.from(input);
  assert.ok(bytes.length <= MAX_BYTES && WebAssembly.validate(bytes), 'invalid or oversized Wasm');
  const module = new WebAssembly.Module(bytes);
  const importedFunctions = WebAssembly.Module.imports(module).filter(row => row.kind === 'function').length;
  const r = reader(bytes); r.at = 8;
  const sections = [], functions = []; let dataPayloadBytes = 0, dataSupported = true;
  while (r.at < bytes.length) {
    assert.ok(sections.length < MAX_RECORDS, 'section limit');
    const offset = r.at, id = r.byte(), size = r.uint(), payload = r.at;
    r.skip(size); const end = r.at, part = reader(bytes.subarray(payload, end));
    if (id === 10) {
      const count = part.uint(); assert.ok(count <= MAX_RECORDS, 'function limit');
      for (let i = 0; i < count; i++) { const n = part.uint(); part.skip(n); functions.push({ index: importedFunctions + i, bytes: n }); }
      assert.equal(part.at, size);
    }
    if (id === 11) {
      // Unknown offset expressions leave payload accounting unavailable, while
      // exact section and code-body accounting remains valid.
      try {
        const count = part.uint(); assert.ok(count <= MAX_RECORDS);
        for (let i = 0; i < count; i++) {
          const mode = part.uint(); assert.ok(mode <= 2);
          if (mode === 2) part.uint();
          if (mode !== 1) {
            assert.equal(part.byte(), 0x41);
            let ended = false;
            for (let j = 0; j < 5; j++) if (!(part.byte() & 128)) { ended = true; break; }
            assert.ok(ended); assert.equal(part.byte(), 0x0b);
          }
          const n = part.uint(); part.skip(n); dataPayloadBytes += n;
        }
        assert.equal(part.at, size);
      } catch { dataSupported = false; }
    }
    sections.push({ index: sections.length, id, bytes: end - offset, payloadBytes: size, offset });
  }
  return { sections, importedFunctions, functions, dataPayloadBytes: dataSupported ? dataPayloadBytes : null };
}
function functionNames(bytes) {
  const r = reader(bytes), names = new Map();
  while (r.at < bytes.length) {
    const id = r.byte(), size = r.uint(), start = r.at; r.skip(size);
    if (id !== 1) continue;
    const part = reader(bytes.subarray(start, r.at)), count = part.uint(); assert.ok(count <= MAX_RECORDS);
    for (let i = 0; i < count; i++) { const index = part.uint(); assert.ok(!names.has(index)); names.set(index, part.text()); }
    assert.equal(part.at, size);
  }
  return names;
}
function assertCompanion(production, named) {
  const a = inspectWasm(production), b = inspectWasm(named);
  const raw = (bytes, rows) => rows.filter(row => row.id !== 0).map(row => bytes.subarray(row.offset, row.offset + row.bytes));
  assert.deepEqual(raw(production, a.sections), raw(named, b.sections));
  return a;
}
module.exports = { inspectWasm, functionNames, assertCompanion, MAX_BYTES, MAX_RECORDS };
