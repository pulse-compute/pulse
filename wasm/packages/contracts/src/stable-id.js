'use strict';

const { sha256Hex: portableSha256Hex } = require('./sha256.js');
const { HANDLER_STABLE_INPUT_VERSION } = require('./handler-table.js');
const { ROUTE_STABLE_INPUT_VERSION } = require('./route-plan.js');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) out[key] = canonicalize(child);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return portableSha256Hex(String(value));
}

function stableHash(value, options = {}) {
  const hex = sha256Hex(stableStringify(value));
  return hex.slice(0, options.length || 24);
}

function sourceTextHash(sourceText, options = {}) {
  return sha256Hex(String(sourceText || '')).slice(0, options.length || 24);
}

function prefixedStableId(prefix, value, options = {}) {
  return `${prefix}_${stableHash(value, options)}`;
}

function createHandlerStableInput(handlerParts) {
  return {
    artifact: HANDLER_STABLE_INPUT_VERSION,
    file: handlerParts.file,
    kind: handlerParts.kind,
    localName: handlerParts.localName || null,
    exportName: handlerParts.exportName || null,
    inline: Boolean(handlerParts.inline),
    loc: handlerParts.inline ? handlerParts.loc || null : undefined,
    sourceTextHash: handlerParts.sourceTextHash
  };
}

function createHandlerStableId(handlerParts) {
  return prefixedStableId('handler', createHandlerStableInput(handlerParts));
}

function normalizeRefIdentity(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return { kind: 'legacy-name', value: ref };
  if (ref.kind === 'handler') return { kind: 'handler', id: ref.id };
  if (ref.id && ref.kind !== 'static') return { kind: 'handler', id: ref.id };
  if (ref.kind === 'identifier') return { kind: 'identifier', value: ref.value };
  if (ref.kind === 'inline') {
    // Legacy Phase 2 behavior for pre-handler-table references.
    return { kind: 'inline', value: String(ref.value || '').replace(/\s+/g, ' ').trim() };
  }
  if (ref.kind === 'ref' || ref.kind === 'static') return { kind: ref.kind, value: ref.value };
  return { kind: ref.kind || 'unknown', value: ref.value === undefined ? null : String(ref.value) };
}

function normalizeChannelIdentity(channel) {
  if (!channel) return null;
  return normalizeRefIdentity(channel);
}

function buildRouteStableInput(routeParts) {
  return {
    artifact: routeParts.artifact || ROUTE_STABLE_INPUT_VERSION,
    method: routeParts.method,
    path: routeParts.path,
    params: routeParts.params || [],
    handler: normalizeRefIdentity(routeParts.handler),
    middleware: (routeParts.middleware || []).map(normalizeRefIdentity),
    errorHandlers: (routeParts.errorHandlers || []).map(normalizeRefIdentity),
    connectHandlers: (routeParts.connectHandlers || []).map(normalizeRefIdentity),
    disconnectHandlers: (routeParts.disconnectHandlers || []).map(normalizeRefIdentity),
    channel: normalizeChannelIdentity(routeParts.channel)
  };
}

function createRouteStableId(routeParts) {
  return prefixedStableId('route', buildRouteStableInput(routeParts));
}

function createRouteIdMap(routePlan, options = {}) {
  const generatedBy = options.generatedBy || routePlan.generatedBy;
  const routes = (routePlan.routes || []).map((route) => ({
    stableId: route.stableId,
    runtimeId: route.runtimeId ?? route.id,
    id: route.id,
    method: route.method,
    path: route.path,
    handler: route.handler,
    handlerName: route.handlerName,
    params: route.params || [],
    pathPattern: route.pathPattern,
    sourceRouter: route.sourceRouter,
    order: route.order
  }));

  return {
    version: 'pulsewasm.route-id-map.v3',
    generatedBy,
    source: routePlan.source,
    entryRouter: routePlan.entryRouter,
    idPolicy: routePlan.idPolicy,
    pathPolicy: routePlan.pathPolicy,
    routes,
    summary: {
      routes: routes.length,
      stableIds: new Set(routes.map((route) => route.stableId)).size,
      runtimeIds: new Set(routes.map((route) => route.runtimeId)).size,
      handlerIds: new Set(routes.map((route) => route.handler).filter(Boolean)).size,
      wildcardRoutes: routes.filter((route) => route.pathPattern && route.pathPattern.wildcard).length
    }
  };
}

module.exports = {
  buildRouteStableInput,
  canonicalize,
  createHandlerStableId,
  createHandlerStableInput,
  createRouteIdMap,
  createRouteStableId,
  normalizeChannelIdentity,
  normalizeRefIdentity,
  prefixedStableId,
  sha256Hex,
  sourceTextHash,
  stableHash,
  stableStringify
};
