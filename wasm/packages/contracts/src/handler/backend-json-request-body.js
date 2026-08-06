'use strict';

const BACKEND_JSON_REQUEST_BODY_PLAN_VERSION = 'pulsewasm.backend-json-request-body-plan.v1';
const BACKEND_JSON_REQUEST_BODY_PLAN_PHASE = '43';
const BACKEND_JSON_REQUEST_BODY_PLAN_ARTIFACT = 'backend-json-request-body-plan.json';
const NODE_BACKEND_JSON_REQUEST_BODY_PROOF_VERSION = 'pulsewasm.node-backend-json-request-body-proof.v1';
const NODE_BACKEND_JSON_REQUEST_BODY_PROOF_PHASE = '43';
const NODE_BACKEND_JSON_REQUEST_BODY_PROOF_ARTIFACT = 'node-backend-json-request-body-proof.json';
const BACKEND_JSON_REQUEST_BODY_CONTRACT_ID = 'pulse.backend-json-request-body-lifecycle';

const BACKEND_JSON_REQUEST_BODY_SCOPE = Object.freeze({
  provider: 'node',
  compilerOrchestrationOnly: true,
  providerOwnsOriginBehavior: true,
  postJsonRequestBodyImplemented: true,
  schemaEncodeRefRequired: true,
  arbitraryObjectLowering: false,
  automaticSchemaGeneration: false,
  binaryRequestBody: false,
  streamRequestBody: false,
  multipartRequestBody: false,
  asyncAwait: false,
  promises: false,
  asyncify: false
});

const BACKEND_JSON_REQUEST_BODY_POLICY = Object.freeze({
  allowedSurface: 'ctx.fetch("backend", { method: "POST", json: ctx.schema.encode("Schema", ref) })',
  allowedMethods: ['POST'],
  allowedBodyModes: ['json'],
  requiredBackendConfig: ['allowedMethods includes POST', 'requestBody includes json'],
  acceptedValueRefs: ['request-json-decode-ref', 'schema-ref', 'generic-json-ref', 'primitive-ref'],
  rejectedValues: ['object-literal', 'spread-object', 'class-instance', 'dynamic-schema-name', 'binary-body', 'stream-body', 'multipart-form-data']
});

const BACKEND_JSON_REQUEST_BODY_DIAGNOSTICS = Object.freeze({
  backendMethodUnsupported: 'PULSEWASM_BACKEND_METHOD_UNSUPPORTED',
  backendRequestBodyModeUnsupported: 'PULSEWASM_BACKEND_REQUEST_BODY_MODE_UNSUPPORTED',
  schemaEncodeRefRequired: 'PULSEWASM_SCHEMA_ENCODE_REF_REQUIRED',
  schemaEncodeDynamicSchemaUnsupported: 'PULSEWASM_SCHEMA_ENCODE_DYNAMIC_SCHEMA_UNSUPPORTED',
  fetchJsonBodySchemaEncodeRequired: 'PULSEWASM_FETCH_JSON_BODY_SCHEMA_ENCODE_REQUIRED',
  binaryBodyReserved: 'PULSEWASM_REQUEST_BODY_BINARY_RESERVED',
  streamBodyReserved: 'PULSEWASM_REQUEST_BODY_STREAM_RESERVED',
  multipartBodyReserved: 'PULSEWASM_REQUEST_BODY_MULTIPART_RESERVED'
});

module.exports = {
  BACKEND_JSON_REQUEST_BODY_PLAN_VERSION,
  BACKEND_JSON_REQUEST_BODY_PLAN_PHASE,
  BACKEND_JSON_REQUEST_BODY_PLAN_ARTIFACT,
  NODE_BACKEND_JSON_REQUEST_BODY_PROOF_VERSION,
  NODE_BACKEND_JSON_REQUEST_BODY_PROOF_PHASE,
  NODE_BACKEND_JSON_REQUEST_BODY_PROOF_ARTIFACT,
  BACKEND_JSON_REQUEST_BODY_CONTRACT_ID,
  BACKEND_JSON_REQUEST_BODY_SCOPE,
  BACKEND_JSON_REQUEST_BODY_POLICY,
  BACKEND_JSON_REQUEST_BODY_DIAGNOSTICS
};
