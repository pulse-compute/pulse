'use strict';

const HANDLER_IO_LIFECYCLE_PLAN_VERSION = 'pulsewasm.handler-io-lifecycle-plan.v1';
const HANDLER_IO_LIFECYCLE_PLAN_PHASE = '36';
const HANDLER_IO_LIFECYCLE_PLAN_ARTIFACT = 'handler-io-lifecycle-plan.json';
const HANDLER_IO_LIFECYCLE_CONTRACT_ID = 'pulse.handler-io-lifecycle';

const HANDLER_IO_LIFECYCLE_SCOPE = Object.freeze({
  planOnly: true,
  unifiesRouteContextPlan: true,
  unifiesRouteEffectPlan: true,
  referencesSchemaJson: true,
  providerBehaviorImplemented: false,
  runtimeBehaviorChanged: false,
  compiledWasmEffectExecutionImplemented: false,
  requestBodyRuntimeImplemented: false,
  backendJsonRequestBodyImplemented: true,
  binaryRequestBodyParsing: false,
  streamRequestBodyParsing: false,
  asyncAwait: false,
  promises: false,
  asyncify: false
});

const HANDLER_IO_LIFECYCLE_STAGES = Object.freeze([
  'route-match',
  'sync-context-read',
  'lazy-request-body-decode',
  'backend-origin-effect',
  'continuation-reentry',
  'origin-response-decode',
  'final-response-encode'
]);

const HANDLER_IO_REQUEST_BODY_MODES = Object.freeze({
  none: { status: 'implemented-now', description: 'route does not read a request body' },
  schemaJson: { status: 'planned-only', surface: 'ctx.req.json("Schema") / ctx.req.parse("Schema")' },
  genericJson: { status: 'planned-only', surface: 'ctx.req.json() with explicit as-json fallback' },
  text: { status: 'reserved-with-diagnostic', surface: 'ctx.req.text() / ctx.request.bodyText()' },
  binary: { status: 'reserved-with-diagnostic', surface: 'binary request body parsing' },
  stream: { status: 'reserved-with-diagnostic', surface: 'stream request body parsing' }
});

const HANDLER_IO_BACKEND_REQUEST_BODY_MODES = Object.freeze({
  none: { status: 'implemented-now', methods: ['GET', 'HEAD', 'POST'] },
  json: { status: 'implemented-node-provider-proof', surface: 'ctx.fetch(..., { json: ctx.schema.encode("Schema", ref) })' },
  text: { status: 'reserved-with-diagnostic', surface: 'ctx.fetch(..., { body/text })' },
  binary: { status: 'reserved-with-diagnostic' },
  stream: { status: 'reserved-with-diagnostic' }
});

const HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES = Object.freeze({
  text: { status: 'implemented-provider-proof', surface: 'ctx.resolved().text()' },
  jsonText: { status: 'implemented-provider-proof', surface: 'ctx.resolved().jsonText()' },
  status: { status: 'implemented-provider-proof', surface: 'ctx.resolved().status() / ok()' },
  header: { status: 'implemented-provider-proof', surface: 'ctx.resolved().header(name)' },
  json: { status: 'implemented-provider-proof', surface: 'ctx.resolved().json("Schema")' },
  binary: { status: 'reserved-with-diagnostic', surface: 'ctx.resolved().bytes()' },
  stream: { status: 'reserved-with-diagnostic', surface: 'ctx.resolved().stream()' }
});

const HANDLER_IO_FINAL_RESPONSE_MODES = Object.freeze({
  text: { status: 'implemented-now', surface: 'ctx.result.text(status, body, opts)' },
  jsonText: { status: 'implemented-now', surface: 'ctx.result.jsonText(status, jsonText, opts)' },
  empty: { status: 'implemented-now', surface: 'ctx.result.empty(status, opts)' },
  schemaJson: { status: 'implemented-compiled-runtime', surface: 'ctx.result.json("Schema", ref, opts)' },
  passthrough: { status: 'reserved-with-diagnostic', surface: 'ctx.result.from(origin, policy)' },
  binary: { status: 'reserved-with-diagnostic' },
  stream: { status: 'reserved-with-diagnostic' }
});

const HANDLER_IO_SCHEMA_SURFACE = Object.freeze({
  requestDecode: ['ctx.req.json("Schema")', 'ctx.req.parse("Schema")'],
  genericRequestDecode: ['ctx.req.json()'],
  originDecode: ['ctx.resolved("name").json("Schema")'],
  encode: ['ctx.schema.encode("Schema", ref)', 'ctx.result.json("Schema", ref, opts)'],
  currentStatus: 'implemented-for-result-origin-decode-and-backend-json-request-bodies',
  automaticSchemaGeneration: false,
  arbitraryJsObjectInference: false
});

const HANDLER_IO_LAZY_EVALUATION_POLICY = Object.freeze({
  requestBodyRead: 'route-demand-only',
  requestBodyParse: 'on-demand-helper-only',
  requestBodyCache: 'per-request body/decode refs',
  backendEffects: 'explicit ctx.resolve boundary only',
  finalResponseEncode: 'only when selected result is returned',
  eagerBodyParsing: false,
  implicitGenericParserBundle: false
});

const HANDLER_IO_LIFECYCLE_DIAGNOSTICS = Object.freeze({
  contextPlanMissing: 'PULSEWASM_HANDLER_IO_CONTEXT_PLAN_MISSING',
  effectPlanMissing: 'PULSEWASM_HANDLER_IO_EFFECT_PLAN_MISSING',
  routePlanMissing: 'PULSEWASM_HANDLER_IO_ROUTE_PLAN_MISSING',
  schemaParserUnavailable: 'PULSEWASM_HANDLER_IO_SCHEMA_PARSER_UNAVAILABLE',
  requestBodyReserved: 'PULSEWASM_HANDLER_IO_REQUEST_BODY_RESERVED',
  backendRequestBodyReserved: 'PULSEWASM_HANDLER_IO_BACKEND_REQUEST_BODY_RESERVED',
  responseBodyReserved: 'PULSEWASM_HANDLER_IO_RESPONSE_BODY_RESERVED',
  unsupportedSchemaSurface: 'PULSEWASM_HANDLER_IO_SCHEMA_SURFACE_UNSUPPORTED'
});

function defaultHandlerIoLifecyclePolicy() {
  return {
    ...HANDLER_IO_LIFECYCLE_SCOPE,
    contractId: HANDLER_IO_LIFECYCLE_CONTRACT_ID,
    artifact: HANDLER_IO_LIFECYCLE_PLAN_ARTIFACT,
    stages: [...HANDLER_IO_LIFECYCLE_STAGES],
    requestBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_REQUEST_BODY_MODES)),
    backendRequestBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_BACKEND_REQUEST_BODY_MODES)),
    originResponseBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES)),
    finalResponseModes: JSON.parse(JSON.stringify(HANDLER_IO_FINAL_RESPONSE_MODES)),
    schemaSurface: JSON.parse(JSON.stringify(HANDLER_IO_SCHEMA_SURFACE)),
    lazyEvaluation: JSON.parse(JSON.stringify(HANDLER_IO_LAZY_EVALUATION_POLICY)),
    diagnostics: { ...HANDLER_IO_LIFECYCLE_DIAGNOSTICS }
  };
}

module.exports = {
  HANDLER_IO_LIFECYCLE_PLAN_VERSION,
  HANDLER_IO_LIFECYCLE_PLAN_PHASE,
  HANDLER_IO_LIFECYCLE_PLAN_ARTIFACT,
  HANDLER_IO_LIFECYCLE_CONTRACT_ID,
  HANDLER_IO_LIFECYCLE_SCOPE,
  HANDLER_IO_LIFECYCLE_STAGES,
  HANDLER_IO_REQUEST_BODY_MODES,
  HANDLER_IO_BACKEND_REQUEST_BODY_MODES,
  HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES,
  HANDLER_IO_FINAL_RESPONSE_MODES,
  HANDLER_IO_SCHEMA_SURFACE,
  HANDLER_IO_LAZY_EVALUATION_POLICY,
  HANDLER_IO_LIFECYCLE_DIAGNOSTICS,
  defaultHandlerIoLifecyclePolicy
};
