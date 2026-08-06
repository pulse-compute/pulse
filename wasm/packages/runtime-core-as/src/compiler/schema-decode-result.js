'use strict';

function loadDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadSchemaDecodeContracts() {
  try { return require('@pulse-compute/wasm-contracts/handler/schema-decode-result'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/handler/schema-decode-result.js');
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact } = loadDiagnostics();
const schemaDecode = loadSchemaDecodeContracts();

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function artifact(value) { return value && typeof value === 'object' && value.artifact ? value.artifact : value; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}
function jsonConfig(config) {
  const root = plainObject(artifact(config));
  const runtime = plainObject(root.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || root.json);
}
function configuredSchemas(config) {
  const json = jsonConfig(config);
  return Array.isArray(json.schemas) ? json.schemas : [];
}
function defaultNamespace(config) {
  const json = jsonConfig(config);
  return typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : 'app';
}
function schemaId(schema, fallbackNamespace) {
  if (!schema || typeof schema !== 'object') return undefined;
  if (typeof schema.id === 'string' && schema.id) return schema.id;
  const name = typeof schema.name === 'string' && schema.name ? schema.name : undefined;
  if (!name) return undefined;
  const namespace = typeof schema.namespace === 'string' && schema.namespace ? schema.namespace : fallbackNamespace;
  return name.includes('.') ? name : `${namespace}.${name}`;
}
function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'boolean') return 'bool';
  if (value === 'number') return 'f64';
  if (value === 'int' || value === 'integer') return 'i32';
  if (value === 'uint') return 'u32';
  return value;
}
function schemaRegistry(config) {
  const fallbackNamespace = defaultNamespace(config);
  const map = new Map();
  const schemas = [];
  for (const entry of configuredSchemas(config)) {
    const id = schemaId(entry, fallbackNamespace);
    if (!id) continue;
    const fields = plainObject(entry.fields);
    const fieldTypes = Object.fromEntries(Object.entries(fields).map(([name, type]) => [name, normalizeType(type)]));
    const normalized = { id, namespace: id.includes('.') ? id.split('.').slice(0, -1).join('.') : fallbackNamespace, name: id.includes('.') ? id.split('.').slice(-1)[0] : id, fields: fieldTypes, source: entry.source, codec: entry.codec || 'json' };
    schemas.push(normalized);
    map.set(id, normalized);
    map.set(normalized.name, normalized);
  }
  return { defaultNamespace: fallbackNamespace, schemas, map };
}
function normalizePlan(input) {
  const plan = artifact(input);
  if (!plan || typeof plan !== 'object') return undefined;
  return { ...plan, routes: Array.isArray(plan.routes) ? plan.routes.map(clone) : [] };
}
function makeDiagnostic(code, message, severity, details, hint) {
  return { phase: 'schema-decode-result', severity: severity || 'error', code, message, hint, details, loc: { file: '<schema-decode-result>' } };
}
function accessorContract(method) {
  return schemaDecode.SCHEMA_DECODE_RESULT_ACCESSORS[method];
}
function methodAllowsType(method, fieldType) {
  const contract = accessorContract(method);
  if (!contract) return false;
  if (!contract.path) return true;
  const allowed = Array.isArray(contract.allowedFieldTypes) ? contract.allowedFieldTypes.map(normalizeType) : [];
  return allowed.includes('any') || allowed.includes(normalizeType(fieldType));
}
function summarizeSchema(schema) {
  return schema ? { id: schema.id, fields: Object.entries(schema.fields || {}).map(([name, type]) => ({ name, type })) } : undefined;
}

function buildSchemaDecodeResultPlan(options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const requestJsonBodyPlan = normalizePlan(options.requestJsonBodyPlan || options.plan);
  if (!requestJsonBodyPlan) diagnostics.push(makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.requestJsonPlanMissing, 'Schema decode result planning requires request-json-body-plan.json.', 'error', { hint: 'Enable request-json-body-plan before schema decode result planning.' }));
  const registry = schemaRegistry(options.resolvedConfig || {});
  const routes = [];
  const schemaReads = [];
  let requiredRequestJsonRouteIndex = 0;
  for (const route of (requestJsonBodyPlan && requestJsonBodyPlan.routes || [])) {
    const allReads = Array.isArray(route.reads) ? route.reads : [];
    const routeRequiresRequestJson = Boolean(route && (route.required || allReads.length > 0));
    const currentRequestJsonRouteIndex = routeRequiresRequestJson ? requiredRequestJsonRouteIndex++ : undefined;
    const reads = allReads.filter((read) => read && read.mode === 'schemaJson');
    if (reads.length === 0) continue;
    const requestJsonRouteIndex = currentRequestJsonRouteIndex;
    const routeDiagnostics = [];
    const accessors = Array.isArray(route.accessors) ? route.accessors : [];
    const decodes = [];
    for (const read of reads) {
      const schema = registry.map.get(read.schema) || registry.map.get(String(read.schema || '').split('.').pop());
      if (!schema) {
        const diag = makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.schemaMissing, `Schema ${read.schema || '<missing>'} is not declared for ctx.req.json/parse schema decode.`, 'error', { routeId: route.routeId, schema: read.schema, declaredSchemas: registry.schemas.map((entry) => entry.id) }, 'Declare the schema under runtime.payload.json.schemas or use ctx.req.json() with explicit generic parser fallback.');
        diagnostics.push(diag); routeDiagnostics.push(diag.code);
      }
      const accessorEntries = accessors.filter((accessor) => accessor.local && read.local && accessor.local === read.local || accessor.schema === read.schema).map((accessor) => {
        const contract = accessorContract(accessor.method);
        let status = 'ok';
        let diagnostic;
        const fieldType = schema && accessor.path ? schema.fields[accessor.path] : undefined;
        if (!contract) {
          diagnostic = makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.accessorUnsupported, `Schema decode accessor ${accessor.method} is not supported.`, 'error', { routeId: route.routeId, schema: read.schema, method: accessor.method });
        } else if (contract.path && !accessor.path) {
          diagnostic = makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.pathMustBeLiteral, `Schema decode accessor ${accessor.method} requires a literal field path.`, 'error', { routeId: route.routeId, schema: read.schema, method: accessor.method });
        } else if (schema && contract.path && !Object.prototype.hasOwnProperty.call(schema.fields, accessor.path)) {
          diagnostic = makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.fieldMissing, `Field ${accessor.path} is not declared on schema ${schema.id}.`, 'error', { routeId: route.routeId, schema: schema.id, field: accessor.path, fields: Object.keys(schema.fields) });
        } else if (schema && contract.path && !methodAllowsType(accessor.method, fieldType)) {
          diagnostic = makeDiagnostic(schemaDecode.SCHEMA_DECODE_RESULT_DIAGNOSTICS.accessorTypeMismatch, `Accessor ${accessor.method} does not match schema field ${schema.id}.${accessor.path} of type ${fieldType}.`, 'error', { routeId: route.routeId, schema: schema.id, field: accessor.path, fieldType, method: accessor.method, allowedFieldTypes: contract.allowedFieldTypes });
        }
        if (diagnostic) { diagnostics.push(diagnostic); routeDiagnostics.push(diagnostic.code); status = 'diagnostic'; }
        return { local: accessor.local, method: accessor.method, path: accessor.path, returns: contract && contract.returns, fieldType, status, diagnostic: diagnostic && diagnostic.code, loc: accessor.loc };
      });
      const decode = { id: read.id, local: read.local, requestedSchema: read.schema, schemaFound: Boolean(schema), schema: schema ? schema.id : read.schema, schemaSummary: summarizeSchema(schema), cacheKey: read.cacheKey, surface: read.surface, accessors: accessorEntries, loc: read.loc };
      schemaReads.push({ routeId: route.routeId, handlerName: route.handlerName, ...decode });
      decodes.push(decode);
    }
    routes.push({ requestJsonRouteIndex, routeId: route.routeId, runtimeId: route.runtimeId, method: route.method, path: route.path, handlerName: route.handlerName, status: routeDiagnostics.length ? 'diagnostic' : 'schema-decode-planned', requestJsonBodyRouteStatus: route.status, decodes, diagnostics: Array.from(new Set(routeDiagnostics)).sort() });
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifactOut = normalizeArtifact({
    version: schemaDecode.SCHEMA_DECODE_RESULT_PLAN_VERSION,
    generatedBy,
    phase: schemaDecode.SCHEMA_DECODE_RESULT_PLAN_PHASE,
    artifact: schemaDecode.SCHEMA_DECODE_RESULT_PLAN_ARTIFACT,
    contractId: schemaDecode.SCHEMA_DECODE_RESULT_CONTRACT_ID,
    status: errorDiagnostics.length ? 'error' : 'ok',
    sourcePlanVersion: requestJsonBodyPlan && requestJsonBodyPlan.version,
    sourcePlanArtifact: requestJsonBodyPlan && requestJsonBodyPlan.artifact,
    requestJsonBodyPlanConnected: Boolean(requestJsonBodyPlan),
    validateAndPlanOnly: false,
    runtimeBehaviorChanged: true,
    compiledWasmRuntimeImplemented: true,
    nodeCompiledProofImplemented: Boolean(options.nodeSchemaDecodeResultProof),
    scope: JSON.parse(JSON.stringify(schemaDecode.SCHEMA_DECODE_RESULT_SCOPE)),
    surface: JSON.parse(JSON.stringify(schemaDecode.SCHEMA_DECODE_RESULT_SURFACE)),
    accessors: JSON.parse(JSON.stringify(schemaDecode.SCHEMA_DECODE_RESULT_ACCESSORS)),
    reserved: [...schemaDecode.SCHEMA_DECODE_RESULT_RESERVED_SURFACE],
    policy: schemaDecode.defaultSchemaDecodeResultPolicy(),
    schemaRegistry: { defaultNamespace: registry.defaultNamespace, schemas: registry.schemas.map(summarizeSchema) },
    routes,
    diagnostics,
    summary: {
      routes: routes.length,
      schemaDecodeReads: schemaReads.length,
      schemasDeclared: registry.schemas.length,
      accessors: routes.reduce((count, route) => count + route.decodes.reduce((inner, decode) => inner + decode.accessors.length, 0), 0),
      compiledWasmRuntimeImplemented: true,
      nodeCompiledProofImplemented: Boolean(options.nodeSchemaDecodeResultProof),
      automaticSchemaGeneration: false,
      typedSchemaSpecificAccessors: false,
      arbitraryJsObjectInference: false,
      binaryRequestBodyParsing: false,
      streamRequestBodyParsing: false,
      asyncAwait: false,
      promises: false,
      asyncify: false,
      diagnostics: diagnostics.length,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact: artifactOut, diagnostics, routes, schemaRegistry: registry };
}

module.exports = { buildSchemaDecodeResultPlan };
