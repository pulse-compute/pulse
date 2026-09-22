'use strict';

const { CANONICAL_NATIVE_READ_LOOP_MEMORY: policy, hasBoundedReadLoop } = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');

function runtimeSource(limits = policy) {
  return `
let __pulse_memory_bytes: i64 = 0
let __pulse_memory_values: i64 = 0
let __pulse_memory_failed: bool = false
function __pulse_memory_charge(values: i64, bytes: i64): void {
  if (__pulse_memory_failed) unreachable()
  if (values > ${limits.maxValues} - __pulse_memory_values || bytes > ${limits.maxBytes} - __pulse_memory_bytes) {
    __pulse_memory_failed = true
    __pulse_fastly_fail(1010, values > ${limits.maxValues} - __pulse_memory_values ? 173 : 172, -1)
    __pulse_invocation_close()
    unreachable()
  }
  __pulse_memory_values += values
  __pulse_memory_bytes += bytes
}
function __pulse_memory_value_push(target: Array<i32>, value: i32): void {
  __pulse_memory_charge(1, ${limits.edgeBytes})
  target.push(value)
}
function __pulse_memory_key_push(target: Array<string>, value: string): void {
  __pulse_memory_charge(1, ${limits.edgeBytes} + i64(value.length) * 2)
  target.push(value)
}
function __pulse_memory_header_push(target: Array<__PulseFastlyHeader>, value: __PulseFastlyHeader): void {
  __pulse_memory_charge(1, ${limits.valueBytes} + i64(value.name.length + value.value.length) * 2)
  target.push(value)
}
export function pulse_fastly_memory_bytes(): i64 { return __pulse_memory_bytes }
export function pulse_fastly_memory_values(): i64 { return __pulse_memory_values }
`;
}

function instrument(source, plan) {
  if (!hasBoundedReadLoop(plan)) return source;
  function insert(needle, extra) {
    if (source.split(needle).length !== 2) throw new Error('Native value budget instrumentation mismatch: ' + needle);
    source = source.replace(needle, needle + extra);
  }
  // Text assignments include lazy fetch bodies and response bodies as well as
  // strings. Ropes reserve their eventual flat size before materialization.
  insert('\n  set text(value: string) {', '\n    __pulse_memory_charge(0, i64(value.length) * 2)');
  insert('\nfunction __pulse_fastly_put(value: __PulseFastlyValue): i32 {',
    ` __pulse_memory_charge(1, ${policy.valueBytes} + (value.textLeft === null ? 0 : i64(value.textLength) * 2));`);
  const helpers = { keys: 'key', values: 'value', headers: 'header' };
  // Skip quoted data and comments: authored text can contain source-like text.
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.(keys|values|headers)\.push\(/g;
  source = source.replace(tokens, (match, quoted, object, field) => quoted || `__pulse_memory_${helpers[field]}_push(${object}.${field}, `);
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  if (/\.(keys|values|headers)\.push\(/.test(code)) throw new Error('Unmetered Native container growth.');
  return source + runtimeSource();
}

module.exports = { policy, hasBoundedReadLoop, runtimeSource, instrument };
