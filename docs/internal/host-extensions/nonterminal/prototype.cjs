'use strict';
// Investigation adapter only. Replaces the extension owner in this process,
// restores it after the callback, and never changes production source files.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const contract = require(path.join(root, 'wasm/packages/contracts/src/provider/host-extension.js'));
const owner = require(path.join(root, 'packages/provider-fastly/src/build/host-extensions.js'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const SERVICE = 'investigation-immediate-observation.v0';
const PACKAGE = '@hex-spike/observations', CONTRACT = 'hex-spike.observations';
const layout = {
  snapshot: { access: 'instance', capability: 'runtime.observation', fields: [
    { name: 'vcpuMs', type: 'u64-safe-number' }, { name: 'memoryMiB', type: 'u32' }] },
  tls: { access: 'request', capability: 'downstream.tls', fields: [
    { name: 'protocol', type: 'ascii' }, { name: 'cipher', type: 'ascii' }] }
};
const sources = {
  snapshot: `@external("fastly_compute_runtime", "get_vcpu_ms") declare function __obs_cpu(out: usize): i32
@external("fastly_compute_runtime", "get_heap_mib") declare function __obs_heap(out: usize): i32
function __obs_snapshot(request: i32, out: usize): void {
  store<i32>(out, __obs_cpu(out + 8))
  store<i32>(out + 80, __obs_heap(out + 88))
}`,
  tls: `@external("fastly_http_downstream", "downstream_tls_protocol") declare function __obs_protocol(request: i32, out: usize, max: i32, written: usize): i32
@external("fastly_http_downstream", "downstream_tls_cipher_openssl_name") declare function __obs_cipher(request: i32, out: usize, max: i32, written: usize): i32
function __obs_tls(request: i32, out: usize): void {
  store<i32>(out, __obs_protocol(request, out + 8, 64, out + 4))
  store<i32>(out + 80, __obs_cipher(request, out + 88, 64, out + 84))
}`
};
function artifacts() {
  return Object.entries(layout).map(([operation, spec]) => {
    const module = operation === 'snapshot' ? 'fastly_compute_runtime' : 'fastly_http_downstream';
    const names = operation === 'snapshot' ? ['get_vcpu_ms', 'get_heap_mib'] : ['downstream_tls_protocol', 'downstream_tls_cipher_openssl_name'];
    return { version: contract.VERSION, id: `${PACKAGE}:${operation}`, kind: 'host-extension', mediaType: 'text/assemblyscript',
      package: PACKAGE, contractId: CONTRACT, data: { target: { provider: 'fastly', target: 'native', targetId: 'fastly-compute-native' },
        operation, service: SERVICE, source: sources[operation], sha256: hash(sources[operation]), entry: `__obs_${operation}`,
        imports: names.map(name => ({ module, name, parameters: operation === 'snapshot' ? ['i32'] : ['i32', 'i32', 'i32', 'i32'], results: ['i32'] })) } };
  });
}
const ADMISSION = contract.normalizeAdmission({ version: contract.ADMISSION_VERSION, protocols: [contract.VERSION], services: [SERVICE] });
const TARGET = { provider: 'fastly', target: 'native', targetId: 'fastly-compute-native', hostExtensions: ADMISSION };
const unique = selected => [...new Map(selected.map(item => [item.artifact.id, item.artifact])).values()];
function select(plan, options) {
  const used = plan.effects.filter(effect => effect.kind === 'host.extension');
  if (!used.length) return [];
  const selected = contract.select(used, options.realizationArtifacts || [], TARGET);
  return used.map(effect => {
    const artifact = selected.find(artifact => contract.matches(effect, artifact));
    const spec = layout[effect.operation];
    // Fixed experiment descriptor, not a newly admitted public manifest field.
    assert(spec && artifact.data.service === SERVICE);
    assert.equal(artifact.package, PACKAGE);
    assert.notEqual(effect.result.mode, 'return', 'Immediate values are not terminal responses');
    return { artifact, effect, index: plan.effects.indexOf(effect), spec };
  });
}
function source(selected) {
  const lines = unique(selected).map(artifact => artifact.data.source);
  lines.push(`
let __obs_delivery: i32 = -1
function __obs_slot(index: i32): bool { return ${selected.map(item => `index == ${item.index}`).join(' || ')} }
function __obs_field(out: usize, kind: i32, index: i32): i32 {
  const status = load<i32>(out)
  const result = host_value_object()
  if (status == 10) {
    host_value_object_set(result, __pulse_fastly_string_value("status"), __pulse_fastly_string_value("unavailable"))
    host_value_object_set(result, __pulse_fastly_string_value("reason"), __pulse_fastly_string_value("not-present"))
    return result
  }
  if (status != 0) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 310, index); return 0 }
  let value: i32 = 0
  if (kind == 0) {
    const n = load<u64>(out + 8)
    if (n > 9007199254740991) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 311, index); return 0 }
    value = host_value_number(<f64>n)
  } else if (kind == 1) value = host_value_number(<f64>load<u32>(out + 8))
  else {
    const n = load<i32>(out + 4)
    if (n < 1 || n > 64) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 312, index); return 0 }
    for (let i = 0; i < n; i++) {
      const byte = load<u8>(out + 8 + i)
      if (byte < 32 || byte > 126) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 313, index); return 0 }
    }
    value = __pulse_fastly_string_value(String.UTF8.decodeUnsafe(out + 8, n))
  }
  host_value_object_set(result, __pulse_fastly_string_value("status"), __pulse_fastly_string_value("available"))
  host_value_object_set(result, __pulse_fastly_string_value("value"), value)
  return result
}
function __pulse_extension_begin(effectIndex: i32): void {
  if (__pulse_invocation_closed || unchecked(__pulse_invocation_tickets[effectIndex]) <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 314, effectIndex); return }
  // One dispatch-local bounded result frame. No pending resource or new scheduler.
  const frame = new StaticArray<u64>(20)
  const out = changetype<usize>(frame)
  // Poison statuses so an unwritten field cannot become a fabricated success.
  store<i32>(out, -1); store<i32>(out + 80, -1)
  switch (effectIndex) {`);
  for (const item of selected) lines.push(`case ${item.index}: ${item.artifact.data.entry}(${item.spec.access === 'request' ? '__pulse_fastly_request_handle' : '0'}, out); break;`);
  lines.push(`default: __pulse_fastly_fail(PULSE_ERROR_STATE, 314, effectIndex); return;
  }
  if (__pulse_invocation_closed) { __pulse_fastly_fail(PULSE_ERROR_STATE, 314, effectIndex); return }
  const result = host_value_object()
  let a: i32 = 0, b: i32 = 0
  switch (effectIndex) {`);
  for (const item of selected) {
    lines.push(`case ${item.index}:`);
    item.spec.fields.forEach((field, i) => lines.push(`${i ? 'b' : 'a'} = __obs_field(out + ${i * 80}, ${['u64-safe-number','u32','ascii'].indexOf(field.type)}, effectIndex)
  if (${i ? 'b' : 'a'} <= 0) return
  host_value_object_set(result, __pulse_fastly_string_value(${JSON.stringify(field.name)}), ${i ? 'b' : 'a'})`));
    lines.push('break;');
  }
  lines.push('}\n  __pulse_fastly_ready_effect(effectIndex, result)\n}');
  return lines.join('\n');
}
function instrument(source, selected) {
  if (!selected.length) return source;
  const replace = (from, to) => { assert.equal(source.split(from).length - 1, 1, 'exactly one instrumentation anchor'); source = source.replace(from, to); };
  replace('export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {',
    'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {\n  if (__obs_slot(effectIndex) && __obs_delivery != effectIndex) return 0;');
  replace('return pulse_set_effect_result(index, result)',
    '__obs_delivery = index\n  const accepted = pulse_set_effect_result(index, result)\n  __obs_delivery = -1\n  return accepted');
  return source;
}
function policy(selected, baseline) { return contract.composeImportPolicy(baseline.map(([module,name]) => ({module,name,kind:'function'})), unique(selected)); }
function withPrototype(callback, testSource = '') {
  const saved = { ...owner };
  Object.assign(owner, { ADMISSION, TARGET, select, matches: contract.matches, source: selected => source(selected) + testSource,
    instrument, imports: selected => unique(selected).flatMap(artifact => artifact.data.imports), policy,
    auditSignatures: (bytes, selected, baseline) => selected.length ? contract.auditWasm(bytes, policy(selected, baseline)) : undefined });
  try { return callback(); } finally { Object.assign(owner, saved); }
}
module.exports = { root, PACKAGE, CONTRACT, SERVICE, TARGET, layout, artifacts, withPrototype, hash };
