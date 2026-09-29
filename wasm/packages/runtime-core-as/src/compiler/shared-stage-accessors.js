'use strict';

// Static slots remain registration-owned, including provider-side settlement.
function effectAccessors(storage) {
  const indices = [...storage.keys()];
  const operations = [
    ['prepare', 'void', index => `__pulse_effect_pending_${index} = 1; __pulse_effect_ready_${index} = 0; __pulse_effect_result_${index} = 0; return`, 'return'],
    ['clear', 'void', index => `__pulse_effect_pending_${index} = 0; __pulse_effect_ready_${index} = 0; return`, 'return'],
    ['ready', 'i32', index => `return __pulse_effect_ready_${index}`, 'return 0'],
    ['result', 'i32', index => `return __pulse_effect_result_${index}`, 'return 0']
  ];
  return operations.map(([name, type, emit, fallback]) => `@noinline
function __pulse_stage_${name}(index: i32): ${type} {
  switch (index) {
${indices.map(index => `    case ${index}: ${emit(index)}`).join('\n')}
    default: ${fallback}
  }
}`);
}
module.exports = { effectAccessors };
