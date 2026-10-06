'use strict';

const crypto = require('node:crypto');

function loadRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/handler/canonical-native-runtime.js');
    }
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

const runtimeContract = loadRuntimeContract();
const runtimePlanContract = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const eventContract = loadEventContract();

class CanonicalNativeAssemblyScriptError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'CanonicalNativeAssemblyScriptError';
    this.code = 'PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED';
    this.detail = Object.freeze({ ...detail });
  }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function collectExpressions(plan) {
  const expressions = [];
  const seen = new WeakSet();

  function add(expression) {
    if (!expression || typeof expression !== 'object' || seen.has(expression)) return;
    seen.add(expression);
    expressions.push(expression);
    switch (expression.kind) {
      case 'array':
        for (const item of expression.items || []) add(item.kind === 'spread' ? item.value : item);
        break;
      case 'object':
        for (const entry of expression.entries || []) {
          if (entry.kind === 'spread') add(entry.value);
          else {
            if (entry.key && entry.key.kind === 'computed') add(entry.key.value);
            else add(entry.key);
            add(entry.value);
          }
        }
        break;
      case 'template':
        for (const part of expression.parts || []) if (part.kind === 'value') add(part.value);
        break;
      case 'binary':
        add(expression.left);
        add(expression.right);
        break;
      case 'unary':
        add(expression.value);
        break;
      case 'conditional':
        add(expression.test);
        add(expression.whenTrue);
        add(expression.whenFalse);
        break;
      case 'property':
        add(expression.object);
        break;
      case 'element':
        add(expression.object);
        add(expression.index);
        break;
      case 'pure-helper-call':
      case 'intrinsic':
        for (const argument of expression.arguments || []) add(argument);
        break;
      case 'method-call':
        add(expression.receiver);
        for (const argument of expression.arguments || []) add(argument);
        break;
      case 'assignment':
        add(expression.target);
        add(expression.value);
        break;
      case 'update':
        add(expression.target);
        break;
      case 'spread':
        add(expression.value);
        break;
      default:
        break;
    }
  }

  function walkStatements(statements) {
    for (const statement of statements || []) {
      if (statement.kind === 'helper-call') for (const arg of statement.arguments) add(arg);
      else if (statement.kind === 'local') add(statement.value);
      else if (statement.kind === 'expression') add(statement.expression);
      else if (statement.kind === 'return') add(statement.value);
      else if (statement.kind === 'if') {
        add(statement.test);
        walkStatements(statement.then);
        walkStatements(statement.else);
      } else if (statement.kind === 'pure-loop' || statement.kind === 'read-loop') {
        if (statement.kind === 'read-loop') { add(statement.initial); add(statement.increment); }
        add(statement.test);
        walkStatements(statement.body);
      }
    }
  }

  walkStatements(plan.entry && plan.entry.body);
  for (const handler of [...(plan.handlers || []), ...(plan.stages || []), ...(plan.helpers || [])]) walkStatements(handler.body);
  for (const effect of plan.effects || []) {
    for (const input of effect.inputs || []) add(input.value);
    const decoder = effect.result && effect.result.decoder;
    for (const argument of (decoder && decoder.arguments) || []) add(argument);
  }
  return expressions;
}

// Preserve plan object references and insertion order. Aliases, block IDs and
// traversal counters belong to their emission builders, not this read-only view.
function prepareNativePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('generateCanonicalNativeAssemblyScript requires a canonical native plan.');
  const pureHelpers = new Map((plan.helpers || []).filter(h => h.version === runtimePlanContract.CANONICAL_NATIVE_PURE_HELPER_VERSION).map((h, i) => [h.id, { ...h, nativeName: `__pulse_pure_helper_${i}` }]));
  const stages = new Map((plan.stages || []).map(stage => [stage.id, stage]));
  const stageBindings = new Map((plan.stages || []).flatMap(stage => stage.registrations.map(row => [row.entryId, row])));
  const stageSites = new Map((plan.effects || []).flatMap((effect, index) => effect.stageId === undefined ? [] : [[index, { site: effect.stageSite }]]));
  const maxStageSites = Math.max(0, ...(plan.stages || []).map(stage => stage.effectIds.length));
  const localIndex = new Map((plan.locals || []).map((local, index) => [String(local.id), index]));
  const effectIndex = new Map((plan.effects || []).map((effect, index) => [String(effect.id), index]));
  const continuationIndex = new Map((plan.continuations || []).map((continuation) => [String(continuation.id), Number(continuation.stateIndex)]));
  const expressions = collectExpressions(plan);
  const expressionIndex = new Map(expressions.map((expression, index) => [expression, index]));
  const stateEnabled = expressions.some((expression) => expression && expression.kind === 'intrinsic' && ['state.get', 'state.set'].includes(expression.name));
  const binaryIndex = new Map(runtimeContract.CANONICAL_NATIVE_BINARY_OPERATORS.map((operator, index) => [operator, index]));
  const unaryIndex = new Map(runtimeContract.CANONICAL_NATIVE_UNARY_OPERATORS.map((operator, index) => [operator, index]));

  function fail(message, detail = {}) {
    throw new CanonicalNativeAssemblyScriptError(message, { planHash: plan.planHash, ...detail });
  }

  function localName(localId) {
    const index = localIndex.get(String(localId));
    if (!Number.isInteger(index)) fail(`Native plan references unknown local ${String(localId)}.`, { localId });
    return `__pulse_local_${index}`;
  }

  function stringHandle(value) {
    return `__pulse_string(${quote(value)})`;
  }

  return {
    pureHelpers, stages, stageBindings, stageSites, maxStageSites,
    localIndex, effectIndex, continuationIndex, expressions, expressionIndex,
    stateEnabled, binaryIndex, unaryIndex, fail, localName, stringHandle
  };
}

// These direct-generator guards follow schema/crypto composition. Full plan
// validation remains owned by the compiler's canonical Native plan authority.
function prepareNativeEmissionInputs(plan) {
  const eventEntries = plan.events && plan.events.catalog && Array.isArray(plan.events.catalog.events)
    ? plan.events.catalog.events
    : [];
  const eventReachable = eventEntries.length > 0;
  if (eventReachable && (!plan.events.abi || plan.events.abi.version !== eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION)) {
    throw new CanonicalNativeAssemblyScriptError('Event-reachable Native plans require the frozen event ABI extension.', {
      planHash: plan.planHash,
      expected: eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION,
      actual: plan.events.abi && plan.events.abi.version
    });
  }

  for (const effect of plan.effects || []) {
    const decoder = effect.result && effect.result.decoder;
    const decoderArguments = (decoder && decoder.arguments) || [];
    if (!decoder || decoderArguments.length === 0) continue;
    const supportedSchemaDecoder = decoder.kind === 'json'
      && decoderArguments.length === 1
      && decoderArguments[0].kind === 'literal'
      && typeof decoderArguments[0].value === 'string';
    if (!supportedSchemaDecoder) {
      throw new CanonicalNativeAssemblyScriptError('Native effect-result decoder arguments must be one static JSON schema ID.', {
        planHash: plan.planHash,
        effectId: effect.id,
        decoder: decoder.kind,
        arguments: decoderArguments
      });
    }
  }

  return { eventEntries, eventReachable };
}

function prepareNativeFlow(plan, pureHelpers) {
  const applicationErrors = (plan.routing?.entries || []).some(entry => entry.kind === 'error');
  const helpers = new Map((plan.helpers || []).filter(helper => !pureHelpers.has(helper.id)).map(helper => [helper.id, helper]));
  const handlers = new Map((plan.handlers || []).map(handler => [handler.id, handler]));
  const routerLocal = name => (plan.locals || []).find(local => local.name === `__pulse_router_${name}`)?.id;
  const routerCursor = routerLocal('cursor');
  return { applicationErrors, helpers, handlers, routerLocal, routerCursor };
}

module.exports = Object.freeze({
  runtimeContract, eventContract, CanonicalNativeAssemblyScriptError,
  stableHash, quote, prepareNativePlan, prepareNativeEmissionInputs, prepareNativeFlow
});
