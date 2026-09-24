'use strict';

const {
  buildRouterHandlerIr
} = require('./handler-ir.js');
const {
  createCanonicalHandlerIr
} = require('./canonical-handler-ir.js');
const {
  emitCanonicalRouterHandlerBody
} = require('./handler-ir-emitter.js');
const {
  CANONICAL_ROUTER_COMPILER_VERSION,
  CANONICAL_ROUTER_AUTHORING_VERSION,
  CANONICAL_ROUTER_EXECUTION_VERSION
} = require('./router-topology-frontend.js');
const {
  ROUTER_CURSOR_IDENTIFIER: CURSOR,
  ROUTER_MODE_IDENTIFIER: MODE,
  ROUTER_ERROR_IDENTIFIER: ERROR
} = require('./router-control-contract.js');

function loadEventContracts() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/events/contracts.js');
    throw error;
  }
}

const eventContracts = loadEventContracts();

const ROUTER_HANDLER_IR_BUNDLE_VERSION = 'pulse.router-handler-ir-bundle.v1';

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return String(text).split('\n').map((line) => line ? `${prefix}${line}` : line).join('\n');
}

function handlerMetadata(frontend) {
  return Object.freeze({
    id: frontend.entry.handlerId,
    name: frontend.descriptor.handler && frontend.descriptor.handler.name,
    localName: frontend.descriptor.handler && frontend.descriptor.handler.localName,
    role: frontend.role,
    ctxParameter: frontend.signature.ctxName,
    nextParameter: frontend.signature.nextName,
    errorParameter: frontend.signature.errorName
  });
}

function routerOwnership(frontend, generatedRange) {
  const entry = frontend.entry;
  const route = frontend.route;
  const event = frontend.event;
  return Object.freeze({
    version: CANONICAL_ROUTER_AUTHORING_VERSION,
    executionVersion: CANONICAL_ROUTER_EXECUTION_VERSION,
    lane: frontend.role === 'event' ? 'event' : (frontend.role === 'error' ? 'error' : 'normal'),
    entry: Object.freeze({
      stableId: entry.stableId,
      index: entry.index,
      nextIndex: entry.nextIndex,
      kind: entry.kind,
      order: entry.order,
      router: entry.router,
      routerPath: entry.routerPath,
      path: entry.path,
      scoped: entry.scoped,
      pattern: entry.pattern,
      method: entry.method,
      handlerId: entry.handlerId,
      ...(entry.kind === 'event' ? {
        plane: 'event',
        eventStableId: entry.eventStableId,
        eventRuntimeId: entry.eventRuntimeId,
        eventType: entry.eventType,
        eventSchemaId: entry.eventSchemaId
      } : {}),
      generatedRange
    }),
    route: route ? Object.freeze({
      stableId: route.stableId,
      runtimeId: route.runtimeId,
      method: route.method,
      path: route.path,
      pathPattern: route.pathPattern,
      params: Object.freeze([...(route.params || [])]),
      handlerId: route.handler,
      handlerName: route.handlerName,
      sourceRouter: route.sourceRouter
    }) : undefined,
    event: event ? Object.freeze({
      stableId: event.stableId,
      runtimeId: event.runtimeId,
      type: event.type,
      schemaId: event.schemaId,
      handlerStableId: event.handlerStableId
    }) : undefined
  });
}

function realizedEventTopology(topology, prepared) {
  if (!topology.eventTopology || !topology.eventCatalog) return undefined;
  const eventHandlers = new Map(prepared.handlers
    .filter((handler) => handler.role === 'event')
    .map((handler) => [handler.entry.eventStableId, handler]));
  const catalog = eventContracts.normalizeEventCatalog({
    version: topology.eventCatalog.version,
    contractId: topology.eventCatalog.contractId,
    events: topology.eventCatalog.events.map((event) => {
      const handler = eventHandlers.get(event.stableId);
      const capabilities = Object.freeze([...new Set([
        ...(event.capabilities || []),
        ...(handler && handler.analysis && handler.analysis.capabilities || [])
      ])].sort());
      const nativeSurfaces = !handler || !handler.surfaceFacts || handler.surfaceFacts.classification.facts.every((fact) => fact.nativeEligible !== false);
      return {
        type: event.type,
        schemaId: event.schemaId,
        stableId: event.stableId,
        runtimeId: event.runtimeId,
        handlerStableId: event.handlerStableId,
        source: event.source,
        capabilities,
        packageOperations: event.packageOperations,
        eligibility: {
          javascript: event.eligibility.javascript,
          native: event.eligibility.native && nativeSurfaces
        },
        hostRequirements: event.hostRequirements
      };
    })
  });
  return Object.freeze({ ...topology.eventTopology, catalog });
}

function emitCanonicalRouterFromHandlerIrs(prepared) {
  if (!prepared || !prepared.topology || !Array.isArray(prepared.handlers)) {
    throw new TypeError('emitCanonicalRouterFromHandlerIrs requires prepared Router handlers.');
  }
  const topology = prepared.topology;
  const operationByEntry = new Map();
  const emittedByEntry = new Map();
  const bodyByEntry = new Map();
  const authoredHandlers = new Map(topology.handlerTable.handlers.map(handler => [handler.id, handler]));
  for (const handler of prepared.handlers) {
    const operationIr = buildRouterHandlerIr(handler);
    operationByEntry.set(handler.entry.stableId, operationIr);
    emittedByEntry.set(handler.entry.stableId, emitCanonicalRouterHandlerBody(operationIr));
    // The first private body family is a terminal HTTP route. Transfer-capable
    // handlers retain the existing cursor/mode lowering until their own pass.
    if (handler.entry.kind === 'route' && !operationIr.summary.operationKinds['router-transfer']) {
      const authored = authoredHandlers.get(handler.entry.handlerId);
      bodyByEntry.set(handler.entry.stableId, Object.freeze({
        version: 'pulse.router-native-body.v1',
        family: 'terminal-route',
        name: `__pulse_body_${handler.entry.stableId}`,
        source: authored && authored.loc
      }));
    }
  }

  const header = topology.retainedDeclarations;
  let synthetic = header ? `${header}\n\n` : '';
  synthetic += 'export default function __pulse_router_entry(ctx) {\n';

  const eventReachable = Boolean(topology.eventTopology && topology.eventCatalog && topology.eventCatalog.events.length > 0);
  const eventTopology = realizedEventTopology(topology, prepared);
  const eventCatalog = eventTopology && eventTopology.catalog;
  const entryRecords = [];
  const eventEntryRecords = [];
  const generatedRangeByEntry = new Map();
  if (eventReachable) {
    for (const descriptor of topology.entries.filter((candidate) => candidate.entry.kind === 'event')) {
      const { entry, event } = descriptor;
      const emitted = emittedByEntry.get(entry.stableId);
      const openingStart = synthetic.length;
      synthetic += `  if (__pulse_event_runtime_id() === ${event.runtimeId}) {\n`;
      const start = synthetic.length;
      synthetic += event.eligibility.native
        ? `${indent(emitted.sourceText, 4)}\n`
        : '    return undefined;\n';
      const end = synthetic.length;
      const generatedRange = Object.freeze({ start, end });
      synthetic += '  }\n';
      generatedRangeByEntry.set(entry.stableId, generatedRange);
      eventEntryRecords.push(Object.freeze({
        ...entry,
        plane: 'event',
        eventStableId: event.stableId,
        eventRuntimeId: event.runtimeId,
        eventType: event.type,
        eventSchemaId: event.schemaId,
        generatedRange,
        generatedBlockRange: Object.freeze({ start: openingStart, end: synthetic.length })
      }));
    }
  }
  synthetic += `  let ${CURSOR} = 0;\n`;
  synthetic += `  let ${MODE} = 0;\n`;
  synthetic += `  let ${ERROR} = undefined;\n`;

  const routeRecordMap = new Map();
  for (const descriptor of topology.entries) {
    const { rawEntry, entry, route } = descriptor;
    if (entry.kind === 'event') continue;
    const openingStart = synthetic.length;
    synthetic += `  if (${CURSOR} === ${entry.index}) {\n`;
    let generatedRange;

    if (entry.kind === 'mount') {
      const pattern = rawEntry.pattern && rawEntry.pattern.normalized || `${rawEntry.path || '/'}/*`;
      synthetic += `    if (${MODE} === 0 && __pulse_router_match(ctx.req.path, ${JSON.stringify(pattern)})) {\n`;
      synthetic += `      ${CURSOR} = ${rawEntry.childStartIndex};\n`;
      synthetic += '    } else {\n';
      synthetic += `      ${CURSOR} = ${rawEntry.parentContinueIndex};\n`;
      synthetic += '    }\n';
    } else if (entry.kind === 'use' || entry.kind === 'route' || entry.kind === 'error') {
      const emitted = emittedByEntry.get(entry.stableId);
      const normalCondition = entry.kind === 'error' ? `${MODE} === 1` : `${MODE} === 0`;
      let matchCondition = normalCondition;
      if (entry.kind === 'use' && rawEntry.scoped) {
        const pattern = rawEntry.pattern && rawEntry.pattern.normalized || `${rawEntry.path || '/'}/*`;
        matchCondition += ` && __pulse_router_match(ctx.req.path, ${JSON.stringify(pattern)})`;
      }
      if (entry.kind === 'route') matchCondition += ` && ctx.req.method === ${JSON.stringify(entry.method)} && __pulse_router_match(ctx.req.path, ${JSON.stringify(entry.path)})`;
      synthetic += `    if (${matchCondition}) {\n`;
      const nativeBody = bodyByEntry.get(entry.stableId);
      if (nativeBody) synthetic += `      function ${nativeBody.name}() {\n`;
      const start = synthetic.length;
      synthetic += `${indent(emitted.sourceText, nativeBody ? 8 : 6)}\n`;
      const end = synthetic.length;
      generatedRange = Object.freeze({ start, end });
      if (nativeBody) synthetic += `      }\n      return ${nativeBody.name}();\n`;
      synthetic += '    } else {\n';
      synthetic += `      ${CURSOR} = ${entry.nextIndex};\n`;
      synthetic += '    }\n';
    } else {
      synthetic += `    ${CURSOR} = ${entry.nextIndex};\n`;
    }
    synthetic += '  }\n';

    const record = Object.freeze({
      ...entry,
      ...(bodyByEntry.has(entry.stableId) ? { nativeBody: bodyByEntry.get(entry.stableId) } : {}),
      ...(eventReachable ? { plane: 'http' } : {}),
      generatedRange,
      generatedBlockRange: Object.freeze({ start: openingStart, end: synthetic.length })
    });
    entryRecords.push(record);
    if (generatedRange) generatedRangeByEntry.set(entry.stableId, generatedRange);
    if (entry.kind === 'route' && route) routeRecordMap.set(route.stableId, Object.freeze({
      order: route.order,
      runtimeId: route.runtimeId,
      stableId: route.stableId,
      method: route.method,
      path: route.path,
      pathPattern: route.pathPattern,
      params: Object.freeze([...(route.params || [])]),
      handlerId: route.handler,
      handlerName: route.handlerName,
      sourceRouter: route.sourceRouter,
      routerEntryStableId: entry.stableId,
      routerEntryIndex: entry.index,
      generatedRange
    }));
  }
  entryRecords.push(...eventEntryRecords);
  synthetic += `  if (${MODE} === 1) return ctx.text("Internal Server Error", { status: 500 });\n`;
  synthetic += '  return ctx.text("Not Found", { status: 404 });\n';
  synthetic += '}\n';

  const handlerRecords = [];
  for (const frontend of prepared.handlers) {
    const operationIr = operationByEntry.get(frontend.entry.stableId);
    const generatedRange = generatedRangeByEntry.get(frontend.entry.stableId);
    const canonicalIr = createCanonicalHandlerIr({
      frontend,
      operationIr,
      compilerVersion: CANONICAL_ROUTER_COMPILER_VERSION,
      programVersion: CANONICAL_ROUTER_AUTHORING_VERSION,
      runtimeProtocolVersion: CANONICAL_ROUTER_EXECUTION_VERSION,
      options: {
        authoringSourceText: frontend.sourceText,
        loweredSourceText: emittedByEntry.get(frontend.entry.stableId).sourceText,
        handlerMetadata: handlerMetadata(frontend),
        routerMetadata: routerOwnership(frontend, generatedRange),
        compilerOwnedCalls: topology.compilerOwnedCalls
      },
      surfaceFacts: frontend.surfaceFacts
    });
    handlerRecords.push(Object.freeze({
      entryStableId: frontend.entry.stableId,
      entryIndex: frontend.entry.index,
      operationIr,
      canonicalIr,
      emitted: emittedByEntry.get(frontend.entry.stableId)
    }));
  }

  const routeRecords = (topology.routePlan.routes || []).map((route) => routeRecordMap.get(route.stableId)).filter(Boolean);
  const warnings = Object.freeze(prepared.handlers.flatMap((handler) => [...(handler.warnings || [])]));
  const userAuthoredAsync = prepared.handlers.some((handler) => Boolean(handler.normalization && handler.normalization.userAuthoredAsync));
  const normalization = Object.freeze({
    handlerCount: prepared.handlers.length,
    userAuthoredAsync,
    awaitCount: prepared.handlers.reduce((total, handler) => total + Number(handler.normalization && handler.normalization.awaitCount || 0), 0),
    effectAwaitCount: prepared.handlers.reduce((total, handler) => total + Number(handler.normalization && handler.normalization.effectAwaitCount || 0), 0),
    syncAwaitCount: prepared.handlers.reduce((total, handler) => total + Number(handler.normalization && handler.normalization.syncAwaitCount || 0), 0)
  });
  const pulseApplication = topology.applicationKind === 'pulse';
  const hasNormalizationEvidence = userAuthoredAsync
    || normalization.awaitCount > 0
    || normalization.effectAwaitCount > 0
    || normalization.syncAwaitCount > 0;
  const output = Object.freeze({
    version: CANONICAL_ROUTER_COMPILER_VERSION,
    authoringVersion: CANONICAL_ROUTER_AUTHORING_VERSION,
    fileName: topology.fileName,
    rootRouter: topology.rootName,
    ...(pulseApplication ? {
      applicationKind: 'pulse',
      applicationConstructionMode: topology.applicationConstructionMode,
      application: Object.freeze({ kind: 'pulse', constructionMode: topology.applicationConstructionMode })
    } : {}),
    sourceText: synthetic,
    compilerPrelude: topology.compilerPrelude,
    compilerOwnedCalls: topology.compilerOwnedCalls,
    ...(userAuthoredAsync ? { userAuthoredAsync: true } : {}),
    ...(hasNormalizationEvidence ? { normalization } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    routePlan: topology.routePlan,
    handlerTable: topology.handlerTable,
    ...(topology.eventTopology ? {
      eventTopology,
      eventCatalog,
      eventOutboundRequirements: topology.eventOutboundRequirements
    } : {}),
    routerTree: topology.routerTree,
    executionPlan: topology.executionPlan,
    metadata: Object.freeze({
      version: CANONICAL_ROUTER_AUTHORING_VERSION,
      entryRouter: topology.rootName,
      routePlanVersion: topology.routePlan.version,
      executionPlanVersion: topology.executionPlan.version,
      executionVersion: CANONICAL_ROUTER_EXECUTION_VERSION,
      ...(topology.eventTopology ? {
        events: Object.freeze({
          version: eventTopology.version,
          catalogHash: eventCatalog.catalogHash,
          count: eventCatalog.events.length,
          handlerExecution: true,
          nativeHandlerExecution: true,
          javascriptArtifactHandlerExecution: false,
          catalog: eventCatalog,
          abi: eventContracts.EVENT_NATIVE_ABI_EXTENSION,
          outboundRequirementsVersion: topology.eventOutboundRequirements.version
        })
      } : {}),
      ...(pulseApplication ? { application: Object.freeze({ kind: 'pulse', constructionMode: topology.applicationConstructionMode }) } : {}),
      ...(userAuthoredAsync ? { userAuthoredAsync: true } : {}),
      ...(hasNormalizationEvidence ? { normalization } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      semantics: Object.freeze({
        nextIsTerminal: true,
        onionResume: false,
        normalExhaustionStatus: 404,
        errorExhaustionStatus: 500,
        explicitErrorTransfer: 'return next(error)'
      }),
      routes: Object.freeze(routeRecords),
      entries: Object.freeze(entryRecords),
      ...(eventReachable ? { applicationEntries: Object.freeze(entryRecords) } : {})
    }),
    diagnostics: Object.freeze([])
  });

  return Object.freeze({
    version: ROUTER_HANDLER_IR_BUNDLE_VERSION,
    output,
    handlers: Object.freeze(handlerRecords)
  });
}

module.exports = Object.freeze({
  ROUTER_HANDLER_IR_BUNDLE_VERSION,
  emitCanonicalRouterFromHandlerIrs
});
