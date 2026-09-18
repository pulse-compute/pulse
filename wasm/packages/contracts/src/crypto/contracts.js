'use strict';

const { stableStringify, sha256Hex } = require('../stable-id.js');

const CRYPTO_CONFIGURATION_VERSION = 'pulse.crypto-configuration.v1';
const CRYPTO_TARGET_CAPABILITIES_VERSION = 'pulse.crypto-target-capabilities.v1';
const CRYPTO_REQUIREMENTS_VERSION = 'pulse.crypto-requirements.v1';
const CRYPTO_REALIZATION_PLAN_VERSION = 'pulse.crypto-realization-plan.v1';
const CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION = 'pulse.crypto-native-guest-source-plan.v1';
const CRYPTO_SEMANTIC_OWNER = '@pulse-compute/crypto';
const CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION = 'webcrypto.subtle.hmac-sha-256.v1';
const CRYPTO_GUEST_SOURCE_IMPLEMENTATION = 'pulse-hmac-as.v1';
const CRYPTO_ES256_CONTRACT_VERSION = 'pulse.crypto.es256-verification.v1';
const CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION = 'webcrypto.subtle.ecdsa-p256-sha-256.v1';
const CRYPTO_ES256_GUEST_LINKED_REALIZATION = 'guest-linked:pulse-es256-rustcrypto-p256';
const CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION =
  'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1';
const CRYPTO_VERIFICATION_STATUSES = Object.freeze([
  'valid',
  'invalid-authenticator',
  'invalid-key',
  'invalid-input',
  'realization-failure'
]);

const CRYPTO_RS256_RUNTIME_BUILTIN_IMPLEMENTATION = 'webcrypto.subtle.rsassa-pkcs1-v1_5-sha-256.v1';
const CRYPTO_RS256_GUEST_LINKED_REALIZATION = 'guest-linked:pulse-rs256-bearssl-i31';
const CRYPTO_RS256_GUEST_LINKED_IMPLEMENTATION = 'bearssl.0.6.rsa-i31.sha256.v1';
const CRYPTO_ALGORITHMS = Object.freeze(['HS256', 'ES256', 'RS256', 'SHA-256', 'HMAC-SHA256']);
const CRYPTO_REALIZATIONS = Object.freeze([
  { id: 'runtime-builtin', kind: 'runtime-builtin', algorithm: 'RS256', targets: ['javascript'], implementation: CRYPTO_RS256_RUNTIME_BUILTIN_IMPLEMENTATION },
  { id: CRYPTO_RS256_GUEST_LINKED_REALIZATION, kind: 'guest-linked', algorithm: 'RS256', targets: ['native'],
    backend: 'pulse-rs256-bearssl-i31', implementation: CRYPTO_RS256_GUEST_LINKED_IMPLEMENTATION,
    source: { package: '@pulse-compute/crypto', export: './pulsewasm-native', contractVersion: 'pulse.guest-unit-contribution.v1', contribution: 'pulseEs256GuestUnit' } },
  ...['SHA-256', 'HMAC-SHA256'].map((algorithm) => Object.freeze({
    id: 'runtime-builtin', kind: 'runtime-builtin', algorithm, targets: Object.freeze(['javascript']),
    implementation: algorithm === 'SHA-256' ? 'webcrypto.subtle.sha-256-bytes.v1' : 'webcrypto.subtle.hmac-sha-256-bytes.v1'
  })),
  ...['SHA-256', 'HMAC-SHA256'].map((algorithm) => Object.freeze({
    id: 'guest-source:pulse-hmac-as', kind: 'guest-source', backend: 'pulse-hmac-as',
    implementation: CRYPTO_GUEST_SOURCE_IMPLEMENTATION, algorithm, targets: Object.freeze(['native']),
    source: Object.freeze({ package: '@pulse-compute/crypto', export: './pulsewasm-native',
      contractVersion: 'pulse.crypto-guest-source.v1', contribution: 'pulse-hmac-as' })
  })),
  Object.freeze({
    id: 'runtime-builtin',
    kind: 'runtime-builtin',
    implementation: CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
    algorithm: 'HS256',
    targets: Object.freeze(['javascript'])
  }),
  Object.freeze({
    id: 'guest-source:pulse-hmac-as',
    kind: 'guest-source',
    backend: 'pulse-hmac-as',
    implementation: CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
    algorithm: 'HS256',
    targets: Object.freeze(['native']),
    source: Object.freeze({
      package: '@pulse-compute/crypto',
      export: './pulsewasm-native',
      contractVersion: 'pulse.crypto-guest-source.v1',
      contribution: 'pulse-hmac-as'
    })
  }),
  Object.freeze({
    id: 'runtime-builtin',
    kind: 'runtime-builtin',
    implementation: CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
    algorithm: 'ES256',
    targets: Object.freeze(['javascript'])
  }),
  Object.freeze({
    id: CRYPTO_ES256_GUEST_LINKED_REALIZATION,
    kind: 'guest-linked',
    backend: 'pulse-es256-rustcrypto-p256',
    implementation: CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
    algorithm: 'ES256',
    targets: Object.freeze(['native']),
    source: Object.freeze({
      package: '@pulse-compute/crypto',
      export: './pulsewasm-native',
      contractVersion: 'pulse.guest-unit-contribution.v1',
      contribution: 'pulseEs256GuestUnit'
    })
  })
]);

const algorithmSet = new Set(CRYPTO_ALGORITHMS);
const realizationsById = new Map();
for (const entry of CRYPTO_REALIZATIONS) {
  const records = realizationsById.get(entry.id) || [];
  records.push(entry);
  realizationsById.set(entry.id, records);
}

function cryptoError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }
  return value;
}

const CRYPTO_ES256_CONTRACT = deepFreeze({
  version: CRYPTO_ES256_CONTRACT_VERSION,
  status: 'executable-g3',
  semanticOwner: CRYPTO_SEMANTIC_OWNER,
  algorithm: 'ES256',
  primitive: {
    kind: 'ecdsa',
    curve: 'P-256',
    hash: 'SHA-256'
  },
  operation: 'verify',
  request: {
    function: 'crypto.signature.verify',
    keyType: 'p256-public-key-bytes',
    publicKeyEncoding: 'raw-x-y-big-endian',
    publicKeyBytes: 64,
    dataBytesMaximum: 16340,
    signatureEncoding: 'jose-r-s-big-endian',
    signatureBytes: 64,
    derAccepted: false
  },
  runtimeBuiltin: {
    realization: 'runtime-builtin',
    implementation: CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
    eligibleTargets: ['node-javascript', 'fastly-javascript']
  },
  native: {
    realization: CRYPTO_ES256_GUEST_LINKED_REALIZATION,
    implementation: CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
    eligibleTargets: ['node-native', 'fastly-native']
  },
  guest: {
    unitVersion: 'pulse.guest-unit.v2',
    unitId: 'pulse.crypto.es256.rustcrypto-p256.v1',
    module: 'pulse_crypto_es256',
    owner: '@pulse-compute/crypto',
    abi: 'pulse.crypto.es256-rs256.verify-and-sign.v3',
    export: {
      name: 'pulse_crypto_es256_verify',
      parameters: ['i32', 'i32'],
      results: ['i32']
    },
    origin: 'package-prebuilt',
    sourceBuildDuringApplicationBuild: false,
    memory: {
      identity: 'pulse.guest-memory.invocation-frame.v2',
      import: 'env.memory',
      minimumPages: 32,
      maximumPages: 32,
      growable: false
    },
    start: 'forbidden',
    hostCallbacks: false,
    allocator: false
  },
  frame: {
    identity: 'pulse.crypto.es256.invocation-frame.v2',
    byteOrder: 'little-endian',
    pointerWidthBits: 32,
    magic: 0x32534550,
    version: 2,
    headerBytes: 64,
    capacityBytes: 16640,
    alignmentBytes: 16,
    signingInputBytesMaximum: 16340,
    publicKeyBytes: 64,
    signatureBytes: 64,
    rawPayloadBytesMaximum: 16468,
    reservedHeaderAndAlignmentBytes: 172,
    canonicalOffsets: {
      publicKey: 64,
      signature: 128,
      signingInput: 192
    },
    header: {
      magic: 0,
      version: 4,
      headerLength: 8,
      totalLength: 12,
      algorithm: 16,
      flags: 20,
      signingInputOffset: 24,
      signingInputLength: 28,
      publicKeyOffset: 32,
      publicKeyLength: 36,
      signatureOffset: 40,
      signatureLength: 44,
      reserved0: 48,
      reserved1: 52,
      reserved2: 56,
      reserved3: 60
    },
    algorithmCode: 1,
    flags: 0,
    reservedWordCount: 4,
    reservedWordValue: 0,
    callerOwned: true,
    synchronous: true,
    retainable: false,
    clearCapacityAfterReturnOrTrap: true
  },
  resultStatuses: CRYPTO_VERIFICATION_STATUSES,
  resultCodes: {
    valid: 1,
    invalidAuthenticator: 0,
    invalidKey: -1,
    invalidInput: -2,
    realizationFailure: -3
  },
  automaticFallback: false
});

function requireAlgorithm(value, location) {
  if (typeof value !== 'string' || !algorithmSet.has(value)) {
    throw cryptoError(
      'PULSE_CRYPTO_ALGORITHM_UNKNOWN',
      `${location} must be a known canonical crypto algorithm.`,
      { location, algorithm: value, supportedAlgorithms: CRYPTO_ALGORITHMS }
    );
  }
  return value;
}

function requireKnownRealization(value, location) {
  if (typeof value !== 'string' || !realizationsById.has(value)) {
    throw cryptoError(
      'PULSE_CRYPTO_REALIZATION_UNKNOWN',
      `${location} must name an exact known crypto realization.`,
      {
        location,
        realization: value,
        knownRealizations: CRYPTO_REALIZATIONS.map((entry) => entry.id)
      }
    );
  }
  return value;
}

function knownRealization(realization, algorithm, target) {
  const records = realizationsById.get(realization) || [];
  return records.find((entry) => (
    entry.algorithm === algorithm
    && (target === undefined || entry.targets.includes(target))
  ));
}

function canonicalConfiguration(form, algorithms) {
  return deepFreeze({
    version: CRYPTO_CONFIGURATION_VERSION,
    form,
    algorithms: algorithms
      .map((entry) => ({ algorithm: entry.algorithm, realization: entry.realization || null }))
      .sort((left, right) => left.algorithm.localeCompare(right.algorithm))
  });
}

function normalizeCryptoConfiguration(value, options = {}) {
  const location = options.location || 'crypto';
  if (Array.isArray(value)) {
    const seen = new Set();
    const algorithms = value.map((entry, index) => {
      const algorithm = requireAlgorithm(entry, `${location}[${index}]`);
      if (seen.has(algorithm)) {
        throw cryptoError(
          'PULSE_CRYPTO_ALGORITHM_DUPLICATE',
          `${location} contains duplicate algorithm ${algorithm}.`,
          { location, algorithm }
        );
      }
      seen.add(algorithm);
      return { algorithm, realization: null };
    });
    return canonicalConfiguration('array', algorithms);
  }
  if (isPlainObject(value)) {
    const algorithms = Object.keys(value).map((algorithm) => {
      requireAlgorithm(algorithm, `${location}.${algorithm}`);
      const selection = value[algorithm];
      if (!isPlainObject(selection)) {
        throw cryptoError(
          'PULSE_CRYPTO_REALIZATION_SELECTION_OBJECT_REQUIRED',
          `${location}.${algorithm} must be an object.`,
          { location: `${location}.${algorithm}`, valueType: Array.isArray(selection) ? 'array' : typeof selection }
        );
      }
      const keys = Object.keys(selection);
      const unsupported = keys.filter((key) => key !== 'realization').sort();
      if (unsupported.length > 0) {
        throw cryptoError(
          'PULSE_CRYPTO_REALIZATION_SELECTION_KEY_UNSUPPORTED',
          `${location}.${algorithm} contains unsupported selection keys.`,
          { location: `${location}.${algorithm}`, keys: unsupported, allowed: Object.freeze(['realization']) }
        );
      }
      if (Object.prototype.hasOwnProperty.call(selection, 'realization') && selection.realization === undefined) {
        throw cryptoError(
          'PULSE_CRYPTO_REALIZATION_UNKNOWN',
          `${location}.${algorithm}.realization must name an exact known crypto realization.`,
          { location: `${location}.${algorithm}.realization`, realization: selection.realization }
        );
      }
      return {
        algorithm,
        realization: Object.prototype.hasOwnProperty.call(selection, 'realization')
          ? requireKnownRealization(selection.realization, `${location}.${algorithm}.realization`)
          : null
      };
    });
    return canonicalConfiguration('object', algorithms);
  }
  throw cryptoError(
    'PULSE_CRYPTO_CONFIG_SHAPE_INVALID',
    `${location} must use the array or object form.`,
    { location, valueType: value === null ? 'null' : typeof value }
  );
}

function emptyCryptoConfiguration() {
  return canonicalConfiguration('implicit', []);
}

function normalizeCryptoConfigurationDocument(value) {
  if (!isPlainObject(value) || value.version !== CRYPTO_CONFIGURATION_VERSION) {
    throw cryptoError('PULSE_CRYPTO_CONFIG_SHAPE_INVALID', 'Crypto configuration document is invalid.');
  }
  if (!['array', 'object', 'implicit'].includes(value.form) || !Array.isArray(value.algorithms)) {
    throw cryptoError('PULSE_CRYPTO_CONFIG_SHAPE_INVALID', 'Crypto configuration document has an invalid canonical shape.');
  }
  const seen = new Set();
  const algorithms = value.algorithms.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw cryptoError('PULSE_CRYPTO_CONFIG_SHAPE_INVALID', 'Crypto configuration algorithm entries must be objects.', { index });
    }
    const algorithm = requireAlgorithm(entry.algorithm, `crypto configuration.algorithms[${index}].algorithm`);
    if (seen.has(algorithm)) {
      throw cryptoError('PULSE_CRYPTO_ALGORITHM_DUPLICATE', `Crypto configuration contains duplicate algorithm ${algorithm}.`, { algorithm });
    }
    seen.add(algorithm);
    return {
      algorithm,
      realization: entry.realization === null
        ? null
        : requireKnownRealization(entry.realization, `crypto configuration.algorithms[${index}].realization`)
    };
  });
  return canonicalConfiguration(value.form, algorithms);
}

function normalizeCryptoRequirements(inputs = []) {
  if (!Array.isArray(inputs)) {
    throw cryptoError('PULSE_CRYPTO_REQUIREMENTS_ARRAY_REQUIRED', 'Crypto requirements must be an array.');
  }
  const requestedByAlgorithm = new Map();
  for (const [index, input] of inputs.entries()) {
    if (!isPlainObject(input)) {
      throw cryptoError(
        'PULSE_CRYPTO_REQUIREMENT_OBJECT_REQUIRED',
        `Crypto requirement ${index + 1} must be an object.`,
        { index }
      );
    }
    const algorithm = requireAlgorithm(input.algorithm, `crypto requirements[${index}].algorithm`);
    if (
      input.semanticOwner !== undefined
      && (
        typeof input.semanticOwner !== 'string'
        || input.semanticOwner.trim() !== CRYPTO_SEMANTIC_OWNER
      )
    ) {
      throw cryptoError(
        'PULSE_CRYPTO_REQUIREMENT_SEMANTIC_OWNER_INVALID',
        `Crypto requirement ${index + 1} must name ${CRYPTO_SEMANTIC_OWNER} as semantic owner.`,
        { index, algorithm, semanticOwner: input.semanticOwner }
      );
    }
    if (typeof input.requestedBy !== 'string' || input.requestedBy.trim().length === 0) {
      throw cryptoError(
        'PULSE_CRYPTO_REQUIREMENT_OWNER_REQUIRED',
        `Crypto requirement ${index + 1} must identify its requesting package.`,
        { index, algorithm }
      );
    }
    const owners = requestedByAlgorithm.get(algorithm) || new Set();
    owners.add(input.requestedBy.trim());
    requestedByAlgorithm.set(algorithm, owners);
  }
  const algorithms = Array.from(requestedByAlgorithm, ([algorithm, owners]) => deepFreeze({
    algorithm,
    requestedBy: Array.from(owners).sort()
  })).sort((left, right) => left.algorithm.localeCompare(right.algorithm));
  const document = {
    version: CRYPTO_REQUIREMENTS_VERSION,
    semanticOwner: CRYPTO_SEMANTIC_OWNER,
    algorithms
  };
  return deepFreeze({
    ...document,
    requirementsHash: sha256Hex(stableStringify(document))
  });
}

function normalizeCryptoRequirementsDocument(value) {
  if (!isPlainObject(value) || value.version !== CRYPTO_REQUIREMENTS_VERSION || !Array.isArray(value.algorithms)) {
    throw cryptoError('PULSE_CRYPTO_REQUIREMENTS_ARRAY_REQUIRED', 'Crypto requirements document is invalid.');
  }
  const flattened = [];
  if (
    value.semanticOwner !== undefined
    && value.semanticOwner !== CRYPTO_SEMANTIC_OWNER
  ) {
    throw cryptoError(
      'PULSE_CRYPTO_REQUIREMENT_SEMANTIC_OWNER_INVALID',
      `Crypto requirements must name ${CRYPTO_SEMANTIC_OWNER} as semantic owner.`,
      { semanticOwner: value.semanticOwner }
    );
  }
  for (const [index, entry] of value.algorithms.entries()) {
    if (!isPlainObject(entry) || !Array.isArray(entry.requestedBy)) {
      throw cryptoError('PULSE_CRYPTO_REQUIREMENT_OBJECT_REQUIRED', 'Crypto requirement document entry is invalid.', { index });
    }
    for (const requestedBy of entry.requestedBy) flattened.push({
      algorithm: entry.algorithm,
      requestedBy,
      semanticOwner: CRYPTO_SEMANTIC_OWNER
    });
  }
  return normalizeCryptoRequirements(flattened);
}

function defineCryptoTargetCapabilities(input) {
  if (!isPlainObject(input)) {
    throw cryptoError('PULSE_CRYPTO_TARGET_CAPABILITIES_OBJECT_REQUIRED', 'Crypto target capabilities must be an object.');
  }
  const target = typeof input.target === 'string' && input.target.trim() ? input.target.trim() : null;
  if (!target) throw cryptoError('PULSE_CRYPTO_TARGET_REQUIRED', 'Crypto target capabilities must identify a target.');
  if (!Array.isArray(input.algorithms)) {
    throw cryptoError('PULSE_CRYPTO_TARGET_ALGORITHMS_ARRAY_REQUIRED', 'Crypto target algorithms must be an array.', { target });
  }
  const seen = new Set();
  const algorithms = input.algorithms.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw cryptoError('PULSE_CRYPTO_TARGET_ALGORITHM_OBJECT_REQUIRED', 'Crypto target algorithm entries must be objects.', { target, index });
    }
    const algorithm = requireAlgorithm(entry.algorithm, `crypto target ${target}.algorithms[${index}]`);
    if (seen.has(algorithm)) {
      throw cryptoError('PULSE_CRYPTO_TARGET_ALGORITHM_DUPLICATE', `Crypto target ${target} declares ${algorithm} more than once.`, { target, algorithm });
    }
    seen.add(algorithm);
    const realization = requireKnownRealization(entry.realization, `crypto target ${target}.${algorithm}.realization`);
    const known = knownRealization(realization, algorithm, target);
    if (!known) {
      throw cryptoError(
        'PULSE_CRYPTO_REALIZATION_PIN_INVALID',
        `Crypto realization ${realization} is incompatible with ${algorithm} on target ${target}.`,
        { target, algorithm, realization }
      );
    }
    return {
      algorithm,
      realization,
      kind: known.kind,
      ...(known.backend ? { backend: known.backend } : {}),
      implementation: known.implementation,
      implemented: entry.implemented === true,
      status: typeof entry.status === 'string' ? entry.status : (entry.implemented === true ? 'implemented' : 'planned')
    };
  }).sort((left, right) => left.algorithm.localeCompare(right.algorithm));
  return deepFreeze({
    version: CRYPTO_TARGET_CAPABILITIES_VERSION,
    target,
    automaticFallback: false,
    algorithms
  });
}

function targetCryptoCapabilities(targetDescriptor, target) {
  const capabilities = targetDescriptor && targetDescriptor.crypto;
  if (!capabilities || capabilities.version !== CRYPTO_TARGET_CAPABILITIES_VERSION) {
    throw cryptoError(
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      `Selected target ${target} does not declare crypto realization capabilities.`,
      { target }
    );
  }
  if (capabilities.target !== target) {
    throw cryptoError(
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      `Selected target ${target} has a mismatched crypto capability declaration.`,
      { target, declaredTarget: capabilities.target }
    );
  }
  return defineCryptoTargetCapabilities(capabilities);
}

function planCryptoRealizations(input = {}) {
  const declaration = input.declaration && input.declaration.version === CRYPTO_CONFIGURATION_VERSION
    ? normalizeCryptoConfigurationDocument(input.declaration)
    : emptyCryptoConfiguration();
  const requirements = input.requirements && input.requirements.version === CRYPTO_REQUIREMENTS_VERSION
    ? normalizeCryptoRequirementsDocument(input.requirements)
    : normalizeCryptoRequirements(input.requirements || []);
  const target = typeof input.target === 'string' && input.target.trim() ? input.target.trim() : null;
  const profile = typeof input.profile === 'string' && input.profile.trim() ? input.profile.trim() : null;
  const profileProvenance = deepFreeze({
    selectedProfile: profile,
    selectionSource: typeof input.profileSelectionSource === 'string' && input.profileSelectionSource.trim()
      ? input.profileSelectionSource.trim()
      : null,
    cryptoSource: typeof input.configurationSource === 'string' && input.configurationSource.trim()
      ? input.configurationSource.trim()
      : 'implicit'
  });
  const declaredByAlgorithm = new Map(declaration.algorithms.map((entry) => [entry.algorithm, entry]));

  for (const requirement of requirements.algorithms) {
    if (!declaredByAlgorithm.has(requirement.algorithm)) {
      throw cryptoError(
        declaration.algorithms.length === 0 ? 'PULSE_CRYPTO_CONFIG_REQUIRED' : 'PULSE_CRYPTO_ALGORITHM_UNDECLARED',
        `Crypto algorithm ${requirement.algorithm}, requested by ${requirement.requestedBy.join(', ')}, is not declared by profile ${profile || '<unknown>'}.`,
        {
          profile,
          target,
          algorithm: requirement.algorithm,
          requestedBy: requirement.requestedBy,
          semanticOwner: requirements.semanticOwner,
          profileProvenance,
          declaredAlgorithms: declaration.algorithms.map((entry) => entry.algorithm)
        }
      );
    }
  }

  if (declaration.algorithms.length === 0) {
    const document = {
      version: CRYPTO_REALIZATION_PLAN_VERSION,
      semanticOwner: requirements.semanticOwner,
      requirementsHash: requirements.requirementsHash,
      profile,
      profileProvenance,
      target,
      algorithms: Object.freeze([]),
      automaticFallback: false
    };
    return deepFreeze({ ...document, planHash: sha256Hex(stableStringify(document)) });
  }

  const targetCapabilities = targetCryptoCapabilities(input.targetDescriptor, target);
  const targetByAlgorithm = new Map(targetCapabilities.algorithms.map((entry) => [entry.algorithm, entry]));
  const planned = declaration.algorithms.map((configured) => {
    const targetCapability = targetByAlgorithm.get(configured.algorithm);
    if (!targetCapability) {
      throw cryptoError(
        'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
        `Selected target ${target} has no ${configured.algorithm} realization.`,
        { profile, target, algorithm: configured.algorithm }
      );
    }
    const realization = configured.realization || targetCapability.realization;
    const known = knownRealization(
      realization,
      configured.algorithm,
      target
    );
    if (
      !known
      || targetCapability.realization !== realization
    ) {
      throw cryptoError(
        'PULSE_CRYPTO_REALIZATION_PIN_INVALID',
        `Pinned realization ${realization} is unavailable for ${configured.algorithm} on target ${target}.`,
        {
          profile,
          target,
          algorithm: configured.algorithm,
          realization,
          targetRealization: targetCapability.realization
        }
      );
    }
    const requirement = requirements.algorithms.find((entry) => entry.algorithm === configured.algorithm);
    return {
      algorithm: configured.algorithm,
      primitive: configured.algorithm === 'RS256' ? Object.freeze({ kind: 'rsa-pkcs1-v1_5', hash: 'SHA-256' }) : configured.algorithm === 'ES256'
        ? Object.freeze({ kind: 'ecdsa', curve: 'P-256', hash: 'SHA-256' })
        : Object.freeze({ kind: configured.algorithm === 'SHA-256' ? 'digest' : 'hmac', hash: 'SHA-256' }),
      requestedBy: requirement ? requirement.requestedBy : Object.freeze([]),
      semanticOwner: requirements.semanticOwner,
      realization,
      kind: known.kind,
      ...(known.backend ? { backend: known.backend } : {}),
      implementation: known.implementation,
      targetStatus: targetCapability.status,
      targetImplemented: targetCapability.implemented,
      pinned: configured.realization !== null,
      automaticFallback: false
    };
  });
  const document = {
    version: CRYPTO_REALIZATION_PLAN_VERSION,
    semanticOwner: requirements.semanticOwner,
    requirementsHash: requirements.requirementsHash,
    profile,
    profileProvenance,
    target,
    algorithms: planned,
    automaticFallback: false
  };
  return deepFreeze({ ...document, planHash: sha256Hex(stableStringify(document)) });
}

module.exports = Object.freeze({
  CRYPTO_RS256_RUNTIME_BUILTIN_IMPLEMENTATION, CRYPTO_RS256_GUEST_LINKED_REALIZATION, CRYPTO_RS256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_CONFIGURATION_VERSION,
  CRYPTO_TARGET_CAPABILITIES_VERSION,
  CRYPTO_REQUIREMENTS_VERSION,
  CRYPTO_REALIZATION_PLAN_VERSION,
  CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION,
  CRYPTO_SEMANTIC_OWNER,
  CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
  CRYPTO_ES256_CONTRACT_VERSION,
  CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_VERIFICATION_STATUSES,
  CRYPTO_ES256_CONTRACT,
  CRYPTO_ALGORITHMS,
  CRYPTO_REALIZATIONS,
  normalizeCryptoConfiguration,
  emptyCryptoConfiguration,
  normalizeCryptoRequirements,
  defineCryptoTargetCapabilities,
  planCryptoRealizations
});
