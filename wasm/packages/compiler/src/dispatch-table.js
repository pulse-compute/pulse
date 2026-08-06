'use strict';

const { PACKAGE_VERSION, normalizeArtifact } = require('./diagnostics.js');
const { matchRoutePath } = require('./path.js');
const { DISPATCH_POLICY, DISPATCH_TABLE_VERSION } = loadContractsDispatchTable();

function loadContractsDispatchTable() {
  try {
    return require('@pulse-compute/wasm-contracts/dispatch-table');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/dispatch-table.js');
    }
    throw error;
  }
}

function compareHandlers(a, b) {
  const ao = Number.isInteger(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = Number.isInteger(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return String(a.id).localeCompare(String(b.id));
}

function makeDiagnostic(code, message, hint, details = {}, loc) {
  return {
    pass: 'dispatch-table',
    code,
    severity: 'error',
    message,
    hint,
    loc: loc || { file: '<dispatch-table>' },
    details
  };
}

function handlerDisplayName(handler) {
  return handler?.localName || handler?.exportName || handler?.id;
}

function findEvalEntry(handlerEval, handlerId) {
  if (!handlerEval || !Array.isArray(handlerEval.handlers)) return undefined;
  return handlerEval.handlers.find((entry) => entry.handlerId === handlerId);
}

function summarizeEval(entry) {
  if (!entry) return { status: 'unknown' };
  return {
    status: entry.status,
    captures: (entry.captures || []).length,
    calls: (entry.calls || []).length,
    deps: (entry.deps || []).length,
    dependencyChain: (entry.dependencyChain || []).length,
    globals: (entry.globals || []).length,
    imports: (entry.imports || []).length,
    unsupported: (entry.unsupported || []).length
  };
}

function buildHandlerSlots(handlerTable, handlerEval, diagnostics) {
  const handlers = Array.isArray(handlerTable?.handlers) ? [...handlerTable.handlers] : [];
  handlers.sort(compareHandlers);

  const slots = [];
  const byId = new Map();
  handlers.forEach((handler, slot) => {
    const evalEntry = findEvalEntry(handlerEval, handler.id);
    const slotEntry = {
      slot,
      id: handler.id,
      name: handlerDisplayName(handler),
      roles: handler.roles || [],
      kind: handler.kind,
      file: handler.file,
      sourceTextHash: handler.sourceTextHash,
      signature: handler.signature,
      eval: summarizeEval(evalEntry),
      loc: handler.loc
    };
    slots.push(slotEntry);
    byId.set(handler.id, slotEntry);

    if (!evalEntry) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_HANDLER_EVAL_MISSING',
        `Handler "${handlerDisplayName(handler)}" is missing handler evaluation metadata.`,
        'Run handler-eval before dispatch-table generation.',
        { handlerId: handler.id },
        handler.loc
      ));
    } else if (evalEntry.status !== 'ok') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_HANDLER_EVAL_ERROR',
        `Handler "${handlerDisplayName(handler)}" did not pass handler evaluation.`,
        'Dispatch metadata can only reference handlers with handler-eval status "ok".',
        { handlerId: handler.id, status: evalEntry.status, unsupported: evalEntry.unsupported || [] },
        handler.loc
      ));
    }
  });

  return { slots, byId };
}

function routeLoc(route) {
  return route?.loc || { file: '<route-plan>' };
}

function createHandlerUse(handlerId, role, slotById, diagnostics, route, index) {
  if (!handlerId) return undefined;
  const slot = slotById.get(handlerId);
  if (!slot) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_DISPATCH_UNKNOWN_HANDLER',
      `Route ${route?.method || '<method>'} ${route?.path || '<path>'} references handler "${handlerId}", but it is not in handler-table.json.`,
      'Every dispatch handler reference must resolve through handler-table.json.',
      { handlerId, role, runtimeId: route?.runtimeId ?? route?.id, stableId: route?.stableId },
      routeLoc(route)
    ));
    return { slot: null, id: handlerId, name: undefined, role, unresolved: true, index };
  }
  return {
    slot: slot.slot,
    id: slot.id,
    name: slot.name,
    role,
    index,
    evalStatus: slot.eval.status
  };
}

function createHandlerUses(handlerIds, role, slotById, diagnostics, route) {
  return (handlerIds || [])
    .map((handlerId, index) => createHandlerUse(handlerId, role, slotById, diagnostics, route, index))
    .filter(Boolean);
}

function createChannelUse(channel, slotById, diagnostics, route) {
  if (!channel) return undefined;
  if (channel.kind === 'static') {
    return { kind: 'static', value: channel.value };
  }
  if (channel.kind === 'handler') {
    const use = createHandlerUse(channel.value, 'channel', slotById, diagnostics, route, 0);
    return {
      kind: 'handler',
      slot: use?.slot ?? null,
      id: channel.value,
      name: channel.name || use?.name,
      evalStatus: use?.evalStatus,
      unresolved: Boolean(use?.unresolved)
    };
  }
  diagnostics.push(makeDiagnostic(
    'PULSEWASM_DISPATCH_UNSUPPORTED_CHANNEL',
    `Unsupported channel metadata kind "${channel.kind}" in route ${route?.method || '<method>'} ${route?.path || '<path>'}.`,
    'Phase 6 accepts static channels and handler channels only.',
    { channel, runtimeId: route?.runtimeId ?? route?.id, stableId: route?.stableId },
    routeLoc(route)
  ));
  return { kind: channel.kind || 'unknown', value: channel.value, unsupported: true };
}

function createParamSlots(route) {
  const params = route.params || [];
  const segments = route.pathPattern?.segments || [];
  return params.map((name) => {
    const segmentIndex = segments.findIndex((segment) => segment.kind === 'param' && segment.name === name);
    return { name, segmentIndex };
  });
}

function buildExecution(normal, error, lifecycle, channel) {
  return {
    normal: [
      ...normal.middleware.map((use) => ({ kind: 'middleware', slot: use.slot, handlerId: use.id, name: use.name, order: use.index })),
      { kind: 'handler', slot: normal.handler?.slot ?? null, handlerId: normal.handler?.id, name: normal.handler?.name, order: normal.middleware.length }
    ],
    error: error.map((use) => ({ kind: 'error', slot: use.slot, handlerId: use.id, name: use.name, order: use.index })),
    lifecycle: {
      connect: lifecycle.connect.map((use) => ({ kind: 'connect', slot: use.slot, handlerId: use.id, name: use.name, order: use.index })),
      disconnect: lifecycle.disconnect.map((use) => ({ kind: 'disconnect', slot: use.slot, handlerId: use.id, name: use.name, order: use.index }))
    },
    channel
  };
}

function validateDenseRuntimeIds(routes, diagnostics) {
  const ids = routes.map((route) => route.runtimeId ?? route.id);
  const seen = new Set();
  ids.forEach((id, index) => {
    if (!Number.isInteger(id)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_INVALID_RUNTIME_ID',
        `Route at index ${index} has a non-integer runtimeId.`,
        'runtimeId must be a dense integer assigned by the flatten pass.',
        { index, runtimeId: id },
        routeLoc(routes[index])
      ));
    } else if (seen.has(id)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_DUPLICATE_RUNTIME_ID',
        `Duplicate runtimeId ${id} in route plan.`,
        'runtimeId values must be unique before dispatch generation.',
        { runtimeId: id },
        routeLoc(routes[index])
      ));
    }
    seen.add(id);
  });
  for (let expected = 0; expected < ids.length; expected += 1) {
    if (!seen.has(expected)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_NON_DENSE_RUNTIME_IDS',
        `Missing runtimeId ${expected}; dispatch route IDs must be dense.`,
        'Regenerate route-plan.json from the flattened route plan.',
        { expected, runtimeIds: ids },
        { file: '<route-plan>' }
      ));
    }
  }
}

function validateStableIds(routes, diagnostics) {
  const seen = new Map();
  for (const route of routes) {
    if (!route.stableId) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_MISSING_STABLE_ID',
        `Route ${route.method || '<method>'} ${route.path || '<path>'} is missing stableId.`,
        'Run stable-ids before dispatch-table generation.',
        { runtimeId: route.runtimeId ?? route.id },
        routeLoc(route)
      ));
      continue;
    }
    if (seen.has(route.stableId)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_DUPLICATE_STABLE_ID',
        `Duplicate stableId ${route.stableId} in route plan.`,
        'Stable route IDs must be unique before dispatch generation.',
        { stableId: route.stableId, firstRuntimeId: seen.get(route.stableId), runtimeId: route.runtimeId ?? route.id },
        routeLoc(route)
      ));
    }
    seen.set(route.stableId, route.runtimeId ?? route.id);
  }
}

function findPathTableRoute(pathTable, route) {
  if (!pathTable || !Array.isArray(pathTable.routes)) return undefined;
  return pathTable.routes.find((entry) => entry.stableId === route.stableId && (entry.runtimeId === (route.runtimeId ?? route.id)));
}

function buildDispatchTable(routePlan, handlerTable, handlerEval, pathTable, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const routes = [...(routePlan?.routes || [])].sort((a, b) => (a.runtimeId ?? a.id) - (b.runtimeId ?? b.id));
  validateDenseRuntimeIds(routes, diagnostics);
  validateStableIds(routes, diagnostics);

  const { slots: handlerSlots, byId: slotById } = buildHandlerSlots(handlerTable, handlerEval, diagnostics);
  const methodBuckets = {};
  const dispatchRoutes = [];

  for (const route of routes) {
    const runtimeId = route.runtimeId ?? route.id;
    const pathEntry = findPathTableRoute(pathTable, route);
    if (!pathEntry) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_DISPATCH_PATH_METADATA_MISSING',
        `Route ${route.method} ${route.path} is missing corresponding path-table metadata.`,
        'Run path-table generation before dispatch-table generation.',
        { runtimeId, stableId: route.stableId },
        routeLoc(route)
      ));
    }

    const middleware = createHandlerUses(route.middleware, 'middleware', slotById, diagnostics, route);
    const errorHandlers = createHandlerUses(route.errorHandlers, 'error', slotById, diagnostics, route);
    const connectHandlers = createHandlerUses(route.connectHandlers, 'lifecycle:connect', slotById, diagnostics, route);
    const disconnectHandlers = createHandlerUses(route.disconnectHandlers, 'lifecycle:disconnect', slotById, diagnostics, route);
    const handler = createHandlerUse(route.handler, 'route', slotById, diagnostics, route, 0);
    const channel = createChannelUse(route.channel, slotById, diagnostics, route);
    const lifecycle = { connect: connectHandlers, disconnect: disconnectHandlers };
    const pattern = route.pathPattern || pathEntry?.pattern;
    const paramSlots = createParamSlots({ ...route, pathPattern: pattern });

    const entry = {
      stableId: route.stableId,
      runtimeId,
      id: runtimeId,
      order: route.order,
      method: route.method,
      path: route.path,
      params: route.params || [],
      paramSlots,
      pattern,
      match: {
        method: route.method,
        path: route.path,
        wildcard: Boolean(pattern && pattern.wildcard),
        segments: pattern?.segments || [],
        paramSlots
      },
      handlers: {
        middleware,
        route: handler,
        error: errorHandlers,
        lifecycle,
        channel
      },
      execution: buildExecution({ middleware, handler }, errorHandlers, lifecycle, channel),
      scopedMiddleware: route.scopedMiddleware || [],
      sourceRouter: route.sourceRouter,
      loc: route.loc
    };

    dispatchRoutes.push(entry);
    if (!methodBuckets[route.method]) methodBuckets[route.method] = [];
    methodBuckets[route.method].push(runtimeId);
  }

  const uniqueHandlerRefs = new Set();
  for (const route of dispatchRoutes) {
    for (const use of route.handlers.middleware || []) uniqueHandlerRefs.add(use.id);
    if (route.handlers.route?.id) uniqueHandlerRefs.add(route.handlers.route.id);
    for (const use of route.handlers.error || []) uniqueHandlerRefs.add(use.id);
    for (const use of route.handlers.lifecycle?.connect || []) uniqueHandlerRefs.add(use.id);
    for (const use of route.handlers.lifecycle?.disconnect || []) uniqueHandlerRefs.add(use.id);
    if (route.handlers.channel?.kind === 'handler' && route.handlers.channel.id) uniqueHandlerRefs.add(route.handlers.channel.id);
  }

  const summary = {
    routes: dispatchRoutes.length,
    methods: Object.keys(methodBuckets).sort(),
    handlerSlots: handlerSlots.length,
    usedHandlers: uniqueHandlerRefs.size,
    middlewareLinks: dispatchRoutes.reduce((sum, route) => sum + route.handlers.middleware.length, 0),
    errorLinks: dispatchRoutes.reduce((sum, route) => sum + route.handlers.error.length, 0),
    lifecycleLinks: dispatchRoutes.reduce((sum, route) => sum + route.handlers.lifecycle.connect.length + route.handlers.lifecycle.disconnect.length, 0),
    channelHandlers: dispatchRoutes.filter((route) => route.handlers.channel?.kind === 'handler').length,
    staticChannels: dispatchRoutes.filter((route) => route.handlers.channel?.kind === 'static').length,
    diagnostics: diagnostics.length
  };

  const dispatchTable = normalizeArtifact({
    version: DISPATCH_TABLE_VERSION,
    generatedBy: options.generatedBy || routePlan?.generatedBy || PACKAGE_VERSION,
    source: routePlan?.source,
    entryRouter: routePlan?.entryRouter,
    policy: DISPATCH_POLICY,
    routePlanVersion: routePlan?.version,
    handlerTableVersion: handlerTable?.version,
    handlerEvalVersion: handlerEval?.version,
    pathTableVersion: pathTable?.version,
    idPolicy: routePlan?.idPolicy,
    pathPolicy: routePlan?.pathPolicy,
    handlerSlots,
    handlerSlotMap: Object.fromEntries(handlerSlots.map((handler) => [handler.id, handler.slot])),
    methodBuckets,
    routes: dispatchRoutes,
    summary
  }, cwd);

  return { dispatchTable, diagnostics };
}

function matchDispatchRoute(dispatchTable, method, requestPath) {
  const normalizedMethod = String(method || '').toUpperCase();
  const routeIds = dispatchTable?.methodBuckets?.[normalizedMethod] || [];
  const routesById = new Map((dispatchTable?.routes || []).map((route) => [route.runtimeId, route]));

  for (const runtimeId of routeIds) {
    const route = routesById.get(runtimeId);
    if (!route) continue;
    const match = matchRoutePath(route.pattern, requestPath);
    if (!match) continue;
    return {
      stableId: route.stableId,
      runtimeId: route.runtimeId,
      id: route.id,
      method: route.method,
      path: route.path,
      params: match.params,
      rest: match.rest,
      handlers: route.handlers,
      execution: route.execution,
      route
    };
  }
  return null;
}

module.exports = {
  DISPATCH_POLICY,
  DISPATCH_TABLE_VERSION,
  buildDispatchTable,
  matchDispatchRoute
};
