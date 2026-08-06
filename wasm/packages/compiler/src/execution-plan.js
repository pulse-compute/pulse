'use strict';

const { PACKAGE_VERSION, normalizeArtifact } = require('./diagnostics.js');
const { compileRoutePath, joinPaths, publicPathPattern, stripScopedWildcard } = require('./path.js');
const { ENTRY_KIND_CODES, EXECUTION_PLAN_VERSION, EXECUTION_POLICY } = loadContractsExecutionPlan();

function loadContractsExecutionPlan() {
  try {
    return require('@pulse-compute/wasm-contracts/execution-plan');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/execution-plan.js');
    }
    throw error;
  }
}

function handlerSlotMap(dispatchTable) {
  const map = new Map();
  for (const slot of dispatchTable?.handlerSlots || []) {
    map.set(slot.id, slot);
  }
  return map;
}

function routeKey(method, path, handlerId) {
  return `${String(method || '').toUpperCase()} ${path} ${handlerId || ''}`;
}

function routeLookup(dispatchTable) {
  const byKey = new Map();
  const byOrder = new Map();
  for (const route of dispatchTable?.routes || []) {
    const key = routeKey(route.method, route.path, route.handlers?.route?.id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(route);
    if (Number.isInteger(route.order)) byOrder.set(route.order, route);
  }
  return { byKey, byOrder };
}

function handlerUseFromRef(ref, role, slots, order = 0) {
  if (!ref) return undefined;
  const id = ref.id || ref.value;
  const slot = slots.get(id);
  return {
    id,
    handlerId: id,
    name: ref.name || slot?.name || id,
    role,
    slot: Number.isInteger(slot?.slot) ? slot.slot : null,
    order,
    evalStatus: slot?.eval?.status,
    unresolved: !slot
  };
}

function channelUseFromRef(ref, slots) {
  if (!ref) return undefined;
  if (ref.kind === 'static') {
    return { kind: 'static', value: ref.value };
  }
  if (ref.kind === 'handler' || ref.kind === 'ref' || ref.id || ref.value) {
    const id = ref.id || ref.value;
    const slot = slots.get(id);
    return {
      kind: 'handler',
      id,
      handlerId: id,
      name: ref.name || slot?.name || id,
      role: 'channel',
      slot: Number.isInteger(slot?.slot) ? slot.slot : null,
      evalStatus: slot?.eval?.status,
      unresolved: !slot
    };
  }
  return undefined;
}

function compilePattern(path, options = {}) {
  if (!path) return undefined;
  const compiled = compileRoutePath(path, {
    scoped: Boolean(options.scoped),
    allowWildcard: true
  });
  return publicPathPattern(compiled);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Math.floor(number) === number ? number : fallback;
}

function configTimeouts(resolvedConfig) {
  const runtime = resolvedConfig?.runtime || resolvedConfig?.config?.runtime || {};
  const timeouts = runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? runtime.timeouts || {} : {};
  const defaultMs = positiveInt(timeouts.defaultMs, 5000);
  const hardMs = positiveInt(timeouts.hardMs, 30000);
  const effectDefaultMs = positiveInt(timeouts.effectDefaultMs, 5000);
  const schedulerResolutionMs = positiveInt(timeouts.schedulerResolutionMs, 10);
  return {
    defaultMs: Math.min(defaultMs, hardMs),
    hardMs,
    effectDefaultMs: Math.min(effectDefaultMs, hardMs),
    schedulerResolutionMs,
    source: 'app'
  };
}

function mergeTimeout(parent, override) {
  const base = parent || configTimeouts();
  const raw = override || {};
  const requestedHardMs = raw.hardMs === undefined ? base.hardMs : positiveInt(raw.hardMs, base.hardMs);
  const hardMs = Math.min(base.hardMs, requestedHardMs);
  const defaultMs = Math.min(hardMs, raw.defaultMs === undefined ? base.defaultMs : positiveInt(raw.defaultMs, base.defaultMs));
  const effectDefaultMs = Math.min(hardMs, raw.effectDefaultMs === undefined ? base.effectDefaultMs : positiveInt(raw.effectDefaultMs, base.effectDefaultMs));
  const schedulerResolutionMs = raw.schedulerResolutionMs === undefined ? base.schedulerResolutionMs : positiveInt(raw.schedulerResolutionMs, base.schedulerResolutionMs);
  return {
    defaultMs,
    hardMs,
    effectDefaultMs,
    schedulerResolutionMs,
    source: raw.source || 'scope',
    inheritsFrom: base.source || 'app'
  };
}

function scopeKey(scope) {
  return JSON.stringify({
    channel: scope.channel || null,
    connect: scope.connect || [],
    disconnect: scope.disconnect || [],
    timeout: scope.timeout || null
  });
}

function createScopeRegistry() {
  const scopes = [];
  const keys = new Map();

  function intern(scope) {
    const normalized = {
      channel: scope.channel || null,
      connect: [...(scope.connect || [])],
      disconnect: [...(scope.disconnect || [])],
      timeout: scope.timeout ? { ...scope.timeout } : null
    };
    const key = scopeKey(normalized);
    if (keys.has(key)) return keys.get(key);
    const id = scopes.length;
    const entry = { id, ...normalized };
    scopes.push(entry);
    keys.set(key, id);
    return id;
  }

  return { scopes, intern };
}

function cloneScope(scope) {
  return {
    channel: scope.channel || null,
    connect: [...(scope.connect || [])],
    disconnect: [...(scope.disconnect || [])],
    timeout: scope.timeout ? { ...scope.timeout } : null
  };
}

function makeDiagnostic(code, message, hint, details = {}, loc) {
  return {
    pass: 'execution-plan',
    code,
    severity: 'error',
    message,
    hint,
    loc: loc || { file: '<execution-plan>' },
    details
  };
}

function buildExecutionPlan(routerTreeArtifact, dispatchTable, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const slots = handlerSlotMap(dispatchTable);
  const routes = routeLookup(dispatchTable);
  const entries = [];
  const scopeRegistry = createScopeRegistry();
  const appTimeout = configTimeouts(options.resolvedConfig);
  const timeoutOverrides = [];

  function addEntry(entry) {
    const index = entries.length;
    entries.push({
      index,
      nextIndex: index + 1,
      ...entry
    });
    return index;
  }

  function patch(index, fields) {
    entries[index] = { ...entries[index], ...fields };
  }

  function findRoute(op, absolutePath) {
    const handlerId = op.handler?.id || op.handler?.value;
    const key = routeKey(op.method, absolutePath, handlerId);
    const candidates = routes.byKey.get(key) || [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      return candidates.find((candidate) => candidate.order === op.order) || candidates[0];
    }
    if (routes.byOrder.has(op.order)) return routes.byOrder.get(op.order);
    return undefined;
  }

  function absoluteScopedPath(prefix, opPath) {
    const joined = joinPaths(prefix || '/', stripScopedWildcard(opPath || '/'));
    return joined === '/' ? '/*' : `${joined}/*`;
  }

  function visitRouter(router, prefix, inheritedScope, routerPath) {
    const scope = cloneScope(inheritedScope);
    const pathForRouter = routerPath.concat(router.name);
    const childrenByOrder = new Map();
    for (const child of router.children || []) {
      childrenByOrder.set(child.order, child);
    }

    for (const op of router.ops || []) {
      const scopeBefore = scopeRegistry.intern(scope);

      if (op.kind === 'timeout') {
        const before = scopeBefore;
        const previous = scope.timeout ? { ...scope.timeout } : { ...appTimeout };
        scope.timeout = mergeTimeout(previous, { ...(op.value || {}), source: 'scope' });
        const after = scopeRegistry.intern(scope);
        timeoutOverrides.push({
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          beforeScopeId: before,
          afterScopeId: after,
          timeout: scope.timeout,
          loc: op.loc
        });
        continue;
      }

      if (op.kind === 'channel') {
        const before = scopeBefore;
        const channel = channelUseFromRef(op.value, slots);
        scope.channel = channel || null;
        const after = scopeRegistry.intern(scope);
        addEntry({
          kind: 'channel',
          kindCode: ENTRY_KIND_CODES.channel,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          scopeId: before,
          nextScopeId: after,
          channel,
          loc: op.loc
        });
        continue;
      }

      if (op.kind === 'lifecycle') {
        const before = scopeBefore;
        const handler = handlerUseFromRef(op.handler, `lifecycle:${op.event}`, slots, (op.event === 'connect' ? scope.connect : scope.disconnect).length);
        if (op.event === 'connect') scope.connect.push(handler);
        if (op.event === 'disconnect') scope.disconnect.push(handler);
        const after = scopeRegistry.intern(scope);
        addEntry({
          kind: 'lifecycle',
          kindCode: ENTRY_KIND_CODES.lifecycle,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          scopeId: before,
          nextScopeId: after,
          event: op.event,
          handler,
          loc: op.loc
        });
        continue;
      }

      if (op.kind === 'mount') {
        const child = childrenByOrder.get(op.order);
        const mountPath = joinPaths(prefix || '/', stripScopedWildcard(op.path || '/'));
        const mountPattern = compilePattern(mountPath, { scoped: true });
        const mountIndex = addEntry({
          kind: 'mount',
          kindCode: ENTRY_KIND_CODES.mount,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          path: mountPath,
          pattern: mountPattern,
          scopeId: scopeBefore,
          childRouter: op.router,
          childStartIndex: null,
          parentContinueIndex: null,
          loc: op.loc
        });
        const childStartIndex = entries.length;
        if (child && child.router) {
          visitRouter(child.router, mountPath, scope, pathForRouter);
        } else {
          diagnostics.push(makeDiagnostic(
            'PULSEWASM_EXECUTION_PLAN_MISSING_MOUNT_CHILD',
            `Mounted router "${op.router}" was not available while building the execution plan.`,
            'Run router tree resolution before execution-plan generation.',
            { router: op.router, order: op.order },
            op.loc
          ));
        }
        const parentContinueIndex = entries.length;
        patch(mountIndex, {
          childStartIndex: childStartIndex === parentContinueIndex ? parentContinueIndex : childStartIndex,
          parentContinueIndex,
          nextIndex: parentContinueIndex
        });
        continue;
      }

      if (op.kind === 'use') {
        const scoped = Boolean(op.path);
        const absolutePath = scoped ? absoluteScopedPath(prefix || '/', op.path) : undefined;
        const handler = handlerUseFromRef(op.handler, 'middleware', slots, 0);
        addEntry({
          kind: 'use',
          kindCode: ENTRY_KIND_CODES.use,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          path: scoped ? stripScopedWildcard(absolutePath) : null,
          pattern: scoped ? compilePattern(stripScopedWildcard(absolutePath), { scoped: true }) : null,
          scoped,
          scopeId: scopeBefore,
          handler,
          loc: op.loc
        });
        continue;
      }

      if (op.kind === 'error') {
        const handler = handlerUseFromRef(op.handler, 'error', slots, 0);
        addEntry({
          kind: 'error',
          kindCode: ENTRY_KIND_CODES.error,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          scopeId: scopeBefore,
          handler,
          loc: op.loc
        });
        continue;
      }

      if (op.route || op.kind === 'get' || op.kind === 'post') {
        const absolutePath = joinPaths(prefix || '/', op.path || '/');
        const route = findRoute(op, absolutePath);
        if (!route) {
          diagnostics.push(makeDiagnostic(
            'PULSEWASM_EXECUTION_PLAN_ROUTE_NOT_FOUND',
            `Route ${op.method || op.kind.toUpperCase()} ${absolutePath} was not found in dispatch-table.json.`,
            'Run route-plan, stable-ids, and dispatch-table before execution-plan generation.',
            { method: op.method, path: absolutePath, handlerId: op.handler?.id, order: op.order },
            op.loc
          ));
        }
        addEntry({
          kind: 'route',
          kindCode: ENTRY_KIND_CODES.route,
          order: op.order,
          router: router.name,
          routerPath: pathForRouter,
          method: op.method,
          path: absolutePath,
          pattern: route?.pattern || compilePattern(absolutePath),
          runtimeId: route?.runtimeId ?? null,
          stableId: route?.stableId,
          routeId: route?.runtimeId ?? null,
          handler: route?.handlers?.route || handlerUseFromRef(op.handler, 'route', slots, 0),
          scopeId: scopeBefore,
          routePlan: route ? {
            middleware: route.handlers?.middleware || [],
            error: route.handlers?.error || [],
            lifecycle: route.handlers?.lifecycle || { connect: [], disconnect: [] },
            channel: route.handlers?.channel
          } : undefined,
          loc: op.loc
        });
      }
    }
  }

  const root = routerTreeArtifact?.tree || routerTreeArtifact;
  if (!root) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_EXECUTION_PLAN_MISSING_TREE',
      'Cannot build execution plan without a resolved router tree.',
      'Run router tree resolution before execution-plan generation.'
    ));
  } else {
    visitRouter(root, '/', { channel: null, connect: [], disconnect: [], timeout: appTimeout }, []);
  }

  for (let i = 0; i < entries.length; i += 1) {
    if (!Number.isInteger(entries[i].nextIndex)) entries[i].nextIndex = i + 1;
    if (entries[i].nextIndex > entries.length) entries[i].nextIndex = entries.length;
  }

  const executableEntries = entries.filter((entry) => entry.kind === 'use' || entry.kind === 'route' || entry.kind === 'error');
  const summary = {
    entries: entries.length,
    executableEntries: executableEntries.length,
    routes: entries.filter((entry) => entry.kind === 'route').length,
    middleware: entries.filter((entry) => entry.kind === 'use').length,
    errors: entries.filter((entry) => entry.kind === 'error').length,
    mounts: entries.filter((entry) => entry.kind === 'mount').length,
    scopeTransitions: entries.filter((entry) => entry.kind === 'channel' || entry.kind === 'lifecycle').length + timeoutOverrides.length,
    timeoutOverrides: timeoutOverrides.length,
    scopes: scopeRegistry.scopes.length,
    diagnostics: diagnostics.length
  };

  const executionPlan = normalizeArtifact({
    version: EXECUTION_PLAN_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    source: dispatchTable?.source || routerTreeArtifact?.source,
    entryRouter: routerTreeArtifact?.entryRouter || root?.name,
    policy: EXECUTION_POLICY,
    routePlanVersion: dispatchTable?.routePlanVersion,
    dispatchTableVersion: dispatchTable?.version,
    pathPolicy: dispatchTable?.pathPolicy,
    entryKindCodes: ENTRY_KIND_CODES,
    timeoutPolicy: {
      appDefault: appTimeout,
      scopeOverridesAreStaticMetadata: true,
      scopeMayTightenButNotExceedAppHardDeadline: true,
      hardDeadlineCannotBeExtended: true,
      assetsAreNotV1EffectKind: true
    },
    timeoutOverrides,
    scopes: scopeRegistry.scopes,
    entries,
    summary
  }, cwd);

  return { executionPlan, diagnostics };
}

module.exports = {
  EXECUTION_PLAN_VERSION,
  EXECUTION_POLICY,
  ENTRY_KIND_CODES,
  buildExecutionPlan
};
