'use strict';

const { schemaNeedsValueProjection, schemaHasScalarRecord, schemaHasNestedJson } = require('@pulse-compute/wasm-contracts/schema-json/registry');
const { scalarRecordRuntimeSource, generateScalarRecordTextValidation } = require('./schema-scalar-record.js');
const { generateSchemaPresenceCodec } = require('./schema-presence-codec.js');
const { jsonAdmissionRuntimeSource, generateSchemaJsonPolicy } = require('./schema-admission.js');
const { nestedJsonProjectionSource } = require('./schema-nested-json.js');
const { CanonicalNativeAssemblyScriptError, stableHash, quote } = require('./canonical-native-context.js');

function schemaIdentifier(value) {
  const normalized = String(value || 'schema').normalize('NFKC').replace(/[^A-Za-z0-9_$]+/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function nativeSchemaCodecSource(plan) {
  const registry = plan.schemas && plan.schemas.registry;
  const schemas = registry && Array.isArray(registry.schemas) ? registry.schemas : [];
  if (schemas.length === 0) {
    return Object.freeze({
      active: false,
      imports: Object.freeze([]),
      declarations: Object.freeze([]),
      exports: Object.freeze([]),
      codecs: Object.freeze([]),
      sourceHash: null
    });
  }

  const declarations = [];
  const codecEntries = [];

  function typeFor(node, symbols, path) {
    switch (node.kind) {
      case 'string': return 'string';
      case 'boolean': return 'bool';
      case 'i32': return 'i32';
      case 'u32': return 'u32';
      case 'f64': return 'f64';
      case 'string-enum': return 'string';
      case 'array': return `Array<${typeFor(node.element, symbols, [...path, 'item'])}>`;
      case 'object': return symbols.get(path.join('.'));
      case 'nullable': {
        const inner = typeFor(node.value, symbols, [...path, 'value']);
        return ['boolean', 'i32', 'u32', 'f64'].includes(node.value.kind)
          ? `JSON.Box<${inner}> | null`
          : `${inner} | null`;
      }
      default: throw new CanonicalNativeAssemblyScriptError(`Unsupported Native schema node ${String(node.kind)}.`, { node, path });
    }
  }

  function defaultFor(node, symbols, path) {
    if (node.kind === 'nullable') return 'null';
    if (node.kind === 'string' || node.kind === 'string-enum') return "''";
    if (node.kind === 'boolean') return 'false';
    if (node.kind === 'i32' || node.kind === 'u32') return '0';
    if (node.kind === 'f64') return '0.0';
    if (node.kind === 'array') return `new Array<${typeFor(node.element, symbols, [...path, 'item'])}>()`;
    if (node.kind === 'object') return `new ${symbols.get(path.join('.'))}()`;
    throw new CanonicalNativeAssemblyScriptError(`Unsupported Native schema default for ${String(node.kind)}.`, { node, path });
  }

  function collectObjects(schema, schemaIndex, node, symbols, records, path = []) {
    if (node.kind === 'nullable') {
      collectObjects(schema, schemaIndex, node.value, symbols, records, [...path, 'value']);
      return;
    }
    if (node.kind === 'array') {
      collectObjects(schema, schemaIndex, node.element, symbols, records, [...path, 'item']);
      return;
    }
    if (node.kind !== 'object') return;
    const key = path.join('.');
    const suffix = path.length === 0
      ? ''
      : `_${path.map(schemaIdentifier).join('_')}_${stableHash(JSON.stringify(path)).slice(0, 8)}`;
    const baseSymbol = registry.codecs
      && registry.codecs[schemaIndex]
      && registry.codecs[schemaIndex].native
      && registry.codecs[schemaIndex].native.symbol
      || `__Pulse_${schemaIdentifier(schema.id)}_${schemaIndex}`;
    const symbol = `${baseSymbol}${suffix}`;
    symbols.set(key, symbol);
    for (const field of node.fields) collectObjects(schema, schemaIndex, field.value, symbols, records, [...path, field.name]);
    records.push(Object.freeze({ symbol, node, path: Object.freeze([...path]) }));
  }

  if (schemas.some(schema => schemaHasScalarRecord(schema.root) || schemaHasNestedJson(schema.root))) declarations.push(scalarRecordRuntimeSource());
  if (schemas.some(schema => schema.jsonLimits)) declarations.push(jsonAdmissionRuntimeSource());
  if (schemas.some(schema => schemaHasNestedJson(schema.root))) declarations.push(nestedJsonProjectionSource());
  schemas.forEach((schema, schemaIndex) => {
    const decode = `__pulse_schema_decode_${schemaIndex}`;
    const encode = `__pulse_schema_encode_${schemaIndex}`;
    let root;
    if (schema.jsonLimits) declarations.push(generateSchemaJsonPolicy(schema, schemaIndex, registry.maxBytes));
    if (schemaNeedsValueProjection(schema.root) || schema.jsonLimits) {
      root = 'JSON.Value';
      const presence = generateSchemaPresenceCodec(schema.root, schemaIndex);
      declarations.push(...presence.declarations);
      const nested = schemaHasNestedJson(schema.root);
      const recordText = schemaHasScalarRecord(schema.root) || nested ? generateScalarRecordTextValidation(schema.root, schemaIndex) : null;
      if (recordText) declarations.push(...recordText.declarations);
      for (const fn of [decode, encode]) {
        declarations.push(`function ${fn}(input: string): string {`);
        if (schema.jsonLimits) {
          declarations.push(`  const admission = __pulse_schema_json_scan_${schemaIndex}(input)`);
          declarations.push('  if (admission.failure != 0) abort("JSON admission failed", "pulse-schema-codecs", 0, 0)');
          if (recordText) declarations.push(`  ${recordText.apply}(new __PulseSchemaTextCursor(input), 0${nested ? ', admission.duplicateObjects' : ''})`);
        }
        declarations.push(`  const value = JSON.parse<JSON.Value>(input)`);
        if (recordText && !schema.jsonLimits) declarations.push(`  ${recordText.apply}(new __PulseSchemaTextCursor(input), 0)`);
        declarations.push(`  const text = JSON.stringify<JSON.Value>(${presence.apply}(value))`);
        if (schema.jsonLimits) declarations.push(`  if (__pulse_schema_json_scan_${schemaIndex}(text, 0).failure != 0) abort("JSON output admission failed", "pulse-schema-codecs", 0, 0)`);
        declarations.push('  return text');
        declarations.push('}');
      }
    } else {
      const symbols = new Map();
      const records = [];
      collectObjects(schema, schemaIndex, schema.root, symbols, records);
      for (const record of records) {
        declarations.push('@json');
        declarations.push(`class ${record.symbol} {`);
        record.node.fields.forEach((field, fieldIndex) => {
          const member = `field_${fieldIndex}`;
          declarations.push(`  @alias(${quote(field.name)})`);
          declarations.push(`  ${member}: ${typeFor(field.value, symbols, [...record.path, field.name])} = ${defaultFor(field.value, symbols, [...record.path, field.name])}`);
        });
        declarations.push('}');
        declarations.push('');
      }
      root = symbols.get('');
      // json-as 1.5.0's slow struct scanner treats a closing quote after a
      // doubled backslash as escaped. A JSON-equivalent Unicode spelling avoids
      // that scanner defect without changing schema values or admitting fallback.
      declarations.push(`function ${decode}(input: string): string {`);
      declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
      declarations.push(`  return JSON.stringify<${root}>(value)`);
      declarations.push('}');
      declarations.push(`function ${encode}(input: string): string {`);
      declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
      declarations.push(`  return JSON.stringify<${root}>(value)`);
      declarations.push('}');
    }
    declarations.push('');
    codecEntries.push(Object.freeze({
      id: String(schema.id),
      index: schemaIndex,
      rootClass: root,
      decode,
      encode,
      semanticHash: registry.codecs && registry.codecs[schemaIndex] && registry.codecs[schemaIndex].semanticHash,
      nativeHash: registry.codecs && registry.codecs[schemaIndex] && registry.codecs[schemaIndex].native && registry.codecs[schemaIndex].native.hash
    }));
  });

  const exports = [
    "let __pulse_schema_result: string = ''",
    'export function pulse_schema_string_id(): i32 { return idof<string>() }',
    'export function pulse_schema_decode(schemaIndex: i32, inputPointer: i32): i32 {',
    '  const input = changetype<string>(inputPointer)',
    '  switch (schemaIndex) {',
    ...codecEntries.map((entry) => `    case ${entry.index}: __pulse_schema_result = ${entry.decode}(input); break`),
    "    default: abort('Unknown Pulse schema codec index', 'pulse-schema-codecs', 0, 0)",
    '  }',
    '  return changetype<i32>(__pulse_schema_result)',
    '}',
    'export function pulse_schema_encode(schemaIndex: i32, inputPointer: i32): i32 {',
    '  const input = changetype<string>(inputPointer)',
    '  switch (schemaIndex) {',
    ...codecEntries.map((entry) => `    case ${entry.index}: __pulse_schema_result = ${entry.encode}(input); break`),
    "    default: abort('Unknown Pulse schema codec index', 'pulse-schema-codecs', 0, 0)",
    '  }',
    '  return changetype<i32>(__pulse_schema_result)',
    '}',
    ''
  ];
  const source = [
    "import { JSON } from 'json-as'",
    '',
    ...declarations,
    ...exports
  ].join('\n');
  return Object.freeze({
    active: true,
    imports: Object.freeze(["import { JSON } from 'json-as'"]),
    declarations: Object.freeze(declarations),
    exports: Object.freeze(exports),
    codecs: Object.freeze(codecEntries),
    sourceHash: stableHash(source)
  });
}

module.exports = Object.freeze({ nativeSchemaCodecSource });
