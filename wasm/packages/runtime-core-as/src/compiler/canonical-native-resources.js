'use strict';

function nativeResourceBacking(blob, name) {
  const bytes = Buffer.from(blob.data, 'base64');
  // memory.data emits literal raw bytes, without base64 or a runtime decoder.
  const words = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const word = Buffer.alloc(8); bytes.copy(word, 0, offset, offset + 8);
    words.push('0x' + word.reverse().toString('hex'));
  }
  return `const ${name}: usize = memory.data<u64>([${words.length ? words.join(',') : '0'}])`;
}
function prepareNativeResources(plan, sharedReferences) {
  const catalogue = plan.binaryResources;
  if (!catalogue) return { source: [], references: new Map(), read() { throw new Error('Missing resource catalogue'); } };
  require('@pulse-compute/wasm-contracts/resources/embedded').validateResourceCatalogue(catalogue);
  const references = sharedReferences || new Map(catalogue.blobs.map((blob, index) => [blob.id, `__pulse_resource_${index}`]));
  for (const blob of catalogue.blobs) if (!references.has(blob.id)) throw new Error('Missing shared resource backing');
  const source = sharedReferences ? [] : catalogue.blobs.map(blob => nativeResourceBacking(blob, references.get(blob.id)));
  source.push(`function __pulse_resource_read(base: usize, length: i32, offset: f64, operation: i32): f64 {
  const checked = host_resource_check(offset, length, operation == 1 ? 1 : operation == 0 ? 0 : 4);
  if (checked < 0) return 0;
  if (operation == 0) return <f64>length;
  const address = base + <usize>checked;
  if (operation == 1) return <f64>load<u8>(address);
  if (operation == 2) return <f64>load<u32>(address);
  const value = <f64>load<f32>(address);
  if (!isFinite(value)) { host_resource_check(NaN, 0, 0); return 0; }
  return value;
}`);
  source.push(`function __pulse_resource_utf8(base: usize, size: i32, offset: f64, length: f64): i32 {
  const width = host_resource_check(length, 12288, 0);
  if (width < 0) return 0;
  const start = host_resource_check(offset, size, width);
  if (start < 0) return 0;
  if (start < size && (load<u8>(base + <usize>start) & 192) == 128) { host_resource_check(NaN, 0, 0); return 0; }
  const end = start + width;
  let at = start;
  while (at < end) {
    if (host_resource_check(at, size, 1) < 0) return 0;
    const a = <i32>load<u8>(base + <usize>(at++));
    if (a < 128) continue;
    const count = a >= 194 && a <= 223 ? 1 : a >= 224 && a <= 239 ? 2 : a >= 240 && a <= 244 ? 3 : 0;
    if (count == 0 || count > end - at) { host_resource_check(NaN, 0, 0); return 0; }
    const b = <i32>load<u8>(base + <usize>at);
    if (a == 224 && b < 160 || a == 237 && b >= 160 || a == 240 && b < 144 || a == 244 && b >= 144) { host_resource_check(NaN, 0, 0); return 0; }
    for (let n = 0; n < count; n++) {
      if ((load<u8>(base + <usize>(at++)) & 192) != 128) { host_resource_check(NaN, 0, 0); return 0; }
    }
  }
  if (host_resource_check(offset, size, width) < 0) return 0;
  const text = String.UTF8.decodeUnsafe(base + <usize>start, width);
  return host_value_string(changetype<usize>(text), text.length);
}`);
  function location(expression) {
    const record = catalogue.records.find(entry => entry.id === expression.resourceId);
    return { record, index: catalogue.blobs.findIndex(blob => blob.id === record.blobId) };
  }
  return { source, references, read(expression, offset = '0.0') {
    const { record, index } = location(expression);
    const operation = ['byteLength', 'readU8', 'readU32LE', 'readF32LE'].indexOf(expression.operation);
    return `__pulse_resource_read(${references.get(record.blobId)}, ${record.byteLength}, ${offset}, ${operation})`;
  }, utf8(expression, offset, length) {
    const { record, index } = location(expression);
    return `__pulse_resource_utf8(${references.get(record.blobId)}, ${record.byteLength}, ${offset}, ${length})`;
  } };
}
module.exports = { prepareNativeResources, nativeResourceBacking };
