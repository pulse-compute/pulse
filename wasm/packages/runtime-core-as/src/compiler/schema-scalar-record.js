'use strict';

const { schemaHasScalarRecord, scalarRecordStringBytes } = require('@pulse-compute/wasm-contracts/schema-json/registry');

function scalarRecordRuntimeSource() {
  return scalarRecordStringBytes.toString().replace('function scalarRecordStringBytes(text)', 'function __pulse_scalar_record_string_bytes(text: string): i32') + `
// Syntax is already checked by json-as. This cursor skips unknown subtrees
// without allocating them or recursing through their arbitrary structure.
class __PulseSchemaTextCursor {
  constructor(public text: string) {}
  space(i: i32): i32 { while (i < this.text.length && this.text.charCodeAt(i) <= 32) i++; return i; }
  stringEnd(i: i32): i32 {
    for (i++; i < this.text.length; i++) {
      const c = this.text.charCodeAt(i);
      if (c == 92) i++;
      else if (c == 34) return i + 1;
    }
    return this.text.length;
  }
  end(i: i32): i32 {
    i = this.space(i);
    const first = this.text.charCodeAt(i);
    if (first == 34) return this.stringEnd(i);
    if (first != 123 && first != 91) {
      while (i < this.text.length) {
        const c = this.text.charCodeAt(i);
        if (c == 44 || c == 93 || c == 125 || c <= 32) break;
        i++;
      }
      return i;
    }
    let depth = 0;
    for (; i < this.text.length; i++) {
      const c = this.text.charCodeAt(i);
      if (c == 34) i = this.stringEnd(i) - 1;
      else if (c == 123 || c == 91) depth++;
      else if ((c == 125 || c == 93) && --depth == 0) return i + 1;
    }
    return this.text.length;
  }
}
`;
}

function generateScalarRecordTextValidation(root, schemaIndex) {
  const declarations = [];
  let next = 0;
  function emit(node) {
    if (node.kind === 'nullable') return emit(node.value);
    const name = `__pulse_schema_record_text_${schemaIndex}_${next++}`;
    const lines = [`function ${name}(source: __PulseSchemaTextCursor, start: i32): void {`, '  start = source.space(start);'];
    if (node.kind === 'array') {
      const child = emit(node.element);
      lines.push('  if (source.text.charCodeAt(start) != 91) return;', '  let i = source.space(start + 1);');
      lines.push('  while (i < source.text.length && source.text.charCodeAt(i) != 93) {', `    ${child}(source, i);`);
      lines.push('    i = source.space(source.end(i));', '    if (source.text.charCodeAt(i) != 44) break;', '    i = source.space(i + 1);', '  }');
    } else {
      const record = node.kind === 'scalar-record';
      const fields = record ? [] : node.fields.filter(field => schemaHasScalarRecord(field.value)).map(field => ({ ...field, fn: emit(field.value) }));
      lines.push('  if (source.text.charCodeAt(start) != 123) return;');
      if (record) lines.push('  const names = new Set<string>();');
      fields.forEach((_, index) => lines.push(`  let at_${index}: i32 = -1;`));
      lines.push('  let i = source.space(start + 1);', '  while (i < source.text.length && source.text.charCodeAt(i) != 125) {');
      lines.push('    const keyEnd = source.stringEnd(i);', '    const key = JSON.parse<string>(source.text.substring(i, keyEnd));', '    i = source.space(source.space(keyEnd) + 1);');
      if (record) {
        lines.push('    if (names.has(key)) abort("Duplicate ScalarRecord key", "pulse-schema-codecs", 0, 0);', '    names.add(key);');
        lines.push(`    if (names.size > ${node.limits.maxKeys}) abort("Too many ScalarRecord keys", "pulse-schema-codecs", 0, 0);`);
      } else fields.forEach((field, index) => lines.push(`    if (key == ${JSON.stringify(field.name)}) at_${index} = i;`));
      lines.push('    i = source.space(source.end(i));', '    if (source.text.charCodeAt(i) != 44) break;', '    i = source.space(i + 1);', '  }');
      fields.forEach((field, index) => lines.push(`  if (at_${index} >= 0) ${field.fn}(source, at_${index});`));
    }
    lines.push('}', '');
    declarations.push(...lines);
    return name;
  }
  const apply = emit(root);
  return { declarations, apply };
}

module.exports = { scalarRecordRuntimeSource, generateScalarRecordTextValidation };
