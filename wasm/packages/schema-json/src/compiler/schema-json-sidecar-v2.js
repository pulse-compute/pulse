'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const { spawnSync } = require('node:child_process');
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const { resolveAsc } = require('@pulse-compute/wasm-build-support/assemblyscript-compile');
const {
  SCHEMA_JSON_SIDECAR_VERSION,
  SCHEMA_JSON_PLAN_VERSION,
  SCHEMA_JSON_REPORT_VERSION,
  SCHEMA_JSON_SMOKE_VERSION,
  SCHEMA_JSON_REGISTRY_VERSION,
  SCHEMA_JSON_ABI_VERSION,
  SCHEMA_JSON_BODY_POLICY_VERSION,
  PHASE,
  SCALAR_TYPES,
  RESERVED_SCALAR_TYPES,
  CONTENT_TYPE_POLICIES,
  DEFAULT_SCHEMA_JSON_NAMESPACE,
  DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY,
  lowerScalar,
  descriptorNeedsV2,
  shouldUseSchemaJsonV2
} = loadContractsSchemaJsonV2();


function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadContractsSchemaJsonV2() {
  try {
    return require('@pulse-compute/wasm-contracts/schema-json/v2');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/schema-json/v2.js');
    }
    throw error;
  }
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function makeFile(file, text) {
  return { file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text), text };
}
function stableSlash(value) { return String(value || '').replace(/\\/g, '/'); }
function kebab(value) {
  return String(value || 'schema')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'schema';
}
function safeIdentifier(value, fallback = 'Schema') {
  const raw = String(value || fallback).replace(/[^A-Za-z0-9_$]/g, '_');
  const cleaned = raw.length > 0 ? raw : fallback;
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}
function namespaceIdentifier(namespace) {
  return safeIdentifier(String(namespace || 'app').replace(/[^A-Za-z0-9_$]/g, '_'), 'app');
}
function schemaSymbol(schema) {
  return `${namespaceIdentifier(schema.namespace)}_${safeIdentifier(schema.type)}`;
}
function asString(value) { return JSON.stringify(String(value ?? '')); }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function plainObject(value) { return isPlainObject(value) ? value : {}; }
function configArtifact(options = {}) { return options.resolvedConfig?.artifact || options.resolvedConfig || {}; }
function jsonConfig(config) {
  const runtime = plainObject(config.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || config.json);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    severity: 'error',
    phase: 'schema-json-sidecar',
    code,
    message,
    hint,
    details,
    loc: { file: '<config>' }
  });
}
function makeWarning(code, message, hint, details) {
  return normalizeDiagnostic({
    severity: 'warning',
    phase: 'schema-json-sidecar',
    code,
    message,
    hint,
    details,
    loc: { file: '<config>' }
  });
}

function pathString(pathSegments) {
  return pathSegments.length ? pathSegments.join('.') : '<root>';
}
function accessorBase(pathSegments) {
  return pathSegments.map((segment) => safeIdentifier(segment)).join('__') || 'value';
}
function hasAccessorName(pathSegments) {
  if (pathSegments.length <= 1) return `has_${accessorBase(pathSegments)}`;
  const prefix = pathSegments.slice(0, -1).map((segment) => safeIdentifier(segment)).join('__');
  return `${prefix}__has_${safeIdentifier(pathSegments[pathSegments.length - 1])}`;
}
function nullAccessorName(pathSegments) {
  return `${accessorBase(pathSegments)}_is_null`;
}
function refAccessorName(pathSegments) {
  return `${accessorBase(pathSegments)}_ref`;
}
function lenAccessorName(pathSegments) {
  return `${accessorBase(pathSegments)}_len`;
}
function atAccessorName(pathSegments) {
  return `${accessorBase(pathSegments)}_at`;
}
function upperJoin(pathSegments) {
  if (!pathSegments.length) return 'Root';
  return pathSegments.map((segment) => safeIdentifier(segment[0].toUpperCase() + segment.slice(1))).join('_');
}
function objectClassName(schema, pathSegments) {
  return `${safeIdentifier(schema.type)}${pathSegments.length ? `_${upperJoin(pathSegments)}` : ''}Object`;
}
function objectParseFn(pathSegments) {
  return safeIdentifier(`parse_object_${pathSegments.length ? pathSegments.map((segment) => kebab(segment).replace(/-/g, '_')).join('__') : 'root'}`);
}
function objectSerializeFn(pathSegments) {
  return safeIdentifier(`serialize_object_${pathSegments.length ? pathSegments.map((segment) => kebab(segment).replace(/-/g, '_')).join('__') : 'root'}`);
}
function arrayParseFn(pathSegments) {
  return safeIdentifier(`parse_array_${pathSegments.map((segment) => kebab(segment).replace(/-/g, '_')).join('__')}`);
}
function arraySerializeFn(pathSegments) {
  return safeIdentifier(`serialize_array_${pathSegments.map((segment) => kebab(segment).replace(/-/g, '_')).join('__')}`);
}
function enumParseFn(pathSegments) {
  return safeIdentifier(`parse_enum_${pathSegments.map((segment) => kebab(segment).replace(/-/g, '_')).join('__')}`);
}

function storageInfo(node) {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return { storageType: 'string', defaultValue: '""' };
    if (node.type === 'bool') return { storageType: 'bool', defaultValue: 'false' };
    if (node.type === 'f64') return { storageType: 'f64', defaultValue: '0.0' };
    return { storageType: node.type, defaultValue: '0' };
  }
  if (node.kind === 'enum') return { storageType: 'string', defaultValue: '""' };
  return { storageType: 'usize', defaultValue: '0' };
}

function normalizeEnumValues(raw, diagnostics, details) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((value) => typeof value !== 'string' || !value.length)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_ENUM_INVALID',
      `Invalid enum descriptor for ${details.path}.`,
      'Use { enum: ["a", "b"] } with at least one string literal value.',
      details
    ));
    return [''];
  }
  return Array.from(new Set(raw.map(String)));
}

function normalizeNode(raw, diagnostics, details, options = {}) {
  if (typeof raw === 'string') {
    const lowered = lowerScalar(raw);
    if (!SCALAR_TYPES.has(raw) && !SCALAR_TYPES.has(lowered)) {
      diagnostics.push(makeDiagnostic(
        RESERVED_SCALAR_TYPES.has(raw) ? 'PULSEWASM_SCHEMA_JSON_UNSUPPORTED_FIELD_TYPE' : 'PULSEWASM_SCHEMA_JSON_UNSUPPORTED_FIELD_TYPE',
        `Unsupported schema field type ${JSON.stringify(raw)} at ${details.path}.`,
        'Phase 14 explicit schema v2 supports string, bool/boolean, i32, u32, f64/number, arrays, nested objects, optionals, nullable fields, and string enums.',
        details
      ));
      return { kind: 'scalar', type: 'string' };
    }
    return { kind: 'scalar', type: lowered };
  }
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_ARRAY_DESCRIPTOR_INVALID',
        `Array descriptor at ${details.path} must contain exactly one item descriptor.`,
        'Use ["string"] or [{ type: "object", fields: { ... } }].',
        details
      ));
      return { kind: 'array', item: { kind: 'scalar', type: 'string' } };
    }
    return { kind: 'array', item: normalizeNode(raw[0], diagnostics, { ...details, path: `${details.path}[]` }, { arrayItem: true }) };
  }
  if (isPlainObject(raw)) {
    if (Object.prototype.hasOwnProperty.call(raw, 'enum')) {
      return { kind: 'enum', values: normalizeEnumValues(raw.enum, diagnostics, details) };
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'fields') || raw.type === 'object') {
      const fields = [];
      const fieldMap = plainObject(raw.fields);
      for (const [name, child] of Object.entries(fieldMap)) fields.push(normalizeField(name, child, diagnostics, { ...details, path: `${details.path}.${name}` }, options.schema));
      return { kind: 'object', fields };
    }
    if (Array.isArray(raw.type)) return normalizeNode(raw.type, diagnostics, details, options);
    if (isPlainObject(raw.type)) return normalizeNode(raw.type, diagnostics, details, options);
    if (typeof raw.type === 'string') return normalizeNode(raw.type, diagnostics, details, options);
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_DESCRIPTOR_INVALID',
      `Unsupported schema descriptor at ${details.path}.`,
      'Use a scalar type string, [itemType], { type, required, nullable }, { fields: { ... } }, or { enum: [...] }.',
      details
    ));
    return { kind: 'scalar', type: 'string' };
  }
  diagnostics.push(makeDiagnostic(
    'PULSEWASM_SCHEMA_JSON_DESCRIPTOR_INVALID',
    `Unsupported schema descriptor at ${details.path}.`,
    'Use a scalar type string, [itemType], { type, required, nullable }, { fields: { ... } }, or { enum: [...] }.',
    details
  ));
  return { kind: 'scalar', type: 'string' };
}

function normalizeField(name, raw, diagnostics, details, schema) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_FIELD_NAME_UNSUPPORTED',
      `Schema field ${JSON.stringify(name)} is not a supported AS identifier.`,
      'Use simple identifier field names for explicit schema v2 sidecars.',
      { schema: details.schema, field: name }
    ));
  }
  let required = true;
  let nullable = false;
  let descriptor = raw;
  if (isPlainObject(raw)) {
    if (raw.required === false) required = false;
    if (raw.nullable === true) nullable = true;
    if (Object.prototype.hasOwnProperty.call(raw, 'enum')) descriptor = { enum: raw.enum };
    else if (Object.prototype.hasOwnProperty.call(raw, 'fields') || raw.type === 'object') descriptor = { type: 'object', fields: raw.fields };
    else if (Array.isArray(raw.type)) descriptor = raw.type;
    else if (plainObject(raw.type)) descriptor = raw.type;
    else if (typeof raw.type === 'string') descriptor = raw.type;
  }
  const node = normalizeNode(descriptor, diagnostics, details, { schema });
  const storage = storageInfo(node);
  return {
    name,
    ident: safeIdentifier(name),
    required,
    nullable,
    node,
    hasFlag: !required,
    nullFlag: nullable,
    storageType: storage.storageType,
    defaultValue: storage.defaultValue,
    pathSegments: [],
    baseAccessor: '',
    hasAccessor: null,
    nullAccessor: null,
    refAccessor: null,
    lenAccessor: null,
    atAccessor: null
  };
}

function enrichSchema(schema) {
  schema.objects = [];
  schema.arrays = [];
  schema.enums = [];
  schema.root = { kind: 'object', fields: schema.fields };

  function visitNode(node, pathSegments) {
    if (node.kind === 'object') {
      if (node.className) return;
      node.pathSegments = pathSegments.slice();
      node.className = objectClassName(schema, pathSegments);
      node.parseFunction = objectParseFn(pathSegments);
      node.serializeFunction = objectSerializeFn(pathSegments);
      schema.objects.push(node);
      for (const field of node.fields) {
        field.pathSegments = pathSegments.concat(field.name);
        field.baseAccessor = accessorBase(field.pathSegments);
        field.hasAccessor = field.hasFlag ? hasAccessorName(field.pathSegments) : null;
        field.nullAccessor = field.nullFlag ? nullAccessorName(field.pathSegments) : null;
        field.refAccessor = field.node.kind === 'object' || field.node.kind === 'array' ? refAccessorName(field.pathSegments) : null;
        field.lenAccessor = field.node.kind === 'array' ? lenAccessorName(field.pathSegments) : null;
        field.atAccessor = field.node.kind === 'array' ? atAccessorName(field.pathSegments) : null;
        visitNode(field.node, field.pathSegments);
      }
      return;
    }
    if (node.kind === 'array') {
      if (node.parseFunction) return;
      node.pathSegments = pathSegments.slice();
      node.parseFunction = arrayParseFn(pathSegments);
      node.serializeFunction = arraySerializeFn(pathSegments);
      schema.arrays.push(node);
      visitNode(node.item, pathSegments.concat('item'));
      return;
    }
    if (node.kind === 'enum') {
      if (node.parseFunction) return;
      node.pathSegments = pathSegments.slice();
      node.parseFunction = enumParseFn(pathSegments);
      schema.enums.push(node);
    }
  }

  visitNode(schema.root, []);
}

function normalizeSchemasV2(config) {
  const json = jsonConfig(config);
  const target = typeof json.target === 'string' && json.target ? json.target : 'generic';
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  const defaultNamespace = typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : DEFAULT_SCHEMA_JSON_NAMESPACE;
  const contentTypePolicy = typeof json.contentTypePolicy === 'string' && json.contentTypePolicy ? json.contentTypePolicy : DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY;
  const schemaVersion = typeof json.schemaVersion === 'string' && json.schemaVersion ? json.schemaVersion : undefined;
  const diagnostics = [];
  const warnings = [];
  const normalized = [];
  if (!CONTENT_TYPE_POLICIES.has(contentTypePolicy)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_CONTENT_TYPE_POLICY_UNSUPPORTED',
      `Unsupported schema JSON contentTypePolicy ${JSON.stringify(contentTypePolicy)}.`,
      'Use "accept-json-or-missing" or "require-json". "ignore-content-type" remains reserved.',
      { contentTypePolicy }
    ));
  }
  const richDescriptor = schemas.some((schema) => Object.values(plainObject(schema.fields)).some((field) => descriptorNeedsV2(field)) || isPlainObject(schema.fields) && descriptorNeedsV2(schema.fields));
  const effectiveTarget = target === 'auto' && schemas.length > 0 ? 'schema' : target;
  if (effectiveTarget !== 'schema') {
    warnings.push(makeWarning(
      'PULSEWASM_SCHEMA_JSON_INACTIVE',
      'Schema JSON sidecar generation is inactive because json.target is not "schema".',
      'Use json.target = "schema" with json.schemas to enable schema sidecar generation.',
      { target }
    ));
    return { target, effectiveTarget, schemaVersion: schemaVersion || (richDescriptor ? 'v2' : undefined), defaultNamespace, contentTypePolicy, schemas: normalized, diagnostics, warnings, active: false };
  }
  if (schemaVersion !== 'v2') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_V2_REQUIRED',
      'Explicit schema v2 features require json.schemaVersion = "v2".',
      'Set runtime.payload.json.schemaVersion = "v2" before using arrays, nested objects, optional fields, nullable fields, or enum descriptors.',
      { schemaVersion, richDescriptor }
    ));
    return { target, effectiveTarget, schemaVersion, defaultNamespace, contentTypePolicy, schemas: normalized, diagnostics, warnings, active: true };
  }
  if (schemas.length === 0) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_SCHEMA_JSON_SCHEMAS_REQUIRED',
      'json.target = "schema" requires at least one schema declaration.',
      'Add json.schemas = [{ namespace, name, type, source, fields }].',
      { target }
    ));
  }
  const ids = new Set();
  const namesByNamespace = new Map();
  let defaultNamespaceSeen = false;
  for (const [index, schema] of schemas.entries()) {
    const namespace = typeof schema.namespace === 'string' && schema.namespace ? schema.namespace : defaultNamespace;
    const name = typeof schema.name === 'string' && schema.name ? schema.name : schema.type;
    const type = typeof schema.type === 'string' && schema.type ? schema.type : name;
    const source = typeof schema.source === 'string' ? schema.source : undefined;
    const codec = typeof schema.codec === 'string' && schema.codec ? schema.codec : 'json';
    const mediaTypes = Array.isArray(schema.mediaTypes) && schema.mediaTypes.length ? schema.mediaTypes.map(String) : ['application/json', 'application/*+json'];
    if (namespace === defaultNamespace) defaultNamespaceSeen = true;
    if (!name || !type) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_NAME_REQUIRED',
        'Schema declarations require a static name/type.',
        'Use { namespace: "app", name: "CreateUserBodyV2", type: "CreateUserBodyV2", fields: { ... } }.',
        { index, schema }
      ));
      continue;
    }
    if (codec !== 'json') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_CODEC_UNSUPPORTED',
        `Schema ${JSON.stringify(name)} uses unsupported codec ${JSON.stringify(codec)}.`,
        'Phase 14 explicit schema v2 supports codec: "json" only.',
        { namespace, name, codec }
      ));
    }
    const id = `${namespace}.${name}`;
    if (ids.has(id)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_DUPLICATE_ID',
        `Duplicate schema id ${JSON.stringify(id)}.`,
        'Schema ids are namespace + name and must be globally unique.',
        { id, index }
      ));
    }
    ids.add(id);
    const nsNames = namesByNamespace.get(namespace) || new Set();
    if (nsNames.has(name)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_AMBIGUOUS_NAME',
        `Schema name ${JSON.stringify(name)} appears more than once in namespace ${JSON.stringify(namespace)}.`,
        'Use unique schema names inside a namespace.',
        { namespace, name }
      ));
    }
    nsNames.add(name);
    namesByNamespace.set(namespace, nsNames);
    const fieldMap = plainObject(schema.fields);
    const fields = [];
    for (const [fieldName, fieldValue] of Object.entries(fieldMap)) fields.push(normalizeField(fieldName, fieldValue, diagnostics, { schema: id, path: fieldName }, schema));
    if (fields.length === 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_FIELDS_REQUIRED',
        `Schema ${JSON.stringify(id)} requires explicit fields.`,
        'Use fields: { name: "string", tags: ["string"], profile: { type: "object", fields: { ... } } } for explicit schema v2 sidecars.',
        { id }
      ));
    }
    const normalizedSchema = {
      id,
      namespace,
      name,
      type,
      source,
      codec,
      mediaTypes,
      schemaVersion: 'v2',
      fields,
      functionBase: safeIdentifier(type),
      fileBase: kebab(type),
      namespaceBase: kebab(namespace),
      moduleFile: `generated/as/schema-json/${kebab(namespace)}/${kebab(type)}.as.ts`
    };
    enrichSchema(normalizedSchema);
    normalized.push(normalizedSchema);
  }
  if (schemas.length > 0 && !defaultNamespaceSeen) {
    warnings.push(makeWarning(
      'PULSEWASM_SCHEMA_JSON_DEFAULT_NAMESPACE_EMPTY',
      `Default namespace ${JSON.stringify(defaultNamespace)} has no schemas.`,
      'Unqualified ctx.req.parse() / schema names remain reserved; use explicit namespace.Schema ids.',
      { defaultNamespace }
    ));
  }
  return { target, schemaVersion: 'v2', defaultNamespace, contentTypePolicy, schemas: normalized, diagnostics, warnings, active: true };
}

function primitiveSample(node, nameHint = 'value') {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return nameHint === 'name' ? 'Ada' : `${nameHint}-value`;
    if (node.type === 'bool') return true;
    if (node.type === 'f64') return 42.5;
    return 42;
  }
  if (node.kind === 'enum') return node.values[0];
  if (node.kind === 'array') return [primitiveSample(node.item, `${nameHint}0`), primitiveSample(node.item, `${nameHint}1`)];
  if (node.kind === 'object') {
    const value = {};
    for (const field of node.fields) {
      if (!field.required) continue;
      if (field.nullable) value[field.name] = null;
      else value[field.name] = primitiveSample(field.node, field.name);
    }
    return value;
  }
  return null;
}

function sampleForObject(node) {
  const out = {};
  for (const field of node.fields) {
    if (!field.required) {
      if (field.nullable) {
        if (field.node.kind === 'object') out[field.name] = sampleForNode(field.node, field.name);
        else out[field.name] = sampleForNode(field.node, field.name);
      }
      continue;
    }
    out[field.name] = sampleForNode(field.node, field.name);
  }
  return out;
}
function sampleForNode(node, nameHint = 'value') {
  if (node.kind === 'object') return sampleForObject(node);
  if (node.kind === 'array') {
    const a = [];
    if (node.item.kind === 'object') a.push(sampleForNode(node.item, nameHint));
    else {
      a.push(sampleForNode(node.item, `${nameHint}0`));
      a.push(sampleForNode(node.item, `${nameHint}1`));
    }
    return a;
  }
  if (node.kind === 'enum') return node.values[0];
  return primitiveSample(node, nameHint);
}

function deepDelete(target, pathSegments) {
  if (!pathSegments.length) return;
  let cursor = target;
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[pathSegments[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[pathSegments[pathSegments.length - 1]];
}
function deepSet(target, pathSegments, value) {
  if (!pathSegments.length) return;
  let cursor = target;
  for (let i = 0; i < pathSegments.length - 1; i += 1) {
    const key = pathSegments[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[pathSegments[pathSegments.length - 1]] = value;
}
function findField(schema, predicate) {
  let found = null;
  function visitObject(node) {
    for (const field of node.fields) {
      if (predicate(field)) { found = field; return; }
      if (field.node.kind === 'object') visitObject(field.node);
      else if (field.node.kind === 'array' && field.node.item.kind === 'object') visitObject(field.node.item);
      if (found) return;
    }
  }
  visitObject(schema.root);
  return found;
}
function findNestedObjectWithScalar(schema) {
  let found = null;
  function visitObject(node) {
    for (const field of node.fields) {
      if (field.node.kind === 'object') {
        const scalarField = field.node.fields.find((child) => child.node.kind === 'scalar' || child.node.kind === 'enum');
        if (scalarField) { found = { parent: field, child: scalarField }; return; }
        visitObject(field.node);
      }
      if (found) return;
    }
  }
  visitObject(schema.root);
  return found;
}

function escapeControl(code) {
  let hex = code.toString(16).toUpperCase();
  while (hex.length < 4) hex = `0${hex}`;
  return `\\u${hex}`;
}

function emitObjectParsers(schema, lines) {
  for (const objectNode of schema.objects) {
    const fieldPathExpr = objectNode.pathSegments.length ? 'fieldPath' : asString(schema.id);
    lines.push(`function ${objectNode.parseFunction}(parser: Parser, fieldPath: string): usize {`);
    lines.push('  if (!parser.expectChar(123, "Expected { for object value.")) return 0;');
    lines.push(`  const value = new ${objectNode.className}();`);
    for (const field of objectNode.fields) lines.push(`  let seen_${field.ident}: bool = false;`);
    lines.push('  parser.skipWs();');
    lines.push('  if (!parser.consumeChar(125)) {');
    lines.push('    while (parser.errorRef == 0) {');
    lines.push('      const key = parser.parseKey();');
    lines.push('      if (parser.errorRef != 0) return 0;');
    lines.push('      if (!parser.expectChar(58, "Expected : after object key.")) return 0;');
    lines.push('      if (false) {}');
    for (const field of objectNode.fields) {
      const fieldPath = objectNode.pathSegments.length ? `fieldPath + ".${field.name}"` : asString(field.name);
      lines.push(`      else if (key == ${asString(field.name)}) {`);
      lines.push(`        seen_${field.ident} = true;`);
      if (field.hasFlag) lines.push(`        value.__has_${field.ident} = true;`);
      if (field.nullFlag) lines.push(`        value.__null_${field.ident} = false;`);
      if (field.nullFlag) {
        lines.push('        if (parser.peek() == 110) {');
        lines.push(`          if (parser.consumeNull()) { value.__null_${field.ident} = true; value.${field.ident} = ${field.defaultValue}; }`);
        lines.push(`          else parser.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + ${fieldPath} + ".", 400);`);
        lines.push('        } else {');
        lines.push(`          value.${field.ident} = ${parseNodeCall(field.node, 'parser', fieldPath)};`);
        lines.push('        }');
      } else {
        lines.push(`        value.${field.ident} = ${parseNodeCall(field.node, 'parser', fieldPath)};`);
      }
      lines.push('      }');
    }
    lines.push('      else {');
    lines.push('        parser.skipValue();');
    lines.push('      }');
    lines.push('      if (parser.errorRef != 0) return 0;');
    lines.push('      if (parser.consumeChar(44)) continue;');
    lines.push('      if (parser.consumeChar(125)) break;');
    lines.push('      parser.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Expected , or } in object value.", 400);');
    lines.push('      return 0;');
    lines.push('    }');
    lines.push('  }');
    for (const field of objectNode.fields) {
      if (field.required) lines.push(`  if (!seen_${field.ident}) { parser.fail("PULSEWASM_SCHEMA_JSON_MISSING_FIELD", "Missing required field ${fieldPathString(field.pathSegments)}.", 400); return 0; }`);
    }
    lines.push('  return changetype<usize>(value);');
    lines.push('}');
    lines.push('');
  }
}

function fieldPathString(pathSegments) {
  return pathSegments.join('.');
}

function emitEnumParsers(schema, lines) {
  for (const enumNode of schema.enums) {
    lines.push(`function ${enumNode.parseFunction}(parser: Parser, fieldPath: string): string {`);
    lines.push('  const value = parser.parseString(fieldPath);');
    lines.push('  if (parser.errorRef != 0) return "";');
    let first = true;
    for (const entry of enumNode.values) {
      lines.push(`  ${first ? 'if' : 'else if'} (value == ${asString(entry)}) return value;`);
      first = false;
    }
    lines.push('  parser.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400);');
    lines.push('  return "";');
    lines.push('}');
    lines.push('');
  }
}

function arrayStorageClass(node) {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return 'StringArrayRef';
    if (node.type === 'bool') return 'BoolArrayRef';
    if (node.type === 'i32') return 'I32ArrayRef';
    if (node.type === 'u32') return 'U32ArrayRef';
    if (node.type === 'f64') return 'F64ArrayRef';
  }
  if (node.kind === 'enum') return 'StringArrayRef';
  return 'RefArrayRef';
}

function emitArrayParsers(schema, lines) {
  for (const arrayNode of schema.arrays) {
    const storageClass = arrayStorageClass(arrayNode.item);
    lines.push(`function ${arrayNode.parseFunction}(parser: Parser, fieldPath: string): usize {`);
    lines.push('  if (!parser.expectChar(91, "Expected [ for array value.")) return 0;');
    lines.push(`  const values = new ${storageClass}();`);
    lines.push('  let index: i32 = 0;');
    lines.push('  parser.skipWs();');
    lines.push('  if (!parser.consumeChar(93)) {');
    lines.push('    while (parser.errorRef == 0) {');
    lines.push('      const itemPath = fieldPath + "[" + index.toString() + "]";');
    lines.push(`      values.values.push(${parseNodeCall(arrayNode.item, 'parser', 'itemPath')});`);
    lines.push('      if (parser.errorRef != 0) return 0;');
    lines.push('      index += 1;');
    lines.push('      if (parser.consumeChar(44)) continue;');
    lines.push('      if (parser.consumeChar(93)) break;');
    lines.push('      parser.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Expected , or ] in array value.", 400);');
    lines.push('      return 0;');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return changetype<usize>(values);');
    lines.push('}');
    lines.push('');
  }
}

function parseNodeCall(node, parserVar, fieldPathExpr) {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return `${parserVar}.parseString(${fieldPathExpr})`;
    if (node.type === 'bool') return `${parserVar}.parseBool(${fieldPathExpr})`;
    if (node.type === 'u32') return `${parserVar}.parseU32(${fieldPathExpr})`;
    if (node.type === 'f64') return `${parserVar}.parseF64(${fieldPathExpr})`;
    return `${parserVar}.parseI32(${fieldPathExpr})`;
  }
  if (node.kind === 'enum') return `${node.parseFunction}(${parserVar}, ${fieldPathExpr})`;
  if (node.kind === 'object' || node.kind === 'array') return `${node.parseFunction}(${parserVar}, ${fieldPathExpr})`;
  return '0';
}

function serializeNodeExpr(node, expr) {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return `"\\\"" + escapeJsonString(${expr}) + "\\\""`;
    if (node.type === 'bool') return `(${expr} ? "true" : "false")`;
    return `${expr}.toString()`;
  }
  if (node.kind === 'enum') return `"\\\"" + escapeJsonString(${expr}) + "\\\""`;
  if (node.kind === 'object') return `${node.serializeFunction}(${expr})`;
  if (node.kind === 'array') return `${node.serializeFunction}(${expr})`;
  return '"null"';
}

function emitObjectSerializers(schema, lines) {
  for (const objectNode of schema.objects) {
    lines.push(`function ${objectNode.serializeFunction}(valueRef: usize): string {`);
    lines.push('  if (valueRef == 0) return "null";');
    lines.push(`  const value = changetype<${objectNode.className}>(valueRef);`);
    lines.push('  const parts = new Array<string>();');
    for (const field of objectNode.fields) {
      const fieldValue = `value.${field.ident}`;
      const entryPrefix = asString(`"${field.name}":`);
      if (field.hasFlag) {
        lines.push(`  if (value.__has_${field.ident}) {`);
        if (field.nullFlag) {
          lines.push(`    if (value.__null_${field.ident}) parts.push(${entryPrefix} + "null");`);
          lines.push(`    else parts.push(${entryPrefix} + ${serializeNodeExpr(field.node, fieldValue)});`);
        } else {
          lines.push(`    parts.push(${entryPrefix} + ${serializeNodeExpr(field.node, fieldValue)});`);
        }
        lines.push('  }');
      } else if (field.nullFlag) {
        lines.push(`  if (value.__null_${field.ident}) parts.push(${entryPrefix} + "null");`);
        lines.push(`  else parts.push(${entryPrefix} + ${serializeNodeExpr(field.node, fieldValue)});`);
      } else {
        lines.push(`  parts.push(${entryPrefix} + ${serializeNodeExpr(field.node, fieldValue)});`);
      }
    }
    lines.push('  return "{" + parts.join(",") + "}";');
    lines.push('}');
    lines.push('');
  }
}

function emitArraySerializers(schema, lines) {
  for (const arrayNode of schema.arrays) {
    const storageClass = arrayStorageClass(arrayNode.item);
    lines.push(`function ${arrayNode.serializeFunction}(valueRef: usize): string {`);
    lines.push('  if (valueRef == 0) return "[]";');
    lines.push(`  const value = changetype<${storageClass}>(valueRef);`);
    lines.push('  const parts = new Array<string>();');
    lines.push('  for (let i = 0; i < value.values.length; i += 1) {');
    lines.push(`    parts.push(${serializeNodeExpr(arrayNode.item, 'value.values[i]')});`);
    lines.push('  }');
    lines.push('  return "[" + parts.join(",") + "]";');
    lines.push('}');
    lines.push('');
  }
}

function boolReturnType(node) {
  return node.kind === 'scalar' && node.type === 'bool' ? 'i32' : node.kind === 'scalar' ? node.type : node.kind === 'enum' ? 'string' : 'usize';
}
function boolReturnExpr(expr, node) {
  return node.kind === 'scalar' && node.type === 'bool' ? `(${expr} ? 1 : 0)` : expr;
}
function emitAccessors(schema, lines) {
  for (const objectNode of schema.objects) {
    lines.push(`// Accessors for ${objectNode.className}`);
    for (const field of objectNode.fields) {
      const valueExpr = `changetype<${objectNode.className}>(valueRef).${field.ident}`;
      if (field.hasAccessor) lines.push(`export function ${field.hasAccessor}(valueRef: usize): i32 { return changetype<${objectNode.className}>(valueRef).__has_${field.ident} ? 1 : 0; }`);
      if (field.nullAccessor) lines.push(`export function ${field.nullAccessor}(valueRef: usize): i32 { return changetype<${objectNode.className}>(valueRef).__null_${field.ident} ? 1 : 0; }`);
      if (field.node.kind === 'object' || field.node.kind === 'array') {
        lines.push(`export function ${field.refAccessor}(valueRef: usize): usize { return ${valueExpr}; }`);
        if (field.node.kind === 'array') {
          const storageClass = arrayStorageClass(field.node.item);
          lines.push(`export function ${field.lenAccessor}(valueRef: usize): i32 { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0; return changetype<${storageClass}>(ref).values.length; }`);
          if (field.node.item.kind === 'object' || field.node.item.kind === 'array') {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): usize { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length ? values[index] : 0; }`);
          } else if (field.node.item.kind === 'enum' || (field.node.item.kind === 'scalar' && field.node.item.type === 'string')) {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): string { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return ""; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length ? values[index] : ""; }`);
          } else if (field.node.item.kind === 'scalar' && field.node.item.type === 'bool') {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): i32 { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length && values[index] ? 1 : 0; }`);
          } else if (field.node.item.kind === 'scalar' && field.node.item.type === 'f64') {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): f64 { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0.0; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length ? values[index] : 0.0; }`);
          } else if (field.node.item.kind === 'scalar' && field.node.item.type === 'u32') {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): u32 { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length ? values[index] : 0; }`);
          } else {
            lines.push(`export function ${field.atAccessor}(valueRef: usize, index: i32): i32 { const ref = changetype<${objectNode.className}>(valueRef).${field.ident}; if (ref == 0) return 0; const values = changetype<${storageClass}>(ref).values; return index >= 0 && index < values.length ? values[index] : 0; }`);
          }
        }
      } else {
        lines.push(`export function ${field.baseAccessor}(valueRef: usize): ${boolReturnType(field.node)} { return ${boolReturnExpr(valueExpr, field.node)}; }`);
      }
      lines.push('');
    }
  }
}

function collectExportNames(schema) {
  const names = new Set(['parse', 'ok', 'value', 'error', 'serialize', 'errorCode', 'errorMessage', 'errorStatusCode', `parse${schemaSymbol(schema)}`, `${schemaSymbol(schema)}ParseOk`, `${schemaSymbol(schema)}ParseValue`, `${schemaSymbol(schema)}ParseError`, `serialize${schemaSymbol(schema)}`]);
  for (const objectNode of schema.objects) {
    for (const field of objectNode.fields) {
      if (field.hasAccessor) names.add(field.hasAccessor);
      if (field.nullAccessor) names.add(field.nullAccessor);
      if (field.node.kind === 'object' || field.node.kind === 'array') {
        names.add(field.refAccessor);
        if (field.node.kind === 'array') {
          names.add(field.lenAccessor);
          names.add(field.atAccessor);
        }
      } else names.add(field.baseAccessor);
    }
  }
  return Array.from(names).sort();
}

function schemaSidecarSource(schema) {
  const symbol = schemaSymbol(schema);
  const lines = [];
  lines.push('// Generated by PulseWasm Phase 14.');
  lines.push('// Deterministic schema JSON sidecar v2. Parse returns an explicit result ref.');
  lines.push('');
  lines.push('export class PulseSchemaJsonError {');
  lines.push('  code: string = "";');
  lines.push('  message: string = "";');
  lines.push('  statusCode: i32 = 400;');
  lines.push('}');
  lines.push('');
  lines.push('export class SchemaParseResult {');
  lines.push('  ok: bool = false;');
  lines.push('  valueRef: usize = 0;');
  lines.push('  errorRef: usize = 0;');
  lines.push('}');
  lines.push('');
  lines.push('class StringArrayRef { values: Array<string> = new Array<string>(); }');
  lines.push('class BoolArrayRef { values: Array<bool> = new Array<bool>(); }');
  lines.push('class I32ArrayRef { values: Array<i32> = new Array<i32>(); }');
  lines.push('class U32ArrayRef { values: Array<u32> = new Array<u32>(); }');
  lines.push('class F64ArrayRef { values: Array<f64> = new Array<f64>(); }');
  lines.push('class RefArrayRef { values: Array<usize> = new Array<usize>(); }');
  lines.push('');
  lines.push('function makeError(code: string, message: string, statusCode: i32 = 400): usize {');
  lines.push('  const err = new PulseSchemaJsonError();');
  lines.push('  err.code = code;');
  lines.push('  err.message = message;');
  lines.push('  err.statusCode = statusCode;');
  lines.push('  return changetype<usize>(err);');
  lines.push('}');
  lines.push('');
  lines.push('function makeOk(valueRef: usize): usize {');
  lines.push('  const result = new SchemaParseResult();');
  lines.push('  result.ok = true;');
  lines.push('  result.valueRef = valueRef;');
  lines.push('  return changetype<usize>(result);');
  lines.push('}');
  lines.push('');
  lines.push('function makeErr(errorRef: usize): usize {');
  lines.push('  const result = new SchemaParseResult();');
  lines.push('  result.ok = false;');
  lines.push('  result.errorRef = errorRef;');
  lines.push('  return changetype<usize>(result);');
  lines.push('}');
  lines.push('');

  for (const objectNode of schema.objects) {
    lines.push(`class ${objectNode.className} {`);
    for (const field of objectNode.fields) {
      if (field.hasFlag) lines.push(`  __has_${field.ident}: bool = false;`);
      if (field.nullFlag) lines.push(`  __null_${field.ident}: bool = false;`);
      lines.push(`  ${field.ident}: ${field.storageType} = ${field.defaultValue};`);
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('class Parser {');
  lines.push('  json: string;');
  lines.push('  pos: i32 = 0;');
  lines.push('  errorRef: usize = 0;');
  lines.push('  constructor(json: string) { this.json = json; }');
  lines.push('');
  lines.push('  fail(code: string, message: string, statusCode: i32 = 400): void {');
  lines.push('    if (this.errorRef != 0) return;');
  lines.push('    this.errorRef = makeError(code, message, statusCode);');
  lines.push('  }');
  lines.push('');
  lines.push('  skipWs(): void {');
  lines.push('    while (this.pos < this.json.length) {');
  lines.push('      const ch = this.json.charCodeAt(this.pos);');
  lines.push('      if (ch != 32 && ch != 10 && ch != 13 && ch != 9) break;');
  lines.push('      this.pos += 1;');
  lines.push('    }');
  lines.push('  }');
  lines.push('');
  lines.push('  peek(): i32 {');
  lines.push('    this.skipWs();');
  lines.push('    return this.pos < this.json.length ? this.json.charCodeAt(this.pos) : -1;');
  lines.push('  }');
  lines.push('');
  lines.push('  consumeChar(code: i32): bool {');
  lines.push('    this.skipWs();');
  lines.push('    if (this.pos < this.json.length && this.json.charCodeAt(this.pos) == code) {');
  lines.push('      this.pos += 1;');
  lines.push('      return true;');
  lines.push('    }');
  lines.push('    return false;');
  lines.push('  }');
  lines.push('');
  lines.push('  expectChar(code: i32, message: string): bool {');
  lines.push('    if (this.consumeChar(code)) return true;');
  lines.push('    this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", message, 400);');
  lines.push('    return false;');
  lines.push('  }');
  lines.push('');
  lines.push('  consumeNull(): bool {');
  lines.push('    this.skipWs();');
  lines.push('    if (this.json.substring(this.pos, this.pos + 4) == "null") { this.pos += 4; return true; }');
  lines.push('    return false;');
  lines.push('  }');
  lines.push('');
  lines.push('  parseKey(): string {');
  lines.push('    return this.readStringInternal("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Expected string object key.");');
  lines.push('  }');
  lines.push('');
  lines.push('  parseString(fieldPath: string): string {');
  lines.push('    return this.readStringInternal("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".");');
  lines.push('  }');
  lines.push('');
  lines.push('  readStringInternal(code: string, message: string): string {');
  lines.push('    this.skipWs();');
  lines.push('    if (this.pos >= this.json.length || this.json.charCodeAt(this.pos) != 34) {');
  lines.push('      this.fail(code, message, 400);');
  lines.push('      return "";');
  lines.push('    }');
  lines.push('    this.pos += 1;');
  lines.push('    let out = "";');
  lines.push('    while (this.pos < this.json.length) {');
  lines.push('      const ch = this.json.charCodeAt(this.pos);');
  lines.push('      if (ch == 34) { this.pos += 1; return out; }');
  lines.push('      if (ch == 92) {');
  lines.push('        this.pos += 1;');
  lines.push('        if (this.pos >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Unterminated escape sequence.", 400); return ""; }');
  lines.push('        const escaped = this.json.charCodeAt(this.pos);');
  lines.push('        if (escaped == 34) out += "\\\"";');
  lines.push('        else if (escaped == 92) out += "\\\\";');
  lines.push('        else if (escaped == 47) out += "/";');
  lines.push('        else if (escaped == 98) out += String.fromCharCode(8);');
  lines.push('        else if (escaped == 102) out += String.fromCharCode(12);');
  lines.push('        else if (escaped == 110) out += String.fromCharCode(10);');
  lines.push('        else if (escaped == 114) out += String.fromCharCode(13);');
  lines.push('        else if (escaped == 116) out += String.fromCharCode(9);');
  lines.push('        else if (escaped == 117) {');
  lines.push('          if (this.pos + 4 >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Incomplete unicode escape.", 400); return ""; }');
  lines.push('          const hex = this.json.substring(this.pos + 1, this.pos + 5);');
  lines.push('          const codePoint = I32.parseInt("0x" + hex);');
  lines.push('          out += String.fromCharCode(codePoint);');
  lines.push('          this.pos += 4;');
  lines.push('        }');
  lines.push('        else { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Unsupported escape sequence.", 400); return ""; }');
  lines.push('      } else {');
  lines.push('        if (ch < 32) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Control character in string literal.", 400); return ""; }');
  lines.push('        out += String.fromCharCode(ch);');
  lines.push('      }');
  lines.push('      this.pos += 1;');
  lines.push('    }');
  lines.push('    this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Unterminated string literal.", 400);');
  lines.push('    return "";');
  lines.push('  }');
  lines.push('');
  lines.push('  parseBool(fieldPath: string): bool {');
  lines.push('    this.skipWs();');
  lines.push('    if (this.json.substring(this.pos, this.pos + 4) == "true") { this.pos += 4; return true; }');
  lines.push('    if (this.json.substring(this.pos, this.pos + 5) == "false") { this.pos += 5; return false; }');
  lines.push('    this.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400);');
  lines.push('    return false;');
  lines.push('  }');
  lines.push('');
  lines.push('  parseNumberText(fieldPath: string, integerOnly: bool): string {');
  lines.push('    this.skipWs();');
  lines.push('    const start = this.pos;');
  lines.push('    if (this.pos < this.json.length && this.json.charCodeAt(this.pos) == 45) this.pos += 1;');
  lines.push('    if (this.pos >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400); return ""; }');
  lines.push('    const first = this.json.charCodeAt(this.pos);');
  lines.push('    if (first < 48 || first > 57) { this.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400); return ""; }');
  lines.push('    if (first == 48) {');
  lines.push('      this.pos += 1;');
  lines.push('      if (this.pos < this.json.length) {');
  lines.push('        const next = this.json.charCodeAt(this.pos);');
  lines.push('        if (next >= 48 && next <= 57) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed number literal.", 400); return ""; }');
  lines.push('      }');
  lines.push('    } else {');
  lines.push('      while (this.pos < this.json.length) {');
  lines.push('        const ch = this.json.charCodeAt(this.pos);');
  lines.push('        if (ch < 48 || ch > 57) break;');
  lines.push('        this.pos += 1;');
  lines.push('      }');
  lines.push('    }');
  lines.push('    if (this.pos < this.json.length && this.json.charCodeAt(this.pos) == 46) {');
  lines.push('      if (integerOnly) { this.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400); return ""; }');
  lines.push('      this.pos += 1;');
  lines.push('      if (this.pos >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed number literal.", 400); return ""; }');
  lines.push('      const fracStart = this.pos;');
  lines.push('      while (this.pos < this.json.length) {');
  lines.push('        const ch = this.json.charCodeAt(this.pos);');
  lines.push('        if (ch < 48 || ch > 57) break;');
  lines.push('        this.pos += 1;');
  lines.push('      }');
  lines.push('      if (fracStart == this.pos) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed number literal.", 400); return ""; }');
  lines.push('    }');
  lines.push('    if (this.pos < this.json.length) {');
  lines.push('      const ch = this.json.charCodeAt(this.pos);');
  lines.push('      if (ch == 101 || ch == 69) {');
  lines.push('        if (integerOnly) { this.fail("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field " + fieldPath + ".", 400); return ""; }');
  lines.push('        this.pos += 1;');
  lines.push('        if (this.pos < this.json.length) {');
  lines.push('          const sign = this.json.charCodeAt(this.pos);');
  lines.push('          if (sign == 43 || sign == 45) this.pos += 1;');
  lines.push('        }');
  lines.push('        if (this.pos >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed number literal.", 400); return ""; }');
  lines.push('        const expStart = this.pos;');
  lines.push('        while (this.pos < this.json.length) {');
  lines.push('          const exp = this.json.charCodeAt(this.pos);');
  lines.push('          if (exp < 48 || exp > 57) break;');
  lines.push('          this.pos += 1;');
  lines.push('        }');
  lines.push('        if (expStart == this.pos) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed number literal.", 400); return ""; }');
  lines.push('      }');
  lines.push('    }');
  lines.push('    return this.json.substring(start, this.pos);');
  lines.push('  }');
  lines.push('');
  lines.push('  parseI32(fieldPath: string): i32 {');
  lines.push('    const text = this.parseNumberText(fieldPath, true);');
  lines.push('    if (this.errorRef != 0) return 0;');
  lines.push('    const value = F64.parseFloat(text);');
  lines.push('    if (!isFinite(value) || value < -2147483648.0 || value > 2147483647.0) { this.fail("PULSEWASM_SCHEMA_JSON_NUMBER_RANGE_ERROR", "Number out of range for field " + fieldPath + ".", 400); return 0; }');
  lines.push('    return <i32>value;');
  lines.push('  }');
  lines.push('');
  lines.push('  parseU32(fieldPath: string): u32 {');
  lines.push('    const text = this.parseNumberText(fieldPath, true);');
  lines.push('    if (this.errorRef != 0) return 0;');
  lines.push('    const value = F64.parseFloat(text);');
  lines.push('    if (!isFinite(value) || value < 0.0 || value > 4294967295.0) { this.fail("PULSEWASM_SCHEMA_JSON_NUMBER_RANGE_ERROR", "Number out of range for field " + fieldPath + ".", 400); return 0; }');
  lines.push('    return <u32>value;');
  lines.push('  }');
  lines.push('');
  lines.push('  parseF64(fieldPath: string): f64 {');
  lines.push('    const text = this.parseNumberText(fieldPath, false);');
  lines.push('    if (this.errorRef != 0) return 0.0;');
  lines.push('    const value = F64.parseFloat(text);');
  lines.push('    if (!isFinite(value)) { this.fail("PULSEWASM_SCHEMA_JSON_NUMBER_RANGE_ERROR", "Number out of range for field " + fieldPath + ".", 400); return 0.0; }');
  lines.push('    return value;');
  lines.push('  }');
  lines.push('');
  lines.push('  skipValue(): void {');
  lines.push('    this.skipWs();');
  lines.push('    if (this.pos >= this.json.length) { this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Unexpected end of JSON input.", 400); return; }');
  lines.push('    const ch = this.json.charCodeAt(this.pos);');
  lines.push('    if (ch == 34) { this.parseKey(); return; }');
  lines.push('    if (ch == 123) {');
  lines.push('      this.pos += 1;');
  lines.push('      this.skipWs();');
  lines.push('      if (this.consumeChar(125)) return;');
  lines.push('      while (this.errorRef == 0) {');
  lines.push('        this.parseKey();');
  lines.push('        if (this.errorRef != 0) return;');
  lines.push('        if (!this.expectChar(58, "Expected : after object key.")) return;');
  lines.push('        this.skipValue();');
  lines.push('        if (this.errorRef != 0) return;');
  lines.push('        if (this.consumeChar(44)) continue;');
  lines.push('        if (this.consumeChar(125)) return;');
  lines.push('        this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Expected , or } while skipping object value.", 400);');
  lines.push('        return;');
  lines.push('      }');
  lines.push('      return;');
  lines.push('    }');
  lines.push('    if (ch == 91) {');
  lines.push('      this.pos += 1;');
  lines.push('      this.skipWs();');
  lines.push('      if (this.consumeChar(93)) return;');
  lines.push('      while (this.errorRef == 0) {');
  lines.push('        this.skipValue();');
  lines.push('        if (this.errorRef != 0) return;');
  lines.push('        if (this.consumeChar(44)) continue;');
  lines.push('        if (this.consumeChar(93)) return;');
  lines.push('        this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Expected , or ] while skipping array value.", 400);');
  lines.push('        return;');
  lines.push('      }');
  lines.push('      return;');
  lines.push('    }');
  lines.push('    if (ch == 116 || ch == 102) { this.parseBool("<skip>"); return; }');
  lines.push('    if (ch == 110) { if (!this.consumeNull()) this.fail("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Malformed null literal.", 400); return; }');
  lines.push('    this.parseNumberText("<skip>", false);');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  emitEnumParsers(schema, lines);
  emitArrayParsers(schema, lines);
  emitObjectParsers(schema, lines);

  lines.push('function escapeJsonString(value: string): string {');
  lines.push('  let out = "";');
  lines.push('  for (let i = 0; i < value.length; i += 1) {');
  lines.push('    const ch = value.charCodeAt(i);');
  lines.push('    if (ch == 34) out += "\\\"";');
  lines.push('    else if (ch == 92) out += "\\\\";');
  lines.push('    else if (ch == 8) out += "\\b";');
  lines.push('    else if (ch == 12) out += "\\f";');
  lines.push('    else if (ch == 10) out += "\\n";');
  lines.push('    else if (ch == 13) out += "\\r";');
  lines.push('    else if (ch == 9) out += "\\t";');
  lines.push('    else if (ch < 32) {');
  lines.push('      let hex = ch.toString(16).toUpperCase();');
  lines.push('      while (hex.length < 4) hex = "0" + hex;');
  lines.push('      out += "\\\\u" + hex;');
  lines.push('    }');
  lines.push('    else out += String.fromCharCode(ch);');
  lines.push('  }');
  lines.push('  return out;');
  lines.push('}');
  lines.push('');

  emitArraySerializers(schema, lines);
  emitObjectSerializers(schema, lines);

  lines.push('export function parse(json: string): usize {');
  lines.push('  const parser = new Parser(json);');
  lines.push(`  const valueRef = ${schema.root.parseFunction}(parser, ${asString(schema.id)});`);
  lines.push('  if (parser.errorRef != 0) return makeErr(parser.errorRef);');
  lines.push('  parser.skipWs();');
  lines.push('  if (parser.pos != json.length) return makeErr(makeError("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Trailing content after root JSON value.", 400));');
  lines.push('  return makeOk(valueRef);');
  lines.push('}');
  lines.push('');
  lines.push('export function ok(resultRef: usize): bool { return changetype<SchemaParseResult>(resultRef).ok; }');
  lines.push('export function value(resultRef: usize): usize { return changetype<SchemaParseResult>(resultRef).valueRef; }');
  lines.push('export function error(resultRef: usize): usize { return changetype<SchemaParseResult>(resultRef).errorRef; }');
  lines.push('export function errorCode(errorRef: usize): string { return changetype<PulseSchemaJsonError>(errorRef).code; }');
  lines.push('export function errorMessage(errorRef: usize): string { return changetype<PulseSchemaJsonError>(errorRef).message; }');
  lines.push('export function errorStatusCode(errorRef: usize): i32 { return changetype<PulseSchemaJsonError>(errorRef).statusCode; }');
  lines.push('');
  lines.push(`export function parse${symbol}(json: string): usize { return parse(json); }`);
  lines.push(`export function ${symbol}ParseOk(resultRef: usize): bool { return ok(resultRef); }`);
  lines.push(`export function ${symbol}ParseValue(resultRef: usize): usize { return value(resultRef); }`);
  lines.push(`export function ${symbol}ParseError(resultRef: usize): usize { return error(resultRef); }`);
  lines.push('');
  emitAccessors(schema, lines);
  lines.push(`export function serialize(valueRef: usize): string { return ${schema.root.serializeFunction}(valueRef); }`);
  lines.push(`export function serialize${symbol}(valueRef: usize): string { return serialize(valueRef); }`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function importAlias(prefix, name) { return `${name} as ${prefix}_${name}`; }
function smokeRunnerSource(schemas) {
  const imports = [];
  const checks = [];
  const checkNames = [];
  for (const schema of schemas) {
    const prefix = schemaSymbol(schema);
    const file = `../as/schema-json/${schema.namespaceBase}/${schema.fileBase}.as`;
    const imported = collectExportNames(schema).map((name) => importAlias(prefix, name));
    imports.push(`import { ${imported.join(', ')} } from '${file}';`);
    const fullSample = sampleForNode(schema.root, schema.name);
    const firstRootScalar = schema.root.fields.find((field) => field.node.kind === 'scalar' || field.node.kind === 'enum');
    const firstArray = findField(schema, (field) => field.node.kind === 'array');
    const firstOptional = findField(schema, (field) => !field.required);
    const firstNullable = findField(schema, (field) => field.nullable);
    const nestedScalar = findNestedObjectWithScalar(schema);
    const firstRequiredRoot = schema.root.fields.find((field) => field.required);
    const firstEnum = findField(schema, (field) => field.node.kind === 'enum');

    const parseFn = `parse_${prefix}`;
    checks.push(`function ${parseFn}(): usize { return ${prefix}_parse(${asString(JSON.stringify(fullSample))}); }`);
    const parseOkName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_parse_ok`.replace(/-/g, '_');
    checks.push(`export function ${parseOkName}(): i32 { const r = ${parseFn}(); return ${prefix}_ok(r) && ${prefix}_value(r) != 0 ? 1 : 0; }`);
    checkNames.push(parseOkName);

    if (firstRootScalar) {
      const scalarName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_${firstRootScalar.name}`.replace(/-/g, '_');
      const expected = sampleForNode(firstRootScalar.node, firstRootScalar.name);
      const accessor = firstRootScalar.baseAccessor;
      if (firstRootScalar.node.kind === 'scalar' && firstRootScalar.node.type === 'string' || firstRootScalar.node.kind === 'enum') {
        checks.push(`export function ${scalarName}(): i32 { const v = ${prefix}_value(${parseFn}()); return ${prefix}_${accessor}(v) == ${asString(expected)} ? 1 : 0; }`);
      } else if (firstRootScalar.node.kind === 'scalar' && firstRootScalar.node.type === 'bool') {
        checks.push(`export function ${scalarName}(): i32 { const v = ${prefix}_value(${parseFn}()); return ${prefix}_${accessor}(v) == ${expected ? 1 : 0} ? 1 : 0; }`);
      } else {
        checks.push(`export function ${scalarName}(): i32 { const v = ${prefix}_value(${parseFn}()); return ${prefix}_${accessor}(v) == ${expected} ? 1 : 0; }`);
      }
      checkNames.push(scalarName);
    }

    if (firstArray && firstArray.lenAccessor) {
      const lenName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_array_len`.replace(/-/g, '_');
      const expectedLen = Array.isArray(deepGet(fullSample, firstArray.pathSegments)) ? deepGet(fullSample, firstArray.pathSegments).length : 0;
      checks.push(`export function ${lenName}(): i32 { const v = ${prefix}_value(${parseFn}()); return ${prefix}_${firstArray.lenAccessor}(v) == ${expectedLen} ? 1 : 0; }`);
      checkNames.push(lenName);
    }

    if (firstOptional && firstOptional.hasAccessor) {
      const optionalPayload = clone(fullSample);
      deepDelete(optionalPayload, firstOptional.pathSegments);
      const optionalName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_optional`.replace(/-/g, '_');
      checks.push(`export function ${optionalName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(optionalPayload))}); const v = ${prefix}_value(r); return ${prefix}_ok(r) && ${prefix}_${firstOptional.hasAccessor}(v) == 0 ? 1 : 0; }`);
      checkNames.push(optionalName);
    }

    if (firstNullable && firstNullable.nullAccessor) {
      const nullablePayload = clone(fullSample);
      deepSet(nullablePayload, firstNullable.pathSegments, null);
      const nullableName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_nullable`.replace(/-/g, '_');
      if (firstNullable.pathSegments.length === 1) {
        checks.push(`export function ${nullableName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(nullablePayload))}); const v = ${prefix}_value(r); return ${prefix}_ok(r) && ${prefix}_${firstNullable.nullAccessor}(v) == 1 ? 1 : 0; }`);
      } else {
        const parentPath = firstNullable.pathSegments.slice(0, -1);
        const parentField = findField(schema, (field) => field.pathSegments.join('.') === parentPath.join('.'));
        checks.push(`export function ${nullableName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(nullablePayload))}); const root = ${prefix}_value(r); const parent = ${prefix}_${parentField.refAccessor}(root); return ${prefix}_ok(r) && parent != 0 && ${prefix}_${firstNullable.nullAccessor}(parent) == 1 ? 1 : 0; }`);
      }
      checkNames.push(nullableName);
    }

    if (nestedScalar) {
      const nestedName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_nested`.replace(/-/g, '_');
      const nestedValue = deepGet(fullSample, nestedScalar.parent.pathSegments.concat(nestedScalar.child.name));
      checks.push(`export function ${nestedName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(fullSample))}); const root = ${prefix}_value(r); const parent = ${prefix}_${nestedScalar.parent.refAccessor}(root); return ${prefix}_ok(r) && parent != 0 && ${compareExpression(prefix, nestedScalar.child, 'parent', nestedValue)} ? 1 : 0; }`);
      checkNames.push(nestedName);
    }

    const serializeName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_serialize`.replace(/-/g, '_');
    checks.push(`export function ${serializeName}(): i32 { return ${prefix}_serialize(${prefix}_value(${parseFn}())).indexOf(${asString(schema.root.fields[0] ? schema.root.fields[0].name : '')}) >= 0 ? 1 : 0; }`);
    checkNames.push(serializeName);

    if (firstRequiredRoot) {
      const missingPayload = clone(fullSample);
      deepDelete(missingPayload, [firstRequiredRoot.name]);
      const missingName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_missing_required`.replace(/-/g, '_');
      checks.push(`export function ${missingName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(missingPayload))}); const e = ${prefix}_error(r); return !${prefix}_ok(r) && ${prefix}_errorCode(e) == "PULSEWASM_SCHEMA_JSON_MISSING_FIELD" ? 1 : 0; }`);
      checkNames.push(missingName);

      const wrongPayload = clone(fullSample);
      wrongPayload[firstRequiredRoot.name] = wrongTypeSample(firstRequiredRoot.node);
      const typeName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_type_error`.replace(/-/g, '_');
      checks.push(`export function ${typeName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(wrongPayload))}); const e = ${prefix}_error(r); return !${prefix}_ok(r) && ${prefix}_errorCode(e) == "PULSEWASM_SCHEMA_JSON_TYPE_ERROR" && ${prefix}_errorStatusCode(e) == 400 ? 1 : 0; }`);
      checkNames.push(typeName);
    }

    if (firstEnum) {
      const enumPayload = clone(fullSample);
      deepSet(enumPayload, firstEnum.pathSegments, '__bad_enum__');
      const enumName = `smoke_${kebab(schema.namespace)}_${kebab(schema.type)}_enum_error`.replace(/-/g, '_');
      checks.push(`export function ${enumName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(enumPayload))}); const e = ${prefix}_error(r); return !${prefix}_ok(r) && ${prefix}_errorCode(e) == "PULSEWASM_SCHEMA_JSON_TYPE_ERROR" ? 1 : 0; }`);
      checkNames.push(enumName);
    }
  }
  return { text: `${imports.join('\n')}\n\n${checks.join('\n')}\n`, checkNames };
}

function deepGet(target, pathSegments) {
  let cursor = target;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}
function wrongTypeSample(node) {
  if (node.kind === 'scalar') {
    if (node.type === 'string') return 1;
    if (node.type === 'bool') return 'bad';
    return 'bad';
  }
  if (node.kind === 'enum') return 1;
  if (node.kind === 'array' || node.kind === 'object') return 'bad';
  return 'bad';
}
function compareExpression(prefix, field, baseRef, expected) {
  const accessor = `${prefix}_${field.baseAccessor}`;
  if (field.node.kind === 'scalar' && field.node.type === 'string' || field.node.kind === 'enum') return `${accessor}(${baseRef}) == ${asString(expected)}`;
  if (field.node.kind === 'scalar' && field.node.type === 'bool') return `${accessor}(${baseRef}) == ${expected ? 1 : 0}`;
  return `${accessor}(${baseRef}) == ${expected}`;
}

function stripAnsi(value) { return String(value || '').replace(/\u001b\[[0-9;]*m/g, ''); }
function truncate(value, max = 12000) { const text = String(value || ''); return text.length <= max ? text : `${text.slice(0, max)}\n... <truncated ${text.length - max} chars>`; }
function parseAscWarnings(stderr) {
  const text = stripAnsi(stderr);
  const warnings = [];
  const regex = /WARNING\s+(AS\d+):\s+([^\n]+)(?:.|\n)*?in ([^\n]+)\((\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(text))) warnings.push({ code: match[1], message: match[2].trim(), file: match[3], line: Number(match[4]), column: Number(match[5]) });
  if (warnings.length === 0 && /WARNING\s+AS\d+:/m.test(text)) warnings.push({ code: 'AS_WARNING', message: 'AssemblyScript emitted one or more warnings. Inspect stderr.' });
  return warnings;
}
function fileRecord(filePath, cwd, kind) {
  const buffer = fs.readFileSync(filePath);
  return { file: stableSlash(path.relative(cwd, filePath)), kind, bytes: buffer.length, sha256: sha256Buffer(buffer) };
}

function compileAndSmoke({ cwd, outDir, files, schemas, checkNames }) {
  const diagnostics = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-schema-json-v2-'));
  const generated = path.join(temp, 'generated');
  for (const file of files) {
    const target = path.join(temp, file.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text, 'utf8');
  }
  const runner = path.join(generated, 'as-smoke', 'schema-json-smoke-runner.as.ts');
  const smokeDir = path.join(outDir, 'generated', 'schema-json');
  fs.mkdirSync(smokeDir, { recursive: true });
  const wasmFile = path.join(smokeDir, 'pulsewasm-schema-json.wasm');
  const watFile = path.join(smokeDir, 'pulsewasm-schema-json.wat');
  const asc = resolveAsc(cwd);
  const args = [runner, '--outFile', wasmFile, '--textFile', watFile, '--runtime', 'stub', '--optimize'];
  if (!asc) {
    diagnostics.push({ phase: 'schema-json-sidecar', code: 'PULSEWASM_SCHEMA_JSON_ASC_MISSING', severity: 'error', message: 'AssemblyScript compiler is not installed.', hint: 'Run npm install so the assemblyscript dev dependency is available.', loc: { file: '<schema-json-sidecar>' } });
    return { diagnostics, warnings: [], smoke: undefined, outputs: [], command: undefined, result: undefined };
  }
  const spawnArgs = asc.script ? [asc.script, ...args] : args;
  const executable = asc.executable || asc.command;
  const proc = spawnSync(executable, spawnArgs, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const warnings = parseAscWarnings(proc.stderr);
  if (proc.status !== 0) {
    diagnostics.push({ phase: 'schema-json-sidecar', code: 'PULSEWASM_SCHEMA_JSON_COMPILE_FAILED', severity: 'error', message: 'Schema JSON sidecar smoke compilation failed.', hint: 'Inspect schema-json-smoke.json stderr.', loc: { file: '<schema-json-sidecar>' }, details: { stdout: truncate(proc.stdout), stderr: truncate(proc.stderr), exitCode: proc.status } });
  }
  const outputs = [];
  if (fs.existsSync(wasmFile)) outputs.push(fileRecord(wasmFile, cwd, 'schema-json-wasm'));
  if (fs.existsSync(watFile)) outputs.push(fileRecord(watFile, cwd, 'schema-json-wat'));
  let smoke;
  if (diagnostics.length === 0 && fs.existsSync(wasmFile)) {
    const wasm = fs.readFileSync(wasmFile);
    const module = new WebAssembly.Module(wasm);
    const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('AssemblyScript abort'); } } });
    const checks = checkNames.map((name) => {
      let actual, status = 'ok', message;
      try {
        const fn = instance.exports[name];
        if (typeof fn !== 'function') { status = 'error'; message = 'Missing smoke export.'; }
        else { actual = fn(); if (actual !== 1) { status = 'error'; message = `Expected 1, got ${actual}.`; } }
      } catch (error) { status = 'error'; message = error.message || String(error); }
      return { name, expected: 1, actual, status, message };
    });
    smoke = { imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module), checks, failedChecks: checks.filter((check) => check.status !== 'ok'), wasmBytes: wasm.length };
    if (smoke.failedChecks.length) diagnostics.push({ phase: 'schema-json-sidecar', code: 'PULSEWASM_SCHEMA_JSON_SMOKE_FAILED', severity: 'error', message: 'Schema JSON sidecar smoke checks failed.', hint: 'Inspect schema-json-smoke.json checks.', loc: { file: '<schema-json-sidecar>' } });
  }
  return { diagnostics, warnings, smoke, outputs, command: { executable: asc.display, args: args.map((arg) => path.isAbsolute(arg) ? stableSlash(path.relative(cwd, arg)) : arg) }, result: { exitCode: proc.status, stdout: truncate(proc.stdout), stderr: truncate(proc.stderr) } };
}

function registryField(field) {
  if (field.node.kind === 'scalar') {
    const out = { kind: 'scalar', type: field.node.type, required: field.required, nullable: field.nullable, export: field.baseAccessor };
    if (field.hasAccessor) out.has = field.hasAccessor;
    if (field.nullAccessor) out.isNull = field.nullAccessor;
    return out;
  }
  if (field.node.kind === 'enum') {
    const out = { kind: 'enum', type: 'enum', required: field.required, nullable: field.nullable, export: field.baseAccessor, values: field.node.values };
    if (field.hasAccessor) out.has = field.hasAccessor;
    if (field.nullAccessor) out.isNull = field.nullAccessor;
    return out;
  }
  if (field.node.kind === 'array') {
    const out = { kind: 'array', type: 'array', required: field.required, nullable: field.nullable, ref: field.refAccessor, len: field.lenAccessor, at: field.atAccessor, itemKind: field.node.item.kind === 'scalar' ? 'scalar' : field.node.item.kind };
    if (field.hasAccessor) out.has = field.hasAccessor;
    if (field.nullAccessor) out.isNull = field.nullAccessor;
    return out;
  }
  const out = { kind: 'object', type: 'object', required: field.required, nullable: field.nullable, ref: field.refAccessor, fields: Object.fromEntries(field.node.fields.map((child) => [child.name, registryField(child)])) };
  if (field.hasAccessor) out.has = field.hasAccessor;
  if (field.nullAccessor) out.isNull = field.nullAccessor;
  return out;
}

function schemaExports(schema) {
  const symbol = schemaSymbol(schema);
  return {
    parse: 'parse',
    ok: 'ok',
    value: 'value',
    error: 'error',
    serialize: 'serialize',
    errorCode: 'errorCode',
    errorMessage: 'errorMessage',
    errorStatusCode: 'errorStatusCode',
    aliasedParse: `parse${symbol}`,
    aliasedOk: `${symbol}ParseOk`,
    aliasedValue: `${symbol}ParseValue`,
    aliasedError: `${symbol}ParseError`,
    fields: Object.fromEntries(schema.root.fields.map((field) => [field.name, registryField(field)]))
  };
}

function buildMarkdown(artifact) {
  const lines = [];
  lines.push('# PulseWasm Schema JSON Registry + Sidecar ABI v2');
  lines.push('');
  lines.push(`Generated by: \`${artifact.generatedBy}\``);
  lines.push(`Phase: \`${artifact.policy.phase}\``);
  lines.push('');
  lines.push('## Locked positions');
  lines.push('');
  for (const item of artifact.lockedPositions) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Schemas');
  lines.push('');
  if (artifact.schemas.length === 0) lines.push('- none');
  for (const schema of artifact.schemas) lines.push(`- \`${schema.id}\` codec \`${schema.codec}\` (${schema.fields.length} root fields) → \`${schema.generatedFile}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  for (const [key, value] of Object.entries(artifact.summary || {})) lines.push(`- ${key}: \`${value}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function registryFor(selected, schemaSummaries) {
  return {
    version: SCHEMA_JSON_REGISTRY_VERSION,
    schemaVersion: 'v2',
    defaultNamespace: selected.defaultNamespace,
    contentTypePolicy: selected.contentTypePolicy,
    bodyPolicy: 'seeded-body-text-only',
    canonicalHandlerSurface: 'ctx.req.parse(schemaId)',
    schemas: schemaSummaries.map((schema) => ({
      id: schema.id,
      namespace: schema.namespace,
      name: schema.name,
      type: schema.type,
      codec: schema.codec,
      mediaTypes: schema.mediaTypes,
      sidecar: schema.generatedFile,
      exports: schema.exports
    }))
  };
}

function buildSchemaJsonSidecarV2(dispatchTable, executionPlan, options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const config = configArtifact(options);
  const selected = normalizeSchemasV2(config);
  const diagnostics = [...selected.diagnostics];
  const warnings = [...selected.warnings];
  const files = [];
  let compileResult = { diagnostics: [], warnings: [], smoke: undefined, outputs: [], command: undefined, result: undefined };
  let smokeRunner;
  if (selected.active && diagnostics.length === 0) {
    for (const schema of selected.schemas) files.push(makeFile(schema.moduleFile, schemaSidecarSource(schema)));
    smokeRunner = smokeRunnerSource(selected.schemas);
    files.push(makeFile('generated/as-smoke/schema-json-smoke-runner.as.ts', smokeRunner.text));
    compileResult = compileAndSmoke({ cwd, outDir, files, schemas: selected.schemas, checkNames: smokeRunner.checkNames });
    diagnostics.push(...compileResult.diagnostics);
    warnings.push(...compileResult.warnings);
  }
  const schemaSummaries = selected.schemas.map((schema) => ({
    id: schema.id,
    namespace: schema.namespace,
    name: schema.name,
    type: schema.type,
    source: schema.source,
    codec: schema.codec,
    mediaTypes: schema.mediaTypes,
    fields: schema.root.fields.map((field) => ({ name: field.name, required: field.required, nullable: field.nullable, kind: field.node.kind, type: field.node.kind === 'scalar' ? field.node.type : field.node.kind === 'enum' ? 'enum' : field.node.kind })),
    generatedFile: schema.moduleFile,
    exports: schemaExports(schema)
  }));
  const registry = normalizeArtifact(registryFor(selected, schemaSummaries), cwd);
  const sidecarAbi = normalizeArtifact({
    version: SCHEMA_JSON_ABI_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    phase: PHASE,
    schemaVersion: 'v2',
    clientObligations: [
      'Read schema-json-registry.json and select parsers by exact schema id, not by sidecar file path.',
      'Treat parse result refs, value refs, and error refs as opaque.',
      'Check ok(resultRef) before using value(resultRef).',
      'Use field accessors; do not assume AssemblyScript class memory layout.',
      'Do not assume generic JSON value trees or host JSON.parse.'
    ],
    parseAbi: {
      parse: '(json: string) => SchemaParseResultRef',
      ok: '(resultRef: usize) => bool',
      value: '(resultRef: usize) => SchemaValueRef',
      error: '(resultRef: usize) => PulseErrorRef'
    },
    accessorAbi: {
      scalar: '(valueRef: usize) => string | i32 | u32 | f64 | i32(bool)',
      objectRef: '(valueRef: usize) => usize',
      arrayRef: '(valueRef: usize) => usize',
      arrayLen: '(valueRef: usize) => i32',
      arrayAt: '(valueRef: usize, index: i32) => value',
      presence: '(valueRef: usize) => i32',
      nullable: '(valueRef: usize) => i32'
    },
    serializeAbi: {
      serialize: '(valueRef: usize) => string',
      fieldOrder: 'schema declaration order'
    },
    errorCodes: [
      'PULSEWASM_SCHEMA_JSON_PARSE_ERROR',
      'PULSEWASM_SCHEMA_JSON_MISSING_FIELD',
      'PULSEWASM_SCHEMA_JSON_TYPE_ERROR',
      'PULSEWASM_SCHEMA_JSON_NUMBER_RANGE_ERROR',
      'PULSEWASM_JSON_BODY_TOO_LARGE'
    ],
    supportedFieldTypes: ['string', 'bool', 'i32', 'u32', 'f64', 'array', 'object', 'enum', 'optional', 'nullable'],
    reservedFieldTypes: ['ctx.req.parse() shorthand', 'default namespace guessing', 'compile-stream lowering for schema v2', 'discriminated unions', 'binary request parsing']
  }, cwd);
  const bodyPolicy = normalizeArtifact({
    version: SCHEMA_JSON_BODY_POLICY_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    phase: PHASE,
    canonicalHandlerSurface: 'ctx.req.parse(schemaId)',
    requestBodyAccess: {
      lazyByArchitecture: true,
      phase14Mode: 'seeded-body-text-only',
      bodyReadEffect: 'reserved',
      automaticBodyRead: false,
      automaticParseDuringRouting: false
    },
    contentTypePolicy: {
      default: selected.contentTypePolicy,
      implemented: ['accept-json-or-missing', 'require-json'],
      reserved: ['ignore-content-type'],
      acceptJsonOrMissing: {
        'application/json': 'parse',
        'application/*+json': 'parse',
        missing: 'parse',
        explicitWrongMediaType: '415 PULSEWASM_UNSUPPORTED_MEDIA_TYPE'
      }
    },
    errors: {
      requestBodyRequired: { code: 'PULSEWASM_REQUEST_BODY_REQUIRED', statusCode: 400 },
      bodyReadEffectUnsupported: { code: 'PULSEWASM_BODY_READ_EFFECT_UNSUPPORTED', statusCode: 500 },
      bodySeedingContractViolation: { code: 'PULSEWASM_BODY_SEEDING_CONTRACT_VIOLATION', statusCode: 500 },
      unsupportedMediaType: { code: 'PULSEWASM_UNSUPPORTED_MEDIA_TYPE', statusCode: 415 }
    }
  }, cwd);
  const summary = {
    active: selected.active,
    target: selected.target,
    schemaVersion: 'v2',
    defaultNamespace: selected.defaultNamespace,
    contentTypePolicy: selected.contentTypePolicy,
    schemas: selected.schemas.length,
    namespaces: new Set(selected.schemas.map((schema) => schema.namespace)).size,
    generatedFiles: files.length,
    compiled: Boolean(compileResult.smoke) && diagnostics.length === 0,
    smokeExecuted: Boolean(compileResult.smoke),
    smokeChecks: compileResult.smoke ? compileResult.smoke.checks.length : 0,
    failedSmokeChecks: compileResult.smoke ? compileResult.smoke.failedChecks.length : 0,
    diagnostics: diagnostics.length,
    warnings: warnings.length,
    genericJsonTree: false,
    parseResultAbi: true,
    seededBodyTextOnly: true,
    ctxReqParseSurface: true,
    compileStreamV2: false
  };
  const artifact = normalizeArtifact({
    version: SCHEMA_JSON_SIDECAR_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    policy: {
      phase: PHASE,
      sourceOfTruth: ['runtime.payload.json.target', 'runtime.payload.json.schemaVersion', 'runtime.payload.json.schemas'],
      target: selected.target,
      schemaVersion: 'v2',
      genericJsonTree: false,
      sidecarCompilation: selected.active,
      payloadFeature: true,
      parserSurface: 'ctx.req.parse(schemaId)',
      compileStreamV2: false
    },
    lockedPositions: [
      'Explicit schema v2 widens the schema surface without changing the canonical handler surface.',
      'Handlers still choose exact schema ids: ctx.req.parse("namespace.Schema").',
      'The registry remains the source of truth for parser selection.',
      'Body handling stays lazy by architecture; explicit schema v2 still parses seeded body text only.',
      'Missing Content-Type parses by default; explicit wrong Content-Type still fails 415.',
      'The Phase 13 compile stream remains the flat v1 frontend and does not lower schema v2 shapes yet.'
    ],
    schemas: schemaSummaries,
    registry,
    sidecarAbi,
    bodyPolicy,
    diagnostics,
    warnings,
    summary
  }, cwd);
  const plan = normalizeArtifact({
    version: SCHEMA_JSON_PLAN_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    target: selected.target,
    schemaVersion: 'v2',
    parserModel: {
      kind: 'deterministic-sidecar-registry',
      genericJsonTree: false,
      dependencyFree: true,
      parseResultAbi: true,
      supportedFieldTypes: ['string', 'i32', 'u32', 'f64', 'bool', 'arrays', 'nested objects', 'optional', 'nullable', 'enum'],
      compileStreamV2: false
    },
    defaultNamespace: selected.defaultNamespace,
    schemas: schemaSummaries,
    diagnostics,
    warnings,
    summary
  }, cwd);
  const report = normalizeArtifact({
    version: SCHEMA_JSON_REPORT_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    lowering: selected.schemas.map((schema) => ({
      id: schema.id,
      schema: schema.type,
      namespace: schema.namespace,
      source: schema.source,
      arrays: schema.root.fields.filter((field) => field.node.kind === 'array').map((field) => ({ path: fieldPathString(field.pathSegments), accessor: field.lenAccessor })),
      nestedObjects: schema.root.fields.filter((field) => field.node.kind === 'object').map((field) => fieldPathString(field.pathSegments)),
      optionalFields: schema.root.fields.filter((field) => !field.required).map((field) => fieldPathString(field.pathSegments)),
      nullableFields: schema.root.fields.filter((field) => field.nullable).map((field) => fieldPathString(field.pathSegments)),
      parser: 'parse',
      parserAlias: `parse${schemaSymbol(schema)}`,
      parseResultAccessors: ['ok', 'value', 'error'],
      serializer: 'serialize'
    })),
    command: compileResult.command,
    result: compileResult.result,
    outputFiles: compileResult.outputs || [],
    diagnostics,
    warnings,
    summary
  }, cwd);
  const smoke = normalizeArtifact({
    version: SCHEMA_JSON_SMOKE_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    policy: {
      phase: PHASE,
      wasmCompiled: Boolean(compileResult.outputs?.length),
      wasmExecuted: Boolean(compileResult.smoke),
      genericJsonParser: false,
      parseResultAbi: true,
      schemaVersion: 'v2'
    },
    command: compileResult.command,
    result: compileResult.result,
    generated: { inputFiles: files.map(({ text, ...rest }) => rest), outputFiles: compileResult.outputs || [] },
    checks: compileResult.smoke ? compileResult.smoke.checks : [],
    diagnostics,
    warnings,
    summary: {
      compiled: Boolean(compileResult.outputs?.length) && diagnostics.length === 0,
      executed: Boolean(compileResult.smoke),
      checks: compileResult.smoke ? compileResult.smoke.checks.length : 0,
      failedChecks: compileResult.smoke ? compileResult.smoke.failedChecks.length : 0,
      diagnostics: diagnostics.length,
      warnings: warnings.length
    }
  }, cwd);
  return {
    artifact,
    plan,
    report,
    smoke,
    registry,
    sidecarAbi,
    bodyPolicy,
    files: files.concat([makeFile('generated/host/schema-json-sidecar.md', buildMarkdown(artifact))]),
    outputFiles: compileResult.outputs || [],
    diagnostics,
    warnings
  };
}

module.exports = { buildSchemaJsonSidecarV2, shouldUseSchemaJsonV2 };
