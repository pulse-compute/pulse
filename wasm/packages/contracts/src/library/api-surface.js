'use strict';

const { PACKAGE_VERSION } = require('../diagnostics.js');

const API_SURFACE_PHASE = '12C';
const API_SURFACE_VERSION = 'pulsewasm.api-surface.v1';
const LIFECYCLE_ORDERING_VERSION = 'pulsewasm.lifecycle-ordering.v1';
const API_SURFACE_POLICY = {
  driftVisibleByArtifact: true,
  canonicalSurfaceExplicit: true,
  reservedAliasesRecorded: true,
  librarySurfacesRequireContracts: true,
  lifecycleDefaultOrdering: 'serial-source-order'
};

const API_SURFACE_DEFINITIONS = [
  { symbol: 'ctx.param', kind: 'ctx-dsl', status: 'implemented-compiled-handler', canonical: true, phase: '12A', notes: 'Trusted param DSL lowered to runtime-core helpers.' },
  { symbol: 'ctx.result.text', kind: 'ctx-dsl', status: 'implemented-compiled-handler', canonical: true, phase: '12A', notes: 'Text result builder.' },
  { symbol: 'ctx.result.jsonText', kind: 'ctx-dsl', status: 'implemented-compiled-handler', canonical: true, phase: '12A.1', notes: 'JSON text result builder; schema parsing remains sidecar path.' },
  { symbol: 'ctx.request.header.*', kind: 'ctx-dsl', status: 'implemented-compiled-handler', canonical: true, phase: '12A.1', notes: 'Read-only ordered request header access.' },
  { symbol: 'ctx.response.header.*', kind: 'ctx-dsl', status: 'implemented-compiled-handler', canonical: true, phase: '12A.1', notes: 'Mutable ordered response header access.' },
  { symbol: 'ctx.fetch', kind: 'effect', status: 'planned-route-effect', canonical: true, phase: '30', notes: 'Declared backend-fetch effect; Pass 30 can plan ctx.resolve lifecycle, execution reserved until provider/runtime proof.' },
  { symbol: 'ctx.sleep', kind: 'effect', status: 'contracted-proof-target', canonical: true, phase: '11F/11G', notes: 'Sleep is the first explicit effect proof target; execution not implemented yet.' },
  { symbol: 'ctx.resolve', kind: 'effect-composition', status: 'planned-route-effect', canonical: true, phase: '30', notes: 'Effect submission boundary with named top-level continuation; no promise/microtask semantics.' },
  { symbol: 'ctx.resolved', kind: 'effect-continuation', status: 'planned-route-effect', canonical: true, phase: '30', notes: 'Continuation-only resolved fetch response handle accessor for ctx.resolve groups.' },
  { symbol: 'ctx.req.parse', kind: 'body-parser', status: 'contracted-reserved', canonical: true, phase: '12B.1', notes: 'Canonical parser surface; schema id selects codec/sidecar.' },
  { symbol: 'ctx.req.json', kind: 'body-parser-sugar', status: 'reserved-alias', canonical: false, canonicalTarget: 'ctx.req.parse', phase: '12B.1', notes: 'JSON-only sugar; not the root API.' },
  { symbol: 'ctx.<extension>.*', kind: 'library-ctx-extension', status: 'library-declared', canonical: true, phase: '12C', notes: 'Only valid when declared by pulse.library.json, installed in scope, and lowered by AS sidecar.' },
  { symbol: 'grip.hold/channel/publish', kind: 'package-owned-lowerable-facade', status: 'package-owned-plan-only', canonical: true, phase: '54', notes: '@pulse-compute/grip now ships its own PulseWasm manifest, lowerable facade, compiler builder, and sidecar declaration. Provider runtime behavior remains plan-only.' },
  { symbol: 'app.timeout', kind: 'router-metadata', status: 'implemented-contract', canonical: true, phase: '11G', notes: 'Static scope timeout metadata, not middleware behavior.' },
  { symbol: 'lifecycle.connect/disconnect', kind: 'lifecycle', status: 'serial-source-order-locked', canonical: true, phase: '12C', notes: 'Lifecycle handlers execute serially in source/scope order. Parallel lifecycle execution is reserved.' }
];

function defaultApiSurfaces() {
  return API_SURFACE_DEFINITIONS.map((surface) => ({ ...surface }));
}

function summarizeApiSurfaces(surfaces) {
  return {
    surfaces: surfaces.length,
    implemented: surfaces.filter((surface) => String(surface.status).startsWith('implemented')).length,
    contractedReserved: surfaces.filter((surface) => surface.status.includes('reserved')).length,
    libraryDeclared: surfaces.filter((surface) => surface.kind === 'library-ctx-extension').length,
    lifecycleSerial: true
  };
}

function buildApiSurfaceContract(inputs = {}) {
  const surfaces = defaultApiSurfaces();
  return {
    version: API_SURFACE_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: inputs.phase || API_SURFACE_PHASE,
    status: 'locked',
    policy: { ...API_SURFACE_POLICY },
    summary: summarizeApiSurfaces(surfaces),
    surfaces
  };
}

function buildLifecycleOrderingContract(executionPlan, inputs = {}) {
  const scopes = Array.isArray(executionPlan?.scopes) ? executionPlan.scopes : [];
  const lifecycleLinks = scopes.flatMap((scope) => [
    ...(scope.connect || []).map((handler, index) => ({ scopeId: scope.id, event: 'connect', order: index, handlerId: handler.handlerId || handler.id, name: handler.name })),
    ...(scope.disconnect || []).map((handler, index) => ({ scopeId: scope.id, event: 'disconnect', order: index, handlerId: handler.handlerId || handler.id, name: handler.name }))
  ]);
  return {
    version: LIFECYCLE_ORDERING_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: inputs.phase || API_SURFACE_PHASE,
    status: 'locked',
    policy: {
      defaultOrdering: 'serial-source-order',
      parallelLifecycleExecution: 'reserved-explicit-only',
      hiddenScheduler: false,
      promiseSemantics: false
    },
    summary: {
      scopes: scopes.length,
      lifecycleLinks: lifecycleLinks.length,
      connectHandlers: lifecycleLinks.filter((link) => link.event === 'connect').length,
      disconnectHandlers: lifecycleLinks.filter((link) => link.event === 'disconnect').length,
      serialByDefault: true
    },
    lifecycleLinks
  };
}

module.exports = {
  API_SURFACE_PHASE,
  API_SURFACE_VERSION,
  LIFECYCLE_ORDERING_VERSION,
  API_SURFACE_POLICY,
  API_SURFACE_DEFINITIONS,
  defaultApiSurfaces,
  summarizeApiSurfaces,
  buildApiSurfaceContract,
  buildLifecycleOrderingContract
};
