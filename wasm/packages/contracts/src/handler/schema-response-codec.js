'use strict';

const SCHEMA_RESPONSE_CODEC_PLAN_VERSION = 'pulsewasm.schema-response-codec-plan.v1';
const SCHEMA_RESPONSE_CODEC_PLAN_PHASE = '41';
const SCHEMA_RESPONSE_CODEC_PLAN_ARTIFACT = 'schema-response-codec-plan.json';
const SCHEMA_RESPONSE_CODEC_CONTRACT_ID = 'pulse.schema-response-codec';
const NODE_SCHEMA_RESPONSE_CODEC_PROOF_VERSION = 'pulsewasm.node-schema-response-codec-proof.v1';
const NODE_SCHEMA_RESPONSE_CODEC_PROOF_PHASE = '41';
const NODE_SCHEMA_RESPONSE_CODEC_PROOF_ARTIFACT = 'node-schema-response-codec-proof.json';
const NODE_SCHEMA_RESPONSE_CODEC_RUNTIME_VERSION = 'pulsewasm.node-schema-response-codec-runtime.v1';

const SCHEMA_RESPONSE_CODEC_SCOPE = Object.freeze({
  finalResponseJsonEncode: true,
  originResponseJsonDecode: true,
  requestDecodeRefEncode: true,
  resolvedDecodeRefEncode: true,
  opaqueSchemaRefs: true,
  compiledWasmRuntimeImplemented: true,
  nodeCompiledProofImplemented: true,
  lazyRequestBodyRead: true,
  perRequestDecodeCache: true,
  providerNetworkFetchRequired: false,
  backendJsonRequestBodies: false,
  requestBodyEffects: false,
  automaticSchemaGeneration: false,
  typedSchemaSpecificAccessors: false,
  arbitraryJsObjectInference: false,
  binaryRequestBodyParsing: false,
  streamRequestBodyParsing: false,
  asyncAwait: false,
  promises: false,
  asyncify: false
});

const SCHEMA_RESPONSE_CODEC_SURFACE = Object.freeze({
  finalEncode: 'ctx.result.json("Schema", value, options?)',
  originDecode: 'ctx.resolved("name").json("Schema")',
  schemaEncode: 'ctx.schema.encode("Schema", ref) implemented only as backend JSON request body input',
  requestDecodeInput: 'ctx.req.json("Schema") opaque decode result ref',
  resolvedDecodeInput: 'ctx.resolved("name").json("Schema") opaque decode result ref',
  statusOption: 'options.status defaults to 200',
  headersOption: 'options.headers literal object',
  resultKind: 'json-text'
});

const SCHEMA_RESPONSE_CODEC_VALUE_KINDS = Object.freeze({
  requestJsonDecodeRef: { status: 'implemented-now', description: 'Encode from a schema-backed ctx.req.json/parse decode ref.' },
  genericJsonDecodeRef: { status: 'implemented-now', description: 'Encode from an explicit generic ctx.req.json() decode ref as JSON text.' },
  resolvedJsonDecodeRef: { status: 'implemented-now', description: 'Encode from a ctx.resolved(...).json("Schema") decode ref.' },
  schemaEncodeCall: { status: 'implemented-for-backend-json-request-bodies', description: 'ctx.schema.encode is recognized for backend JSON request bodies and is not accepted as a final response value.' },
  primitiveLiterals: { status: 'planned-only', description: 'Primitive builder refs/literals are reserved for a later schema builder pass.' },
  arbitraryObjectLiteral: { status: 'reserved-with-diagnostic', description: 'Arbitrary JavaScript object materialization is intentionally not supported.' },
  typedSchemaAccessors: { status: 'reserved-with-diagnostic', description: 'Typed schema-specific accessors/builders are reserved.' }
});

const SCHEMA_RESPONSE_CODEC_RESERVED_SURFACE = Object.freeze([
  'automatic schema generation from handler source',
  'arbitrary JavaScript object materialization for ctx.result.json',
  'object literal/spread response encoding',
  'typed schema-specific response builders/accessors',
  'ctx.schema.encode as a final response value',
  'binary response encode/decode',
  'stream response encode/decode',
  'throwing encode/decode failures'
]);

const SCHEMA_RESPONSE_CODEC_DIAGNOSTICS = Object.freeze({
  planMissing: 'PULSEWASM_SCHEMA_RESPONSE_CODEC_PLAN_MISSING',
  noSchemaResponseRoutes: 'PULSEWASM_SCHEMA_RESPONSE_CODEC_NO_ROUTES',
  schemaMissing: 'PULSEWASM_SCHEMA_RESPONSE_CODEC_SCHEMA_MISSING',
  resultJsonSchemaMustBeLiteral: 'PULSEWASM_SCHEMA_RESPONSE_RESULT_JSON_SCHEMA_MUST_BE_LITERAL',
  resultJsonUnsupportedValue: 'PULSEWASM_SCHEMA_RESPONSE_RESULT_JSON_VALUE_UNSUPPORTED',
  resultJsonStatusUnsupported: 'PULSEWASM_SCHEMA_RESPONSE_RESULT_JSON_STATUS_UNSUPPORTED',
  originJsonSchemaMustBeLiteral: 'PULSEWASM_SCHEMA_RESPONSE_ORIGIN_JSON_SCHEMA_MUST_BE_LITERAL',
  schemaEncodeSchemaMustBeLiteral: 'PULSEWASM_SCHEMA_RESPONSE_SCHEMA_ENCODE_SCHEMA_MUST_BE_LITERAL',
  arbitraryObjectReserved: 'PULSEWASM_SCHEMA_RESPONSE_ARBITRARY_OBJECT_RESERVED',
  compiledSmokeFailed: 'PULSEWASM_SCHEMA_RESPONSE_CODEC_COMPILED_SMOKE_FAILED',
  wasmMissing: 'PULSEWASM_SCHEMA_RESPONSE_CODEC_COMPILED_WASM_MISSING'
});

const SCHEMA_RESPONSE_CODEC_POLICY = Object.freeze({
  phase: SCHEMA_RESPONSE_CODEC_PLAN_PHASE,
  sourceOfTruth: 'runtime.payload.json.schemas + request-json-body-plan.json + route-handler-effect-plan.json',
  finalResponseEncode: 'opaque refs only; no arbitrary JS object materialization',
  originResponseDecode: 'inspectable origin JSON decode ref over resolved response jsonText',
  statusDefault: 200,
  routeDemandOnly: true,
  encodeOnlyOnReturn: true,
  implicitGenericParserBundle: false,
  binaryAndStream: 'reserved-with-diagnostic'
});

function defaultSchemaResponseCodecPolicy() {
  return {
    contractId: SCHEMA_RESPONSE_CODEC_CONTRACT_ID,
    artifact: SCHEMA_RESPONSE_CODEC_PLAN_ARTIFACT,
    phase: SCHEMA_RESPONSE_CODEC_PLAN_PHASE,
    scope: { ...SCHEMA_RESPONSE_CODEC_SCOPE },
    surface: JSON.parse(JSON.stringify(SCHEMA_RESPONSE_CODEC_SURFACE)),
    valueKinds: JSON.parse(JSON.stringify(SCHEMA_RESPONSE_CODEC_VALUE_KINDS)),
    reserved: [...SCHEMA_RESPONSE_CODEC_RESERVED_SURFACE],
    policy: { ...SCHEMA_RESPONSE_CODEC_POLICY },
    diagnostics: { ...SCHEMA_RESPONSE_CODEC_DIAGNOSTICS }
  };
}

function defaultNodeSchemaResponseCodecProofPolicy() {
  return {
    ...defaultSchemaResponseCodecPolicy(),
    provider: 'node',
    proofArtifact: NODE_SCHEMA_RESPONSE_CODEC_PROOF_ARTIFACT,
    proofVersion: NODE_SCHEMA_RESPONSE_CODEC_PROOF_VERSION,
    runtimeVersion: NODE_SCHEMA_RESPONSE_CODEC_RUNTIME_VERSION,
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
  SCHEMA_RESPONSE_CODEC_PLAN_VERSION,
  SCHEMA_RESPONSE_CODEC_PLAN_PHASE,
  SCHEMA_RESPONSE_CODEC_PLAN_ARTIFACT,
  SCHEMA_RESPONSE_CODEC_CONTRACT_ID,
  NODE_SCHEMA_RESPONSE_CODEC_PROOF_VERSION,
  NODE_SCHEMA_RESPONSE_CODEC_PROOF_PHASE,
  NODE_SCHEMA_RESPONSE_CODEC_PROOF_ARTIFACT,
  NODE_SCHEMA_RESPONSE_CODEC_RUNTIME_VERSION,
  SCHEMA_RESPONSE_CODEC_SCOPE,
  SCHEMA_RESPONSE_CODEC_SURFACE,
  SCHEMA_RESPONSE_CODEC_VALUE_KINDS,
  SCHEMA_RESPONSE_CODEC_RESERVED_SURFACE,
  SCHEMA_RESPONSE_CODEC_DIAGNOSTICS,
  SCHEMA_RESPONSE_CODEC_POLICY,
  defaultSchemaResponseCodecPolicy,
  defaultNodeSchemaResponseCodecProofPolicy
};
