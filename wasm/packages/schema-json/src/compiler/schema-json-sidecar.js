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
  SUPPORTED_TYPES,
  RESERVED_TYPES,
  CONTENT_TYPE_POLICIES,
  DEFAULT_SCHEMA_JSON_NAMESPACE,
  DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY,
  DEFAULT_SCHEMA_JSON_MAX_BYTES,
  lowerFieldType
} = loadContractsSchemaJsonV1();


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

function loadContractsSchemaJsonV1() {
  try {
    return require('@pulse-compute/wasm-contracts/schema-json/v1');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/schema-json/v1.js');
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
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function configArtifact(options = {}) { return options.resolvedConfig?.artifact || options.resolvedConfig || {}; }
function jsonConfig(config) {
  const runtime = plainObject(config.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || config.json);
}

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

function normalizeSchemas(config) {
  const json = jsonConfig(config);
  const target = typeof json.target === 'string' && json.target ? json.target : 'generic';
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  const effectiveTarget = target === 'auto' && schemas.length > 0 ? 'schema' : target;
  const defaultNamespace = typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : DEFAULT_SCHEMA_JSON_NAMESPACE;
  const contentTypePolicy = typeof json.contentTypePolicy === 'string' && json.contentTypePolicy ? json.contentTypePolicy : DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY;
  return { target, effectiveTarget, schemas, defaultNamespace, contentTypePolicy, maxBytes: Number.isFinite(Number(json.maxBytes)) ? Number(json.maxBytes) : DEFAULT_SCHEMA_JSON_MAX_BYTES };
}

function schemaFields(schema) {
  const fields = [];
  const rawFields = plainObject(schema.fields);
  for (const [name, type] of Object.entries(rawFields)) {
    fields.push({ name, type: String(type), asType: lowerFieldType(String(type)), required: true });
  }
  return fields;
}

function validateSchemas(config) {
  const { target, effectiveTarget, schemas, defaultNamespace, contentTypePolicy, maxBytes } = normalizeSchemas(config);
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
  if (effectiveTarget !== 'schema') {
    warnings.push(makeWarning(
      'PULSEWASM_SCHEMA_JSON_INACTIVE',
      'Schema JSON sidecar generation is inactive because json.target is not "schema" and auto mode did not provide schemas.',
      'Use json.target = "schema" with json.schemas, or use { target: "auto", parser: "as-json" } for the generic AssemblyScript JSON parser fallback.',
      { target, effectiveTarget }
    ));
    return { target, effectiveTarget, defaultNamespace, contentTypePolicy, maxBytes, schemas: normalized, diagnostics, warnings, active: false };
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
    const fields = schemaFields(schema);
    if (namespace === defaultNamespace) defaultNamespaceSeen = true;
    if (!name || !type) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_NAME_REQUIRED',
        'Schema declarations require a static name/type.',
        'Use { namespace: "app", name: "CreateUserBody", type: "CreateUserBody", fields: { ... } }.',
        { index, schema }
      ));
      continue;
    }
    if (codec !== 'json') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_CODEC_UNSUPPORTED',
        `Schema ${JSON.stringify(name)} uses unsupported codec ${JSON.stringify(codec)}.`,
        'Phase 12B.1 supports codec: "json" only. Other codecs are reserved behind ctx.req.parse(...).',
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
    if (fields.length === 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_SCHEMA_JSON_FIELDS_REQUIRED',
        `Schema ${JSON.stringify(id)} requires explicit fields in Phase 12B.1.`,
        'Use fields: { fieldName: "string" | "i32" | "u32" | "f64" | "bool" } until the external TS-type compiler is plugged in.',
        { id }
      ));
    }
    for (const field of fields) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.name)) {
        diagnostics.push(makeDiagnostic(
          'PULSEWASM_SCHEMA_JSON_FIELD_NAME_UNSUPPORTED',
          `Schema field ${JSON.stringify(field.name)} is not a supported AS identifier.`,
          'Use simple identifier field names for Phase 12B.1 sidecars.',
          { schema: id, field: field.name }
        ));
      }
      if (!SUPPORTED_TYPES.has(field.type)) {
        const reserved = RESERVED_TYPES.has(field.type);
        diagnostics.push(makeDiagnostic(
          reserved ? 'PULSEWASM_SCHEMA_JSON_FIELD_TYPE_RESERVED' : 'PULSEWASM_SCHEMA_JSON_FIELD_TYPE_UNSUPPORTED',
          `Schema field ${id}.${field.name} has unsupported type ${JSON.stringify(field.type)}.`,
          'Phase 12B.1 supports string, i32, u32, f64, bool/boolean only. Arrays, nested objects, unions, optionals, and generics are reserved.',
          { schema: id, field: field.name, type: field.type }
        ));
      }
    }
    normalized.push({
      id,
      namespace,
      name,
      type,
      source,
      codec,
      mediaTypes,
      fields,
      functionBase: safeIdentifier(type),
      fileBase: kebab(type),
      namespaceBase: kebab(namespace),
      moduleFile: `generated/as/schema-json/${kebab(namespace)}/${kebab(type)}.as.ts`
    });
  }
  if (schemas.length > 0 && !defaultNamespaceSeen) {
    warnings.push(makeWarning(
      'PULSEWASM_SCHEMA_JSON_DEFAULT_NAMESPACE_EMPTY',
      `Default namespace ${JSON.stringify(defaultNamespace)} has no schemas.`,
      'Unqualified ctx.req.parse() / schema names will require route metadata or explicit namespace.name ids.',
      { defaultNamespace }
    ));
  }
  return { target, defaultNamespace, contentTypePolicy, maxBytes, schemas: normalized, diagnostics, warnings, active: true };
}

function schemaSidecarSource(schema) {
  const typeName = safeIdentifier(schema.type);
  const symbol = schemaSymbol(schema);
  const lines = [];
  lines.push('// Generated by PulseWasm Phase 12B.1.');
  lines.push('// Deterministic schema JSON sidecar. Parse returns an explicit result ref.');
  lines.push('');
  lines.push('export class PulseSchemaJsonError {');
  lines.push('  code: string = "";');
  lines.push('  message: string = "";');
  lines.push('  statusCode: i32 = 400;');
  lines.push('}');
  lines.push('');
  lines.push(`export class ${typeName} {`);
  for (const field of schema.fields) {
    const t = lowerFieldType(field.type);
    const init = t === 'string' ? ' = ""' : t === 'bool' ? ' = false' : ' = 0';
    lines.push(`  ${field.name}: ${t}${init};`);
  }
  lines.push('}');
  lines.push('');
  lines.push('export class SchemaParseResult {');
  lines.push('  ok: bool = false;');
  lines.push('  valueRef: usize = 0;');
  lines.push('  errorRef: usize = 0;');
  lines.push('}');
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
  lines.push('  result.errorRef = 0;');
  lines.push('  return changetype<usize>(result);');
  lines.push('}');
  lines.push('');
  lines.push('function makeErr(errorRef: usize): usize {');
  lines.push('  const result = new SchemaParseResult();');
  lines.push('  result.ok = false;');
  lines.push('  result.valueRef = 0;');
  lines.push('  result.errorRef = errorRef;');
  lines.push('  return changetype<usize>(result);');
  lines.push('}');
  lines.push('');
  lines.push('function skipWs(json: string, pos: i32): i32 {');
  lines.push('  let i: i32 = pos;');
  lines.push('  while (i < json.length) {');
  lines.push('    const ch = json.charCodeAt(i);');
  lines.push('    if (ch != 32 && ch != 10 && ch != 13 && ch != 9) return i;');
  lines.push('    i += 1;');
  lines.push('  }');
  lines.push('  return i;');
  lines.push('}');
  lines.push('');
  lines.push('function valueStart(json: string, key: string): i32 {');
  lines.push('  const needle = "\\\"" + key + "\\\"";');
  lines.push('  const keyIndex = json.indexOf(needle);');
  lines.push('  if (keyIndex < 0) return -1;');
  lines.push('  const colon = json.indexOf(":", keyIndex + needle.length);');
  lines.push('  if (colon < 0) return -1;');
  lines.push('  return skipWs(json, colon + 1);');
  lines.push('}');
  lines.push('');
  lines.push('function valueEnd(json: string, pos: i32): i32 {');
  lines.push('  let i: i32 = pos;');
  lines.push('  let inString = false;');
  lines.push('  while (i < json.length) {');
  lines.push('    const ch = json.charCodeAt(i);');
  lines.push('    if (ch == 34) inString = !inString;');
  lines.push('    if (!inString && (ch == 44 || ch == 125)) return i;');
  lines.push('    i += 1;');
  lines.push('  }');
  lines.push('  return i;');
  lines.push('}');
  lines.push('');
  lines.push('function hasField(json: string, key: string): bool { return valueStart(json, key) >= 0; }');
  lines.push('');
  lines.push('function isStringAt(json: string, pos: i32): bool { return pos >= 0 && pos < json.length && json.charCodeAt(pos) == 34; }');
  lines.push('');
  lines.push('function isBoolAt(json: string, pos: i32): bool {');
  lines.push('  if (pos < 0) return false;');
  lines.push('  return json.substr(pos, 4) == "true" || json.substr(pos, 5) == "false";');
  lines.push('}');
  lines.push('');
  lines.push('function isNumberAt(json: string, pos: i32): bool {');
  lines.push('  if (pos < 0 || pos >= json.length) return false;');
  lines.push('  const ch = json.charCodeAt(pos);');
  lines.push('  return ch == 45 || (ch >= 48 && ch <= 57);');
  lines.push('}');
  lines.push('');
  lines.push('function parseString(json: string, key: string): string {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (!isStringAt(json, start)) return "";');
  lines.push('  let end: i32 = start + 1;');
  lines.push('  while (end < json.length && json.charCodeAt(end) != 34) end += 1;');
  lines.push('  if (end >= json.length) return "";');
  lines.push('  return json.substring(start + 1, end);');
  lines.push('}');
  lines.push('');
  lines.push('function parseI32(json: string, key: string): i32 {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (!isNumberAt(json, start)) return 0;');
  lines.push('  const end = valueEnd(json, start);');
  lines.push('  return I32.parseInt(json.substring(start, end));');
  lines.push('}');
  lines.push('');
  lines.push('function parseU32(json: string, key: string): u32 {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (!isNumberAt(json, start)) return 0;');
  lines.push('  const end = valueEnd(json, start);');
  lines.push('  return U32.parseInt(json.substring(start, end));');
  lines.push('}');
  lines.push('');
  lines.push('function parseF64(json: string, key: string): f64 {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (!isNumberAt(json, start)) return 0.0;');
  lines.push('  const end = valueEnd(json, start);');
  lines.push('  return F64.parseFloat(json.substring(start, end));');
  lines.push('}');
  lines.push('');
  lines.push('function parseBool(json: string, key: string): bool {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (!isBoolAt(json, start)) return false;');
  lines.push('  return json.substr(start, 4) == "true";');
  lines.push('}');
  lines.push('');
  lines.push('function fieldTypeOk(json: string, key: string, typeCode: i32): bool {');
  lines.push('  const start = valueStart(json, key);');
  lines.push('  if (typeCode == 0) return isStringAt(json, start);');
  lines.push('  if (typeCode == 1) return isNumberAt(json, start);');
  lines.push('  if (typeCode == 2) return isBoolAt(json, start);');
  lines.push('  return false;');
  lines.push('}');
  lines.push('');
  lines.push('export function parse(json: string): usize {');
  lines.push(`  if (skipWs(json, 0) >= json.length || json.charCodeAt(skipWs(json, 0)) != 123) return makeErr(makeError("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Invalid JSON object for ${schema.id}.", 400));`);
  for (const field of schema.fields) {
    lines.push(`  if (!hasField(json, ${asString(field.name)})) return makeErr(makeError("PULSEWASM_SCHEMA_JSON_MISSING_FIELD", "Missing required field ${field.name}.", 400));`);
    const typeCode = field.asType === 'string' ? 0 : field.asType === 'bool' ? 2 : 1;
    lines.push(`  if (!fieldTypeOk(json, ${asString(field.name)}, ${typeCode})) return makeErr(makeError("PULSEWASM_SCHEMA_JSON_TYPE_ERROR", "Wrong type for field ${field.name}.", 400));`);
  }
  lines.push(`  const value = new ${typeName}();`);
  for (const field of schema.fields) {
    const fn = field.asType === 'string' ? 'parseString' : field.asType === 'bool' ? 'parseBool' : field.asType === 'u32' ? 'parseU32' : field.asType === 'f64' ? 'parseF64' : 'parseI32';
    lines.push(`  value.${field.name} = ${fn}(json, ${asString(field.name)});`);
  }
  lines.push('  return makeOk(changetype<usize>(value));');
  lines.push('}');
  lines.push('');
  lines.push('export function ok(resultRef: usize): bool { return changetype<SchemaParseResult>(resultRef).ok; }');
  lines.push('export function value(resultRef: usize): usize { return changetype<SchemaParseResult>(resultRef).valueRef; }');
  lines.push('export function error(resultRef: usize): usize { return changetype<SchemaParseResult>(resultRef).errorRef; }');
  lines.push('export function errorCode(errorRef: usize): string { return changetype<PulseSchemaJsonError>(errorRef).code; }');
  lines.push('export function errorMessage(errorRef: usize): string { return changetype<PulseSchemaJsonError>(errorRef).message; }');
  lines.push('export function errorStatusCode(errorRef: usize): i32 { return changetype<PulseSchemaJsonError>(errorRef).statusCode; }');
  lines.push('');
  // Schema-specific aliases keep generated integrations readable when sidecars are linked together.
  lines.push(`export function parse${symbol}(json: string): usize { return parse(json); }`);
  lines.push(`export function ${symbol}ParseOk(resultRef: usize): bool { return ok(resultRef); }`);
  lines.push(`export function ${symbol}ParseValue(resultRef: usize): usize { return value(resultRef); }`);
  lines.push(`export function ${symbol}ParseError(resultRef: usize): usize { return error(resultRef); }`);
  lines.push('');
  for (const field of schema.fields) {
    const t = lowerFieldType(field.type);
    const suffix = safeIdentifier(field.name[0].toUpperCase() + field.name.slice(1));
    lines.push(`export function ${field.name}(valueRef: usize): ${t} { return changetype<${typeName}>(valueRef).${field.name}; }`);
    lines.push(`export function ${symbol}${suffix}(valueRef: usize): ${t} { return ${field.name}(valueRef); }`);
    lines.push('');
  }
  lines.push('export function serialize(valueRef: usize): string {');
  lines.push(`  const value = changetype<${typeName}>(valueRef);`);
  const parts = schema.fields.map((field) => {
    if (field.asType === 'string') return `${asString(`"${field.name}":"`)} + value.${field.name} + ${asString('"')}`;
    if (field.asType === 'bool') return `${asString(`"${field.name}":`)} + (value.${field.name} ? "true" : "false")`;
    return `${asString(`"${field.name}":`)} + value.${field.name}.toString()`;
  });
  if (parts.length === 0) lines.push('  return "{}";');
  else lines.push(`  return "{" + ${parts.join(' + "," + ')} + "}";`);
  lines.push('}');
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
    const imported = ['parse', 'ok', 'value', 'error', 'errorCode', 'errorStatusCode', 'serialize']
      .concat(schema.fields.map((f) => f.name))
      .map((name) => importAlias(prefix, name));
    imports.push(`import { ${imported.join(', ')} } from '${file}';`);
    const sample = {};
    for (const field of schema.fields) {
      if (field.asType === 'string') sample[field.name] = field.name === 'name' ? 'Ada' : `${field.name}-value`;
      else if (field.asType === 'bool') sample[field.name] = true;
      else if (field.asType === 'f64') sample[field.name] = 42.5;
      else sample[field.name] = 42;
    }
    const sampleJson = JSON.stringify(sample);
    const parseOkName = `smoke_schema_${kebab(schema.namespace).replace(/-/g, '_')}_${kebab(schema.type).replace(/-/g, '_')}_parse_ok`;
    checks.push(`function parse_${prefix}(): usize { return ${prefix}_parse(${asString(sampleJson)}); }`);
    checks.push(`export function ${parseOkName}(): i32 { const r = parse_${prefix}(); return ${prefix}_ok(r) && ${prefix}_value(r) != 0 ? 1 : 0; }`);
    checkNames.push(parseOkName);
    for (const field of schema.fields) {
      const exportName = `smoke_schema_${kebab(schema.namespace).replace(/-/g, '_')}_${kebab(schema.type).replace(/-/g, '_')}_${field.name}`;
      if (field.asType === 'string') {
        checks.push(`export function ${exportName}(): i32 { const v = ${prefix}_value(parse_${prefix}()); return ${prefix}_${field.name}(v) == ${asString(sample[field.name])} ? 1 : 0; }`);
      } else if (field.asType === 'bool') {
        checks.push(`export function ${exportName}(): i32 { const v = ${prefix}_value(parse_${prefix}()); return ${prefix}_${field.name}(v) == true ? 1 : 0; }`);
      } else {
        checks.push(`export function ${exportName}(): i32 { const v = ${prefix}_value(parse_${prefix}()); return ${prefix}_${field.name}(v) == ${sample[field.name]} ? 1 : 0; }`);
      }
      checkNames.push(exportName);
    }
    const serializeName = `smoke_schema_${kebab(schema.namespace).replace(/-/g, '_')}_${kebab(schema.type).replace(/-/g, '_')}_serialize`;
    checks.push(`export function ${serializeName}(): i32 { return ${prefix}_serialize(${prefix}_value(parse_${prefix}())).indexOf(${asString(schema.fields[0] ? schema.fields[0].name : '')}) >= 0 ? 1 : 0; }`);
    checkNames.push(serializeName);
    const missingName = `smoke_schema_${kebab(schema.namespace).replace(/-/g, '_')}_${kebab(schema.type).replace(/-/g, '_')}_missing_field_error`;
    const partial = schema.fields.length ? JSON.stringify(Object.fromEntries(schema.fields.slice(1).map((f) => [f.name, sample[f.name]]))) : '{}';
    checks.push(`export function ${missingName}(): i32 { const r = ${prefix}_parse(${asString(partial)}); const e = ${prefix}_error(r); return !${prefix}_ok(r) && ${prefix}_errorCode(e) == "PULSEWASM_SCHEMA_JSON_MISSING_FIELD" ? 1 : 0; }`);
    checkNames.push(missingName);
    const typeName = `smoke_schema_${kebab(schema.namespace).replace(/-/g, '_')}_${kebab(schema.type).replace(/-/g, '_')}_type_error`;
    const wrong = { ...sample };
    if (schema.fields[0]) wrong[schema.fields[0].name] = schema.fields[0].asType === 'string' ? 1 : 'bad';
    checks.push(`export function ${typeName}(): i32 { const r = ${prefix}_parse(${asString(JSON.stringify(wrong))}); const e = ${prefix}_error(r); return !${prefix}_ok(r) && ${prefix}_errorCode(e) == "PULSEWASM_SCHEMA_JSON_TYPE_ERROR" && ${prefix}_errorStatusCode(e) == 400 ? 1 : 0; }`);
    checkNames.push(typeName);
  }
  return { text: `${imports.join('\n')}\n\n${checks.join('\n')}\n`, checkNames };
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-schema-json-'));
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
    smoke = { imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module), checks, failedChecks: checks.filter((c) => c.status !== 'ok'), wasmBytes: wasm.length };
    if (smoke.failedChecks.length) diagnostics.push({ phase: 'schema-json-sidecar', code: 'PULSEWASM_SCHEMA_JSON_SMOKE_FAILED', severity: 'error', message: 'Schema JSON sidecar smoke checks failed.', hint: 'Inspect schema-json-smoke.json checks.', loc: { file: '<schema-json-sidecar>' } });
  }
  return { diagnostics, warnings, smoke, outputs, command: { executable: asc.display, args: args.map((arg) => path.isAbsolute(arg) ? stableSlash(path.relative(cwd, arg)) : arg) }, result: { exitCode: proc.status, stdout: truncate(proc.stdout), stderr: truncate(proc.stderr) } };
}

function buildMarkdown(artifact) {
  const lines = [];
  lines.push('# PulseWasm Schema JSON Registry + Sidecar ABI v1');
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
  for (const schema of artifact.schemas) {
    lines.push(`- \`${schema.id}\` codec \`${schema.codec}\` (${schema.fields.length} fields) → \`${schema.generatedFile}\``);
  }
  lines.push('');
  lines.push('## Handler surface');
  lines.push('');
  lines.push('- canonical parser surface: `ctx.req.parse("namespace.Schema")`');
  lines.push('- `ctx.req.parse()` is reserved for routes with exactly one declared body schema');
  lines.push('- `ctx.req.json(...)` is reserved as JSON-only sugar, not the core ABI');
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
    defaultNamespace: selected.defaultNamespace,
    contentTypePolicy: selected.contentTypePolicy,
    bodyPolicy: 'seeded-body-text-only',
    canonicalHandlerSurface: 'ctx.req.parse(schemaId)',
    defaultParseSurface: {
      form: 'ctx.req.parse()',
      legalWhen: 'current route declares exactly one body schema',
      status: 'reserved-route-body-metadata-required'
    },
    jsonSugar: {
      form: 'ctx.req.json(schemaId)',
      status: 'reserved',
      equivalentTo: 'ctx.req.parse(schemaId) when codec = json'
    },
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

function schemaExports(schema) {
  const symbol = schemaSymbol(schema);
  const fields = {};
  for (const field of schema.fields) fields[field.name] = field.name;
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
    fields
  };
}

function buildSchemaJsonSidecar(dispatchTable, executionPlan, options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const config = configArtifact(options);
  const selected = validateSchemas(config);
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
    fields: schema.fields,
    generatedFile: schema.moduleFile,
    exports: schemaExports(schema)
  }));
  const registry = normalizeArtifact(registryFor(selected, schemaSummaries), cwd);
  const sidecarAbi = normalizeArtifact({
    version: SCHEMA_JSON_ABI_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    phase: PHASE,
    clientObligations: [
      'Read schema-json-registry.json and select parsers by schema id, not by sidecar file path.',
      'Treat parse result refs, value refs, and error refs as opaque.',
      'Check ok(resultRef) before using value(resultRef).',
      'Use field accessors; do not assume AssemblyScript class memory layout.',
      'Do not assume generic JSON value model or host JSON.parse.'
    ],
    parseAbi: {
      parse: '(json: string) => SchemaParseResultRef',
      ok: '(resultRef: usize) => bool',
      value: '(resultRef: usize) => SchemaValueRef',
      error: '(resultRef: usize) => PulseErrorRef'
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
    supportedFieldTypes: ['string', 'bool', 'i32', 'u32', 'f64'],
    reservedFieldTypes: ['arrays', 'nested objects', 'optional fields', 'nullable fields', 'unions', 'generics', 'dates']
  }, cwd);
  const bodyPolicy = normalizeArtifact({
    version: SCHEMA_JSON_BODY_POLICY_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    phase: PHASE,
    canonicalHandlerSurface: 'ctx.req.parse(schemaId)',
    requestBodyAccess: {
      lazyByArchitecture: true,
      phase12b1Mode: 'seeded-body-text-only',
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
    defaultNamespace: selected.defaultNamespace,
    contentTypePolicy: selected.contentTypePolicy,
    schemas: selected.schemas.length,
    namespaces: new Set(selected.schemas.map((s) => s.namespace)).size,
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
    externalTsTypeCompilerRequired: false
  };
  const artifact = normalizeArtifact({
    version: SCHEMA_JSON_SIDECAR_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    policy: {
      phase: PHASE,
      sourceOfTruth: ['runtime.payload.json.target', 'runtime.payload.json.schemas', 'future pulse json compile outputs'],
      target: selected.target,
      contractOnlyWhenInactive: !selected.active,
      genericJsonTree: false,
      arbitraryTsTypeParsing: false,
      sidecarCompilation: selected.active,
      routingFeature: false,
      payloadFeature: true,
      registry: 'schema-json-registry.json',
      parserSurface: 'ctx.req.parse(schemaId)'
    },
    lockedPositions: [
      'Multiple schema sidecars are expected and are addressed through namespace + schema name ids.',
      'Handlers choose schema ids, not sidecar files: ctx.req.parse("namespace.Schema").',
      'ctx.req.parse() is reserved for routes with exactly one declared body schema.',
      'ctx.req.json(...) remains reserved JSON-only sugar; parse is the canonical generic surface.',
      'Schema sidecars return explicit parse-result refs, not raw value refs.',
      'Body handling is lazy by architecture; Phase 12B.1 parses seeded body text only.',
      'Missing Content-Type parses by default; explicit wrong Content-Type fails 415.',
      'Generated schema parsers are deterministic AS sidecars and do not require a generic JSON value tree.'
    ],
    schemas: schemaSummaries,
    registry: registry,
    sidecarAbi: sidecarAbi,
    bodyPolicy: bodyPolicy,
    diagnostics,
    warnings,
    summary
  }, cwd);
  const plan = normalizeArtifact({
    version: SCHEMA_JSON_PLAN_VERSION,
    generatedBy,
    status: diagnostics.length ? 'error' : 'ok',
    target: selected.target,
    parserModel: {
      kind: 'deterministic-sidecar-registry',
      genericJsonTree: false,
      dependencyFree: true,
      parseResultAbi: true,
      supportedFieldTypes: ['string', 'i32', 'u32', 'f64', 'bool'],
      richTsTypeCompiler: 'external future stream'
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
      fields: schema.fields.map((f) => ({ name: f.name, type: f.type, loweredTo: f.asType, required: true })),
      parser: 'parse',
      parserAlias: `parse${schemaSymbol(schema)}`,
      parseResultAccessors: ['ok', 'value', 'error'],
      serializer: 'serialize',
      unsupportedTypes: schema.fields.filter((f) => !SUPPORTED_TYPES.has(f.type)).map((f) => f.type)
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
      hostBindings: false,
      genericJsonParser: false,
      parseResultAbi: true,
      multipleSchemas: selected.schemas.length > 1
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

module.exports = { buildSchemaJsonSidecar };
