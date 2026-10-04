'use strict';

const crypto = require('node:crypto');
const { HANDLER_IR_VERSION } = require('./handler-ir.js');

const CANONICAL_HANDLER_IR_VERSION = HANDLER_IR_VERSION;
const CANONICAL_HANDLER_IR_CONTRACT_ID = 'pulse.canonical-handler-ir';
const payloads = new WeakMap();

class CanonicalHandlerIrError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CanonicalHandlerIrError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CanonicalHandlerIrError('PULSE_CANONICAL_HANDLER_IR_INVALID', `${field} must be a non-empty string.`, { field, value });
  }
  return value;
}

function annotateSites(effectSites, continuationSites, routerMetadata) {
  const routeRanges = routerMetadata && Array.isArray(routerMetadata.routes) ? routerMetadata.routes : [];
  const entryRanges = routerMetadata && Array.isArray(routerMetadata.entries) ? routerMetadata.entries : [];

  function ownerForPosition(position) {
    const offset = position && Number(position.offset);
    if (!Number.isSafeInteger(offset)) return undefined;
    return entryRanges.find((entry) => entry && entry.generatedRange && offset >= entry.generatedRange.start && offset < entry.generatedRange.end)
      || routeRanges.find((route) => route && route.generatedRange && offset >= route.generatedRange.start && offset < route.generatedRange.end);
  }

  function annotate(site) {
    // Package diagnostics retain authored locations, including imported files.
    // Router ownership instead follows the mapped call in generated source.
    const owner = ownerForPosition(site && (site.generatedPosition || site.position));
    if (!owner) return site;
    const ownerKind = owner.kind || 'route';
    const plane = owner.plane || (ownerKind === 'event' ? 'event' : 'http');
    const annotated = {
      ...site,
      applicationEntryStableId: owner.stableId,
      applicationEntryKind: ownerKind,
      applicationEntryPlane: plane,
      applicationEntryIndex: Number.isInteger(owner.index) ? owner.index : undefined
    };
    if (plane === 'http') {
      annotated.routerEntryStableId = owner.stableId;
      annotated.routerEntryKind = ownerKind;
      annotated.routerEntryIndex = Number.isInteger(owner.index) ? owner.index : undefined;
      annotated.routerEntryPath = owner.path || undefined;
    }
    if (ownerKind === 'route') {
      annotated.routeStableId = owner.routeStableId || owner.stableId;
      annotated.routeRuntimeId = Number.isInteger(owner.routeRuntimeId) ? owner.routeRuntimeId : owner.runtimeId;
      annotated.routeMethod = owner.method;
      annotated.routePath = owner.path;
    }
    if (ownerKind === 'event') {
      annotated.eventStableId = owner.eventStableId || owner.stableId;
      annotated.eventRuntimeId = owner.eventRuntimeId;
      annotated.eventType = owner.eventType;
      annotated.eventSchemaId = owner.eventSchemaId;
    }
    return Object.freeze(annotated);
  }

  return Object.freeze({
    effectSites: Object.freeze(effectSites.map(annotate)),
    continuationSites: Object.freeze(continuationSites.map(annotate))
  });
}

function providerOperationsForSites(effectSites, continuationSites) {
  return Object.freeze(effectSites.map((site) => Object.freeze({
    id: site.id,
    kind: site.providerKind || (site.kind === 'fetch' ? 'fetch' : String(site.kind).split('.')[0]),
    operation: site.operation || (site.kind === 'fetch' ? 'dispatch' : undefined),
    capability: site.capability,
    opaqueReturn: (site.kind === 'fetch' && continuationSites.some((continuation) => continuation.kind === 'opaque-fetch-return' && continuation.effectIds.includes(site.id))) || site.result === 'opaque-response',
    resource: site.resource,
    package: site.package,
    contractId: site.contractId,
    payload: site.payload,
    result: site.result,
    position: site.position,
    routeStableId: site.routeStableId,
    routeRuntimeId: site.routeRuntimeId,
    routeMethod: site.routeMethod,
    routePath: site.routePath,
    routerEntryStableId: site.routerEntryStableId,
    routerEntryKind: site.routerEntryKind,
    routerEntryIndex: site.routerEntryIndex,
    routerEntryPath: site.routerEntryPath,
    applicationEntryStableId: site.applicationEntryStableId,
    applicationEntryKind: site.applicationEntryKind,
    applicationEntryPlane: site.applicationEntryPlane,
    applicationEntryIndex: site.applicationEntryIndex,
    eventStableId: site.eventStableId,
    eventRuntimeId: site.eventRuntimeId,
    eventType: site.eventType,
    eventSchemaId: site.eventSchemaId
  })));
}

function packageEffectSummary(packageEffects) {
  return Object.freeze(packageEffects.map((effect) => Object.freeze({
    contractId: effect.contractId,
    package: effect.package,
    import: effect.import,
    kind: effect.kind,
    operation: effect.operation,
    capability: effect.capability,
    result: effect.result,
    placement: effect.placement,
    ...(effect.redaction ? { redaction: effect.redaction } : {}),
    range: effect.range
  })));
}

function createCanonicalHandlerIr(input) {
  if (!input || typeof input !== 'object') {
    throw new CanonicalHandlerIrError('PULSE_CANONICAL_HANDLER_IR_INVALID', 'Canonical Handler IR input must be an object.');
  }
  const frontend = input.frontend;
  const operationIr = input.operationIr;
  if (!frontend || !['canonical-source', 'canonical-router-handler'].includes(frontend.frontend)) {
    throw new CanonicalHandlerIrError('PULSE_CANONICAL_HANDLER_IR_FRONTEND_UNSUPPORTED', 'Canonical Handler IR requires a supported internal handler frontend.', {
      frontend: frontend && frontend.frontend
    });
  }
  if (!operationIr || operationIr.version !== HANDLER_IR_VERSION) {
    throw new CanonicalHandlerIrError('PULSE_CANONICAL_HANDLER_IR_INVALID', `Canonical Handler IR requires ${HANDLER_IR_VERSION}.`, { version: operationIr && operationIr.version });
  }

  const compilerVersion = requireString(input.compilerVersion, 'compilerVersion');
  const programVersion = requireString(input.programVersion, 'programVersion');
  const runtimeProtocolVersion = requireString(input.runtimeProtocolVersion, 'runtimeProtocolVersion');
  const options = input.options || {};
  const sourceText = frontend.sourceText;
  const authoringSourceText = options.authoringSourceText === undefined ? sourceText : String(options.authoringSourceText);
  const loweredSourceText = options.loweredSourceText === undefined ? sourceText : String(options.loweredSourceText);
  const schemaBundle = frontend.schemaBundle || Object.freeze({
    registry: Object.freeze([]),
    schemaIds: Object.freeze([]),
    sourceHash: stableHash(`empty-schema:${frontend.fileName || ''}`)
  });
  const packageEffectsInput = Object.freeze([...(options.packageEffects || [])]);
  const packageEffects = packageEffectSummary(packageEffectsInput);
  const packageIntrinsicsInput = Object.freeze([...(options.packageIntrinsics || [])]);
  const metadataExtensions = options.metadataExtensions && typeof options.metadataExtensions === 'object' ? options.metadataExtensions : {};
  const compilerOwnedIntrinsics = Object.freeze([...(options.compilerOwnedIntrinsics || packageIntrinsicsInput)].map((entry) => Object.freeze({
    compilerName: String(entry.compilerName),
    intrinsic: String(entry.intrinsic),
    valueKind: String(entry.valueKind || 'unknown')
  })));
  const compilerOwnedCalls = Object.freeze([...new Set([
    ...(options.compilerOwnedCalls || []).map(String),
    ...compilerOwnedIntrinsics.map((entry) => entry.compilerName)
  ])]);
  const compilerPrelude = options.compilerPrelude || '';
  const routerMetadata = options.routerMetadata || metadataExtensions.router;
  const applicationEntries = metadataExtensions.applicationEntries
    || routerMetadata && routerMetadata.applicationEntries;
  const events = metadataExtensions.events || routerMetadata && routerMetadata.events;
  const annotated = annotateSites(operationIr.effectSites, operationIr.continuationSites, metadataExtensions.router);
  const capabilities = Object.freeze([...new Set([
    ...operationIr.analysis.capabilities,
    ...annotated.effectSites.map((site) => site.capability)
  ])].sort());
  const providerOperations = providerOperationsForSites(annotated.effectSites, annotated.continuationSites);
  const warnings = Object.freeze([...(frontend.warnings || []), ...(metadataExtensions.warnings || [])]);
  const genericRequestCount = Number(operationIr.analysis.genericJsonCount || 0);
  const schemaBoundRequestCount = Number(operationIr.analysis.schemaBoundJsonCount || 0);
  const jsonPolicy = options.emitJsonPolicy === true || genericRequestCount > 0 || schemaBoundRequestCount > 0 || metadataExtensions.json
    ? Object.freeze({
        strict: options.strict !== false,
        schemaBoundRequestCount,
        genericRequestCount,
        genericParserRequired: genericRequestCount > 0,
        maxBytes: Number(schemaBundle.registry && schemaBundle.registry.maxBytes || 65536),
        ...(metadataExtensions.json || {})
      })
    : undefined;
  const userAuthoredAsync = Boolean(
    (frontend.normalization && frontend.normalization.userAuthoredAsync)
    || metadataExtensions.userAuthoredAsync
  );

  const ir = Object.freeze({
    version: CANONICAL_HANDLER_IR_VERSION,
    contractId: CANONICAL_HANDLER_IR_CONTRACT_ID,
    kind: operationIr.kind || 'plain-handler',
    frontend: frontend.frontend,
    compilerVersion,
    programVersion,
    runtimeProtocolVersion,
    file: frontend.fileName,
    sourceHash: stableHash(authoringSourceText),
    loweredSourceHash: stableHash(loweredSourceText),
    projectSourceHash: stableHash(`${authoringSourceText}\n${loweredSourceText}\n${schemaBundle.sourceHash}\n${JSON.stringify(packageEffectsInput)}\n${JSON.stringify(packageIntrinsicsInput)}`),
    handler: Object.freeze({ ...(options.handlerMetadata || { id: 'default', ctxParameter: operationIr.ctxName }) }),
    capabilities,
    providerOperations,
    effectSites: annotated.effectSites,
    continuationSites: annotated.continuationSites,
    schema: Object.freeze({
      registry: schemaBundle.registry,
      ids: schemaBundle.schemaIds,
      declaredIds: schemaBundle.declaredSchemaIds || schemaBundle.schemaIds,
      deferredIds: schemaBundle.deferredSchemaIds || Object.freeze([]),
      registryIrVersion: schemaBundle.registryIrVersion,
      registryHash: schemaBundle.registryHash,
      codecTableHash: schemaBundle.codecTableHash,
      responseCaseIds: schemaBundle.responseCaseIds || Object.freeze([]),
      fullCodecRealization: schemaBundle.fullCodecRealization !== false,
      sourceHash: schemaBundle.sourceHash
    }),
    schemaReferences: operationIr.analysis.schemaReferences,
    ...(jsonPolicy ? { json: jsonPolicy } : {}),
    packageEffects,
    ...(warnings.length > 0 ? { warnings } : {}),
    authoring: metadataExtensions.authoring,
    ...(metadataExtensions.application ? { application: metadataExtensions.application } : {}),
    ...(applicationEntries ? { applicationEntries } : {}),
    ...(events ? { events } : {}),
    router: routerMetadata,
    compilerOwnedCalls,
    compilerOwnedIntrinsics,
    compilerPreludeHash: options.compilerPrelude ? stableHash(options.compilerPrelude) : undefined,
    invariants: Object.freeze({
      userAuthoredAsync,
      promiseSemantics: false,
      asyncify: false
    }),
    operationSummary: operationIr.summary,
    surfaceSummary: Object.freeze({
      recognition: input.surfaceFacts && input.surfaceFacts.recognition && input.surfaceFacts.recognition.summary,
      classification: input.surfaceFacts && input.surfaceFacts.classification && input.surfaceFacts.classification.summary,
      normalization: input.surfaceFacts && input.surfaceFacts.normalization,
      validation: input.surfaceFacts && input.surfaceFacts.validation
    })
  });

  payloads.set(ir, Object.freeze({
    sourceFile: frontend.sourceFile,
    sourceText,
    loweredSourceText,
    authoringSourceText,
    schemaBundle,
    compilerPrelude,
    operationIr,
    packageEffectsInput,
    packageIntrinsicsInput,
    surfaceFacts: input.surfaceFacts
  }));
  return ir;
}

function assertCanonicalHandlerIr(value) {
  if (!value || value.version !== CANONICAL_HANDLER_IR_VERSION || value.contractId !== CANONICAL_HANDLER_IR_CONTRACT_ID || !payloads.has(value)) {
    throw new CanonicalHandlerIrError('PULSE_CANONICAL_HANDLER_IR_INVALID', 'Expected an internally created canonical Handler IR value.', {
      version: value && value.version,
      contractId: value && value.contractId
    });
  }
  return value;
}

function payloadForCanonicalHandlerIr(value) {
  const ir = assertCanonicalHandlerIr(value);
  return payloads.get(ir);
}


function definedSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(definedSnapshot));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = definedSnapshot(entry);
  }
  return Object.freeze(out);
}

function canonicalHandlerIrSnapshot(value) {
  const ir = assertCanonicalHandlerIr(value);
  return definedSnapshot({
    version: ir.version,
    contractId: ir.contractId,
    kind: ir.kind,
    frontend: ir.frontend,
    compilerVersion: ir.compilerVersion,
    programVersion: ir.programVersion,
    runtimeProtocolVersion: ir.runtimeProtocolVersion,
    file: ir.file,
    sourceHash: ir.sourceHash,
    loweredSourceHash: ir.loweredSourceHash,
    projectSourceHash: ir.projectSourceHash,
    handler: ir.handler,
    capabilities: ir.capabilities,
    providerOperations: ir.providerOperations,
    effectSites: ir.effectSites,
    continuationSites: ir.continuationSites,
    schema: ir.schema,
    schemaReferences: ir.schemaReferences,
    json: ir.json,
    packageEffects: ir.packageEffects,
    warnings: ir.warnings,
    authoring: ir.authoring,
    application: ir.application,
    router: ir.router,
    compilerOwnedCalls: ir.compilerOwnedCalls,
    compilerOwnedIntrinsics: ir.compilerOwnedIntrinsics,
    compilerPreludeHash: ir.compilerPreludeHash,
    invariants: ir.invariants,
    operationSummary: ir.operationSummary,
    surfaceSummary: ir.surfaceSummary
  });
}

module.exports = Object.freeze({
  CANONICAL_HANDLER_IR_VERSION,
  CANONICAL_HANDLER_IR_CONTRACT_ID,
  CanonicalHandlerIrError,
  createCanonicalHandlerIr,
  assertCanonicalHandlerIr,
  payloadForCanonicalHandlerIr,
  canonicalHandlerIrSnapshot
});
