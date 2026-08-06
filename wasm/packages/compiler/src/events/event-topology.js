'use strict';

const { stableFileName } = require('../diagnostics.js');

function loadEventContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/events');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code) && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

const events = loadEventContracts();
const EVENT_TOPOLOGY_VERSION = 'pulse.event-topology.v1';
const EVENT_OUTBOUND_REQUIREMENTS_VERSION = 'pulse.event-outbound-requirements.v1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function portableSource(op, cwd) {
  const loc = op && op.loc || {};
  const start = loc.start || {};
  return Object.freeze({
    file: String(stableFileName(loc.file, cwd) || '').replace(/\\/g, '/'),
    line: Number(start.line || 1),
    column: Math.max(0, Number(start.column || 1) - 1)
  });
}

function buildEventTopology(eventIr, handlerTable, options = {}) {
  const registrations = [...(eventIr || [])].sort((left, right) => Number(left.order) - Number(right.order));
  const handlers = new Map((handlerTable && handlerTable.handlers || []).map((handler) => [handler.id, handler]));
  const emitAnalysis = options.emitAnalysis || Object.freeze({
    version: 'pulse.event-emit-analysis.v1',
    callsites: Object.freeze([]),
    summary: Object.freeze({ callsites: 0, schemaBound: 0, noPayload: 0, grouped: 0, handlers: 0 })
  });
  const emitCallsitesByHandler = new Map();
  for (const callsite of emitAnalysis.callsites || []) {
    if (!emitCallsitesByHandler.has(callsite.handlerStableId)) emitCallsitesByHandler.set(callsite.handlerStableId, []);
    emitCallsitesByHandler.get(callsite.handlerStableId).push(callsite);
  }
  const catalog = events.normalizeEventCatalog({
    version: events.EVENT_CATALOG_VERSION,
    contractId: events.EVENT_CONTRACT_ID,
    events: registrations.map((registration, runtimeId) => {
      const handlerStableId = registration.handler && registration.handler.id;
      const handler = handlers.get(handlerStableId);
      if (!handler || !handler.roles.includes('event')) {
        throw new TypeError(`Unable to resolve canonical event handler identity for ${JSON.stringify(registration.type)}.`);
      }
      const schemaId = registration.declaration.schemaId;
      const handlerEmitCallsites = emitCallsitesByHandler.get(handlerStableId) || [];
      return {
        type: registration.type,
        schemaId,
        stableId: events.createEventStableId({ type: registration.type, schemaId, handlerStableId }),
        runtimeId,
        handlerStableId,
        source: portableSource(registration, options.cwd || process.cwd()),
        capabilities: handlerEmitCallsites.length > 0 ? ['event.emit'] : [],
        packageOperations: [],
        eligibility: { javascript: false, native: true },
        hostRequirements: handlerEmitCallsites.length > 0 ? ['event.ingress', 'event.emit'] : ['event.ingress']
      };
    })
  });
  const emits = (emitAnalysis.callsites || []).length > 0;
  const outboundRequirements = deepFreeze({
    version: EVENT_OUTBOUND_REQUIREMENTS_VERSION,
    status: 'implemented-node-javascript-and-native',
    operation: 'emit',
    analysisVersion: emitAnalysis.version,
    callsites: emitAnalysis.callsites || [],
    summary: emitAnalysis.summary,
    capabilities: emits ? ['event.emit'] : [],
    packageOperations: [],
    hostRequirements: emits ? ['event.emit'] : [],
    policy: {
      sourceRecognition: true,
      effectLowering: true,
      execution: true,
      javascriptExecution: true,
      nativeEffectLowering: true,
      nativeExecution: true,
      providerSupportChanged: true,
      automaticLoopback: false
    }
  });
  return deepFreeze({
    version: EVENT_TOPOLOGY_VERSION,
    contractId: events.EVENT_CONTRACT_ID,
    catalog,
    outboundRequirements,
    summary: {
      events: catalog.events.length,
      schemaBound: catalog.events.filter((event) => event.schemaId !== null).length,
      noPayload: catalog.events.filter((event) => event.schemaId === null).length,
      handlers: new Set(catalog.events.map((event) => event.handlerStableId)).size,
      emitCallsites: emitAnalysis.summary.callsites
    },
    policy: {
      rootPulseOnly: true,
      staticallyKnown: true,
      uniqueTypeOwnership: true,
      handlerExecution: true,
      nativeHandlerExecution: true,
      javascriptArtifactHandlerExecution: false,
      outboundJavascriptExecution: true,
      outboundNativeExecution: true,
      eventRoutesAreHttpRoutes: false,
      providerSupportChanged: true
    }
  });
}

module.exports = Object.freeze({
  EVENT_TOPOLOGY_VERSION,
  EVENT_OUTBOUND_REQUIREMENTS_VERSION,
  buildEventTopology
});
