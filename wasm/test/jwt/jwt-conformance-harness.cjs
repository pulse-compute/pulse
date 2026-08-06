'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const corpusFile = path.join(__dirname, 'jwt-conformance-corpus.json');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');

const CORPUS_VERSION = 'pulse.jwt-conformance-corpus.e0.v1';
const HARNESS_VERSION = 'pulse.jwt-conformance-harness.e0.v1';
const JAVASCRIPT_REALITY_HARNESS_VERSION =
  'pulse.jwt-javascript-reality-harness.e1.v1';
const NATIVE_REALITY_HARNESS_VERSION =
  'pulse.jwt-native-reality-harness.e2.v1';
const REQUIRED_TARGET_IDS = Object.freeze([
  'node-javascript',
  'fastly-javascript',
  'node-native',
  'fastly-native'
]);
const REQUIRED_CASE_IDS = Object.freeze([
  'valid-hs256',
  'required-claims',
  'issuer',
  'audience-string',
  'audience-array',
  'subject',
  'protected-typ',
  'expiration-inside-tolerance',
  'not-before-at-tolerance-boundary',
  'issued-at-within-tolerance',
  'maximum-token-age',
  'claims-schema',
  'detached-immutable-result',
  'invalid-signature',
  'altered-protected-header',
  'altered-payload',
  'wrong-key',
  'undersized-secret',
  'malformed-secret-descriptor',
  'malformed-compact-token',
  'malformed-protected-header',
  'malformed-payload',
  'malformed-authenticator',
  'wrong-length-authenticator',
  'none-algorithm',
  'token-algorithm-outside-jwt-allowlist',
  'jwt-algorithm-outside-profile-crypto',
  'missing-target-realization',
  'invalid-exact-realization-pin',
  'runtime-realization-failure',
  'no-fallback',
  'claims-unavailable-before-authenticity',
  'registered-claim-failure-after-authenticity',
  'claims-schema-failure-after-registered-claims',
  'sensitive-values-redacted'
]);

function ordinaryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!ordinaryObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
}

function corpusSemanticHash(corpus) {
  const semantic = { ...corpus };
  delete semantic.corpusHash;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalValue(semantic)))
    .digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertExactIds(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} must use the frozen corpus order`);
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
}

function validateTargetMatrix(corpus) {
  assert.ok(ordinaryObject(corpus.targetMatrix));
  assert.ok(Array.isArray(corpus.targetMatrix.required));
  assert.deepEqual(corpus.targetMatrix.additional, []);
  assertExactIds(
    corpus.targetMatrix.required.map((entry) => entry.id),
    REQUIRED_TARGET_IDS,
    'required target matrix'
  );
  for (const target of corpus.targetMatrix.required) {
    assert.equal(target.required, true);
    assert.equal(target.expectedStatus, 'executable');
    assert.equal(target.casePolicy, 'all-cases-required');
    assert.equal(target.automaticFallback, false);
    assert.deepEqual(target.providerRequirements, [
      'jwt.verify',
      'time.wall-clock',
      'jwt.verify.hs256',
      'secret.get',
      'schema.decode'
    ]);
    if (target.mode === 'javascript') {
      assert.equal(target.realization, 'runtime-builtin');
      assert.equal(target.implementation, 'webcrypto.subtle.hmac-sha-256.v1');
    } else {
      assert.equal(target.mode, 'native');
      assert.equal(target.realization, 'guest-source:pulse-hmac-as');
      assert.equal(target.implementation, 'pulse-hmac-as.v1');
    }
  }
  const fastlyNative = corpus.targetMatrix.required.find(
    (entry) => entry.id === 'fastly-native'
  );
  assert.equal(fastlyNative.currentReadiness.status, 'planning-blocked');
  assert.equal(
    fastlyNative.currentReadiness.reasonId,
    'fastly-native-jwt-package-effect-unavailable'
  );
  assert.equal(fastlyNative.currentReadiness.mustBecomeExecutableBy, 'E4');
}

function validateCases(corpus) {
  assert.ok(Array.isArray(corpus.cases));
  assertExactIds(
    corpus.cases.map((entry) => entry.id),
    REQUIRED_CASE_IDS,
    'semantic cases'
  );
  assert.equal(corpus.cases.filter((entry) => entry.polarity === 'positive').length, 13);
  assert.equal(corpus.cases.filter((entry) => entry.polarity === 'negative').length, 22);
  for (const testCase of corpus.cases) {
    assert.ok(['runtime', 'planning', 'observation'].includes(testCase.kind));
    assert.ok(['positive', 'negative'].includes(testCase.polarity));
    assert.equal(typeof testCase.setup, 'string');
    assert.ok(ordinaryObject(testCase.expected));
    assert.equal(typeof testCase.expected.status, 'string');
    assert.equal(Object.hasOwn(testCase, 'targets'), false);
    assert.equal(Object.hasOwn(testCase, 'skip'), false);
  }
}

function validateResourcesAndFixture(corpus) {
  assert.deepEqual(corpus.resourceLimits, {
    compactSegments: 3,
    tokenBytesMaximum: jwtContracts.JWT_RESOURCE_LIMITS.tokenBytes,
    protectedHeaderBytesMaximum: jwtContracts.JWT_RESOURCE_LIMITS.protectedHeaderBytes,
    claimsBytesMaximum: jwtContracts.JWT_RESOURCE_LIMITS.claimsBytes,
    jsonDepthMaximum: jwtContracts.JWT_RESOURCE_LIMITS.jsonDepth,
    requiredClaimNamesMaximum: jwtContracts.JWT_RESOURCE_LIMITS.requiredClaimNames,
    algorithmAllowlistEntriesMaximum: jwtContracts.JWT_RESOURCE_LIMITS.algorithms,
    clockToleranceSecondsMaximum: jwtContracts.JWT_RESOURCE_LIMITS.clockToleranceSeconds,
    maximumTokenAgeSecondsMaximum: 31_536_000,
    secretBytesMinimum: 32,
    secretBytesMaximum: 4096,
    cryptoDataBytesMaximum: 1_048_576,
    hs256AuthenticatorBytes: 32
  });
  assert.equal(corpus.fixture.clockInstantUnixSeconds, 2_000_000_000);
  assert.deepEqual(corpus.fixture.policy.algorithms, ['HS256']);
  assert.deepEqual(
    jwtContracts.jwtVerifyProviderRequirements(corpus.fixture.policy),
    corpus.targetMatrix.required[0].providerRequirements
  );
  assert.equal(corpus.fixture.policy.claimsSchema, corpus.fixture.schema.id);
  assert.deepEqual(
    corpus.fixture.schema.normalizedClaims,
    corpus.fixture.normalizedResult.claims
  );
  assert.deepEqual(corpus.fixture.normalizedResult.protectedHeader, {
    alg: 'HS256',
    kid: 'e0-key',
    typ: 'JWT'
  });
  assert.deepEqual(
    corpus.fixture.forbiddenSensitiveSubstrings.map((entry) => entry.id),
    [
      'complete-token',
      'authenticator',
      'complete-claims',
      'secret-value',
      'key-material',
      'subject'
    ]
  );
}

function loadJwtConformanceCorpus(file = corpusFile) {
  const bytes = fs.readFileSync(file);
  const corpus = JSON.parse(bytes.toString('utf8'));
  assert.equal(corpus.version, CORPUS_VERSION);
  assert.equal(corpus.status, 'frozen');
  assert.equal(corpus.algorithm, 'HS256');
  assert.equal(corpus.semanticOwner, '@pulse-compute/crypto');
  assert.equal(corpus.hashAlgorithm, 'sha256-canonical-json-without-corpusHash');
  assert.equal(corpus.corpusHash, corpusSemanticHash(corpus));
  assert.equal(corpus.harnessContract.version, HARNESS_VERSION);
  assert.equal(corpus.harnessContract.allCasesRequired, true);
  assert.equal(corpus.harnessContract.allowSkip, false);
  assert.equal(corpus.harnessContract.allowModeFallback, false);
  assert.equal(corpus.harnessContract.allowRealizationFallback, false);
  assert.equal(corpus.harnessContract.allowHarnessResultSubstitution, false);
  assert.equal(corpus.harnessContract.harnessSetupIsTargetBehavior, false);
  validateTargetMatrix(corpus);
  validateCases(corpus);
  validateResourcesAndFixture(corpus);
  return deepFreeze(corpus);
}

function materializeBaseFixture(corpus = loadJwtConformanceCorpus()) {
  const recipe = corpus.fixture.secretRecipe;
  assert.equal(recipe.kind, 'ascii-prefix-fill');
  assert.equal(Buffer.byteLength(recipe.fill, 'ascii'), 1);
  const remaining = recipe.totalBytes - Buffer.byteLength(recipe.prefix, 'ascii');
  assert.ok(remaining > 0);
  const secret = `${recipe.prefix}${recipe.fill.repeat(remaining)}`;
  assert.equal(Buffer.byteLength(secret, 'ascii'), recipe.totalBytes);
  const protectedHeaderJson = JSON.stringify(corpus.fixture.protectedHeader);
  const claimsJson = JSON.stringify(corpus.fixture.claims);
  const protectedSegment = Buffer.from(protectedHeaderJson, 'utf8').toString('base64url');
  const claimsSegment = Buffer.from(claimsJson, 'utf8').toString('base64url');
  const signingInput = `${protectedSegment}.${claimsSegment}`;
  const authenticator = crypto
    .createHmac('sha256', secret)
    .update(signingInput, 'ascii')
    .digest();
  assert.equal(authenticator.byteLength, corpus.resourceLimits.hs256AuthenticatorBytes);
  const authenticatorBase64url = authenticator.toString('base64url');
  return Object.freeze({
    compactToken: `${signingInput}.${authenticatorBase64url}`,
    authenticatorBase64url,
    claimsJson,
    secretUtf8: secret,
    secretHex: Buffer.from(secret, 'utf8').toString('hex'),
    subject: corpus.fixture.claims.sub
  });
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [name, cloneJson(child)])
  );
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signSegments(secret, protectedSegment, claimsSegment) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${protectedSegment}.${claimsSegment}`, 'ascii')
    .digest();
}

function compactToken(secret, protectedHeader, claims, options = {}) {
  const protectedSegment = options.protectedJson === undefined
    ? base64urlJson(protectedHeader)
    : Buffer.from(options.protectedJson, 'utf8').toString('base64url');
  const claimsSegment = options.claimsJson === undefined
    ? base64urlJson(claims)
    : Buffer.from(options.claimsJson, 'utf8').toString('base64url');
  const signingInput = `${protectedSegment}.${claimsSegment}`;
  const authenticator = signSegments(secret, protectedSegment, claimsSegment);
  const selected = options.authenticatorBytes === undefined
    ? authenticator
    : Buffer.from(options.authenticatorBytes);
  return Object.freeze({
    token: `${signingInput}.${selected.toString('base64url')}`,
    protectedSegment,
    claimsSegment,
    authenticator
  });
}

function changedCompactSegment(token, index, value) {
  const segments = token.split('.');
  assert.equal(segments.length, 3);
  segments[index] = value;
  return segments.join('.');
}

function javascriptSecretFixtures(corpus) {
  const base = materializeBaseFixture(corpus);
  const wrongBinding = 'AUTH_JWT_E1_WRONG';
  const shortBinding = 'AUTH_JWT_E1_SHORT';
  const wrongPrefix = 'pulse-e1-wrong-secret-';
  const wrongSecret = `${wrongPrefix}${'y'.repeat(48 - wrongPrefix.length)}`;
  const shortSecret = 's'.repeat(31);
  assert.equal(Buffer.byteLength(wrongSecret, 'utf8'), 48);
  assert.equal(Buffer.byteLength(shortSecret, 'utf8'), 31);
  return deepFreeze({
    bindings: {
      base: corpus.fixture.secretBinding,
      wrong: wrongBinding,
      short: shortBinding
    },
    values: {
      [corpus.fixture.secretBinding]: base.secretUtf8,
      [wrongBinding]: wrongSecret,
      [shortBinding]: shortSecret
    }
  });
}

function materializeJavascriptConformanceCases(
  corpus = loadJwtConformanceCorpus()
) {
  const fixture = corpus.fixture;
  const base = materializeBaseFixture(corpus);
  const secrets = javascriptSecretFixtures(corpus);
  const clock = fixture.clockInstantUnixSeconds;
  const baseHeader = cloneJson(fixture.protectedHeader);
  const baseClaims = cloneJson(fixture.claims);
  const basePolicy = cloneJson(fixture.policy);
  const expectedResult = {
    claims: cloneJson(fixture.normalizedResult.claims),
    protectedHeader: cloneJson(fixture.normalizedResult.protectedHeader)
  };
  const baseInput = () => ({
    verifierInput: {
      token: base.compactToken,
      options: cloneJson(basePolicy)
    },
    clockInstantUnixSeconds: clock,
    schemaMode: 'normalize',
    expectedResult: cloneJson(expectedResult),
    sensitive: { subject: fixture.claims.sub },
    cryptoMode: 'runtime-builtin'
  });
  const withSignedClaims = (claims, policy = basePolicy) => ({
    ...baseInput(),
    verifierInput: {
      token: compactToken(base.secretUtf8, baseHeader, claims).token,
      options: cloneJson(policy)
    }
  });
  const withSignedHeader = (header, claims = baseClaims, policy = basePolicy) => ({
    ...baseInput(),
    verifierInput: {
      token: compactToken(base.secretUtf8, header, claims).token,
      options: cloneJson(policy)
    }
  });
  const cases = [];
  const addRuntime = (id, overrides = {}) => {
    const source = corpus.cases.find((entry) => entry.id === id);
    assert.ok(source);
    cases.push(deepFreeze({
      id,
      kind: source.kind,
      polarity: source.polarity,
      setup: source.setup,
      expected: cloneJson(source.expected),
      input: { ...baseInput(), ...overrides }
    }));
  };
  const addPlanning = (id, planningScenario) => {
    const source = corpus.cases.find((entry) => entry.id === id);
    assert.ok(source);
    cases.push(deepFreeze({
      id,
      kind: source.kind,
      polarity: source.polarity,
      setup: source.setup,
      expected: cloneJson(source.expected),
      planningScenario
    }));
  };

  addRuntime('valid-hs256');
  addRuntime('required-claims');
  addRuntime('issuer', withSignedClaims({
    ...baseClaims,
    iss: 'https://issuer.alternate.example'
  }));
  addRuntime('audience-string', withSignedClaims({
    ...baseClaims,
    aud: 'pulse-api'
  }, {
    ...basePolicy,
    audience: 'pulse-api'
  }));
  addRuntime('audience-array');
  addRuntime('subject');
  addRuntime('protected-typ');
  addRuntime('expiration-inside-tolerance', withSignedClaims({
    ...baseClaims,
    exp: clock - basePolicy.clockToleranceSeconds + 1
  }));
  addRuntime('not-before-at-tolerance-boundary', withSignedClaims({
    ...baseClaims,
    nbf: clock + basePolicy.clockToleranceSeconds
  }));
  addRuntime('issued-at-within-tolerance', withSignedClaims({
    ...baseClaims,
    iat: clock + basePolicy.clockToleranceSeconds
  }));
  addRuntime('maximum-token-age', withSignedClaims({
    ...baseClaims,
    iat: clock
      - basePolicy.maxTokenAgeSeconds
      - basePolicy.clockToleranceSeconds
  }));
  addRuntime('claims-schema');
  addRuntime('detached-immutable-result');

  const baseSegments = base.compactToken.split('.');
  const invalidAuthenticator = Buffer.from(base.authenticatorBase64url, 'base64url');
  invalidAuthenticator[0] ^= 1;
  addRuntime('invalid-signature', {
    ...baseInput(),
    verifierInput: {
      token: `${baseSegments[0]}.${baseSegments[1]}.${invalidAuthenticator.toString('base64url')}`,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('altered-protected-header', {
    ...baseInput(),
    verifierInput: {
      token: changedCompactSegment(
        base.compactToken,
        0,
        base64urlJson({ ...baseHeader, kid: 'altered-key' })
      ),
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('altered-payload', {
    ...baseInput(),
    verifierInput: {
      token: changedCompactSegment(
        base.compactToken,
        1,
        base64urlJson({ ...baseClaims, roles: ['administrator'] })
      ),
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('wrong-key', {
    ...baseInput(),
    verifierInput: {
      token: base.compactToken,
      options: {
        ...cloneJson(basePolicy),
        key: { type: 'secret', binding: secrets.bindings.wrong }
      }
    }
  });
  addRuntime('undersized-secret', {
    ...baseInput(),
    verifierInput: {
      token: base.compactToken,
      options: {
        ...cloneJson(basePolicy),
        key: { type: 'secret', binding: secrets.bindings.short }
      }
    }
  });
  addRuntime('malformed-secret-descriptor', {
    ...baseInput(),
    verifierInput: {
      token: base.compactToken,
      options: {
        ...cloneJson(basePolicy),
        key: {
          type: 'secret',
          binding: secrets.bindings.base,
          extra: true
        }
      }
    }
  });
  addRuntime('malformed-compact-token', {
    ...baseInput(),
    verifierInput: {
      token: `${baseSegments[0]}.${baseSegments[1]}`,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('malformed-protected-header', {
    ...baseInput(),
    verifierInput: {
      token: compactToken(
        base.secretUtf8,
        baseHeader,
        baseClaims,
        { protectedJson: '[]' }
      ).token,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('malformed-payload', {
    ...baseInput(),
    verifierInput: {
      token: compactToken(
        base.secretUtf8,
        baseHeader,
        baseClaims,
        { claimsJson: '[]' }
      ).token,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('malformed-authenticator', {
    ...baseInput(),
    verifierInput: {
      token: `${baseSegments[0]}.${baseSegments[1]}.${baseSegments[2]}=`,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('wrong-length-authenticator', {
    ...baseInput(),
    verifierInput: {
      token: compactToken(
        base.secretUtf8,
        baseHeader,
        baseClaims,
        { authenticatorBytes: Buffer.from(base.authenticatorBase64url, 'base64url').subarray(0, 31) }
      ).token,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('none-algorithm', withSignedHeader({
    ...baseHeader,
    alg: 'none'
  }));
  addRuntime('token-algorithm-outside-jwt-allowlist', withSignedHeader({
    ...baseHeader,
    alg: 'RS256'
  }));

  addPlanning(
    'jwt-algorithm-outside-profile-crypto',
    'reachable-hs256-without-effective-crypto'
  );
  addPlanning(
    'missing-target-realization',
    'target-without-hs256-realization'
  );
  addPlanning(
    'invalid-exact-realization-pin',
    'runtime-builtin-pin-for-native'
  );

  addRuntime('runtime-realization-failure', {
    ...baseInput(),
    cryptoMode: 'selected-realization-failure'
  });
  addRuntime('no-fallback', {
    ...baseInput(),
    cryptoMode: 'selected-realization-failure'
  });
  addRuntime('claims-unavailable-before-authenticity', {
    ...baseInput(),
    verifierInput: {
      token: `${baseSegments[0]}.${baseSegments[1]}.${invalidAuthenticator.toString('base64url')}`,
      options: cloneJson(basePolicy)
    }
  });
  addRuntime('registered-claim-failure-after-authenticity', withSignedClaims({
    ...baseClaims,
    exp: clock - basePolicy.clockToleranceSeconds
  }));
  addRuntime('claims-schema-failure-after-registered-claims', {
    ...baseInput(),
    schemaMode: 'reject'
  });
  addRuntime('sensitive-values-redacted');

  assertExactIds(
    cases.map((entry) => entry.id),
    REQUIRED_CASE_IDS,
    'materialized JavaScript conformance cases'
  );
  return deepFreeze({
    version: JAVASCRIPT_REALITY_HARNESS_VERSION,
    corpusVersion: corpus.version,
    corpusHash: corpus.corpusHash,
    secrets,
    cases
  });
}

function materializeNativeConformanceCases(
  corpus = loadJwtConformanceCorpus()
) {
  const javascript = materializeJavascriptConformanceCases(corpus);
  const cases = javascript.cases.map((testCase) => {
    if (!testCase.input) return cloneJson(testCase);
    return {
      ...cloneJson(testCase),
      input: {
        ...cloneJson(testCase.input),
        cryptoMode: testCase.input.cryptoMode === 'selected-realization-failure'
          ? 'selected-realization-failure'
          : 'guest-source:pulse-hmac-as'
      }
    };
  });
  assertExactIds(
    cases.map((entry) => entry.id),
    REQUIRED_CASE_IDS,
    'materialized Native conformance cases'
  );
  return deepFreeze({
    version: NATIVE_REALITY_HARNESS_VERSION,
    corpusVersion: corpus.version,
    corpusHash: corpus.corpusHash,
    secrets: cloneJson(javascript.secrets),
    cases
  });
}

function forbiddenSensitiveValues(corpus = loadJwtConformanceCorpus()) {
  const material = materializeBaseFixture(corpus);
  const byDerivation = Object.freeze({
    'base-fixture.compactToken': material.compactToken,
    'base-fixture.authenticatorBase64url': material.authenticatorBase64url,
    'base-fixture.claimsJson': material.claimsJson,
    'base-fixture.secretUtf8': material.secretUtf8,
    'base-fixture.secretHex': material.secretHex,
    'fixture.claims.sub': material.subject
  });
  return Object.freeze(corpus.fixture.forbiddenSensitiveSubstrings.map((entry) => {
    const value = byDerivation[entry.derive];
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0);
    return Object.freeze({ id: entry.id, value });
  }));
}

function targetById(corpus, targetId) {
  const target = corpus.targetMatrix.required.find((entry) => entry.id === targetId);
  assert.ok(target, `unknown required target ${targetId}`);
  return target;
}

function createTargetHarnessManifest(targetId, setupId, corpus = loadJwtConformanceCorpus()) {
  const target = targetById(corpus, targetId);
  assert.equal(typeof setupId, 'string');
  assert.ok(setupId.length > 0);
  return deepFreeze({
    version: HARNESS_VERSION,
    phase: 'E0',
    contractOnly: true,
    runtimeObserved: false,
    targetId,
    corpusVersion: corpus.version,
    corpusHash: corpus.corpusHash,
    realization: target.realization,
    implementation: target.implementation,
    caseIds: [...REQUIRED_CASE_IDS],
    skippedCaseIds: [],
    setup: {
      id: setupId,
      classifiedAsTargetBehavior: false
    },
    automaticFallback: false
  });
}

function assertTargetHarnessManifest(manifest, corpus = loadJwtConformanceCorpus()) {
  assert.ok(ordinaryObject(manifest));
  const target = targetById(corpus, manifest.targetId);
  assert.equal(manifest.version, HARNESS_VERSION);
  assert.equal(manifest.phase, 'E0');
  assert.equal(manifest.contractOnly, true);
  assert.equal(manifest.runtimeObserved, false);
  assert.equal(manifest.corpusVersion, corpus.version);
  assert.equal(manifest.corpusHash, corpus.corpusHash);
  assert.equal(manifest.realization, target.realization);
  assert.equal(manifest.implementation, target.implementation);
  assertExactIds(manifest.caseIds, REQUIRED_CASE_IDS, `${manifest.targetId} harness cases`);
  assert.deepEqual(manifest.skippedCaseIds, []);
  assert.ok(ordinaryObject(manifest.setup));
  assert.equal(typeof manifest.setup.id, 'string');
  assert.ok(manifest.setup.id.length > 0);
  assert.equal(manifest.setup.classifiedAsTargetBehavior, false);
  assert.equal(manifest.automaticFallback, false);
  return manifest;
}

module.exports = Object.freeze({
  CORPUS_VERSION,
  HARNESS_VERSION,
  JAVASCRIPT_REALITY_HARNESS_VERSION,
  NATIVE_REALITY_HARNESS_VERSION,
  REQUIRED_TARGET_IDS,
  REQUIRED_CASE_IDS,
  corpusFile,
  corpusSemanticHash,
  loadJwtConformanceCorpus,
  materializeBaseFixture,
  materializeJavascriptConformanceCases,
  materializeNativeConformanceCases,
  forbiddenSensitiveValues,
  createTargetHarnessManifest,
  assertTargetHarnessManifest
});
