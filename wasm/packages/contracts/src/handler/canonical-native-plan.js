'use strict';

const CANONICAL_NATIVE_PLAN_VERSION = 'pulse.canonical-native-plan.v3';
const CANONICAL_NATIVE_HANDLER_BODY_VERSION = 'pulse.canonical-native-handler-body.v1';
const CANONICAL_NATIVE_PLAN_HASH_ALGORITHM = 'sha256';
const CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION = 'pulse.canonical-native-ownership.v1';
const CANONICAL_PURE_LOOP_LIMITS = Object.freeze({ maxIterations: 1024, maxNestedIterations: 65536 });
const CANONICAL_READ_LOOP_CONTRACT = Object.freeze({
  version: 'pulse.bounded-read-loop.v1',
  maxIterations: 64,
  maxNestedIterations: CANONICAL_PURE_LOOP_LIMITS.maxNestedIterations,
  effectKinds: Object.freeze(['s3.getText', 'kv.getVersioned', 'crypto.digestText']),
  valueIntrinsics: Object.freeze(['schema.decode.text', 'schema.encode.text', 'response.text', 'response.json', 'response.custom']),
  nestedEffects: false,
  continueTarget: 'increment',
  breakTarget: 'exit'
});

const CANONICAL_NATIVE_STATEMENT_KINDS = Object.freeze([
  'local',
  'effect',
  'effect-group',
  'if',
  'pure-loop',
  'read-loop',
  'break',
  'continue',
  'return',
  'handler-call',
  'expression'
]);

const CANONICAL_NATIVE_EXPRESSION_KINDS = Object.freeze([
  'literal',
  'undefined',
  'local',
  'context-read',
  'array',
  'object',
  'template',
  'binary',
  'unary',
  'conditional',
  'property',
  'element',
  'intrinsic',
  'method-call',
  'assignment',
  'update',
  'spread'
]);

const CANONICAL_NATIVE_CONTEXT_READS = Object.freeze([
  'req.method',
  'req.url',
  'req.path',
  'req.headers',
  'event.payload'
]);

const CANONICAL_NATIVE_INTRINSICS = Object.freeze([
  'request.header',
  'request.text',
  'request.json',
  'response.json',
  'schema.encode.text',
  'schema.decode.text',
  'response.text',
  'response.custom',
  'kv.namespace',
  'state.get',
  'state.set',
  'logging.emit',
  'event.runtime-id',
  'router.match',
  'router.param',
  'grip.is-websocket',
  'grip.subscribe',
  'grip.handoff'
]);

const CANONICAL_NATIVE_DECODER_KINDS = Object.freeze([
  'json',
  'text'
]);

const CANONICAL_NATIVE_RESULT_MODES = Object.freeze([
  'bind',
  'bind-group',
  'discard',
  'return'
]);

const CANONICAL_NATIVE_VALUE_KINDS = Object.freeze([
  'unknown',
  'undefined',
  'null',
  'boolean',
  'number',
  'string',
  'string-or-undefined',
  'headers',
  'array',
  'object',
  'json',
  'json-or-undefined',
  'fetch-response',
  'kv-namespace',
  'pulse-result',
  'opaque-response',
  'structured-response',
  'ack'
]);

const CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES = Object.freeze({
  COMPILED_PROGRAM_REQUIRED: 'PULSE_CANONICAL_NATIVE_COMPILED_PROGRAM_REQUIRED',
  GENERATED_HANDLER_MISSING: 'PULSE_CANONICAL_NATIVE_HANDLER_MISSING',
  GENERATED_HANDLER_DUPLICATE: 'PULSE_CANONICAL_NATIVE_HANDLER_DUPLICATE',
  STATEMENT_UNSUPPORTED: 'PULSE_CANONICAL_NATIVE_STATEMENT_UNSUPPORTED',
  EXPRESSION_UNSUPPORTED: 'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED',
  BINDING_UNSUPPORTED: 'PULSE_CANONICAL_NATIVE_BINDING_UNSUPPORTED',
  LOCAL_UNRESOLVED: 'PULSE_CANONICAL_NATIVE_LOCAL_UNRESOLVED',
  EFFECT_INVALID: 'PULSE_CANONICAL_NATIVE_EFFECT_INVALID',
  EFFECT_MISMATCH: 'PULSE_CANONICAL_NATIVE_EFFECT_MISMATCH',
  CONTINUATION_MISMATCH: 'PULSE_CANONICAL_NATIVE_CONTINUATION_MISMATCH',
  EVENT_HANDLER_INELIGIBLE: 'PULSE_CANONICAL_NATIVE_EVENT_HANDLER_INELIGIBLE',
  LOG_INVALID: 'PULSE_CANONICAL_NATIVE_LOG_INVALID',
  PLAN_INVALID: 'PULSE_CANONICAL_NATIVE_PLAN_INVALID'
});

const CANONICAL_NATIVE_PLAN_POLICY = Object.freeze({
  version: CANONICAL_NATIVE_PLAN_VERSION,
  ownershipVersion: CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION,
  providerNeutral: true,
  providerSelected: false,
  providerSdkUserland: false,
  javascriptRuntime: false,
  promiseSemantics: false,
  asyncify: false,
  controlFlow: 'structured statements, if/else, literal-capped pure for loops and non-nested bounded sequential read loops',
  handlerBodies: Object.freeze({
    version: CANONICAL_NATIVE_HANDLER_BODY_VERSION,
    family: 'terminal HTTP route bodies without next transfer',
    calls: 'one static tail call from the dispatcher; no recursion or captured locals',
    outcomes: 'response, suspension, normalized application-error transfer, terminal failure',
    suspension: 'resume the owning body by program counter; no live call stack',
    budget: 'one charge per original state; the call reference adds no state'
  }),
  suspension: 'explicit effect and effect-group statements with stable continuation IDs',
  values: 'versioned JSON expression tree with stable local identities',
  logging: 'compile-time threshold pruning plus synchronous provider-adapter emission',
  schemas: 'canonical compiled schema registry and explicit schema references',
  crypto: 'explicit preselected realization plan; guest source remains package-owned and fallback-free',
  packages: 'trusted package-owned canonical effects and pure intrinsic records only'
});

module.exports = Object.freeze({
  CANONICAL_NATIVE_PLAN_VERSION,
  CANONICAL_NATIVE_HANDLER_BODY_VERSION,
  CANONICAL_PURE_LOOP_LIMITS,
  CANONICAL_READ_LOOP_CONTRACT,
  CANONICAL_NATIVE_PLAN_HASH_ALGORITHM,
  CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION,
  CANONICAL_NATIVE_STATEMENT_KINDS,
  CANONICAL_NATIVE_EXPRESSION_KINDS,
  CANONICAL_NATIVE_CONTEXT_READS,
  CANONICAL_NATIVE_INTRINSICS,
  CANONICAL_NATIVE_DECODER_KINDS,
  CANONICAL_NATIVE_RESULT_MODES,
  CANONICAL_NATIVE_VALUE_KINDS,
  CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES,
  CANONICAL_NATIVE_PLAN_POLICY
});
