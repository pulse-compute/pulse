'use strict';

const { HANDLER_SURFACE_DEFINITIONS, HANDLER_SURFACE_CONTRACT_VERSION } = require('./surface-contract.js');

const CTX_CONTRACT_VERSION = 'pulse.ctx-contract.v4';
const CTX_CONTRACT_ID = 'pulse.ctx';
const CTX_SURFACE_IDS = Object.freeze([
  'ctx.param','ctx.req.method','ctx.req.url','ctx.req.path','ctx.req.header','ctx.req.headers',
  'ctx.state.get','ctx.state.set','ctx.json','ctx.text','ctx.response','ctx.req.text','ctx.req.json.schema',
  'ctx.req.json.generic','ctx.fetch.projected','ctx.fetch.opaque-return','ctx.config.get','ctx.secret.get',
  'ctx.kv.get','ctx.kv.put','ctx.emit','package.operation'
]);
const surfaceById = new Map(HANDLER_SURFACE_DEFINITIONS.map((entry) => [entry.id, entry]));
const CTX_SURFACES = Object.freeze(CTX_SURFACE_IDS.map((id) => {
  const surface = surfaceById.get(id);
  if (!surface) throw new TypeError(`Missing handler-surface definition for ctx contract entry ${id}.`);
  return Object.freeze({
    id: surface.id,
    class: surface.class,
    canonicalOperation: surface.canonicalOperation,
    awaitPolicy: surface.awaitPolicy,
    publicForms: surface.publicForms,
    nativeEligible: surface.targetSupport.native,
    javascriptSupported: surface.targetSupport.javascript,
    schemaPolicy: surface.schemaPolicy || null,
    redaction: surface.redaction || null
  });
}));
function defaultCtxContract() {
  return Object.freeze({
    version: CTX_CONTRACT_VERSION,
    contractId: CTX_CONTRACT_ID,
    handlerSurfaceVersion: HANDLER_SURFACE_CONTRACT_VERSION,
    surfaces: CTX_SURFACES,
    planes: Object.freeze({
      sharedAuthoring: Object.freeze(['state', 'log', 'fetch', 'parallel', 'config', 'secret', 'kv', 'emit']),
      httpAuthoring: Object.freeze(['req', 'json', 'text', 'response']),
      routeAuthoring: Object.freeze(['param']),
      eventAuthoring: Object.freeze(['event.type', 'event.payload']),
      eventExecutionImplemented: true,
      emitPublished: true,
      emitJavascriptExecutionImplemented: true,
      emitNativeExecutionImplemented: false
    }),
    policies: Object.freeze({
      handlersAsyncShaped: true,
      syncAwaitIsWarning: true,
      effectAwaitRequiredWhenConsumed: true,
      terminalNextAwaitForbidden: true,
      stateRepresentation: 'execution-local-string-map',
      stateMissingValue: 'undefined',
      stateClearedPerRequest: true,
      stateClearedPerExecution: true,
      nativePromiseRuntime: false,
      nativeAsyncify: false,
      packageCapabilitiesManifestClassified: true
    })
  });
}
function validateCtxContract(contract = defaultCtxContract()) {
  if (contract.version !== CTX_CONTRACT_VERSION) throw new TypeError(`Unsupported ctx contract version ${contract.version}.`);
  const ids = new Set();
  for (const surface of contract.surfaces) {
    if (ids.has(surface.id)) throw new TypeError(`Duplicate ctx surface ${surface.id}.`);
    ids.add(surface.id);
  }
  if (ids.size !== CTX_SURFACE_IDS.length) throw new TypeError('ctx contract surface count does not match its sealed ID list.');
  if (contract.policies.nativePromiseRuntime !== false || contract.policies.nativeAsyncify !== false) throw new TypeError('Native ctx lowering must remain Promise-free and Asyncify-free.');
  return contract;
}
module.exports = Object.freeze({ CTX_CONTRACT_VERSION, CTX_CONTRACT_ID, CTX_SURFACE_IDS, CTX_SURFACES, defaultCtxContract, validateCtxContract });
