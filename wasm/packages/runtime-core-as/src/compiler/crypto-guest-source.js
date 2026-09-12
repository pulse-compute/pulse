'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

function loadCryptoContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/crypto/contracts');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/crypto/contracts.js');
    }
    throw error;
  }
}

const cryptoContracts = loadCryptoContracts();

class CryptoGuestSourceError extends Error {
  constructor(message, code = 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE', detail = {}) {
    super(message);
    this.name = 'CryptoGuestSourceError';
    this.code = code;
    this.detail = Object.freeze({ ...detail, automaticFallback: false });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function localCryptoSourceModule() {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'crypto',
    'pulsewasm.native.cjs'
  );
}

function loadGuestSourceModule(definition) {
  const source = definition && definition.source;
  if (!source || source.package !== '@pulse-compute/crypto' || source.export !== './pulsewasm-native') {
    throw new CryptoGuestSourceError(
      `Crypto realization ${definition && definition.id || '<unknown>'} has no synchronized first-party guest source.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      { realization: definition && definition.id }
    );
  }

  const specifier = `${source.package}/${source.export.replace(/^\.\//, '')}`;
  try {
    return require(specifier);
  } catch (error) {
    if (!error || !['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    try {
      return require(localCryptoSourceModule());
    } catch (fallbackError) {
      throw new CryptoGuestSourceError(
        `Selected crypto realization ${definition.id} could not load its synchronized package source.`,
        'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
        {
          realization: definition.id,
          package: source.package,
          export: source.export,
          causeCode: fallbackError && fallbackError.code,
          cause: fallbackError && fallbackError.message
        }
      );
    }
  }
}

function inactivePlan(plan) {
  return deepFreeze({
    version: cryptoContracts.CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION,
    active: false,
    realizationPlanVersion: plan && plan.crypto && plan.crypto.version || null,
    realizationPlanHash: plan && plan.crypto && plan.crypto.planHash || null,
    algorithms: [],
    sources: [],
    source: '',
    sourceHash: sha256(''),
    automaticFallback: false
  });
}

function assertSelectedDefinition(entry) {
  const definition = cryptoContracts.CRYPTO_REALIZATIONS.find(
    (candidate) => (
      candidate.id === entry.realization
      && candidate.algorithm === entry.algorithm
    )
  );
  if (
    !definition
    || definition.algorithm !== entry.algorithm
    || !['guest-source', 'guest-linked'].includes(definition.kind)
    || !definition.targets.includes('native')
    || entry.kind !== definition.kind
    || entry.backend !== definition.backend
    || entry.implementation !== definition.implementation
  ) {
    throw new CryptoGuestSourceError(
      `Selected Native crypto realization ${entry.realization || '<unknown>'} is invalid.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      {
        algorithm: entry.algorithm,
        realization: entry.realization,
        kind: entry.kind,
        backend: entry.backend
      }
    );
  }
  if (entry.targetImplemented !== true) {
    throw new CryptoGuestSourceError(
      `Selected Native crypto realization ${entry.realization} is not implemented for this target.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      {
        algorithm: entry.algorithm,
        realization: entry.realization,
        targetStatus: entry.targetStatus
      }
    );
  }
  return definition;
}

function normalizeLinkedContribution(entry, definition) {
  if (
    entry.algorithm !== 'ES256'
    || definition.id !== cryptoContracts.CRYPTO_ES256_GUEST_LINKED_REALIZATION
    || definition.implementation !==
      cryptoContracts.CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION
  ) {
    throw new CryptoGuestSourceError(
      `Selected crypto realization ${entry.realization} is not a recognized linked guest.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      { algorithm: entry.algorithm, realization: entry.realization }
    );
  }
  const module = loadGuestSourceModule(definition);
  const guest = module
    && typeof module.pulseEs256GuestUnit === 'function'
    && module.pulseEs256GuestUnit();
  if (
    !guest
    || guest.version !== definition.source.contractVersion
    || guest.id !== 'pulse.crypto.es256.rustcrypto-p256.v1'
    || guest.owner !== definition.source.package
    || typeof guest.packageVersion !== 'string'
    || guest.packageVersion.length === 0
    || guest.origin !== 'package-prebuilt'
    || guest.manifest !== './guests/es256-rustcrypto/pulse.guest-unit.json'
  ) {
    throw new CryptoGuestSourceError(
      `Selected crypto realization ${entry.realization} failed its synchronized linked-guest contract.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      { algorithm: entry.algorithm, realization: entry.realization }
    );
  }
  const source = [
    '@external("pulse_crypto_es256", "pulse_crypto_es256_verify")',
    'declare function __pulse_crypto_es256_guest_verify(framePointer: i32, frameCapacity: i32): i32',
    'export function __pulse_crypto_es256_link_anchor(framePointer: i32, frameCapacity: i32): i32 {',
    '  return __pulse_crypto_es256_guest_verify(framePointer, frameCapacity)',
    '}',
    ''
  ].join('\n');
  return deepFreeze({
    id: 'pulse-es256-rustcrypto-p256',
    owner: guest.owner,
    packageVersion: guest.packageVersion,
    realization: definition.id,
    kind: definition.kind,
    backend: definition.backend,
    backendVersion: definition.implementation,
    algorithm: definition.algorithm,
    language: 'wasm',
    license: 'Apache-2.0 OR MIT',
    origin: 'package-prebuilt',
    sourceIncluded: false,
    provenance: ['package-prebuilt', 'Cargo.lock', 'pulse.guest-unit.v2'],
    sourceFile: guest.manifest.replace(/^\.\//, ''),
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    imports: [{
      module: 'pulse_crypto_es256',
      name: 'pulse_crypto_es256_verify',
      kind: 'function'
    }],
    exports: ['__pulse_crypto_es256_link_anchor'],
    resourceLimits: {
      es256PublicKeyBytes: 64,
      es256SignatureBytes: 64,
      es256SigningInputBytesMaximum: 16_340
    },
    resultCodes: {
      valid: 1,
      invalidAuthenticator: 0,
      invalidKey: -1,
      invalidInput: -2,
      realizationFailure: -3
    },
    comparison: {
      mode: 'ecdsa-p256-sha-256',
      bytes: 64,
      earlyMismatchReturn: null
    },
    automaticFallback: false
  });
}

function normalizeContribution(entry, definition) {
  const module = loadGuestSourceModule(definition);
  if (!module || typeof module.pulseHmacAssemblyScriptSource !== 'function') {
    throw new CryptoGuestSourceError(
      `Selected crypto realization ${entry.realization} does not expose its guest-source contract.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      { algorithm: entry.algorithm, realization: entry.realization }
    );
  }
  const contribution = module.pulseHmacAssemblyScriptSource(entry.algorithm);
  const expected = definition.source;
  if (
    !contribution
    || contribution.version !== expected.contractVersion
    || contribution.id !== expected.contribution
    || contribution.owner !== expected.package
    || typeof contribution.packageVersion !== 'string'
    || contribution.packageVersion.length === 0
    || contribution.realization !== definition.id
    || contribution.kind !== definition.kind
    || contribution.backend !== definition.backend
    || contribution.backendVersion !== definition.implementation
    || contribution.algorithm !== definition.algorithm
    || contribution.language !== 'assemblyscript'
    || contribution.license !== 'Apache-2.0'
    || contribution.origin !== 'package-source'
    || contribution.sourceIncluded !== true
    || !Array.isArray(contribution.provenance)
    || contribution.provenance.length !== 3
    || contribution.provenance[0] !== 'NIST FIPS 180-4'
    || contribution.provenance[1] !== 'RFC 2104'
    || contribution.provenance[2] !== 'RFC 4231'
    || contribution.sourceFile !== 'as/pulse-hmac-as.ts'
    || typeof contribution.source !== 'string'
    || contribution.source.length === 0
    || contribution.sourceSha256 !== sha256(contribution.source)
    || contribution.sourceBytes !== Buffer.byteLength(contribution.source)
    || !Array.isArray(contribution.imports)
    || contribution.imports.length !== 0
    || !Array.isArray(contribution.exports)
    || contribution.exports.length !== 5
    || !contribution.exports.includes('pulse_crypto_hs256_verify')
    || !contribution.exports.includes('pulse_crypto_sha256_digest')
    || !contribution.exports.includes('pulse_crypto_bytes_frame_v1')
    || !contribution.exports.includes('pulse_crypto_sha256_bytes_v1')
    || !contribution.exports.includes('pulse_crypto_hmac_sha256_bytes_v1')
    || !contribution.resourceLimits
    || contribution.resourceLimits.hmacKeyBytesMinimum !== 32
    || contribution.resourceLimits.hmacKeyBytesMaximum !== 4 * 1024
    || contribution.resourceLimits.macDataBytesMaximum !== 1024 * 1024
    || contribution.resourceLimits.hs256TagBytes !== 32
    || contribution.resourceLimits.byteOperationKeyBytesMaximum !== 8192
    || contribution.resourceLimits.byteOperationDataBytesMaximum !== 32768
    || contribution.resourceLimits.byteOperationOutputBytes !== 32
    || contribution.resourceLimits.byteOperationFrameBytes !== 40992
    || !contribution.resultCodes
    || contribution.resultCodes.valid !== 1
    || contribution.resultCodes.invalidAuthenticator !== 0
    || contribution.resultCodes.invalidKey !== -1
    || contribution.resultCodes.invalidInput !== -2
    || contribution.resultCodes.realizationFailure !== -3
    || !contribution.comparison
    || contribution.comparison.mode !== 'constant-time-full-tag-scan'
    || contribution.comparison.bytes !== 32
    || contribution.comparison.earlyMismatchReturn !== false
    || contribution.automaticFallback !== false
  ) {
    throw new CryptoGuestSourceError(
      `Selected crypto realization ${entry.realization} failed its synchronized guest-source contract.`,
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      { algorithm: entry.algorithm, realization: entry.realization }
    );
  }
  return contribution;
}

function buildNativeCryptoGuestSources(plan) {
  const realizationPlan = plan && plan.crypto;
  if (!realizationPlan || !Array.isArray(realizationPlan.algorithms) || realizationPlan.algorithms.length === 0) {
    return inactivePlan(plan);
  }
  if (
    realizationPlan.version !== cryptoContracts.CRYPTO_REALIZATION_PLAN_VERSION
    || realizationPlan.target !== 'native'
    || realizationPlan.automaticFallback !== false
  ) {
    throw new CryptoGuestSourceError(
      'Canonical Native crypto realization planning is invalid.',
      'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      {
        version: realizationPlan.version,
        target: realizationPlan.target,
        automaticFallback: realizationPlan.automaticFallback
      }
    );
  }

  const contributions = realizationPlan.algorithms.map((entry) => {
    const definition = assertSelectedDefinition(entry);
    return definition.kind === 'guest-linked'
      ? normalizeLinkedContribution(entry, definition)
      : normalizeContribution(entry, definition);
  });
  const algorithmsSeen = new Set();
  const sourcesById = new Map();
  for (const contribution of contributions) {
    const previous = sourcesById.get(contribution.id);
    if (algorithmsSeen.has(contribution.algorithm) || (previous && (
      previous.sourceSha256 !== contribution.sourceSha256
      || JSON.stringify(previous.exports) !== JSON.stringify(contribution.exports)
      || previous.owner !== contribution.owner || previous.packageVersion !== contribution.packageVersion
      || previous.kind !== contribution.kind || previous.backendVersion !== contribution.backendVersion
      || JSON.stringify(previous.imports) !== JSON.stringify(contribution.imports)
      || JSON.stringify(previous.resourceLimits) !== JSON.stringify(contribution.resourceLimits)
    ))) throw new CryptoGuestSourceError('Native Crypto contributions conflict.', 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE');
    algorithmsSeen.add(contribution.algorithm);
    sourcesById.set(contribution.id, contribution);
  }
  const uniqueSources = [...sourcesById.values()];

  const source = uniqueSources
    .map((entry) => [
      `/* Pulse crypto guest source: ${entry.id} (${entry.sourceSha256}) */`,
      entry.source.trimEnd(),
      ''
    ].join('\n'))
    .join('\n');
  const algorithms = contributions.map((entry) => deepFreeze({
    algorithm: entry.algorithm,
    realization: entry.realization,
    kind: entry.kind,
    backend: entry.backend,
    backendVersion: entry.backendVersion,
    implementation: entry.backendVersion,
    owner: entry.owner,
    packageVersion: entry.packageVersion,
    language: entry.language,
    license: entry.license,
    origin: entry.origin,
    sourceIncluded: entry.sourceIncluded,
    provenance: [...entry.provenance],
    sourceFile: entry.sourceFile,
    sourceBytes: entry.sourceBytes,
    sourceSha256: entry.sourceSha256,
    imports: [...entry.imports],
    exports: [...entry.exports],
    resourceLimits: { ...entry.resourceLimits },
    resultCodes: { ...entry.resultCodes },
    comparison: { ...entry.comparison },
    automaticFallback: false
  }));

  return deepFreeze({
    version: cryptoContracts.CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION,
    active: true,
    realizationPlanVersion: realizationPlan.version,
    realizationPlanHash: realizationPlan.planHash,
    algorithms,
    sources: uniqueSources.map((entry) => entry.source),
    source,
    sourceHash: sha256(source),
    automaticFallback: false
  });
}

module.exports = Object.freeze({
  CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION:
    cryptoContracts.CRYPTO_NATIVE_GUEST_SOURCE_PLAN_VERSION,
  CryptoGuestSourceError,
  buildNativeCryptoGuestSources
});
