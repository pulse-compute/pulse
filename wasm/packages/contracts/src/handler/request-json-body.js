'use strict';

const REQUEST_JSON_BODY_PLAN_VERSION = 'pulsewasm.request-json-body-plan.v1';
const REQUEST_JSON_BODY_PLAN_PHASE = '39';
const REQUEST_JSON_BODY_PLAN_ARTIFACT = 'request-json-body-plan.json';
const REQUEST_JSON_BODY_CONTRACT_ID = 'pulse.request-json-body';
const NODE_REQUEST_JSON_BODY_PROOF_VERSION = 'pulsewasm.node-request-json-body-proof.v1';
const NODE_REQUEST_JSON_BODY_PROOF_PHASE = '39';
const NODE_REQUEST_JSON_BODY_PROOF_ARTIFACT = 'node-request-json-body-proof.json';
const NODE_REQUEST_JSON_BODY_RUNTIME_VERSION = 'pulsewasm.node-request-json-body-runtime.v1';

const REQUEST_JSON_BODY_SCOPE = Object.freeze({
  lazyRequestBodyRead: true,
  routeDemandOnly: true,
  perRequestDecodeCache: true,
  compiledWasmRuntimeImplemented: true,
  nodeCompiledProofImplemented: true,
  providerNetworkFetchRequired: false,
  backendJsonRequestBodyImplemented: false,
  binaryRequestBodyParsing: false,
  streamRequestBodyParsing: false,
  requestBodyEffects: false,
  asyncAwait: false,
  promises: false,
  asyncify: false,
  automaticSchemaGeneration: false,
  arbitraryJsObjectInference: false
});

const REQUEST_JSON_BODY_SURFACE = Object.freeze({
  canonical: 'ctx.req.parse("Schema")',
  schemaSugar: 'ctx.req.json("Schema")',
  genericSugar: 'ctx.req.json()',
  aliases: Object.freeze(['ctx.request.json("Schema")', 'ctx.request.json()']),
  compiledHandle: 'opaque request-json ref',
  schemaMode: 'schema-backed request JSON decode',
  genericMode: 'explicit as-json generic parser fallback'
});

const REQUEST_JSON_BODY_MODES = Object.freeze({
  none: { status: 'implemented-now', description: 'route does not read a request JSON body' },
  schemaJson: { status: 'implemented-compiled-node-proof', surface: 'ctx.req.json("Schema") / ctx.req.parse("Schema")' },
  genericJson: { status: 'implemented-compiled-node-proof', surface: 'ctx.req.json() with explicit as-json fallback config' },
  text: { status: 'reserved-with-diagnostic', surface: 'ctx.req.text()' },
  binary: { status: 'reserved-with-diagnostic', surface: 'ctx.req.arrayBuffer() / binary request body parsing' },
  stream: { status: 'reserved-with-diagnostic', surface: 'ctx.req.stream() / stream request body parsing' }
});

const REQUEST_JSON_BODY_ACCESSORS = Object.freeze([
  'ok',
  'errorText',
  'jsonText',
  'getString',
  'getI32',
  'getU32',
  'getF64',
  'getBool',
  'has'
]);

const REQUEST_JSON_BODY_RESERVED_ACCESSORS = Object.freeze([
  'bytes',
  'stream',
  'json object materialization',
  'typed schema-specific accessors',
  'schema-backed result ergonomics are owned by @pulse-compute/wasm-contracts/handler/schema-decode-result',
  'mutation APIs',
  'automatic schema inference'
]);

const REQUEST_JSON_BODY_LAZY_POLICY = Object.freeze({
  bodyRead: 'route-demand-only',
  parse: 'first ctx.req.json/parse call only',
  cache: 'per-request body/decode refs',
  repeatedReads: 'cached; no reread or reparse',
  noEagerParsing: true,
  noImplicitGenericParserBundle: true,
  missingBody: 'empty text decoded as invalid JSON for json helpers',
  invalidJson: 'inspectable decode result; no throw'
});

const REQUEST_JSON_BODY_DIAGNOSTICS = Object.freeze({
  planMissing: 'PULSEWASM_REQUEST_JSON_BODY_PLAN_MISSING',
  nonLiteralSchema: 'PULSEWASM_REQUEST_JSON_SCHEMA_MUST_BE_LITERAL',
  genericParserRequired: 'PULSEWASM_REQUEST_JSON_GENERIC_PARSER_REQUIRED',
  unsupportedParser: 'PULSEWASM_REQUEST_JSON_GENERIC_PARSER_UNSUPPORTED',
  schemaRequired: 'PULSEWASM_REQUEST_JSON_SCHEMA_REQUIRED',
  accessorUnsupported: 'PULSEWASM_REQUEST_JSON_ACCESSOR_UNSUPPORTED',
  accessorPathMustBeLiteral: 'PULSEWASM_REQUEST_JSON_ACCESSOR_PATH_MUST_BE_LITERAL',
  bodyTextReserved: 'PULSEWASM_REQUEST_JSON_TEXT_BODY_RESERVED',
  binaryReserved: 'PULSEWASM_REQUEST_JSON_BINARY_BODY_RESERVED',
  streamReserved: 'PULSEWASM_REQUEST_JSON_STREAM_BODY_RESERVED',
  compiledSmokeFailed: 'PULSEWASM_REQUEST_JSON_COMPILED_SMOKE_FAILED',
  wasmMissing: 'PULSEWASM_REQUEST_JSON_COMPILED_WASM_MISSING'
});

function defaultRequestJsonBodyPolicy() {
  return {
    contractId: REQUEST_JSON_BODY_CONTRACT_ID,
    artifact: REQUEST_JSON_BODY_PLAN_ARTIFACT,
    phase: REQUEST_JSON_BODY_PLAN_PHASE,
    scope: { ...REQUEST_JSON_BODY_SCOPE },
    surface: JSON.parse(JSON.stringify(REQUEST_JSON_BODY_SURFACE)),
    modes: JSON.parse(JSON.stringify(REQUEST_JSON_BODY_MODES)),
    accessors: [...REQUEST_JSON_BODY_ACCESSORS],
    reservedAccessors: [...REQUEST_JSON_BODY_RESERVED_ACCESSORS],
    lazy: JSON.parse(JSON.stringify(REQUEST_JSON_BODY_LAZY_POLICY)),
    diagnostics: { ...REQUEST_JSON_BODY_DIAGNOSTICS }
  };
}

function defaultNodeRequestJsonBodyProofPolicy() {
  return {
    ...defaultRequestJsonBodyPolicy(),
    provider: 'node',
    proofArtifact: NODE_REQUEST_JSON_BODY_PROOF_ARTIFACT,
    proofVersion: NODE_REQUEST_JSON_BODY_PROOF_VERSION,
    runtimeVersion: NODE_REQUEST_JSON_BODY_RUNTIME_VERSION,
    compiledWasmRuntimeImplemented: true,
    nodeCompiledProofImplemented: true,
    actualNetworkFetch: false,
    userAuthoredAsync: false,
    promises: false,
    asyncAwait: false,
    asyncify: false
  };
}

module.exports = {
  REQUEST_JSON_BODY_PLAN_VERSION,
  REQUEST_JSON_BODY_PLAN_PHASE,
  REQUEST_JSON_BODY_PLAN_ARTIFACT,
  REQUEST_JSON_BODY_CONTRACT_ID,
  NODE_REQUEST_JSON_BODY_PROOF_VERSION,
  NODE_REQUEST_JSON_BODY_PROOF_PHASE,
  NODE_REQUEST_JSON_BODY_PROOF_ARTIFACT,
  NODE_REQUEST_JSON_BODY_RUNTIME_VERSION,
  REQUEST_JSON_BODY_SCOPE,
  REQUEST_JSON_BODY_SURFACE,
  REQUEST_JSON_BODY_MODES,
  REQUEST_JSON_BODY_ACCESSORS,
  REQUEST_JSON_BODY_RESERVED_ACCESSORS,
  REQUEST_JSON_BODY_LAZY_POLICY,
  REQUEST_JSON_BODY_DIAGNOSTICS,
  defaultRequestJsonBodyPolicy,
  defaultNodeRequestJsonBodyProofPolicy
};
