'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');
const {
  ENTITIES_CATALOG_VERSION,
  ENTITIES_CONTRACT_ID,
  ENTITIES_DEFAULT_LIMITS,
  ENTITIES_DIAGNOSTIC_CODES,
  entitiesContractError,
  normalizeDiscriminator,
  normalizeSchemaId,
  normalizeStaticMetadata,
  utf8ByteLength
} = require('./contracts.js');

const ENTITIES_CATALOG_TARGETS = Object.freeze([
  'fastly-javascript',
  'fastly-native',
  'node-javascript',
  'node-native'
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeEligibility(input = {}) {
  if (!plainObject(input)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Catalog eligibility must be an object.');
  const unknown = Object.keys(input).filter((key) => !ENTITIES_CATALOG_TARGETS.includes(key)).sort();
  if (unknown.length > 0) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Catalog eligibility contains unknown targets: ${unknown.join(', ')}.`);
  return Object.freeze(Object.fromEntries(ENTITIES_CATALOG_TARGETS.map((target) => {
    const value = input[target];
    if (value !== undefined && typeof value !== 'boolean') throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Eligibility for ${target} must be boolean.`);
    return [target, value === true];
  })));
}

function normalizeEntityCatalog(input) {
  if (!plainObject(input) || input.version !== ENTITIES_CATALOG_VERSION || input.contractId !== ENTITIES_CONTRACT_ID || !Array.isArray(input.routers)) {
    throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Entity catalog requires ${ENTITIES_CATALOG_VERSION}.`);
  }
  const routerIds = new Set();
  const routers = input.routers.map((router) => {
    if (!plainObject(router)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Catalog router must be an object.');
    const id = String(router.id || '');
    if (!id || routerIds.has(id) || router.adapter !== 'json-rpc' || router.binding !== 'request' || !Array.isArray(router.entities)) {
      throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, `Catalog router ${id || '<missing>'} is invalid.`);
    }
    routerIds.add(id);
    if (router.entities.length > ENTITIES_DEFAULT_LIMITS.maxEntities) {
      throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `Catalog router ${id} exceeds its entity limit.`);
    }
    const names = new Set();
    const entities = router.entities.map((entity) => {
      if (!plainObject(entity)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'Catalog entity must be an object.');
      const name = normalizeDiscriminator(entity.name);
      if (names.has(name)) throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_DUPLICATE, `Catalog repeats entity ${name}.`);
      names.add(name);
      return Object.freeze({
        name,
        inputSchema: normalizeSchemaId(entity.inputSchema, 'catalog.inputSchema'),
        outputSchema: normalizeSchemaId(entity.outputSchema, 'catalog.outputSchema'),
        ...(entity.metadata === undefined ? {} : { metadata: normalizeStaticMetadata(entity.metadata) }),
        eligibility: normalizeEligibility(entity.eligibility)
      });
    }).sort((left, right) => compareText(left.name, right.name));
    const metadataBytes = entities.reduce((sum, entity) => sum + (entity.metadata ? utf8ByteLength(stableStringify(entity.metadata)) : 0), 0);
    if (metadataBytes > ENTITIES_DEFAULT_LIMITS.maxMetadataBytesPerRouter) {
      throw entitiesContractError(ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `Catalog router ${id} exceeds its metadata limit.`);
    }
    return Object.freeze({ id, adapter: 'json-rpc', binding: 'request', entities: Object.freeze(entities) });
  }).sort((left, right) => compareText(left.id, right.id));
  const normalized = Object.freeze({ version: ENTITIES_CATALOG_VERSION, contractId: ENTITIES_CONTRACT_ID, routers: Object.freeze(routers) });
  return Object.freeze({ ...normalized, catalogHash: sha256Hex(stableStringify(normalized)) });
}

module.exports = Object.freeze({
  ENTITIES_CATALOG_TARGETS,
  normalizeEligibility,
  normalizeEntityCatalog
});
