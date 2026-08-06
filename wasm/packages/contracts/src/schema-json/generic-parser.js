'use strict';

const SCHEMA_JSON_GENERIC_PARSER_VERSION = 'pulsewasm.schema-json-generic-parser.v1';
const SCHEMA_JSON_GENERIC_PARSER_PLAN_VERSION = 'pulsewasm.schema-json-generic-parser-plan.v1';
const SCHEMA_JSON_GENERIC_PARSER_ABI_VERSION = 'pulsewasm.schema-json-generic-parser-abi.v1';
const SCHEMA_JSON_GENERIC_PARSER_SMOKE_VERSION = 'pulsewasm.schema-json-generic-parser-smoke.v1';
const SCHEMA_JSON_GENERIC_PARSER_PHASE = '34';
const PHASE = SCHEMA_JSON_GENERIC_PARSER_PHASE;

const SCHEMA_JSON_GENERIC_PARSER_ARTIFACT = 'schema-json-generic-parser.json';
const SCHEMA_JSON_GENERIC_PARSER_PLAN_ARTIFACT = 'schema-json-generic-parser-plan.json';
const SCHEMA_JSON_GENERIC_PARSER_ABI_ARTIFACT = 'schema-json-generic-parser-abi.json';
const SCHEMA_JSON_GENERIC_PARSER_SMOKE_ARTIFACT = 'schema-json-generic-parser-smoke.json';
const SCHEMA_JSON_GENERIC_PARSER_NAME = 'as-json';
const SCHEMA_JSON_GENERIC_PARSER_ID = SCHEMA_JSON_GENERIC_PARSER_NAME;
const SCHEMA_JSON_GENERIC_PARSER_MODE = 'generic-as-json-parser';
const SCHEMA_JSON_GENERIC_PARSER_FILE = 'generated/as/schema-json/generic/as-json-parser.as.ts';
const SCHEMA_JSON_GENERIC_PARSER_MODULE_FILE = SCHEMA_JSON_GENERIC_PARSER_FILE;
const SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE = 'generated/as-smoke/schema-json-generic-parser-smoke-runner.as.ts';
const SCHEMA_JSON_GENERIC_PARSER_WASM_FILE = 'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wasm';
const SCHEMA_JSON_GENERIC_PARSER_WAT_FILE = 'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wat';
const SCHEMA_JSON_GENERIC_PARSER_WASM = SCHEMA_JSON_GENERIC_PARSER_WASM_FILE;
const SCHEMA_JSON_GENERIC_PARSER_WAT = SCHEMA_JSON_GENERIC_PARSER_WAT_FILE;
const SCHEMA_JSON_GENERIC_PARSER_DOC_FILE = 'generated/host/schema-json-generic-parser.md';

const SCHEMA_JSON_TARGETS = Object.freeze(['generic', 'schema', 'auto', 'parser', 'none']);
const SCHEMA_JSON_GENERIC_PARSER_TARGETS = Object.freeze(['auto', 'parser']);
const SCHEMA_JSON_PARSER_MODES = Object.freeze([SCHEMA_JSON_GENERIC_PARSER_NAME]);
const SCHEMA_JSON_GENERIC_VALUE_KINDS = Object.freeze({ null: 0, bool: 1, number: 2, string: 3, array: 4, object: 5, error: -1 });
const SCHEMA_JSON_GENERIC_PARSER_ACCESSORS = Object.freeze(['parse', 'ok', 'value', 'error', 'errorCode', 'errorMessage', 'errorStatusCode', 'kind', 'isNull', 'asBool', 'asF64', 'asString', 'objectGet', 'objectHas', 'has', 'get', 'getString', 'getI32', 'getU32', 'getF64', 'getBool', 'arrayLen', 'arrayGet', 'length', 'at', 'text']);
const SCHEMA_JSON_GENERIC_ACCESSOR_SURFACE = SCHEMA_JSON_GENERIC_PARSER_ACCESSORS;
const SCHEMA_JSON_GENERIC_RESERVED_SURFACE = Object.freeze(['automatic typed schema inference from generic refs', 'arbitrary JavaScript object materialization', 'host JSON.parse fallback', 'binary request body parsing', 'streaming request body parsing', 'mutation APIs for parsed generic refs']);
const SCHEMA_JSON_GENERIC_PARSER_POLICY = Object.freeze({ phase: SCHEMA_JSON_GENERIC_PARSER_PHASE, parser: SCHEMA_JSON_GENERIC_PARSER_NAME, explicitOptIn: true, schemaDeclarationsPreferred: true, schemaAutoTakesPrecedence: true, directJsObjects: false, hostJsonParse: false, assemblyScriptParser: true, fullJsonTree: true, valueAccess: 'opaque-ref-accessors', bodySource: 'seeded-body-text-only', supportedTargets: SCHEMA_JSON_GENERIC_PARSER_TARGETS, supportedValueKinds: Object.keys(SCHEMA_JSON_GENERIC_VALUE_KINDS).filter((kind) => kind !== 'error'), reservedSurface: SCHEMA_JSON_GENERIC_RESERVED_SURFACE });
const SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS = Object.freeze({ parserRequired: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_REQUIRED', genericParserRequired: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_REQUIRED', unsupportedParser: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_UNSUPPORTED', genericParserUnsupported: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_UNSUPPORTED', genericParserInactive: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_INACTIVE', schemasTakePrecedence: 'PULSEWASM_SCHEMA_JSON_SCHEMAS_TAKE_PRECEDENCE', schemasIgnored: 'PULSEWASM_SCHEMA_JSON_GENERIC_SCHEMAS_IGNORED', schemaTargetRequiresSchemas: 'PULSEWASM_SCHEMA_JSON_SCHEMAS_REQUIRED', compileFailed: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_COMPILE_FAILED', genericParserCompileFailed: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_COMPILE_FAILED', smokeFailed: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_SMOKE_FAILED', genericParserSmokeFailed: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_SMOKE_FAILED', ascMissing: 'PULSEWASM_SCHEMA_JSON_GENERIC_PARSER_ASC_MISSING' });

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function configArtifact(config) { return config && typeof config === 'object' && config.artifact ? config.artifact : config; }
function jsonConfig(config) { const root = plainObject(configArtifact(config)); const runtime = plainObject(root.runtime); const payload = plainObject(runtime.payload); return plainObject(payload.json || root.json); }
function schemas(config) { const json = jsonConfig(config); return Array.isArray(json.schemas) ? json.schemas : []; }
function normalizeSchemaJsonTarget(value) { if (typeof value !== 'string' || !value) return 'generic'; if (value === 'fallback') return 'auto'; if (value === 'generic-parser') return 'parser'; return value; }
function normalizeJsonTarget(config) { return normalizeSchemaJsonTarget(jsonConfig(config).target); }
function normalizeParserMode(value) { if (typeof value === 'string' && value) return value; if (value && typeof value === 'object' && !Array.isArray(value)) return String(value.id || value.mode || value.kind || value.name || ''); return ''; }
function normalizeSchemaJsonParser(value) { const normalized = String(normalizeParserMode(value) || '').toLowerCase(); if (!normalized) return undefined; if (normalized === 'assemblyscript-json' || normalized === 'full-as-json' || normalized === 'asjson' || normalized === 'generic-as-json') return SCHEMA_JSON_GENERIC_PARSER_ID; return normalized; }
function normalizedParserId(config) { return normalizeSchemaJsonParser(jsonConfig(config).parser); }
function normalizeJsonParserConfig(config = {}) {
  const target = normalizeJsonTarget(config); const parser = normalizedParserId(config); const schemaList = schemas(config); const diagnostics = []; const warnings = []; let effectiveTarget = target; let genericParser = false; let schemaSidecar = false; let mode = 'inactive';
  if (!SCHEMA_JSON_TARGETS.includes(target)) { diagnostics.push('PULSEWASM_SCHEMA_JSON_GENERIC_TARGET_UNSUPPORTED'); mode = 'error'; }
  else if (target === 'schema') { effectiveTarget = 'schema'; schemaSidecar = true; mode = 'schema'; if (schemaList.length === 0) diagnostics.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemaTargetRequiresSchemas); }
  else if (target === 'auto') { if (schemaList.length > 0) { effectiveTarget = 'schema'; schemaSidecar = true; mode = 'schema'; if (parser === SCHEMA_JSON_GENERIC_PARSER_ID) warnings.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemasTakePrecedence); } else if (parser === SCHEMA_JSON_GENERIC_PARSER_ID) { effectiveTarget = 'parser'; genericParser = true; mode = SCHEMA_JSON_GENERIC_PARSER_MODE; } else if (parser) { effectiveTarget = 'parser'; diagnostics.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.unsupportedParser); mode = 'error'; } else { effectiveTarget = 'parser'; diagnostics.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.parserRequired); mode = 'error'; } }
  else if (target === 'parser') { effectiveTarget = 'parser'; const selectedParser = parser || SCHEMA_JSON_GENERIC_PARSER_ID; if (selectedParser === SCHEMA_JSON_GENERIC_PARSER_ID) { genericParser = true; mode = SCHEMA_JSON_GENERIC_PARSER_MODE; if (schemaList.length > 0) warnings.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemasIgnored); } else { diagnostics.push(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.unsupportedParser); mode = 'error'; } }
  return { target, effectiveTarget, parser: target === 'parser' && !parser ? SCHEMA_JSON_GENERIC_PARSER_ID : parser, schemaCount: schemaList.length, schemasPresent: schemaList.length > 0, genericParser, schemaSidecar, mode, diagnostics, warnings, parserUnsupportedDiagnostic: diagnostics.includes(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.unsupportedParser), parserRequiredDiagnostic: diagnostics.includes(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.parserRequired), schemaSidecarRequested: schemaSidecar, genericParserRequested: genericParser };
}
function normalizeGenericParserConfig(config = {}) { const json = jsonConfig(config); const mode = normalizeJsonParserConfig(config); const schemaList = schemas(config); return { ...mode, schemas: schemaList, schemasSupplied: schemaList.length > 0, contentTypePolicy: typeof json.contentTypePolicy === 'string' && json.contentTypePolicy ? json.contentTypePolicy : 'accept-json-or-missing', defaultNamespace: typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : 'app', maxBytes: Number.isFinite(Number(json.maxBytes)) ? Number(json.maxBytes) : 1048576 }; }
function normalizeSchemaJsonParserMode(config = {}) { return normalizeJsonParserConfig(config); }
function normalizeSchemaJsonParserSelection(config = {}) { const mode = normalizeJsonParserConfig(config); return { target: mode.target, effectiveTarget: mode.effectiveTarget, effectiveParser: mode.parser, parserRequested: mode.genericParser, explicitParser: Boolean(mode.parser), schemasSupplied: mode.schemasPresent, schemaCount: mode.schemaCount, schemaSidecarsPreferred: mode.schemaSidecar, mode: mode.mode, diagnostics: mode.diagnostics, warnings: mode.warnings }; }
function genericParserNeeded(config = {}) { const selection = normalizeJsonParserConfig(config); if (selection.genericParser) return true; if ((selection.target === 'auto' || selection.target === 'parser') && !selection.schemaSidecar && selection.diagnostics.length > 0) return true; return false; }
function shouldUseGenericSchemaJsonParser(config = {}) { return genericParserNeeded(config); }
function shouldUseSchemaJsonGenericParser(config = {}, options = {}) { return Boolean(options && options.forceGenericParser) || genericParserNeeded(config); }
function shouldUseSchemaJsonSchemaMode(config = {}) { return normalizeJsonParserConfig(config).schemaSidecar; }
function defaultSchemaJsonGenericParserPolicy() { return { ...SCHEMA_JSON_GENERIC_PARSER_POLICY, accessorSurface: SCHEMA_JSON_GENERIC_PARSER_ACCESSORS.slice(), diagnostics: { ...SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS } }; }

module.exports = { SCHEMA_JSON_GENERIC_PARSER_VERSION, SCHEMA_JSON_GENERIC_PARSER_PLAN_VERSION, SCHEMA_JSON_GENERIC_PARSER_ABI_VERSION, SCHEMA_JSON_GENERIC_PARSER_SMOKE_VERSION, SCHEMA_JSON_GENERIC_PARSER_PHASE, PHASE, SCHEMA_JSON_GENERIC_PARSER_ARTIFACT, SCHEMA_JSON_GENERIC_PARSER_PLAN_ARTIFACT, SCHEMA_JSON_GENERIC_PARSER_ABI_ARTIFACT, SCHEMA_JSON_GENERIC_PARSER_SMOKE_ARTIFACT, SCHEMA_JSON_GENERIC_PARSER_NAME, SCHEMA_JSON_GENERIC_PARSER_ID, SCHEMA_JSON_GENERIC_PARSER_MODE, SCHEMA_JSON_GENERIC_PARSER_FILE, SCHEMA_JSON_GENERIC_PARSER_MODULE_FILE, SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE, SCHEMA_JSON_GENERIC_PARSER_WASM_FILE, SCHEMA_JSON_GENERIC_PARSER_WAT_FILE, SCHEMA_JSON_GENERIC_PARSER_WASM, SCHEMA_JSON_GENERIC_PARSER_WAT, SCHEMA_JSON_GENERIC_PARSER_DOC_FILE, SCHEMA_JSON_TARGETS, SCHEMA_JSON_GENERIC_PARSER_TARGETS, SCHEMA_JSON_PARSER_MODES, SCHEMA_JSON_GENERIC_VALUE_KINDS, SCHEMA_JSON_GENERIC_PARSER_ACCESSORS, SCHEMA_JSON_GENERIC_ACCESSOR_SURFACE, SCHEMA_JSON_GENERIC_RESERVED_SURFACE, SCHEMA_JSON_GENERIC_PARSER_POLICY, SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS, configArtifact, jsonConfig, schemas, normalizeSchemaJsonTarget, normalizeJsonTarget, normalizeParserMode, normalizeSchemaJsonParser, normalizedParserId, normalizeJsonParserConfig, normalizeGenericParserConfig, normalizeSchemaJsonParserMode, normalizeSchemaJsonParserSelection, genericParserNeeded, shouldUseGenericSchemaJsonParser, shouldUseSchemaJsonGenericParser, shouldUseSchemaJsonSchemaMode, defaultSchemaJsonGenericParserPolicy };
