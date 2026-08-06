'use strict';

const SCHEMA_DECODE_RESULT_PLAN_VERSION = 'pulsewasm.schema-decode-result-plan.v1';
const SCHEMA_DECODE_RESULT_PLAN_PHASE = '40';
const SCHEMA_DECODE_RESULT_PLAN_ARTIFACT = 'schema-decode-result-plan.json';
const SCHEMA_DECODE_RESULT_CONTRACT_ID = 'pulse.schema-decode-result';
const NODE_SCHEMA_DECODE_RESULT_PROOF_VERSION = 'pulsewasm.node-schema-decode-result-proof.v1';
const NODE_SCHEMA_DECODE_RESULT_PROOF_PHASE = '40';
const NODE_SCHEMA_DECODE_RESULT_PROOF_ARTIFACT = 'node-schema-decode-result-proof.json';
const NODE_SCHEMA_DECODE_RESULT_RUNTIME_VERSION = 'pulsewasm.node-schema-decode-result-runtime.v1';

const SCHEMA_DECODE_RESULT_SCOPE = Object.freeze({
  requestJsonSchemaSugar: true,
  canonicalParseSurface: true,
  opaqueDecodeRefs: true,
  fieldAccessorValidation: true,
  compiledWasmRuntimeImplemented: true,
  nodeCompiledProofImplemented: true,
  lazyRequestBodyRead: true,
  perRequestDecodeCache: true,
  automaticSchemaGeneration: false,
  typedSchemaSpecificAccessors: false,
  arbitraryJsObjectInference: false,
  binaryRequestBodyParsing: false,
  streamRequestBodyParsing: false,
  asyncAwait: false,
  promises: false,
  asyncify: false
});

const SCHEMA_DECODE_RESULT_SURFACE = Object.freeze({
  canonical: 'ctx.req.parse("Schema")',
  ergonomicSugar: 'ctx.req.json("Schema")',
  aliases: Object.freeze(['ctx.request.json("Schema")']),
  result: 'opaque schema decode result ref',
  success: 'result.ok()',
  error: 'result.errorText()',
  fields: Object.freeze(['result.getString(path)', 'result.getI32(path)', 'result.getU32(path)', 'result.getF64(path)', 'result.getBool(path)', 'result.has(path)', 'result.jsonText()'])
});

const SCHEMA_DECODE_RESULT_ACCESSORS = Object.freeze({
  ok: { path: false, returns: 'bool', allowedFieldTypes: Object.freeze(['any']) },
  errorText: { path: false, returns: 'string', allowedFieldTypes: Object.freeze(['any']) },
  jsonText: { path: false, returns: 'string', allowedFieldTypes: Object.freeze(['any']) },
  has: { path: true, returns: 'bool', allowedFieldTypes: Object.freeze(['string', 'i32', 'u32', 'f64', 'bool', 'boolean', 'number']) },
  getString: { path: true, returns: 'string', allowedFieldTypes: Object.freeze(['string']) },
  getI32: { path: true, returns: 'i32', allowedFieldTypes: Object.freeze(['i32', 'int', 'integer']) },
  getU32: { path: true, returns: 'u32', allowedFieldTypes: Object.freeze(['u32', 'uint']) },
  getF64: { path: true, returns: 'f64', allowedFieldTypes: Object.freeze(['f64', 'float', 'number']) },
  getBool: { path: true, returns: 'bool', allowedFieldTypes: Object.freeze(['bool', 'boolean']) }
});

const SCHEMA_DECODE_RESULT_RESERVED_SURFACE = Object.freeze([
  'typed schema-specific accessors such as input.email()',
  'automatic schema generation from handler source',
  'arbitrary JavaScript object materialization',
  'schema-backed mutation/build APIs',
  'binary request-body schema decode',
  'stream request-body schema decode',
  'throwing decode failures'
]);

const SCHEMA_DECODE_RESULT_DIAGNOSTICS = Object.freeze({
  planMissing: 'PULSEWASM_SCHEMA_DECODE_RESULT_PLAN_MISSING',
  requestJsonPlanMissing: 'PULSEWASM_SCHEMA_DECODE_REQUEST_JSON_PLAN_MISSING',
  noSchemaRoutes: 'PULSEWASM_SCHEMA_DECODE_NO_SCHEMA_ROUTES',
  schemaMissing: 'PULSEWASM_SCHEMA_DECODE_SCHEMA_MISSING',
  fieldMissing: 'PULSEWASM_SCHEMA_DECODE_FIELD_MISSING',
  accessorUnsupported: 'PULSEWASM_SCHEMA_DECODE_ACCESSOR_UNSUPPORTED',
  accessorTypeMismatch: 'PULSEWASM_SCHEMA_DECODE_ACCESSOR_TYPE_MISMATCH',
  pathMustBeLiteral: 'PULSEWASM_SCHEMA_DECODE_ACCESSOR_PATH_MUST_BE_LITERAL',
  compiledSmokeFailed: 'PULSEWASM_SCHEMA_DECODE_COMPILED_SMOKE_FAILED',
  wasmMissing: 'PULSEWASM_SCHEMA_DECODE_COMPILED_WASM_MISSING'
});

const SCHEMA_DECODE_RESULT_POLICY = Object.freeze({
  phase: SCHEMA_DECODE_RESULT_PLAN_PHASE,
  sourceOfTruth: 'runtime.payload.json.schemas + request-json-body-plan.json',
  decodeFailure: 'inspectable result; no throw',
  missingFields: 'result.ok() false for schema-backed decode',
  typeMismatches: 'planned diagnostics plus compiled proof for basic scalar checks',
  routeDemandOnly: true,
  perRequestCache: true,
  implicitGenericParserBundle: false
});

function defaultSchemaDecodeResultPolicy() {
  return {
    contractId: SCHEMA_DECODE_RESULT_CONTRACT_ID,
    artifact: SCHEMA_DECODE_RESULT_PLAN_ARTIFACT,
    phase: SCHEMA_DECODE_RESULT_PLAN_PHASE,
    scope: { ...SCHEMA_DECODE_RESULT_SCOPE },
    surface: JSON.parse(JSON.stringify(SCHEMA_DECODE_RESULT_SURFACE)),
    accessors: JSON.parse(JSON.stringify(SCHEMA_DECODE_RESULT_ACCESSORS)),
    reserved: [...SCHEMA_DECODE_RESULT_RESERVED_SURFACE],
    policy: { ...SCHEMA_DECODE_RESULT_POLICY },
    diagnostics: { ...SCHEMA_DECODE_RESULT_DIAGNOSTICS }
  };
}

function defaultNodeSchemaDecodeResultProofPolicy() {
  return {
    ...defaultSchemaDecodeResultPolicy(),
    provider: 'node',
    proofArtifact: NODE_SCHEMA_DECODE_RESULT_PROOF_ARTIFACT,
    proofVersion: NODE_SCHEMA_DECODE_RESULT_PROOF_VERSION,
    runtimeVersion: NODE_SCHEMA_DECODE_RESULT_RUNTIME_VERSION,
    compiledWasmRuntimeImplemented: true,
    nodeCompiledProofImplemented: true,
    providerNetworkFetchRequired: false,
    userAuthoredAsync: false,
    promises: false,
    asyncAwait: false,
    asyncify: false
  };
}

module.exports = {
  SCHEMA_DECODE_RESULT_PLAN_VERSION,
  SCHEMA_DECODE_RESULT_PLAN_PHASE,
  SCHEMA_DECODE_RESULT_PLAN_ARTIFACT,
  SCHEMA_DECODE_RESULT_CONTRACT_ID,
  NODE_SCHEMA_DECODE_RESULT_PROOF_VERSION,
  NODE_SCHEMA_DECODE_RESULT_PROOF_PHASE,
  NODE_SCHEMA_DECODE_RESULT_PROOF_ARTIFACT,
  NODE_SCHEMA_DECODE_RESULT_RUNTIME_VERSION,
  SCHEMA_DECODE_RESULT_SCOPE,
  SCHEMA_DECODE_RESULT_SURFACE,
  SCHEMA_DECODE_RESULT_ACCESSORS,
  SCHEMA_DECODE_RESULT_RESERVED_SURFACE,
  SCHEMA_DECODE_RESULT_DIAGNOSTICS,
  SCHEMA_DECODE_RESULT_POLICY,
  defaultSchemaDecodeResultPolicy,
  defaultNodeSchemaDecodeResultProofPolicy
};
