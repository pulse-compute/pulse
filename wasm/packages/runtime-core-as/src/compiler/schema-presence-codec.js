'use strict';

// Generate one projection from schema IR. json-as owns parsing and
// serialization; Pulse owns requiredness, presence, validation and field order.
// JSON.Obj.get distinguishes a missing key (null reference) from JSON null
// (a non-null JSON.Value whose kind is Null).
function generateSchemaPresenceCodec(root, schemaIndex) {
  const declarations = [];
  let next = 0;
  const quote = JSON.stringify;
  function emit(node) {
    const name = `__pulse_schema_presence_${schemaIndex}_${next++}`;
    const lines = [`function ${name}(value: JSON.Value): JSON.Value {`];
    const check = condition => lines.push(`  if (!(${condition})) abort("Invalid Pulse schema value", "pulse-schema-codecs", 0, 0)`);
    if (node.kind === 'object') {
      check('value.type == JSON.Types.Object');
      lines.push('  const input = value.get<JSON.Obj>()', '  const output = new JSON.Obj()');
      node.fields.forEach((field, index) => {
        const child = emit(field.value);
        lines.push(`  const field_${index} = input.get(${quote(field.name)})`);
        if (field.required) check(`field_${index} !== null`);
        lines.push(`  if (field_${index} !== null) output.set<JSON.Value>(${quote(field.name)}, ${child}(field_${index}!))`);
      });
      if (node.additionalProperties) {
        lines.push('  const keys = input.keys()', '  for (let i = 0; i < keys.length; i++) {', '    const key = keys[i]');
        if (node.fields.length) lines.push(`    if (${node.fields.map(field => `key == ${quote(field.name)}`).join(' || ')}) continue`);
        lines.push('    output.set<JSON.Value>(key, __pulse_json_copy(input.get(key)!))', '  }');
      }
      lines.push('  return JSON.Value.from<JSON.Obj>(output)');
    } else if (node.kind === 'json-value' || node.kind === 'json-object') {
      if (node.kind === 'json-object') check('value.type == JSON.Types.Object');
      lines.push('  return __pulse_json_copy(value)');
    } else if (node.kind === 'scalar-record') {
      const limits = node.limits;
      check('value.type == JSON.Types.Object');
      lines.push('  const input = value.get<JSON.Obj>()', '  const keys = input.keys().sort()', '  const output = new JSON.Obj()');
      check(`keys.length <= ${limits.maxKeys}`);
      lines.push('  let bytes = 2', '  for (let i = 0; i < keys.length; i++) {', '    const key = keys[i]', '    const item = input.get(key)!');
      check(`key.length <= ${limits.maxKeyLength}`);
      lines.push('    let size = 0');
      lines.push('    if (item.type == JSON.Types.String) {', '      const text = item.get<string>()');
      check(`text.length <= ${limits.maxStringLength}`);
      lines.push('      size = __pulse_scalar_record_string_bytes(text)', '    } else if (item.type == JSON.Types.F64) {');
      check('isFinite(item.get<f64>())');
      lines.push(`      size = ${limits.numberBytes}`, '    } else if (item.type == JSON.Types.Bool) size = item.get<bool>() ? 4 : 5', '    else if (item.type == JSON.Types.Null) size = 4', '    else abort("Invalid ScalarRecord value", "pulse-schema-codecs", 0, 0)');
      lines.push('    bytes += (i == 0 ? 0 : 1) + __pulse_scalar_record_string_bytes(key) + 1 + size');
      check(`bytes <= ${limits.maxBytes}`);
      lines.push('    output.set<JSON.Value>(key, item)', '  }', '  return JSON.Value.from<JSON.Obj>(output)');
    } else if (node.kind === 'array') {
      const child = emit(node.element);
      check('value.type == JSON.Types.Array');
      lines.push('  const input = value.get<JSON.Arr>()', '  const output = new JSON.Arr()');
      lines.push(`  for (let i = 0; i < input.length; i++) output.push<JSON.Value>(${child}(input.at(i)))`);
      lines.push('  return JSON.Value.from<JSON.Arr>(output)');
    } else if (node.kind === 'nullable') {
      const child = emit(node.value);
      lines.push('  if (value.type == JSON.Types.Null) return JSON.Value.empty()', `  return ${child}(value)`);
    } else if (node.kind === 'string' || node.kind === 'string-enum') {
      check('value.type == JSON.Types.String');
      lines.push('  const text = value.get<string>()');
      if (node.kind === 'string-enum') check(node.values.map(text => `text == ${quote(text)}`).join(' || '));
      lines.push('  return JSON.Value.from<string>(text)');
    } else if (node.kind === 'boolean') {
      check('value.type == JSON.Types.Bool');
      lines.push('  return JSON.Value.from<bool>(value.get<bool>())');
    } else if (['f64','i32','u32'].includes(node.kind)) {
      check('value.type == JSON.Types.F64');
      lines.push('  const number = value.get<f64>()');
      check('isFinite(number)');
      if (node.kind !== 'f64') {
        check('Math.floor(number) == number');
        check(node.kind === 'i32' ? 'number >= -2147483648.0 && number <= 2147483647.0' : 'number >= 0.0 && number <= 4294967295.0');
      }
      lines.push('  return JSON.Value.from<f64>(number)');
    } else {
      throw new TypeError(`Unsupported Native schema node ${node.kind}`);
    }
    lines.push('}', '');
    declarations.push(...lines);
    return name;
  }
  const apply = emit(root);
  return {declarations, apply};
}

module.exports = {generateSchemaPresenceCodec};
