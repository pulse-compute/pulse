'use strict';
// Private investigation model. Not a supported application API.
const crypto = require('node:crypto');
const { selectEmbeddedAsset } = require('../../../wasm/packages/contracts/src/assets/embedded.js');
const LIMITS = Object.freeze({ files: 256, fileBytes: 262144, totalBytes: 1048576, readBytes: 4194304 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code: `RESOURCE_${code}` }); }
function range(size, offset, width) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(width) || offset < 0 || width < 0
    || offset > size || width > size - offset) fail('BOUNDS');
}
function catalogue(serialized, declarations) {
  if (!Array.isArray(declarations) || declarations.length > LIMITS.files) fail('DECLARATION');
  try { selectEmbeddedAsset(serialized, '/__resource_validation__'); } catch { fail('INTEGRITY'); }
  const entries = new Map();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration !== 'object'
      || Object.keys(declaration).sort().join(',') !== 'id,path') fail('DECLARATION');
    const { id, path } = declaration;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(id) || entries.has(id)) fail('DECLARATION');
    let selected;
    try { selected = selectEmbeddedAsset(serialized, path); } catch { fail('INTEGRITY'); }
    if (!selected.embeddedFound) fail('MISSING');
    const bytes = Buffer.from(selected.embeddedData, 'base64');
    entries.set(id, { id, path, byteLength: bytes.length, sha256: hash(bytes), manifestId: selected.embeddedId, bytes });
  }
  const records = [...entries.values()].sort((a, b) => a.id < b.id ? -1 : 1)
    .map(({ id, path, byteLength, sha256, manifestId }) => [id, path, byteLength, sha256, manifestId]);
  return { entries, identity: hash(JSON.stringify(['pulse.binary-resource-proof.v1', records])) };
}
function execution(catalogue, supplied, readLimit = LIMITS.readBytes) {
  if (!Number.isSafeInteger(readLimit) || readLimit < 0 || readLimit > LIMITS.readBytes) fail('LIMIT');
  const admitted = new Map(), views = new WeakMap();
  let active = true, readBytes = 0;
  // Atomically snapshot and verify the entire declared catalogue before exposing a view.
  for (const [id, entry] of catalogue.entries) {
    const input = supplied ? supplied.get(id) : entry.bytes;
    if (!(input instanceof Uint8Array)) fail('MISSING');
    if (input.byteLength !== entry.byteLength) fail('LENGTH');
    const bytes = Uint8Array.from(input);
    if (hash(bytes) !== entry.sha256) fail('INTEGRITY');
    admitted.set(id, bytes);
  }
  const open = () => { if (!active) fail('CLOSED'); };
  function read(view, offset, width, accessor) {
    open(); const bytes = views.get(view);
    if (!bytes) fail('OWNER');
    range(bytes.length, offset, width);
    if (width > readLimit - readBytes) { active = false; fail('LIMIT'); }
    readBytes += width;
    return accessor(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset);
  }
  return {
    map(id) { open(); const bytes = admitted.get(id); if (!bytes) fail('MISSING');
      const view = Object.freeze({ byteLength: bytes.length }); views.set(view, bytes); return view; },
    u8: (view, offset) => read(view, offset, 1, (data, at) => data.getUint8(at)),
    u32LE: (view, offset) => read(view, offset, 4, (data, at) => data.getUint32(at, true)),
    f32LE: (view, offset) => read(view, offset, 4, (data, at) => {
      const value = data.getFloat32(at, true); if (!Number.isFinite(value)) fail('NONFINITE'); return value;
    }),
    close() { active = false; admitted.clear(); },
    get readBytes() { return readBytes; }
  };
}
module.exports = { LIMITS, hash, range, catalogue, execution };
