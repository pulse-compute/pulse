'use strict';

function prepareNativeResources(plan) {
  const catalogue = plan.binaryResources;
  if (!catalogue) return { source: [], read() { throw new Error('Missing resource catalogue'); } };
  require('@pulse-compute/wasm-contracts/resources/embedded').validateResourceCatalogue(catalogue);
  const source = catalogue.blobs.map((blob, index) => {
    const bytes = Buffer.from(blob.data, 'base64');
    // memory.data emits literal raw bytes, without base64 or a runtime decoder.
    const words = [];
    for (let offset = 0; offset < bytes.length; offset += 8) {
      const word = Buffer.alloc(8); bytes.copy(word, 0, offset, offset + 8);
      words.push('0x' + word.reverse().toString('hex'));
    }
    return `const __pulse_resource_${index}: usize = memory.data<u64>([${words.length ? words.join(',') : '0'}])`;

  });
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
  return { source, read(expression, offset = '0.0') {
    const record = catalogue.records.find(entry => entry.id === expression.resourceId);
    const index = catalogue.blobs.findIndex(blob => blob.id === record.blobId);
    const operation = ['byteLength', 'readU8', 'readU32LE', 'readF32LE'].indexOf(expression.operation);
    return `__pulse_resource_read(__pulse_resource_${index}, ${record.byteLength}, ${offset}, ${operation})`;
  } };
}
module.exports = { prepareNativeResources };
