'use strict';

const ROUTE_HANDLER_CONTEXT_LOWERING_VERSION = 'pulsewasm.route-handler-context-lowering.v1';
const ROUTE_HANDLER_CONTEXT_LOWERING_PHASE = '31';
const ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT = 'route-handler-context-lowering-plan.json';
const ROUTE_HANDLER_CONTEXT_CONTRACT_ID = 'pulse.route-handler-context';

const ROUTE_HANDLER_CONTEXT_PLAN_SCOPE = Object.freeze({
  syncContextLowering: true,
  runtimeBehaviorChanged: true,
  providerBehaviorImplemented: false,
  effectExecutionImplemented: false,
  asyncAwait: false,
  promises: false,
  asyncify: false,
  closureCapture: false
});

const ROUTE_HANDLER_CONTEXT_SYNC_SURFACE = Object.freeze([
  'ctx.param',
  'ctx.paramI32',
  'ctx.request.method',
  'ctx.request.path',
  'ctx.state.get',
  'ctx.state.set',
  'ctx.request.header.first',
  'ctx.request.header.count',
  'ctx.request.header.at',
  'ctx.response.header.set',
  'ctx.response.header.append',
  'ctx.response.header.delete',
  'ctx.result.text',
  'ctx.result.jsonText',
  'ctx.result.empty',
  'ctx.error',
  'next',
  'next(error)'
]);

const ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE = Object.freeze([
  'ctx.fetch',
  'ctx.resolve',
  'ctx.resolved',
  'ctx.bodyText',
  'ctx.request.body',
  'ctx.request.json',
  'ctx.request.arrayBuffer',
  'global fetch',
  'Promise',
  'async/await'
]);

const ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET = Object.freeze({
  literals: Object.freeze(['string', 'number', 'boolean']),
  identifiers: 'locals declared in the same handler body',
  binaryOperators: Object.freeze(['+', '-', '*', '/', '%', '===', '!==', '==', '!=', '<', '<=', '>', '>=', '&&', '||']),
  unaryOperators: Object.freeze(['!']),
  branches: 'if/else is lowerable when branches remain within the same synchronous context surface',
  rejected: Object.freeze([
    'loops',
    'switch',
    'try/catch/throw',
    'classes/new',
    'destructuring',
    'spread/rest',
    'computed property access',
    'dynamic ctx member access',
    'inline closure capture',
    'nested functions',
    'recursion',
    'Promise',
    'async/await',
    'ctx.resolve runtime execution'
  ])
});

const ROUTE_HANDLER_CONTEXT_DIAGNOSTICS = Object.freeze({
  handlerSourceMissing: 'PULSEWASM_CONTEXT_HANDLER_SOURCE_MISSING',
  parameterUnsupported: 'PULSEWASM_CONTEXT_PARAMETER_UNSUPPORTED',
  captureUnsupported: 'PULSEWASM_CONTEXT_CAPTURE_UNSUPPORTED',
  destructuringUnsupported: 'PULSEWASM_CONTEXT_DESTRUCTURING_UNSUPPORTED',
  loopUnsupported: 'PULSEWASM_CONTEXT_LOOP_UNSUPPORTED',
  asyncUnsupported: 'PULSEWASM_CONTEXT_ASYNC_UNSUPPORTED',
  promiseUnsupported: 'PULSEWASM_CONTEXT_PROMISE_UNSUPPORTED',
  throwUnsupported: 'PULSEWASM_CONTEXT_THROW_UNSUPPORTED',
  classUnsupported: 'PULSEWASM_CONTEXT_CLASS_UNSUPPORTED',
  computedPropertyUnsupported: 'PULSEWASM_CONTEXT_COMPUTED_PROPERTY_UNSUPPORTED',
  unsupportedStatement: 'PULSEWASM_CONTEXT_UNSUPPORTED_STATEMENT',
  unsupportedExpression: 'PULSEWASM_CONTEXT_UNSUPPORTED_EXPRESSION',
  unsupportedCall: 'PULSEWASM_CONTEXT_UNSUPPORTED_CALL',
  unsupportedContextSurface: 'PULSEWASM_CONTEXT_UNSUPPORTED_SURFACE',
  effectBoundaryReserved: 'PULSEWASM_CONTEXT_EFFECT_BOUNDARY_RESERVED',
  effectUnsupported: 'PULSEWASM_CONTEXT_EFFECT_UNSUPPORTED',
  resultTerminalConflict: 'PULSEWASM_CONTEXT_TERMINAL_CONFLICT',
  ifBranchUnsupported: 'PULSEWASM_CONTEXT_IF_BRANCH_UNSUPPORTED'
});

function defaultRouteHandlerContextLoweringPolicy() {
  return {
    ...ROUTE_HANDLER_CONTEXT_PLAN_SCOPE,
    contractId: ROUTE_HANDLER_CONTEXT_CONTRACT_ID,
    artifact: ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
    syncSurface: [...ROUTE_HANDLER_CONTEXT_SYNC_SURFACE],
    reservedSurface: [...ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE],
    expressionSubset: JSON.parse(JSON.stringify(ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET)),
    lifecycle: {
      handlerRunsSynchronously: true,
      effectBoundaryReserved: true,
      providerExecution: false,
      wasmSuspension: false,
      continuationReentry: 'ctx.resolve plan only; not implemented by Pass 31'
    }
  };
}

module.exports = {
  ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
  ROUTE_HANDLER_CONTEXT_PLAN_VERSION: ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
  ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
  ROUTE_HANDLER_CONTEXT_PLAN_PHASE: ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
  ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
  ROUTE_HANDLER_CONTEXT_PLAN_ARTIFACT: ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
  ROUTE_HANDLER_CONTEXT_CONTRACT_ID,
  ROUTE_HANDLER_CONTEXT_PLAN_SCOPE,
  ROUTE_HANDLER_CONTEXT_SYNC_SURFACE,
  ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE,
  ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET,
  ROUTE_HANDLER_CONTEXT_DIAGNOSTICS,
  defaultRouteHandlerContextLoweringPolicy,
  defaultRouteHandlerContextPolicy: defaultRouteHandlerContextLoweringPolicy
};
