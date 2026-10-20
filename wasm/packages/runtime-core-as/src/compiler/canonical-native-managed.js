'use strict';
// Shared resource/workspace emitters remain the only owners of checked loads,
// UTF-8 decoding, zeroing and numeric storage. Package emitters use slot calls.
function generateManagedNativePrimitiveSource(plan) {
  const resources = require('./canonical-native-resources.js').prepareNativeResources(plan);
  const workspaces = require('./canonical-native-workspaces.js').prepareNativeWorkspaces(plan);
  const lines = [
    '@external("pulse_host", "resource_check") declare function __pulse_managed_resource_check(offset: f64, length: i32, width: i32): i32',
    '@external("pulse_host", "workspace_check") declare function __pulse_managed_workspace_check(offset: f64, capacity: i32, value: f64): i32',
    '@external("pulse_host", "value_string") declare function __pulse_managed_value_string(pointer: i32, length: i32): i32',
    '@external("pulse_host", "value_json") declare function __pulse_managed_value_json(handle: i32): i32',
    ...resources.source, ...workspaces.source
  ];
  lines.push('function __pulse_managed_resource(slot: i32, operation: i32, offset: f64): f64 {', '  switch (slot) {');
  for (const [slot, record] of (plan.binaryResources?.records || []).entries()) {
    lines.push(`    case ${slot}: {`);
    for (const [operation, name] of ['byteLength','readU8','readU32LE','readF32LE'].entries()) lines.push(`      if (operation == ${operation}) return ${resources.read({ resourceId: record.id, operation: name }, 'offset')};`);
    lines.push('    }');
  }
  lines.push('  }', '  abort("Invalid resource slot", "managed", 0, 0); return 0;', '}');
  lines.push('function __pulse_managed_utf8(slot: i32, offset: f64, length: f64): JSON.Value {', '  let handle: i32 = 0;', '  switch (slot) {');
  for (const [slot, record] of (plan.binaryResources?.records || []).entries()) lines.push(`    case ${slot}: handle = ${resources.utf8({ resourceId: record.id }, 'offset', 'length')}; break;`);
  lines.push('    default: abort("Invalid resource slot", "managed", 0, 0);', '  }', '  if (handle <= 0) return __pulse_entities_null();', '  return JSON.parse<JSON.Value>(changetype<string>(__pulse_managed_value_json(handle)));', '}');
  for (const [slot, record] of (plan.numericWorkspaces || []).entries()) {
    const e = { workspaceId: record.id, offset: true };
    lines.push(`function __pulse_managed_workspace_init_${slot}(): JSON.Value { ${workspaces.init(e)}; return __pulse_entities_null(); }`);
    lines.push(`function __pulse_managed_workspace_read_${slot}(offset: f64): f64 { return ${workspaces.read(e, 'offset')}; }`);
    lines.push(`function __pulse_managed_workspace_write_${slot}(offset: f64, value: f64): f64 { return ${workspaces.write(e, 'offset', 'value')}; }`);
  }
  return lines.join('\n').replace(/\bhost_resource_check\b/g, '__pulse_managed_resource_check')
    .replace(/\bhost_workspace_check\b/g, '__pulse_managed_workspace_check')
    .replace(/\bhost_value_string\b/g, '__pulse_managed_value_string').replace('changetype<usize>(text)', 'changetype<i32>(text)');
}
module.exports = { generateManagedNativePrimitiveSource };
