'use strict';

const {
  CRYPTO_REQUIREMENTS_VERSION,
  CRYPTO_SEMANTIC_OWNER,
  normalizeCryptoRequirements,
  planCryptoRealizations
} = require('@pulse-compute/wasm-contracts/crypto/contracts');

function requirementError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

/**
 * Collect package-owned requirements after reachability is known. Entries not
 * explicitly marked reachable are ignored so installation alone cannot create
 * capability demand.
 */
function collectReachableCryptoRequirements(inputs = []) {
  if (!Array.isArray(inputs)) {
    throw requirementError(
      'PULSE_CRYPTO_REQUIREMENT_COLLECTION_ARRAY_REQUIRED',
      'Package crypto requirement declarations must be an array.'
    );
  }
  const normalizedInputs = [];
  for (const [index, input] of inputs.entries()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw requirementError(
        'PULSE_CRYPTO_REQUIREMENT_COLLECTION_OBJECT_REQUIRED',
        `Package crypto requirement declaration ${index + 1} must be an object.`,
        { index }
      );
    }
    if (input.reachable !== true) continue;
    if (typeof input.requestedBy !== 'string' || input.requestedBy.trim().length === 0) {
      throw requirementError(
        'PULSE_CRYPTO_REQUIREMENT_OWNER_REQUIRED',
        `Reachable package crypto requirement declaration ${index + 1} must identify its owner.`,
        { index }
      );
    }
    if (input.semanticOwner !== undefined && input.semanticOwner !== CRYPTO_SEMANTIC_OWNER) {
      throw requirementError(
        'PULSE_CRYPTO_REQUIREMENT_SEMANTIC_OWNER_INVALID',
        `Reachable package crypto requirement declaration ${index + 1} must name ${CRYPTO_SEMANTIC_OWNER} as semantic owner.`,
        { index, requestedBy: input.requestedBy.trim(), semanticOwner: input.semanticOwner }
      );
    }
    if (!Array.isArray(input.algorithms)) {
      throw requirementError(
        'PULSE_CRYPTO_REQUIREMENT_ALGORITHMS_ARRAY_REQUIRED',
        `Reachable package crypto requirement declaration ${index + 1} must provide an algorithms array.`,
        { index, requestedBy: input.requestedBy.trim() }
      );
    }
    for (const algorithm of input.algorithms) {
      normalizedInputs.push({
        algorithm,
        requestedBy: input.requestedBy.trim(),
        semanticOwner: CRYPTO_SEMANTIC_OWNER
      });
    }
  }
  return normalizeCryptoRequirements(normalizedInputs);
}

function planProjectCrypto(input = {}) {
  const requirements = input.requirements && input.requirements.version === CRYPTO_REQUIREMENTS_VERSION
    ? input.requirements
    : collectReachableCryptoRequirements(input.packageRequirements || []);
  return planCryptoRealizations({
    declaration: input.declaration,
    requirements,
    targetDescriptor: input.targetDescriptor,
    target: input.target,
    profile: input.profile,
    profileSelectionSource: input.profileSelectionSource,
    configurationSource: input.configurationSource
  });
}

module.exports = Object.freeze({
  collectReachableCryptoRequirements,
  planProjectCrypto
});
