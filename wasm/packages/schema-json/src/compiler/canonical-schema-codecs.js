'use strict';

const crypto = require('node:crypto');
const {
  SCHEMA_REGISTRY_IR_VERSION,
  normalizeSchemaRegistry,
  scalarRecordStringBytes,
  schemaHasScalarRecord,
  schemaHasNestedJson
} = require('@pulse-compute/wasm-contracts/schema-json/registry');
const { projectScalarRecord, validateScalarRecordText } = require('./scalar-record-codec.js');
const { javascriptJsonAdmissionSource } = require('./json-admission.js');
const {
  normalizeJsonTraceEvent,
  semanticValueDigest
} = require('@pulse-compute/wasm-contracts/schema-json/semantic-trace');

const CANONICAL_SCHEMA_BUNDLE_VERSION = 'pulse.canonical-schema-bundle.v3';
const CANONICAL_SCHEMA_REGISTRY_VERSION = 'pulse.canonical-schema-registry.v3';
const CANONICAL_SCHEMA_CODECS_VERSION = 'pulse.canonical-schema-codecs.v3';
const JAVASCRIPT_SCHEMA_CODEC_VERSION = 'pulse.javascript-schema-codec.v3';
const NATIVE_SCHEMA_CODEC_VERSION = 'pulse.native-json-as-schema-codec.v3';

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = stableObject(value[key]);
  }
  return output;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

function identifier(value) {
  const normalized = String(value || 'schema').normalize('NFKC').replace(/[^A-Za-z0-9_$]+/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function legacyNode(type) {
  const kind = String(type) === 'bool' ? 'boolean' : String(type);
  if (!['string', 'boolean', 'i32', 'u32', 'f64'].includes(kind)) {
    throw new TypeError(`Canonical legacy schema field uses unsupported type ${String(type)}.`);
  }
  return Object.freeze({ kind });
}

function legacyRegistry(compiledSchemas) {
  const schemas = compiledSchemas.map((schema, schemaIndex) => Object.freeze({
    id: String(schema.id),
    typeName: String(schema.type || schema.name || `Schema${schemaIndex + 1}`),
    root: Object.freeze({
      kind: 'object',
      fields: Object.freeze((schema.fields || []).map((field, fieldIndex) => Object.freeze({
        name: String(field.name),
        required: true,
        value: legacyNode(field.type),
        source: Object.freeze({
          file: String(schema.source || '<legacy-schema>'),
          line: fieldIndex + 1,
          column: 1
        })
      })))
    }),
    source: Object.freeze({
      file: String(schema.source || '<legacy-schema>'),
      line: schemaIndex + 1,
      column: 1
    })
  }));
  return normalizeSchemaRegistry({
    source: Object.freeze({ file: '<legacy-schema-registry>', line: 1, column: 1 }),
    schemas,
    responses: Object.freeze([])
  });
}

function canonicalRegistry(input, options = {}) {
  const registryIr = Array.isArray(input)
    ? legacyRegistry(input)
    : normalizeSchemaRegistry(input || {
        source: Object.freeze({ file: '<empty-schema-registry>', line: 1, column: 1 }),
        schemas: Object.freeze([]),
        responses: Object.freeze([])
      });
  const contentTypePolicy = String(options.contentTypePolicy || 'accept-json-or-missing');
  if (!['accept-json-or-missing', 'require-json'].includes(contentTypePolicy)) {
    throw new TypeError(`Unsupported canonical schema content-type policy ${contentTypePolicy}.`);
  }
  const configuredMaxBytes = Number(options.maxBytes);
  const maxBytes = Number.isSafeInteger(configuredMaxBytes) && configuredMaxBytes > 0
    ? configuredMaxBytes
    : 65_536;
  const codecEntries = registryIr.schemas.map((schema, schemaIndex) => {
    const semantic = {
      registryVersion: registryIr.version,
      registryHash: registryIr.registryHash,
      id: schema.id,
      root: schema.root,
      ...(schema.jsonLimits ? { jsonLimits: schema.jsonLimits, boundaryMaxBytes: maxBytes } : {}),
      policies: registryIr.policies
    };
    const semanticHash = stableHash(semantic);
    return Object.freeze({
      id: schema.id,
      semanticHash,
      javascript: Object.freeze({
        version: JAVASCRIPT_SCHEMA_CODEC_VERSION,
        symbol: `__pulse_schema_${identifier(schema.id)}_${schemaIndex}`,
        hash: stableHash(`${JAVASCRIPT_SCHEMA_CODEC_VERSION}:${semanticHash}`)
      }),
      native: Object.freeze({
        version: NATIVE_SCHEMA_CODEC_VERSION,
        backend: 'json-as',
        packageVersion: '1.5.0',
        symbol: `__Pulse_${identifier(schema.id)}_${schemaIndex}`,
        hash: stableHash(`${NATIVE_SCHEMA_CODEC_VERSION}:json-as@1.5.0:${semanticHash}`)
      })
    });
  });
  const semantic = {
    version: CANONICAL_SCHEMA_REGISTRY_VERSION,
    registryIrVersion: SCHEMA_REGISTRY_IR_VERSION,
    registryHash: registryIr.registryHash,
    contentTypePolicy,
    maxBytes,
    policies: registryIr.policies,
    schemas: registryIr.schemas,
    responses: registryIr.responses,
    codecs: codecEntries
  };
  return deepFreeze({
    ...semantic,
    codecTableHash: stableHash(codecEntries),
    sourceHash: stableHash(semantic)
  });
}

function schemaFunctionName(registry, schemaIndex) {
  return registry.codecs[schemaIndex].javascript.symbol;
}

function renderCanonicalSchemaCodecDeclaration(registryInput, options = {}) {
  const registry = registryInput && registryInput.version === CANONICAL_SCHEMA_REGISTRY_VERSION
    ? registryInput
    : canonicalRegistry(registryInput, options);
  const registryName = options.registryName || '__pulse_schema_registry';
  const codecsName = options.codecsName || '__pulse_schema_codecs';
  const lines = [];
  lines.push(`const ${registryName} = Object.freeze(${JSON.stringify(registry, null, 2)});`);
  const scalarRecords = registry.schemas.some(schema => schemaHasScalarRecord(schema.root));
  const nestedJson = registry.schemas.some(schema => schemaHasNestedJson(schema.root));
  const admission = registry.schemas.some(schema => schema.jsonLimits);
  if (admission) lines.push(javascriptJsonAdmissionSource());
  if (scalarRecords || nestedJson) {
    // Keep generated declarations in the existing reserved schema namespace.
    for (const helper of [scalarRecordStringBytes, projectScalarRecord, validateScalarRecordText]) {
      lines.push(helper.toString().replace(/\b(scalarRecordStringBytes|projectScalarRecord|validateScalarRecordText)\b/g, name => '__pulse_schema_' + name));
    }
  }
  lines.push('function __pulse_schema_kind(value) {');
  lines.push("  if (value === null) return 'null';");
  lines.push("  if (Array.isArray(value)) return 'array';");
  lines.push("  if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite-number';");
  lines.push('  return typeof value;');
  lines.push('}');
  lines.push('function __pulse_schema_pointer(path, segment) {');
  lines.push("  const escaped = String(segment).replace(/~/g, '~0').replace(/\\//g, '~1');");
  lines.push("  return (path || '') + '/' + escaped;");
  lines.push('}');
  lines.push('function __pulse_schema_failure(mode, code, schemaId, path, expected, actual, source, cause) {');
  lines.push("  const encode = mode === 'encode';");
  lines.push("  const error = new Error((encode ? 'Schema encode' : 'Schema decode') + ' failed for ' + schemaId + (path || '') + ': expected ' + expected + ', received ' + actual + '.');");
  lines.push("  error.name = encode ? 'SchemaEncodeError' : 'SchemaDecodeError';");
  lines.push("  error.code = code || (encode ? 'PULSE_SCHEMA_ENCODE' : 'PULSE_SCHEMA_DECODE');");
  lines.push('  error.detail = Object.freeze({ schemaId: String(schemaId), path: path || null, expected, actualKind: actual, source: String(source || mode) });');
  lines.push('  if (cause !== undefined) error.cause = cause;');
  lines.push('  return error;');
  lines.push('}');
  lines.push('function __pulse_schema_reference_error(schemaId, source) {');
  lines.push("  const error = new Error('Unknown compiled schema ' + String(schemaId) + '.');");
  lines.push("  error.name = 'SchemaReferenceError';");
  lines.push("  error.code = 'PULSE_SCHEMA_REFERENCE';");
  lines.push("  error.detail = Object.freeze({ schemaId: String(schemaId), source: String(source || 'schema') });");
  lines.push('  return error;');
  lines.push('}');
  lines.push('function __pulse_schema_data_value(value, field, mode, schemaId, path, source) {');
  lines.push('  const descriptor = Object.getOwnPropertyDescriptor(value, field);');
  lines.push("  if (!descriptor) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'required', 'missing', source);");
  lines.push("  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'data-property', 'accessor', source);");
  lines.push('  return descriptor.value;');
  lines.push('}');
  lines.push('function __pulse_schema_apply_node(node, value, mode, schemaId, path, source) {');
  lines.push('  const kind = node.kind;');
  if (nestedJson) {
    lines.push("  if (kind === 'json-value') return value;");
    lines.push("  if (kind === 'json-object') {");
    lines.push("    if (!value || typeof value !== 'object' || Array.isArray(value)) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'json-object', __pulse_schema_kind(value), source);");
    lines.push('    return value;', '  }');
  }
  if (scalarRecords) {
    lines.push("  if (kind === 'scalar-record') return __pulse_schema_projectScalarRecord(value, node.limits, (key, expected, actual) => {");
    lines.push('    throw __pulse_schema_failure(mode, undefined, schemaId, key === null ? path : __pulse_schema_pointer(path, key), expected, actual, source);');
    lines.push('  });');
  }
  lines.push("  if (kind === 'nullable') {");
  lines.push("    if (value === null) return null;");
  lines.push('    return __pulse_schema_apply_node(node.value, value, mode, schemaId, path, source);');
  lines.push('  }');
  lines.push("  if (kind === 'string') {");
  lines.push("    if (typeof value !== 'string') throw __pulse_schema_failure(mode, undefined, schemaId, path, 'string', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'boolean') {");
  lines.push("    if (typeof value !== 'boolean') throw __pulse_schema_failure(mode, undefined, schemaId, path, 'boolean', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'i32') {");
  lines.push("    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'i32', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'u32') {");
  lines.push("    if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'u32', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'f64') {");
  lines.push("    if (typeof value !== 'number' || !Number.isFinite(value)) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'finite-f64', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'string-enum') {");
  lines.push("    if (typeof value !== 'string' || !node.values.includes(value)) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'enum(' + node.values.map(JSON.stringify).join('|') + ')', __pulse_schema_kind(value), source);");
  lines.push('    return value;');
  lines.push('  }');
  lines.push("  if (kind === 'array') {");
  lines.push("    if (!Array.isArray(value)) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'array', __pulse_schema_kind(value), source);");
  lines.push('    return Object.freeze(value.map((entry, index) => __pulse_schema_apply_node(node.element, entry, mode, schemaId, __pulse_schema_pointer(path, index), source)));');
  lines.push('  }');
  lines.push("  if (kind === 'object') {");
  lines.push("    if (!value || typeof value !== 'object' || Array.isArray(value)) throw __pulse_schema_failure(mode, undefined, schemaId, path, 'object', __pulse_schema_kind(value), source);");
  lines.push('    const output = {};');
  lines.push('    for (const field of node.fields) {');
  lines.push("      if (!field.required && !Object.prototype.hasOwnProperty.call(value, field.name)) continue;");
  lines.push('      const fieldPath = __pulse_schema_pointer(path, field.name);');
  lines.push('      const fieldValue = __pulse_schema_data_value(value, field.name, mode, schemaId, fieldPath, source);');
  lines.push('      Object.defineProperty(output, field.name, { enumerable: true, configurable: false, writable: false, value: __pulse_schema_apply_node(field.value, fieldValue, mode, schemaId, fieldPath, source) });');
  lines.push('    }');
  lines.push('    return Object.freeze(output);');
  lines.push('  }');
  lines.push("  throw __pulse_schema_failure(mode, undefined, schemaId, path, 'supported-schema-node', String(kind), source);");
  lines.push('}');

  registry.schemas.forEach((schema, index) => {
    const fn = schemaFunctionName(registry, index);
    lines.push(`function ${fn}(value, mode, source) {`);
    if (schema.jsonLimits) {
      lines.push(`  try { value = __pulse_schema_inspectJsonValue(value, ${registryName}.schemas[${index}].jsonLimits, true).value; }`);
      lines.push(`  catch (cause) { throw __pulse_schema_failure(mode, undefined, ${JSON.stringify(schema.id)}, '', 'bounded-json', cause.detail?.reason || 'unsupported-value', source, cause); }`);
    }
    lines.push(`  return __pulse_schema_apply_node(${registryName}.schemas[${index}].root, value, mode, ${JSON.stringify(schema.id)}, '', source);`);
    lines.push('}');
  });

  lines.push('function __pulse_schema_apply(schemaId, value, mode, source) {');
  lines.push('  switch (String(schemaId)) {');
  for (let index = 0; index < registry.schemas.length; index += 1) {
    const schema = registry.schemas[index];
    lines.push(`    case ${JSON.stringify(schema.id)}: return ${schemaFunctionName(registry, index)}(value, mode, source);`);
  }
  lines.push('    default: throw __pulse_schema_reference_error(schemaId, source);');
  lines.push('  }');
  lines.push('}');
  lines.push(`const ${codecsName} = Object.freeze({`);
  lines.push(`  version: ${JSON.stringify(CANONICAL_SCHEMA_CODECS_VERSION)},`);
  lines.push(`  registry: ${registryName},`);
  lines.push(`  ids: Object.freeze(${JSON.stringify(registry.schemas.map((schema) => schema.id))}),`);
  lines.push(`  responseCaseIds: Object.freeze(${JSON.stringify(registry.responses.map((entry) => entry.id))}),`);
  lines.push(`  codecTableHash: ${JSON.stringify(registry.codecTableHash)},`);
  lines.push('  has(schemaId) { return this.ids.includes(String(schemaId)); },');
  lines.push('  schema(schemaId) { return this.registry.schemas.find((entry) => entry.id === String(schemaId)); },');
  lines.push('  responseCase(responseCaseId) { return this.registry.responses.find((entry) => entry.id === String(responseCaseId)); },');
  lines.push('  codec(schemaId) { return this.registry.codecs.find((entry) => entry.id === String(schemaId)); },');
  lines.push("  decode(schemaId, value, source = 'json') { return __pulse_schema_apply(schemaId, value, 'decode', source); },");
  lines.push("  encode(schemaId, value, source = 'response') { return __pulse_schema_apply(schemaId, value, 'encode', source); },");
  lines.push("  decodeJsonText(schemaId, text, source = 'json') {");
  lines.push('    const schema = this.schema(schemaId);');
  lines.push('    if (!schema) throw __pulse_schema_reference_error(schemaId, source);');
  if (admission) {
    lines.push('    let duplicates = [];');
    lines.push('    if (schema.jsonLimits) {');
    lines.push('      const limits = { ...schema.jsonLimits, maxTextBytes: Math.min(schema.jsonLimits.maxTextBytes, this.registry.maxBytes) };');
    lines.push('      const scan = new __pulse_schema_JsonTextAdmission(String(text), limits, 2);');
    lines.push("      if (!scan.scan()) throw __pulse_schema_failure('decode', scan.failure === 1 ? 'PULSE_SCHEMA_JSON_MALFORMED' : scan.failure === 2 ? 'PULSE_BODY_TOO_LARGE' : undefined, String(schemaId), '', 'bounded-json', __pulse_schema_JSON_ADMISSION_FAILURES[scan.failure], source);");
    lines.push('      duplicates = scan.duplicateObjects;', '    }');
  }
  if ((scalarRecords || nestedJson) && admission) {
    lines.push("    if (schema.jsonLimits) __pulse_schema_validateScalarRecordText(String(text), schema.root, (path, expected, actual) => { throw __pulse_schema_failure('decode', undefined, String(schemaId), path, expected, actual, source); }, duplicates);");
  }
  lines.push('    let value;');
  lines.push('    try { value = JSON.parse(String(text)); }');
  lines.push("    catch (cause) { throw __pulse_schema_failure('decode', 'PULSE_SCHEMA_JSON_MALFORMED', String(schemaId), '', 'valid-json', 'malformed-json', source, cause); }");
  if (scalarRecords) {
    lines.push("    if (!schema.jsonLimits) __pulse_schema_validateScalarRecordText(String(text), schema.root, (path, expected, actual) => { throw __pulse_schema_failure('decode', undefined, String(schemaId), path, expected, actual, source); });");
  }
  lines.push("    return __pulse_schema_apply(schemaId, value, 'decode', source);");
  lines.push('  },');
  lines.push("  encodeJsonText(schemaId, value, source = 'response') {");
  lines.push("    const normalized = __pulse_schema_apply(schemaId, value, 'encode', source);");
  lines.push('    let text;');
  lines.push('    try { text = JSON.stringify(normalized); }');
  lines.push("    catch (cause) { throw __pulse_schema_failure('encode', 'PULSE_SCHEMA_ENCODE', String(schemaId), '', 'serializable-json', __pulse_schema_kind(normalized), source, cause); }");
  if (admission) {
    lines.push('    const schema = this.schema(schemaId);');
    lines.push('    if (schema.jsonLimits) {');
    lines.push('      const limits = { ...schema.jsonLimits, maxTextBytes: Math.min(schema.jsonLimits.maxTextBytes, this.registry.maxBytes) };');
    lines.push('      const scan = new __pulse_schema_JsonTextAdmission(text, limits, 0);');
    lines.push("      if (!scan.scan()) throw __pulse_schema_failure('encode', scan.failure === 2 ? 'PULSE_BODY_TOO_LARGE' : undefined, String(schemaId), '', 'bounded-json', __pulse_schema_JSON_ADMISSION_FAILURES[scan.failure], source);");
    lines.push('    }');
  }
  lines.push('    return text;');
  lines.push('  }');
  lines.push('});');
  return `${lines.join('\n')}\n`;
}

function createCanonicalSchemaCodecs(registryInput, options = {}) {
  const registry = registryInput && registryInput.version === CANONICAL_SCHEMA_REGISTRY_VERSION
    ? registryInput
    : canonicalRegistry(registryInput, options);
  const declaration = renderCanonicalSchemaCodecDeclaration(registry, options);
  // The source is produced exclusively from normalized, JSON-serialized schema
  // IR. Evaluating it here keeps the in-memory JavaScript target and emitted
  // build artifact on the exact same generated implementation.
  const generated = Function(`${declaration}\nreturn ${options.codecsName || '__pulse_schema_codecs'};`)();
  return Object.freeze({
    ...generated,
    createTraceEvent(input, traceOptions = {}) {
      const { semanticValue, ...event } = input || {};
      return normalizeJsonTraceEvent({
        ...event,
        valueDigest: semanticValue === undefined
          ? null
          : semanticValueDigest(semanticValue, { redact: traceOptions.redact })
      });
    }
  });
}

function buildCanonicalSchemaBundle(registryInput = [], options = {}) {
  const registry = canonicalRegistry(registryInput, options);
  const declarationSource = renderCanonicalSchemaCodecDeclaration(registry, options);
  const codecsName = options.codecsName || '__pulse_schema_codecs';
  const moduleSource = `${declarationSource}
const {
  normalizeJsonTraceEvent: __pulse_normalize_json_trace_event,
  semanticValueDigest: __pulse_semantic_value_digest
} = require('@pulse-compute/wasm-contracts/schema-json/semantic-trace');
module.exports = Object.freeze({
  ...${codecsName},
  createTraceEvent(input, traceOptions = {}) {
    const { semanticValue, ...event } = input || {};
    return __pulse_normalize_json_trace_event({
      ...event,
      valueDigest: semanticValue === undefined
        ? null
        : __pulse_semantic_value_digest(semanticValue, { redact: traceOptions.redact })
    });
  }
});
`;
  return Object.freeze({
    version: CANONICAL_SCHEMA_BUNDLE_VERSION,
    registry,
    declarationSource,
    moduleSource,
    active: registry.schemas.length > 0,
    schemaIds: Object.freeze(registry.schemas.map((schema) => schema.id)),
    responseCaseIds: Object.freeze(registry.responses.map((entry) => entry.id)),
    codecTableHash: registry.codecTableHash,
    sourceHash: registry.sourceHash,
    fullCodecRealization: true
  });
}

module.exports = Object.freeze({
  CANONICAL_SCHEMA_BUNDLE_VERSION,
  CANONICAL_SCHEMA_REGISTRY_VERSION,
  CANONICAL_SCHEMA_CODECS_VERSION,
  JAVASCRIPT_SCHEMA_CODEC_VERSION,
  NATIVE_SCHEMA_CODEC_VERSION,
  buildCanonicalSchemaBundle,
  canonicalRegistry,
  createCanonicalSchemaCodecs,
  renderCanonicalSchemaCodecDeclaration,
  stableHash,
  stableStringify
});
