'use strict';

const {
  ENTITIES_DEFAULT_LIMITS,
  ENTITIES_DIAGNOSTIC_CODES,
  ENTITIES_FAILURE_VERSION,
  ENTITIES_JSON_RPC_ADAPTER_VERSION,
  ENTITIES_JSON_RPC_OPTIONS,
  entitiesContractError,
  normalizeJsonRpcAdapterOptions,
  createJsonRpcAdapter: createRuntimeJsonRpcAdapter
} = require('./runtime.js');

const ENTITIES_JSON_RPC_ADAPTER_ID = 'json-rpc';
const ENTITIES_JSON_RPC_PROTOCOL = '2.0';
const ENTITIES_JSON_RPC_ERROR_CODES = Object.freeze({
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603
});
const ENTITIES_JSON_RPC_FAILURE_MAP = Object.freeze({
  'invalid-envelope': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.invalidRequest, message: 'Invalid Request' }),
  'unknown-entity': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.methodNotFound, message: 'Method not found' }),
  'invalid-input': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.invalidParams, message: 'Invalid params' }),
  'execution-failed': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.internal, message: 'Internal error' }),
  'invalid-output': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.internal, message: 'Internal error' }),
  'input-too-large': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.invalidRequest, message: 'Invalid Request' }),
  'output-too-large': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.internal, message: 'Internal error' }),
  'adapter-failed': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.internal, message: 'Internal error' }),
  'runtime-not-realized': Object.freeze({ code: ENTITIES_JSON_RPC_ERROR_CODES.internal, message: 'Internal error' })
});

function normalizeJsonRpcOptions(input = {}) {
  return normalizeJsonRpcAdapterOptions(input);
}

function createJsonRpcAdapter(options = {}, limitsInput = ENTITIES_DEFAULT_LIMITS) {
  return createRuntimeJsonRpcAdapter(options, limitsInput);
}

function normalizeJsonRpcId(value, present = true) {
  if (present !== true) return Object.freeze({ kind: 'absent', value: undefined });
  if (value === null) return Object.freeze({ kind: 'null', value: null });
  if (typeof value === 'string') return Object.freeze({ kind: 'string', value });
  if (typeof value === 'number' && Number.isSafeInteger(value)) return Object.freeze({ kind: 'number', value });
  throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'JSON-RPC ID must be a string, safe integer, null, or absent.', { value });
}

function mapEntitiesFailureToJsonRpc(failure) {
  if (!failure || failure.version !== ENTITIES_FAILURE_VERSION || !Object.prototype.hasOwnProperty.call(ENTITIES_JSON_RPC_FAILURE_MAP, failure.kind)) {
    throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'JSON-RPC failure mapping requires a normalized Entities failure.');
  }
  return ENTITIES_JSON_RPC_FAILURE_MAP[failure.kind];
}

module.exports = Object.freeze({
  ENTITIES_JSON_RPC_ADAPTER_VERSION,
  ENTITIES_JSON_RPC_ADAPTER_ID,
  ENTITIES_JSON_RPC_PROTOCOL,
  ENTITIES_JSON_RPC_OPTIONS,
  ENTITIES_JSON_RPC_ERROR_CODES,
  ENTITIES_JSON_RPC_FAILURE_MAP,
  normalizeJsonRpcOptions,
  createJsonRpcAdapter,
  normalizeJsonRpcId,
  mapEntitiesFailureToJsonRpc
});
