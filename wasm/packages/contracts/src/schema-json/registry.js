'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');
const { JSON_LIMIT_FIELDS, normalizeJsonAdmissionLimits } = require('./admission.js');

const SCHEMA_REGISTRY_IR_VERSION = 'pulse.schema-registry-ir.v4';
const SCHEMA_CODEC_INPUTS_VERSION = 'pulse.schema-codec-inputs.v4';
const SCHEMA_AUTHORING_VERSION = 'pulse.schema-authoring.v2';
const SCHEMA_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;
const RESPONSE_CASE_ID_PATTERN = SCHEMA_ID_PATTERN;
const SCALAR_KINDS = Object.freeze(['string', 'boolean', 'i32', 'u32', 'f64']);
const NODE_KINDS = Object.freeze([...SCALAR_KINDS, 'object', 'array', 'string-enum', 'nullable', 'scalar-record', 'json-value', 'json-object']);
const SCALAR_RECORD_LIMITS = Object.freeze({ maxKeys: 32, maxKeyLength: 64, maxStringLength: 1024, maxBytes: 8192, numberBytes: 24 });
const JSON_SCHEMA_DEFAULT_LIMITS = Object.freeze({ maxTextBytes: 65536, maxDepth: 32, maxNodes: 4096,
  maxObjectMembers: 256, maxArrayItems: 1024, maxKeyLength: 256, maxStringLength: 16384, maxJsonBytes: 65536 });

function normalizeJsonSchemaLimits(input = {}) {
  if (!plainObject(input)) throw schemaContractError('PULSE_SCHEMA_JSON_LIMITS_INVALID', 'Schema JSON limits must be a static object.');
  const values = { ...JSON_SCHEMA_DEFAULT_LIMITS };
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!JSON_LIMIT_FIELDS.includes(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw schemaContractError('PULSE_SCHEMA_JSON_LIMITS_INVALID', 'Unknown JSON limit or non-data property.');
    }
    values[key] = descriptor.value;
  }
  try { return normalizeJsonAdmissionLimits(values); }
  catch { throw schemaContractError('PULSE_SCHEMA_JSON_LIMITS_INVALID', 'JSON limits must be positive i32 integers.'); }
}

// Shared conservative UTF-8 JSON string sizing. Native code generation reuses
// this pure function body; keep it independent of host APIs and mutable state.
function scalarRecordStringBytes(text) {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32) bytes += 6;
    else if (code === 34 || code === 92) bytes += 2;
    else if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

function schemaContractError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw schemaContractError('PULSE_SCHEMA_IR_STRING_REQUIRED', `${field} must be a non-empty string.`, { field, value });
  }
  return value.trim();
}

function normalizeSource(input, field) {
  if (!plainObject(input)) {
    throw schemaContractError('PULSE_SCHEMA_IR_SOURCE_REQUIRED', `${field} must identify a source location.`, { field });
  }
  const line = Number(input.line);
  const column = Number(input.column);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw schemaContractError('PULSE_SCHEMA_IR_SOURCE_INVALID', `${field} requires positive line and column values.`, {
      field,
      line,
      column
    });
  }
  return Object.freeze({
    file: requiredString(input.file, `${field}.file`).replace(/\\/g, '/'),
    line,
    column
  });
}

function normalizeId(value, field, pattern, code) {
  const id = requiredString(value, field);
  if (!pattern.test(id)) {
    throw schemaContractError(code, `${field} must be a stable dotted identifier.`, { field, id });
  }
  return id;
}

function normalizeSchemaNode(input, field = 'schema.root', stack = []) {
  if (!plainObject(input)) {
    throw schemaContractError('PULSE_SCHEMA_IR_NODE_REQUIRED', `${field} must be a normalized schema node.`, { field });
  }
  const kind = requiredString(input.kind, `${field}.kind`);
  if (!NODE_KINDS.includes(kind)) {
    throw schemaContractError('PULSE_SCHEMA_IR_NODE_KIND_UNSUPPORTED', `${field}.kind is unsupported: ${kind}.`, { field, kind });
  }
  if (SCALAR_KINDS.includes(kind)) return Object.freeze({ kind });
  if (kind === 'json-value' || kind === 'json-object') return Object.freeze({ kind });
  if (kind === 'scalar-record') {
    if (input.limits !== undefined && (!plainObject(input.limits)
      || stableStringify(input.limits) !== stableStringify(SCALAR_RECORD_LIMITS))) {
      throw schemaContractError('PULSE_SCHEMA_IR_NODE_KIND_UNSUPPORTED', `${field} must use the fixed ScalarRecord limits.`, { field, kind });
    }
    return Object.freeze({ kind, limits: SCALAR_RECORD_LIMITS });
  }
  if (kind === 'array') {
    return Object.freeze({ kind, element: normalizeSchemaNode(input.element, `${field}.element`, stack) });
  }
  if (kind === 'nullable') {
    const value = normalizeSchemaNode(input.value, `${field}.value`, stack);
    if (value.kind === 'nullable') {
      throw schemaContractError('PULSE_SCHEMA_IR_REDUNDANT_NULLABLE', `${field} cannot contain another nullable node.`, { field });
    }
    return Object.freeze({ kind, value });
  }
  if (kind === 'string-enum') {
    if (!Array.isArray(input.values) || input.values.length === 0) {
      throw schemaContractError('PULSE_SCHEMA_IR_ENUM_VALUES_REQUIRED', `${field}.values must contain at least one string literal.`, { field });
    }
    const values = input.values.map((value, index) => requiredString(value, `${field}.values[${index}]`));
    if (new Set(values).size !== values.length) {
      throw schemaContractError('PULSE_SCHEMA_IR_ENUM_VALUE_DUPLICATE', `${field}.values must be unique.`, { field, values });
    }
    return Object.freeze({ kind, values: Object.freeze(values) });
  }
  if (!Array.isArray(input.fields)) {
    throw schemaContractError('PULSE_SCHEMA_IR_OBJECT_FIELDS_REQUIRED', `${field}.fields must be an array.`, { field });
  }
  const names = new Set();
  const fields = input.fields.map((entry, index) => {
    if (!plainObject(entry)) {
      throw schemaContractError('PULSE_SCHEMA_IR_FIELD_REQUIRED', `${field}.fields[${index}] must be an object.`, { field, index });
    }
    const name = requiredString(entry.name, `${field}.fields[${index}].name`);
    if (names.has(name)) {
      throw schemaContractError('PULSE_SCHEMA_IR_FIELD_DUPLICATE', `${field} declares field ${name} more than once.`, { field, name });
    }
    names.add(name);
    if (typeof entry.required !== 'boolean') {
      throw schemaContractError('PULSE_SCHEMA_IR_FIELD_REQUIRED', `${field}.${name}.required must be a boolean.`, {
        field,
        name
      });
    }
    return Object.freeze({
      name,
      required: entry.required,
      value: normalizeSchemaNode(entry.value, `${field}.fields[${index}].value`, [...stack, name]),
      source: entry.source ? normalizeSource(entry.source, `${field}.fields[${index}].source`) : undefined
    });
  });
  return Object.freeze({ kind, fields: Object.freeze(fields) });
}

function normalizeSchema(input, index) {
  if (!plainObject(input)) {
    throw schemaContractError('PULSE_SCHEMA_IR_SCHEMA_REQUIRED', `schemas[${index}] must be an object.`, { index });
  }
  const id = normalizeId(input.id, `schemas[${index}].id`, SCHEMA_ID_PATTERN, 'PULSE_SCHEMA_ID_INVALID');
  const root = normalizeSchemaNode(input.root, `schemas[${index}].root`);
  if (root.kind !== 'object') {
    throw schemaContractError('PULSE_SCHEMA_ROOT_OBJECT_REQUIRED', `Schema ${id} must have an object root.`, { id, kind: root.kind });
  }
  return Object.freeze({
    id,
    typeName: requiredString(input.typeName, `schemas[${index}].typeName`),
    root,
    ...(input.jsonLimits !== undefined || schemaHasNestedJson(root)
      ? { jsonLimits: normalizeJsonSchemaLimits(input.jsonLimits) } : {}),
    source: normalizeSource(input.source, `schemas[${index}].source`)
  });
}

function normalizeResponseCase(input, index) {
  if (!plainObject(input)) {
    throw schemaContractError('PULSE_RESPONSE_CASE_REQUIRED', `responses[${index}] must be an object.`, { index });
  }
  const status = Number(input.status);
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw schemaContractError('PULSE_RESPONSE_STATUS_INVALID', `responses[${index}].status must be an integer from 100 through 599.`, {
      index,
      status
    });
  }
  return Object.freeze({
    id: normalizeId(input.id, `responses[${index}].id`, RESPONSE_CASE_ID_PATTERN, 'PULSE_RESPONSE_CASE_ID_INVALID'),
    status,
    schemaId: normalizeId(input.schemaId, `responses[${index}].schemaId`, SCHEMA_ID_PATTERN, 'PULSE_SCHEMA_ID_INVALID'),
    source: normalizeSource(input.source, `responses[${index}].source`)
  });
}

function assertUnique(entries, field, code) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw schemaContractError(code, `${field} contains duplicate ID ${entry.id}.`, { field, id: entry.id });
    }
    seen.add(entry.id);
  }
}

function normalizeSchemaRegistry(input) {
  if (!plainObject(input)) {
    throw schemaContractError('PULSE_SCHEMA_REGISTRY_REQUIRED', 'Schema registry IR must be an object.');
  }
  const schemas = Object.freeze((input.schemas || []).map(normalizeSchema));
  const responses = Object.freeze((input.responses || []).map(normalizeResponseCase));
  assertUnique(schemas, 'schemas', 'PULSE_SCHEMA_ID_DUPLICATE');
  assertUnique(responses, 'responses', 'PULSE_RESPONSE_CASE_ID_DUPLICATE');
  const schemaIds = new Set(schemas.map((entry) => entry.id));
  for (const entry of responses) {
    if (!schemaIds.has(entry.schemaId)) {
      throw schemaContractError(
        'PULSE_RESPONSE_SCHEMA_UNKNOWN',
        `Response case ${entry.id} references unknown schema ${entry.schemaId}.`,
        { responseCaseId: entry.id, schemaId: entry.schemaId }
      );
    }
  }
  const semantic = {
    version: SCHEMA_REGISTRY_IR_VERSION,
    source: normalizeSource(input.source, 'source'),
    schemas,
    responses,
    policies: deepFreeze({
      objectRoots: true,
      requiredFieldsOnly: false,
      optionalFields: 'omit-absent-own-properties',
      presentUndefined: 'reject',
      unknownInputFields: 'drop',
      outputFields: 'declared-only',
      outputFieldOrder: 'declaration',
      scalarRecords: 'bounded-own-scalar-properties',
      scalarRecordDuplicateKeys: 'reject-after-unescaping',
      nestedJson: 'bounded-recursive-json-values',
      nestedJsonDuplicateKeys: 'reject-after-unescaping',
      jsonAdmission: 'whole-document-before-materialization',
      numericPolicy: 'finite-rfc-json',
      parity: 'semantic',
      dynamicIds: false,
      schemaTrialFallback: false,
      publicDecorators: false
    })
  };
  return deepFreeze({
    ...semantic,
    registryHash: sha256Hex(stableStringify(semantic))
  });
}

function assemblyScriptType(node, symbols, pathParts) {
  switch (node.kind) {
    case 'string': return 'string';
    case 'boolean': return 'bool';
    case 'i32': return 'i32';
    case 'u32': return 'u32';
    case 'f64': return 'f64';
    case 'string-enum': return 'string';
    case 'array': return `Array<${assemblyScriptType(node.element, symbols, [...pathParts, 'item'])}>`;
    case 'nullable': return `${assemblyScriptType(node.value, symbols, [...pathParts, 'value'])} | null`;
    case 'object': {
      const key = pathParts.join('.');
      return symbols.get(key);
    }
    default: throw schemaContractError('PULSE_SCHEMA_IR_NODE_KIND_UNSUPPORTED', `Unsupported schema node kind ${node.kind}.`);
  }
}

function identifier(value) {
  const normalized = String(value).normalize('NFKC').replace(/[^A-Za-z0-9_$]+/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function collectNativeClasses(schema, node, symbols, classes, pathParts = []) {
  if (node.kind === 'nullable') return collectNativeClasses(schema, node.value, symbols, classes, [...pathParts, 'value']);
  if (node.kind === 'array') return collectNativeClasses(schema, node.element, symbols, classes, [...pathParts, 'item']);
  if (node.kind !== 'object') return;
  const key = pathParts.join('.');
  const symbol = `__Pulse_${identifier(schema.id)}${pathParts.length === 0 ? '' : `_${pathParts.map(identifier).join('_')}`}`;
  symbols.set(key, symbol);
  for (const field of node.fields) collectNativeClasses(schema, field.value, symbols, classes, [...pathParts, field.name]);
  classes.push(Object.freeze({
    symbol,
    schemaId: schema.id,
    path: pathParts.length === 0 ? '' : `/${pathParts.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
    fields: Object.freeze(node.fields.map((field) => Object.freeze({
      name: field.name,
      type: assemblyScriptType(field.value, symbols, [...pathParts, field.name]),
      required: field.required,
      constraints: field.value.kind === 'string-enum'
        ? Object.freeze({ enum: field.value.values })
        : Object.freeze({})
    })))
  }));
}

function schemaHasOptionalProperties(node) {
  if (node.kind === 'nullable') return schemaHasOptionalProperties(node.value);
  if (node.kind === 'array') return schemaHasOptionalProperties(node.element);
  return node.kind === 'object' && node.fields.some(field => !field.required || schemaHasOptionalProperties(field.value));
}

function schemaHasScalarRecord(node) {
  if (node.kind === 'scalar-record') return true;
  if (node.kind === 'nullable') return schemaHasScalarRecord(node.value);
  if (node.kind === 'array') return schemaHasScalarRecord(node.element);
  return node.kind === 'object' && node.fields.some(field => schemaHasScalarRecord(field.value));
}

function schemaNeedsValueProjection(node) {
  return schemaHasOptionalProperties(node) || schemaHasScalarRecord(node) || schemaHasNestedJson(node);
}

function schemaHasNestedJson(node) {
  if (node.kind === 'json-value' || node.kind === 'json-object') return true;
  if (node.kind === 'nullable') return schemaHasNestedJson(node.value);
  if (node.kind === 'array') return schemaHasNestedJson(node.element);
  return node.kind === 'object' && node.fields.some(field => schemaHasNestedJson(field.value));
}

function codecInputsForRegistry(registryInput) {
  const registry = normalizeSchemaRegistry(registryInput);
  const nativeSchemas = registry.schemas.map((schema) => {
    const schemaClasses = [];
    const symbols = new Map();
    const presence = schemaNeedsValueProjection(schema.root) || Boolean(schema.jsonLimits);
    if (!presence) collectNativeClasses(schema, schema.root, symbols, schemaClasses);
    const rootClass = presence ? 'JSON.Value' : symbols.get('');
    return Object.freeze({
      id: schema.id,
      rootClass,
      representation: presence ? 'schema-projected-json-value' : 'required-struct',
      classes: Object.freeze(schemaClasses),
      parse: `JSON.parse<${rootClass}>`,
      stringify: `JSON.stringify<${rootClass}>`
    });
  });
  return deepFreeze({
    version: SCHEMA_CODEC_INPUTS_VERSION,
    registryVersion: registry.version,
    registryHash: registry.registryHash,
    javascript: {
      backend: 'pulse-generated',
      operation: 'direct-parse-or-serialize',
      schemas: registry.schemas,
      policies: registry.policies
    },
    native: {
      backend: 'json-as',
      package: 'json-as',
      packageVersion: '1.5.0',
      transform: 'json-as',
      assemblyScriptVersion: '0.28.18',
      generatedOnly: true,
      publicDecorators: false,
      schemas: Object.freeze(nativeSchemas)
    },
    responses: registry.responses
  });
}

function defaultSchemaBoundaryPolicy() {
  return deepFreeze({
    strict: {
      missingSchemaId: 'diagnostic',
      knownSchemaId: 'schema-codec',
      unknownSchemaId: 'diagnostic'
    },
    nonStrict: {
      missingSchemaId: 'generic-json',
      knownSchemaId: 'schema-codec',
      unknownSchemaId: 'diagnostic'
    },
    suppliedIds: 'string-literal-only',
    genericJsonFallbackForUnknownId: false,
    schemaTrialFallback: false,
    jsonBodyOwnership: 'pulse-semantic-encoding',
    bodyOwnership: 'caller-exact-payload',
    bodyAndJsonMutuallyExclusive: true
  });
}

function defaultSchemaRegistryContract() {
  return deepFreeze({
    authoringVersion: SCHEMA_AUTHORING_VERSION,
    registryVersion: SCHEMA_REGISTRY_IR_VERSION,
    codecInputsVersion: SCHEMA_CODEC_INPUTS_VERSION,
    schemaIdPattern: SCHEMA_ID_PATTERN.source,
    responseCaseIdPattern: RESPONSE_CASE_ID_PATTERN.source,
    scalarKinds: SCALAR_KINDS,
    nodeKinds: NODE_KINDS,
    helpers: ['defineSchemaRegistry', 'schema', 'response'],
    markerTypes: ['Int32', 'Uint32', 'ScalarRecord', 'JsonValue', 'JsonObject'],
    scalarRecordLimits: SCALAR_RECORD_LIMITS,
    jsonDefaultLimits: JSON_SCHEMA_DEFAULT_LIMITS,
    policies: {
      canonicalEntrypoint: 'pulse.schema',
      defaultExportRequired: true,
      staticObjectLiteralsOnly: true,
      stableStringIds: true,
      exactLiteralIdsAtBoundaries: true,
      oldSchemasJsonSupported: false,
      optionalPropertiesSupported: true,
      scalarRecordsSupported: true,
      nestedJsonSupported: true,
      staticJsonLimitsSupported: true,
      recursiveSchemasSupported: false,
      publicJsonAsImportsSupported: false,
      automaticFallback: false
    },
    boundaryPolicy: defaultSchemaBoundaryPolicy()
  });
}

module.exports = Object.freeze({
  SCHEMA_REGISTRY_IR_VERSION,
  SCHEMA_CODEC_INPUTS_VERSION,
  SCHEMA_AUTHORING_VERSION,
  SCHEMA_ID_PATTERN,
  RESPONSE_CASE_ID_PATTERN,
  SCALAR_KINDS,
  NODE_KINDS,
  SCALAR_RECORD_LIMITS,
  JSON_SCHEMA_DEFAULT_LIMITS,
  normalizeJsonSchemaLimits,
  scalarRecordStringBytes,
  schemaContractError,
  normalizeSchemaNode,
  normalizeSchemaRegistry,
  codecInputsForRegistry,
  schemaHasOptionalProperties,
  schemaHasScalarRecord,
  schemaHasNestedJson,
  schemaNeedsValueProjection,
  defaultSchemaBoundaryPolicy,
  defaultSchemaRegistryContract
});
