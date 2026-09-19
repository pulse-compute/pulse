'use strict';

// Both Fastly Native realizations validate handles before json-as sees them.
function scalarRecordProjectionLines(node) {
  const limits = node.limits;
  return [
    '  if (input.kind != PULSE_VALUE_OBJECT || (checkDuplicates && input.duplicateJsonKeys)) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }',
    `  if (input.keys.length > ${limits.maxKeys}) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }`,
    '  const keys = input.keys.slice().sort()',
    '  const output = host_value_object()',
    '  let bytes = 2',
    '  for (let i = 0; i < keys.length; i++) {',
    '    const key = keys[i]',
    `    if (key.length > ${limits.maxKeyLength}) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }`,
    '    const keyHandle = __pulse_fastly_string_value(key)',
    '    const itemHandle = host_value_property(valueHandle, keyHandle)',
    '    const item = __pulse_fastly_value(itemHandle)',
    '    let size = 0',
    '    if (item.kind == PULSE_VALUE_STRING) {',
    `      if (item.text.length > ${limits.maxStringLength}) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }`,
    '      size = __pulse_scalar_record_string_bytes(item.text)',
    '    } else if (item.kind == PULSE_VALUE_NUMBER && isFinite(item.number)) {',
    `      size = ${limits.numberBytes}`,
    '    } else if (item.kind == PULSE_VALUE_BOOLEAN) size = item.boolean != 0 ? 4 : 5',
    '    else if (item.kind == PULSE_VALUE_NULL) size = 4',
    '    else { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }',
    '    bytes += (i == 0 ? 0 : 1) + __pulse_scalar_record_string_bytes(key) + 1 + size',
    `    if (bytes > ${limits.maxBytes}) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 56, -1); return 0 }`,
    '    host_value_object_set(output, keyHandle, itemHandle)',
    '  }',
    '  return output'
  ];
}

module.exports = { scalarRecordProjectionLines };
