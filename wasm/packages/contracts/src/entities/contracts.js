'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');
const { PACKAGE_INTRINSIC_VERSION } = require('../package/package-contract.js');
const runtime = require('./runtime.js');

const ENTITIES_PACKAGE_VERSION = 'pulse.entities-package.v1';
const ENTITIES_CONTRACT_VERSION = 'pulse.entities-contract.v1';
const ENTITIES_PLAN_VERSION = 'pulse.entities-lowering-plan.v1';
const ENTITIES_CATALOG_VERSION = 'pulse.entities-catalog.v1';
const ENTITIES_DIAGNOSTIC_VERSION = 'pulse.entities-diagnostics.v1';
const ENTITIES_HANDLER_REFERENCE_VERSION = 'pulse.entities-handler-reference.v1';
const ENTITIES_REGISTRY_VERSION = 'pulse.entities-registry.v1';
const ENTITIES_CONTRACT_ID = 'pulse.entities';
const ENTITIES_PACKAGE_NAME = '@pulse-compute/entities';
const ENTITIES_LOWERER_ID = 'pulse.entities.compiler-builder.v1';
const ENTITIES_LOWERER_EXPORT = 'createEntitiesPackageCompilerBuilder';
const ENTITIES_LOWERER_MANIFEST = './pulsewasm.manifest.cjs';
const ENTITIES_LOWERABLE_SUBPATH = '@pulse-compute/entities';
const ENTITIES_PACKAGE_INTRINSIC_VERSION = PACKAGE_INTRINSIC_VERSION;
const ENTITIES_PUBLIC_SYMBOLS = Object.freeze(['EntityRouter', 'jsonRpc']);
const ENTITIES_PACKAGE_INTRINSICS = Object.freeze({
  handle: Object.freeze({
    name: 'pulse.entities.handle.v1',
    compilerName: '__pulse_entities_handle',
    valueKind: 'response',
    argumentIndexes: Object.freeze([0])
  })
});
const ROUTER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function normalizeHandlerReference(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.HANDLER_UNRESOLVED, 'Entity handler reference must be an object.');
  }
  const unknown = Object.keys(input).filter((key) => !['version', 'file', 'exportName', 'localName'].includes(key)).sort();
  if (unknown.length > 0) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.HANDLER_UNRESOLVED, `Entity handler reference contains unsupported fields: ${unknown.join(', ')}.`);
  const version = input.version === undefined ? ENTITIES_HANDLER_REFERENCE_VERSION : String(input.version);
  const file = typeof input.file === 'string' ? input.file.replace(/\\/g, '/') : '';
  const exportName = typeof input.exportName === 'string' ? input.exportName : '';
  const localName = input.localName === undefined ? exportName : String(input.localName);
  if (version !== ENTITIES_HANDLER_REFERENCE_VERSION || !file || file.startsWith('/') || file.split('/').includes('..') || !exportName || !localName) {
    throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.HANDLER_UNRESOLVED, 'Entity handler reference must use a portable file and named export.', { version, file, exportName, localName });
  }
  return Object.freeze({ version, file, exportName, localName });
}

function normalizeEntityRegistry(entriesInput, limitsInput = runtime.ENTITIES_DEFAULT_LIMITS) {
  const limits = limitsInput === runtime.ENTITIES_DEFAULT_LIMITS ? limitsInput : runtime.normalizeEntityLimits(limitsInput);
  if (!Array.isArray(entriesInput)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Entity registry entries must be an array.');
  if (entriesInput.length > limits.maxEntities) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, 'Entity registry exceeds its entity limit.', { count: entriesInput.length, maxEntities: limits.maxEntities });
  const seen = new Set();
  const entries = entriesInput.map((entry) => {
    const normalized = runtime.normalizeEntityRegistration(entry, limits);
    if (seen.has(normalized.discriminator)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_DUPLICATE, `Entity discriminator ${JSON.stringify(normalized.discriminator)} is already registered.`, { discriminator: normalized.discriminator });
    seen.add(normalized.discriminator);
    return normalized;
  }).sort((left, right) => runtime.compareText(left.discriminator, right.discriminator));
  const metadataBytes = entries.reduce((sum, entry) => sum + (entry.declaration.metadata ? runtime.utf8ByteLength(stableStringify(entry.declaration.metadata)) : 0), 0);
  if (metadataBytes > limits.maxMetadataBytesPerRouter) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, 'Entity router metadata exceeds its aggregate byte limit.', { metadataBytes, maxBytes: limits.maxMetadataBytesPerRouter });
  const semantic = entries.map((entry) => ({ discriminator: entry.discriminator, input: entry.declaration.input, output: entry.declaration.output, metadata: entry.declaration.metadata, handler: entry.handler.name }));
  return Object.freeze({ version: ENTITIES_REGISTRY_VERSION, entries: Object.freeze(entries), registryHash: sha256Hex(stableStringify(semantic)), limits });
}

function normalizeEntityPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== ENTITIES_PLAN_VERSION || input.contractId !== ENTITIES_CONTRACT_ID || !Array.isArray(input.routers)) {
    throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Entity plan requires ${ENTITIES_PLAN_VERSION} and ${ENTITIES_CONTRACT_ID}.`);
  }
  const unknownPlan = Object.keys(input).filter((key) => !['version', 'contractId', 'routers'].includes(key)).sort();
  if (unknownPlan.length > 0) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Entity plan contains unsupported fields: ${unknownPlan.join(', ')}.`);
  const routerIds = new Set();
  const routers = input.routers.map((router, routerIndex) => {
    if (!router || typeof router !== 'object' || Array.isArray(router)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `routers[${routerIndex}] must be an object.`);
    const unknownRouter = Object.keys(router).filter((key) => !['id', 'adapter', 'binding', 'entities'].includes(key)).sort();
    if (unknownRouter.length > 0) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `routers[${routerIndex}] contains unsupported fields: ${unknownRouter.join(', ')}.`);
    const id = String(router.id || '');
    if (!ROUTER_ID_PATTERN.test(id) || routerIds.has(id)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Entity router ID is invalid or duplicated: ${id}.`, { id });
    routerIds.add(id);
    if (!router.binding || router.binding.kind !== 'request') throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'Entity plan binding must be request.');
    const adapter = runtime.normalizeAdapter(router.adapter);
    if (!Array.isArray(router.entities)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `routers[${routerIndex}].entities must be an array.`);
    if (router.entities.length > runtime.ENTITIES_DEFAULT_LIMITS.maxEntities) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `Entity plan router ${id} exceeds its entity limit.`);
    const discriminators = new Set();
    const entities = router.entities.map((entity, entityIndex) => {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `routers[${routerIndex}].entities[${entityIndex}] must be an object.`);
      const unknown = Object.keys(entity).filter((key) => !['discriminator', 'inputSchema', 'outputSchema', 'handler', 'metadata'].includes(key)).sort();
      if (unknown.length > 0) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Entity contains unsupported fields: ${unknown.join(', ')}.`);
      const discriminator = runtime.normalizeDiscriminator(entity.discriminator);
      if (discriminators.has(discriminator)) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_DUPLICATE, `Duplicate entity ${discriminator}.`, { discriminator });
      discriminators.add(discriminator);
      return Object.freeze({ discriminator, inputSchema: runtime.normalizeSchemaId(entity.inputSchema, 'inputSchema'), outputSchema: runtime.normalizeSchemaId(entity.outputSchema, 'outputSchema'), handler: normalizeHandlerReference(entity.handler), ...(entity.metadata === undefined ? {} : { metadata: runtime.normalizeStaticMetadata(entity.metadata) }) });
    }).sort((left, right) => runtime.compareText(left.discriminator, right.discriminator));
    const metadataBytes = entities.reduce((sum, entity) => sum + (entity.metadata ? runtime.utf8ByteLength(stableStringify(entity.metadata)) : 0), 0);
    if (metadataBytes > runtime.ENTITIES_DEFAULT_LIMITS.maxMetadataBytesPerRouter) throw runtime.entitiesContractError(runtime.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `Entity plan router ${id} exceeds its metadata limit.`);
    return Object.freeze({ id, adapter, binding: Object.freeze({ kind: 'request' }), entities: Object.freeze(entities) });
  }).sort((left, right) => runtime.compareText(left.id, right.id));
  const normalized = Object.freeze({ version: ENTITIES_PLAN_VERSION, contractId: ENTITIES_CONTRACT_ID, routers: Object.freeze(routers) });
  return Object.freeze({ ...normalized, planHash: sha256Hex(stableStringify(normalized)) });
}

module.exports = Object.freeze({
  ...runtime,
  ENTITIES_PACKAGE_VERSION,
  ENTITIES_CONTRACT_VERSION,
  ENTITIES_PLAN_VERSION,
  ENTITIES_CATALOG_VERSION,
  ENTITIES_DIAGNOSTIC_VERSION,
  ENTITIES_HANDLER_REFERENCE_VERSION,
  ENTITIES_REGISTRY_VERSION,
  ENTITIES_CONTRACT_ID,
  ENTITIES_PACKAGE_NAME,
  ENTITIES_LOWERER_ID,
  ENTITIES_LOWERER_EXPORT,
  ENTITIES_LOWERER_MANIFEST,
  ENTITIES_LOWERABLE_SUBPATH,
  ENTITIES_PACKAGE_INTRINSIC_VERSION,
  ENTITIES_PUBLIC_SYMBOLS,
  ENTITIES_PACKAGE_INTRINSICS,
  normalizeHandlerReference,
  normalizeEntityRegistry,
  normalizeEntityPlan
});
