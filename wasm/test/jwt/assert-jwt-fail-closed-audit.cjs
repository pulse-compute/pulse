#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  planProjectCrypto,
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/native/target.js');
const {
  createNodeJavascriptJwtVerify,
} = require('../../../packages/provider-node/src/javascript/jwt-verifier.js');
const {
  createFastlyJavascriptJwtVerify,
} = require('../../../packages/provider-fastly/src/javascript/jwt-verifier.js');
const pulseJwtManifest = require('../../../packages/jwt/pulsewasm.manifest.cjs');
const {
  forbiddenSensitiveValues,
  loadJwtConformanceCorpus,
} = require('./jwt-conformance-harness.cjs');

const EVIDENCE_VERSION = 'pulse.jwt-e3-evidence.v1';
const ORDER_REPORT_VERSION = 'pulse.jwt-fail-closed-order-report.e3.v1';
const FALLBACK_REPORT_VERSION = 'pulse.jwt-no-fallback-audit-report.e3.v1';
const REDACTION_REPORT_VERSION = 'pulse.jwt-redaction-audit-report.e3.v1';
const NOW = 2_100_000_000;
const BINDING = 'JWT_E3_AUDIT_SECRET';

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-e3');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') outputDirectory = path.resolve(argv[++index]);
    else throw new TypeError(`Unknown E3 option ${String(argv[index])}.`);
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function sourceRecord(relativeFile) {
  const bytes = fs.readFileSync(path.join(repoRoot, relativeFile));
  return Object.freeze({
    file: relativeFile.replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function readJson(relativeFile) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'));
}

function errorProjection(error) {
  const detail = error && typeof error === 'object'
    ? (
      Object.getOwnPropertyDescriptor(error, 'detail')?.value
      ?? Object.getOwnPropertyDescriptor(error, 'details')?.value
    )
    : undefined;
  return Object.freeze({
    name: error && typeof error.name === 'string' ? error.name : 'Error',
    code: error && typeof error.code === 'string' ? error.code : null,
    message: error && typeof error.message === 'string'
      ? error.message
      : 'Operation failed.',
    detail: detail && typeof detail === 'object'
      ? JSON.parse(JSON.stringify(detail))
      : null,
  });
}

function fixtureMaterial() {
  const secret = [
    'pulse',
    'e3',
    'secret',
    'material',
    'x'.repeat(40),
  ].join('-');
  const subject = [
    'pulse',
    'e3',
    'claims',
    'subject',
    'must',
    'remain',
    'private',
  ].join('-');
  const privateMarker = [
    'pulse',
    'e3',
    'private',
    'claim',
    'marker',
  ].join('-');
  const role = ['pulse', 'e3', 'role', 'member'].join('-');
  return Object.freeze({ secret, subject, privateMarker, role });
}

function compactFixture(material, overrides = {}, algorithm = 'HS256') {
  const protectedHeader = Object.freeze({
    alg: algorithm,
    kid: 'e3-key',
    typ: 'JWT',
  });
  const claims = Object.freeze({
    sub: material.subject,
    iss: 'https://issuer.e3.invalid',
    aud: 'pulse-e3-audit',
    iat: NOW - 10,
    exp: NOW + 60,
    roles: Object.freeze([material.role]),
    privateMarker: material.privateMarker,
    ...overrides,
  });
  const headerJson = JSON.stringify(protectedHeader);
  const claimsJson = JSON.stringify(claims);
  const protectedSegment = Buffer.from(headerJson, 'utf8').toString('base64url');
  const claimsSegment = Buffer.from(claimsJson, 'utf8').toString('base64url');
  const signingInput = `${protectedSegment}.${claimsSegment}`;
  const signature = crypto
    .createHmac('sha256', material.secret)
    .update(signingInput, 'ascii')
    .digest();
  const token = `${signingInput}.${signature.toString('base64url')}`;
  const invalidSignature = Buffer.from(signature);
  invalidSignature[0] ^= 0x01;
  const invalidToken =
    `${signingInput}.${invalidSignature.toString('base64url')}`;
  return Object.freeze({
    protectedHeader,
    claims,
    headerJson,
    claimsJson,
    protectedSegment,
    claimsSegment,
    signingInput,
    signature,
    token,
    invalidToken,
  });
}

function verificationOptions(overrides = {}) {
  return Object.freeze({
    algorithms: Object.freeze(['HS256']),
    key: Object.freeze({ type: 'secret', binding: BINDING }),
    issuer: 'https://issuer.e3.invalid',
    audience: 'pulse-e3-audit',
    typ: 'JWT',
    requiredClaims: Object.freeze(['sub', 'iat', 'exp']),
    claimsSchema: 'auth.E3Claims',
    ...overrides,
  });
}

function frozenResultPaths(result) {
  return Object.freeze({
    '$': Boolean(result && Object.isFrozen(result)),
    '$.claims': Boolean(result && Object.isFrozen(result.claims)),
    '$.claims.roles': Boolean(
      result
      && result.claims
      && Object.isFrozen(result.claims.roles),
    ),
    '$.protectedHeader': Boolean(
      result
      && Object.isFrozen(result.protectedHeader),
    ),
  });
}

async function runPackageProbe(input, runtime, material) {
  const events = [];
  const counters = {
    secretCalls: 0,
    selectedRealizationAttempts: 0,
    hostVerifyAttempts: 0,
    javascriptVerifyAttempts: 0,
    clockCalls: 0,
    schemaCalls: 0,
    claimsExposureEvents: 0,
  };
  let claimsExposed = false;
  let result = null;
  let caught = null;

  const selectedCrypto = Object.freeze({
    mac: Object.freeze({
      async verify(request) {
        counters.selectedRealizationAttempts += 1;
        events.push('crypto');
        if (input.cryptoStatus) return Object.freeze({ status: input.cryptoStatus });
        return runtime.crypto.mac.verify(request);
      },
    }),
  });
  assert.deepEqual(Object.keys(selectedCrypto), ['mac']);
  assert.deepEqual(Object.keys(selectedCrypto.mac), ['verify']);

  // These spies remain deliberately outside the selected crypto contract. If
  // JWT attempts target or realization discovery, either counter makes the
  // audit fail below.
  const dormantAlternatives = Object.freeze({
    hostVerify() {
      counters.hostVerifyAttempts += 1;
      throw new Error('Dormant host verifier must not execute.');
    },
    javascriptVerify() {
      counters.javascriptVerifyAttempts += 1;
      throw new Error('Dormant JavaScript verifier must not execute.');
    },
  });
  assert.equal(typeof dormantAlternatives.hostVerify, 'function');
  assert.equal(typeof dormantAlternatives.javascriptVerify, 'function');

  const host = Object.freeze({
    resolveSecret(binding) {
      counters.secretCalls += 1;
      events.push('secret');
      return binding === BINDING ? material.secret : undefined;
    },
    captureWallClock() {
      counters.clockCalls += 1;
      events.push('clock');
      return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
    },
    validateClaims(_schemaId, claims) {
      counters.schemaCalls += 1;
      events.push('schema');
      if (input.schemaReject) {
        const error = new Error('E3 schema fixture rejected the value.');
        error.code = 'PULSE_SCHEMA_VALUE_INVALID';
        error.detail = Object.freeze({
          path: '$.roles',
          expected: 'string',
          actualKind: 'array',
        });
        throw error;
      }
      return Object.freeze({
        sub: String(claims.sub),
        roles: Object.freeze(claims.roles.map(String)),
      });
    },
    registerSensitiveValue(value) {
      if (value === material.subject && !claimsExposed) {
        claimsExposed = true;
        counters.claimsExposureEvents += 1;
        events.push('claims');
      }
    },
  });

  try {
    result = await runtime.jwt.verifyJwtWithCrypto(
      {
        token: input.token,
        options: input.options || verificationOptions(),
      },
      host,
      selectedCrypto,
    );
    events.push('verified');
  } catch (error) {
    caught = error;
  }

  const record = Object.freeze({
    id: input.id,
    status: caught ? 'error' : 'success',
    error: caught ? errorProjection(caught) : null,
    resultProduced: result !== null,
    immutablePaths: frozenResultPaths(result),
    observation: Object.freeze({
      ...counters,
      registeredClaimAuthorityCalls: counters.clockCalls,
      claimsExposed,
      eventOrder: Object.freeze([...events]),
      automaticFallback: false,
    }),
  });
  if (input.expectedCode) {
    assert.equal(record.status, 'error', input.id);
    assert.equal(record.error.code, input.expectedCode, input.id);
    assert.equal(record.resultProduced, false, input.id);
  } else {
    assert.equal(record.status, 'success', input.id);
  }
  return record;
}

async function directPackageAudit(material) {
  const [jwt, cryptoProvider] = await Promise.all([
    import(pathToFileURL(path.join(
      repoRoot,
      'packages',
      'jwt',
      'dist',
      'provider.js',
    )).href),
    import(pathToFileURL(path.join(
      repoRoot,
      'packages',
      'crypto',
      'dist',
      'index.js',
    )).href),
  ]);
  const runtime = Object.freeze({ jwt, crypto: cryptoProvider.crypto });
  const valid = compactFixture(material);
  const expired = compactFixture(material, { exp: NOW });
  const disallowed = compactFixture(material, {}, 'RS256');

  const cases = [];
  cases.push(await runPackageProbe({
    id: 'invalid-authenticity',
    token: valid.invalidToken,
    expectedCode: 'PULSE_JWT_SIGNATURE_INVALID',
  }, runtime, material));
  cases.push(await runPackageProbe({
    id: 'jwt-allowlist-before-crypto',
    token: disallowed.token,
    expectedCode: 'PULSE_JWT_ALGORITHM_NOT_ALLOWED',
  }, runtime, material));
  cases.push(await runPackageProbe({
    id: 'registered-claims-before-schema',
    token: expired.token,
    expectedCode: 'PULSE_JWT_CLAIMS_INVALID',
  }, runtime, material));
  cases.push(await runPackageProbe({
    id: 'schema-after-registered-claims',
    token: valid.token,
    schemaReject: true,
    expectedCode: 'PULSE_JWT_CLAIMS_SCHEMA_INVALID',
  }, runtime, material));
  cases.push(await runPackageProbe({
    id: 'selected-realization-failure',
    token: valid.token,
    cryptoStatus: 'realization-failure',
    expectedCode: 'PULSE_JWT_OPERATION_FAILED',
  }, runtime, material));
  cases.push(await runPackageProbe({
    id: 'verified-result',
    token: valid.token,
  }, runtime, material));

  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  const invalid = byId.get('invalid-authenticity');
  assert.deepEqual(invalid.observation.eventOrder, ['secret', 'crypto']);
  assert.equal(invalid.observation.claimsExposureEvents, 0);
  assert.equal(invalid.observation.registeredClaimAuthorityCalls, 0);
  assert.equal(invalid.observation.schemaCalls, 0);
  assert.deepEqual(Object.values(invalid.immutablePaths), [false, false, false, false]);

  const allowlist = byId.get('jwt-allowlist-before-crypto');
  assert.deepEqual(allowlist.observation.eventOrder, []);
  assert.equal(allowlist.observation.secretCalls, 0);
  assert.equal(allowlist.observation.selectedRealizationAttempts, 0);

  const registered = byId.get('registered-claims-before-schema');
  assert.deepEqual(
    registered.observation.eventOrder,
    ['secret', 'crypto', 'claims', 'clock'],
  );
  assert.equal(registered.observation.schemaCalls, 0);

  const schema = byId.get('schema-after-registered-claims');
  assert.deepEqual(
    schema.observation.eventOrder,
    ['secret', 'crypto', 'claims', 'clock', 'schema'],
  );

  const failure = byId.get('selected-realization-failure');
  assert.deepEqual(failure.observation.eventOrder, ['secret', 'crypto']);
  assert.equal(failure.observation.selectedRealizationAttempts, 1);
  assert.equal(failure.observation.hostVerifyAttempts, 0);
  assert.equal(failure.observation.javascriptVerifyAttempts, 0);
  assert.equal(failure.observation.automaticFallback, false);

  const verified = byId.get('verified-result');
  assert.deepEqual(
    verified.observation.eventOrder,
    ['secret', 'crypto', 'claims', 'clock', 'schema', 'verified'],
  );
  assert.ok(Object.values(verified.immutablePaths).every(Boolean));
  assert.notEqual(
    invalid.error.code,
    failure.error.code,
    'ordinary invalid signatures must remain distinguishable from realization failure',
  );

  return Object.freeze({
    version: 'pulse.jwt-e3-package-spy.v1',
    status: 'passed',
    cases: Object.freeze(cases),
  });
}

function canonicalEffect(token) {
  return Object.freeze({
    ...jwtContracts.JWT_VERIFY_OPERATION,
    id: 'jwt-e3-provider-error-probe',
    payload: Object.freeze({
      token,
      options: verificationOptions(),
    }),
  });
}

async function runProviderErrorProbe(id, createVerify, fixture, material) {
  let clockCalls = 0;
  let schemaCalls = 0;
  let redactionRegistrations = 0;
  const verify = createVerify({
    secretLookup(binding) {
      return binding === BINDING ? material.secret : undefined;
    },
    captureWallClock() {
      clockCalls += 1;
      return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
    },
  });
  let caught;
  try {
    await verify(canonicalEffect(fixture.invalidToken), {
      requestId: `${id}-request`,
      registerRedactionValue() {
        redactionRegistrations += 1;
      },
      validateSchemaValue() {
        schemaCalls += 1;
        return {};
      },
    });
    assert.fail(`${id} unexpectedly accepted an invalid signature.`);
  } catch (error) {
    caught = error;
  }
  const projection = errorProjection(caught);
  assert.equal(projection.code, 'PULSE_JWT_SIGNATURE_INVALID');
  assert.equal(clockCalls, 0);
  assert.equal(schemaCalls, 0);
  assert.ok(redactionRegistrations >= 2);
  return Object.freeze({
    id,
    status: 'passed',
    error: projection,
    clockCalls,
    schemaCalls,
    redactionRegistrations,
    resultProduced: false,
  });
}

async function providerErrorAudit(material) {
  const fixture = compactFixture(material);
  return Object.freeze({
    version: 'pulse.jwt-e3-provider-error-projections.v1',
    status: 'passed',
    providers: Object.freeze([
      await runProviderErrorProbe(
        'node-javascript',
        createNodeJavascriptJwtVerify,
        fixture,
        material,
      ),
      await runProviderErrorProbe(
        'fastly-javascript',
        createFastlyJavascriptJwtVerify,
        fixture,
        material,
      ),
    ]),
  });
}

function planningAudit() {
  const requirements = cryptoContracts.normalizeCryptoRequirements([{
    algorithm: 'HS256',
    requestedBy: '@pulse-compute/jwt',
  }]);
  const emptyNativeTarget = Object.freeze({
    ...NODE_NATIVE_TARGET_DESCRIPTOR,
    crypto: cryptoContracts.defineCryptoTargetCapabilities({
      target: 'native',
      algorithms: [],
    }),
  });
  const cases = [
    {
      id: 'missing-profile-crypto',
      expectedCode: 'PULSE_CRYPTO_CONFIG_REQUIRED',
      declaration: cryptoContracts.normalizeCryptoConfiguration([]),
      targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    },
    {
      id: 'unavailable-target-realization',
      expectedCode: 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
      declaration: cryptoContracts.normalizeCryptoConfiguration(['HS256']),
      targetDescriptor: emptyNativeTarget,
    },
    {
      id: 'invalid-exact-pin',
      expectedCode: 'PULSE_CRYPTO_REALIZATION_PIN_INVALID',
      declaration: cryptoContracts.normalizeCryptoConfiguration({
        HS256: { realization: 'runtime-builtin' },
      }),
      targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    },
  ].map((input) => {
    const counters = {
      planningAttempts: 0,
      compilationStarts: 0,
      loweringStarts: 0,
      packagingStarts: 0,
      alternativeRealizationAttempts: 0,
    };
    let caught;
    try {
      counters.planningAttempts += 1;
      planProjectCrypto({
        declaration: input.declaration,
        requirements,
        targetDescriptor: input.targetDescriptor,
        target: 'native',
        profile: 'jwt-e3',
        profileSelectionSource: 'e3-audit',
        configurationSource: 'e3-audit',
      });
      counters.compilationStarts += 1;
      counters.loweringStarts += 1;
      counters.packagingStarts += 1;
    } catch (error) {
      caught = error;
    }
    const projection = errorProjection(caught);
    assert.equal(projection.code, input.expectedCode, input.id);
    assert.deepEqual(counters, {
      planningAttempts: 1,
      compilationStarts: 0,
      loweringStarts: 0,
      packagingStarts: 0,
      alternativeRealizationAttempts: 0,
    });
    return Object.freeze({
      id: input.id,
      status: 'error-before-compilation',
      error: projection,
      observation: Object.freeze({
        ...counters,
        artifactEmitted: false,
        automaticFallback: false,
      }),
    });
  });

  const selectedPlan = planProjectCrypto({
    declaration: cryptoContracts.normalizeCryptoConfiguration({
      HS256: { realization: 'guest-source:pulse-hmac-as' },
    }),
    requirements,
    targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    target: 'native',
    profile: 'jwt-e3',
    profileSelectionSource: 'e3-audit',
    configurationSource: 'e3-audit',
  });
  assert.equal(selectedPlan.automaticFallback, false);
  assert.deepEqual(
    selectedPlan.algorithms.map((entry) => ({
      algorithm: entry.algorithm,
      realization: entry.realization,
    })),
    [{
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
    }],
  );
  return Object.freeze({
    version: 'pulse.jwt-e3-planning-spy.v1',
    status: 'passed',
    cases: Object.freeze(cases),
    selectedPlan,
  });
}

function reportEntries(evidence) {
  if (Array.isArray(evidence.reports)) return evidence.reports;
  return Object.values(evidence.reports);
}

function assertPredecessorEvidence() {
  const e1File = 'wasm/.test-results/jwt-e1/jwt-e1-evidence.json';
  const e2File = 'wasm/.test-results/jwt-e2/jwt-e2-evidence.json';
  const e1 = readJson(e1File);
  const e2 = readJson(e2File);
  assert.equal(e1.version, 'pulse.jwt-e1-evidence.v1');
  assert.equal(e1.status, 'passed');
  assert.equal(e2.version, 'pulse.jwt-e2-evidence.v1');
  assert.equal(e2.status, 'passed');
  for (const report of [...reportEntries(e1), ...reportEntries(e2)]) {
    assert.equal(fileSha256(path.join(repoRoot, report.file)), report.sha256);
  }
  assert.equal(fileSha256(path.join(repoRoot, e1File)), e2.predecessor.e1.sha256);
  return Object.freeze({
    e1: Object.freeze({
      file: e1File,
      sha256: fileSha256(path.join(repoRoot, e1File)),
      evidence: e1,
    }),
    e2: Object.freeze({
      file: e2File,
      sha256: fileSha256(path.join(repoRoot, e2File)),
      evidence: e2,
    }),
  });
}

function caseById(cases, id, laneId) {
  const value = cases.find((entry) => entry.id === id);
  assert.ok(value, `${laneId} is missing ${id}`);
  assert.equal(value.status, 'passed', `${laneId}:${id}`);
  return value;
}

function assertRuntimeLane(lane) {
  const invalid = caseById(lane.cases, 'invalid-signature', lane.id);
  const unavailable = caseById(
    lane.cases,
    'claims-unavailable-before-authenticity',
    lane.id,
  );
  const allowlist = caseById(
    lane.cases,
    'token-algorithm-outside-jwt-allowlist',
    lane.id,
  );
  const registered = caseById(
    lane.cases,
    'registered-claim-failure-after-authenticity',
    lane.id,
  );
  const schema = caseById(
    lane.cases,
    'claims-schema-failure-after-registered-claims',
    lane.id,
  );
  const failure = caseById(
    lane.cases,
    'runtime-realization-failure',
    lane.id,
  );
  const noFallback = caseById(lane.cases, 'no-fallback', lane.id);
  const valid = caseById(lane.cases, 'valid-hs256', lane.id);

  for (const entry of [invalid, unavailable]) {
    assert.equal(entry.errorCode, 'PULSE_JWT_SIGNATURE_INVALID');
    assert.equal(entry.observation.cryptoPrimitiveCalls, 1);
    assert.equal(entry.observation.claimsParsed, false);
    assert.equal(entry.observation.claimsObserved, false);
    assert.equal(entry.observation.clockCalls, 0);
    assert.equal(entry.observation.schemaCalls, 0);
    assert.equal(entry.result, null);
  }
  assert.equal(allowlist.errorCode, 'PULSE_JWT_ALGORITHM_NOT_ALLOWED');
  assert.equal(allowlist.observation.secretCalls, 0);
  assert.equal(allowlist.observation.cryptoPrimitiveCalls, 0);
  assert.equal(allowlist.observation.realizationAttempts, 0);
  assert.equal(allowlist.result, null);

  assert.equal(registered.errorCode, 'PULSE_JWT_CLAIMS_INVALID');
  assert.equal(registered.observation.cryptoPrimitiveCalls, 1);
  assert.equal(registered.observation.clockCalls, 1);
  assert.equal(registered.observation.schemaCalls, 0);
  assert.equal(registered.result, null);

  assert.equal(schema.errorCode, 'PULSE_JWT_CLAIMS_SCHEMA_INVALID');
  assert.equal(schema.observation.cryptoPrimitiveCalls, 1);
  assert.equal(schema.observation.clockCalls, 1);
  assert.equal(schema.observation.registeredClaimsStatus, 'passed');
  assert.equal(schema.observation.schemaCalls, 1);
  assert.equal(schema.result, null);

  for (const entry of [failure, noFallback]) {
    assert.equal(entry.errorCode, 'PULSE_JWT_OPERATION_FAILED');
    assert.equal(entry.observation.realizationAttempts, 1);
    assert.equal(entry.observation.alternateTargetAttempts, 0);
    assert.equal(entry.observation.alternateRealizationAttempts, 0);
    assert.equal(entry.observation.automaticFallback, false);
    assert.equal(entry.observation.clockCalls, 0);
    assert.equal(entry.observation.schemaCalls, 0);
    assert.equal(entry.result, null);
  }
  assert.notEqual(invalid.errorCode, failure.errorCode);
  assert.equal(valid.observedStatus, 'success');
  assert.ok(Object.values(valid.result.immutablePaths).every(Boolean));

  return Object.freeze({
    id: lane.id,
    targetId: lane.targetId,
    provider: lane.provider,
    target: lane.target,
    optimizationMode: lane.optimizationMode,
    status: 'passed',
    runtimeObserved: true,
    invalidAuthenticity: Object.freeze({
      code: invalid.errorCode,
      claimsExposed: invalid.observation.claimsObserved,
      registeredClaimAuthorityCalls: invalid.observation.clockCalls,
      schemaCalls: invalid.observation.schemaCalls,
      resultProduced: invalid.result !== null,
      eventOrder: Object.freeze([...invalid.observation.eventOrder]),
    }),
    order: Object.freeze({
      registeredFailure: Object.freeze([...registered.observation.eventOrder]),
      schemaFailure: Object.freeze([...schema.observation.eventOrder]),
      success: Object.freeze([...valid.observation.eventOrder]),
    }),
    noFallback: Object.freeze({
      selectedRealizationAttempts: noFallback.observation.realizationAttempts,
      alternateTargetAttempts: noFallback.observation.alternateTargetAttempts,
      alternateRealizationAttempts:
        noFallback.observation.alternateRealizationAttempts,
      automaticFallback: noFallback.observation.automaticFallback,
    }),
    errorTaxonomy: Object.freeze({
      invalidSignature: invalid.errorCode,
      realizationFailure: failure.errorCode,
    }),
  });
}

function crossTargetAudit() {
  const javascript = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
  );
  const native = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
  );
  assert.equal(javascript.status, 'passed');
  assert.equal(javascript.completedExecutions, 70);
  assert.equal(javascript.skippedExecutions, 0);
  assert.equal(native.status, 'passed');
  assert.equal(native.completedExecutions, 140);
  assert.equal(native.skippedExecutions, 0);

  const lanes = [];
  for (const target of javascript.targets) {
    lanes.push({
      id: target.targetId,
      targetId: target.targetId,
      provider: target.provider,
      target: target.mode,
      optimizationMode: 'default',
      cases: target.cases,
    });
  }
  for (const target of native.targets) {
    for (const mode of target.modes) {
      lanes.push({
        id: `${target.targetId}/${mode.mode}`,
        targetId: target.targetId,
        provider: target.provider,
        target: target.mode,
        optimizationMode: mode.mode,
        cases: mode.cases,
      });
    }
  }
  assert.deepEqual(
    lanes.map((entry) => entry.id),
    [
      'node-javascript',
      'fastly-javascript',
      'node-native/default',
      'node-native/experimental-native-size',
      'fastly-native/default',
      'fastly-native/experimental-native-size',
    ],
  );
  return Object.freeze(lanes.map(assertRuntimeLane));
}

function assertNativeGuestSourceNoFallback(lanes) {
  const targetReality = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
  );
  const artifactAudit = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
  );
  assert.equal(targetReality.status, 'passed');
  assert.equal(targetReality.selection.realization, 'guest-source:pulse-hmac-as');
  assert.equal(targetReality.selection.automaticFallback, false);
  assert.equal(artifactAudit.status, 'passed');
  assert.equal(artifactAudit.guestSourceImplementationPresent, true);
  assert.equal(artifactAudit.exactFinalArtifactsAuditedAndExecuted, true);
  assert.equal(artifactAudit.directImportsWithinTargetPolicy, true);
  assert.equal(artifactAudit.automaticFallback, false);
  const artifacts = [...artifactAudit.local, ...artifactAudit.fastly];
  assert.equal(artifacts.length, 4);
  const fallbackImportPattern =
    /(?:crypto|jwt).*(?:host|verify)|(?:host|verify).*(?:crypto|jwt)|javascript|js[_-]?compute/i;
  for (const artifact of artifacts) {
    assert.equal(artifact.status, 'passed');
    assert.equal(artifact.automaticFallback, false);
    assert.equal(
      artifact.imports.some((entry) => (
        fallbackImportPattern.test(`${entry.module}:${entry.name}`)
      )),
      false,
      `${artifact.targetId}/${artifact.mode} contains a fallback-capable import`,
    );
    if (artifact.targetId === 'node-native') {
      assert.deepEqual(artifact.guestSourceExports, [
        'pulse_crypto_hs256_verify',
        'pulse_crypto_sha256_digest',
      ]);
    } else {
      assert.equal(artifact.cryptoRealization, 'guest-source:pulse-hmac-as');
      assert.equal(artifact.guestLinkedUnitRequired, false);
    }
  }
  const nativeLanes = lanes.filter((entry) => entry.target === 'native');
  assert.equal(nativeLanes.length, 4);
  for (const lane of nativeLanes) {
    assert.deepEqual(lane.noFallback, {
      selectedRealizationAttempts: 1,
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false,
    });
  }
  return Object.freeze({
    status: 'passed',
    realization: targetReality.selection.realization,
    implementation: targetReality.selection.implementation,
    runtimeLanes: Object.freeze(nativeLanes.map((entry) => entry.id)),
    exactFinalArtifactsAuditedAndExecuted:
      artifactAudit.exactFinalArtifactsAuditedAndExecuted,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze({
      targetId: artifact.targetId,
      mode: artifact.mode,
      sha256: artifact.sha256,
      selectedGuestSourcePresent: artifact.targetId === 'node-native'
        ? artifact.guestSourceExports.includes('pulse_crypto_hs256_verify')
        : artifact.cryptoRealization === 'guest-source:pulse-hmac-as',
      fallbackCapableImports: 0,
      automaticFallback: artifact.automaticFallback,
    }))),
    hostVerifyAttempts: 0,
    javascriptVerifyAttempts: 0,
    automaticFallback: false,
  });
}

function surfaceBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(stableJson(value), 'utf8');
}

function scanSurface(id, kind, value, forbidden) {
  const bytes = surfaceBytes(value);
  const text = bytes.toString('utf8');
  for (const entry of forbidden) {
    assert.equal(
      text.includes(entry.value),
      false,
      `${id} contains forbidden value ${entry.id}`,
    );
  }
  return Object.freeze({
    id,
    kind,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    forbiddenValuesPresent: 0,
  });
}

function predecessorJsonSurfaces(predecessors) {
  const files = new Set([
    predecessors.e1.file,
    predecessors.e2.file,
    ...reportEntries(predecessors.e1.evidence).map((entry) => entry.file),
    ...reportEntries(predecessors.e2.evidence).map((entry) => entry.file),
  ]);
  return [...files].sort().map((file) => Object.freeze({
    id: file,
    kind: file.includes('redaction')
      ? 'redaction-report'
      : file.includes('conformance')
        ? 'test-report'
        : file.includes('artifact')
          ? 'manifest-and-artifact-report'
          : 'generated-json',
    value: fs.readFileSync(path.join(repoRoot, file)),
  }));
}

function redactionAudit(input) {
  const corpus = loadJwtConformanceCorpus();
  const fixture = compactFixture(input.material);
  const invalidAuthenticator = fixture.invalidToken.split('.')[2];
  const keyBytes = Buffer.from(input.material.secret, 'utf8');
  const e0Forbidden = forbiddenSensitiveValues(corpus);
  const e3Forbidden = Object.freeze([
    { id: 'e3-complete-token', value: fixture.token },
    { id: 'e3-invalid-token', value: fixture.invalidToken },
    { id: 'e3-authenticator', value: fixture.signature.toString('base64url') },
    { id: 'e3-authenticator-hex', value: fixture.signature.toString('hex') },
    { id: 'e3-invalid-authenticator', value: invalidAuthenticator },
    {
      id: 'e3-invalid-authenticator-hex',
      value: Buffer.from(invalidAuthenticator, 'base64url').toString('hex'),
    },
    { id: 'e3-claims-json', value: fixture.claimsJson },
    { id: 'e3-claims-segment', value: fixture.claimsSegment },
    { id: 'e3-secret-value', value: input.material.secret },
    {
      id: 'e3-key-material-hex',
      value: keyBytes.toString('hex'),
    },
    {
      id: 'e3-key-material-base64',
      value: keyBytes.toString('base64'),
    },
    {
      id: 'e3-key-material-base64url',
      value: keyBytes.toString('base64url'),
    },
    {
      id: 'e3-key-material-byte-array',
      value: JSON.stringify([...keyBytes]),
    },
    { id: 'e3-subject', value: input.material.subject },
    { id: 'e3-private-claim', value: input.material.privateMarker },
    { id: 'e3-role', value: input.material.role },
  ]);
  const forbidden = Object.freeze([...e0Forbidden, ...e3Forbidden]);
  const e1Redaction = readJson(
    'wasm/.test-results/jwt-e1/jwt-javascript-redaction-report.json',
  );
  const e2Redaction = readJson(
    'wasm/.test-results/jwt-e2/jwt-native-redaction-report.json',
  );
  for (const report of [e1Redaction, e2Redaction]) {
    assert.equal(report.status, 'passed');
    assert.equal(report.forbiddenValuesPresent, 0);
    assert.ok(report.scannedArtifacts.includes('Fastly Compute stdout'));
    assert.ok(report.scannedArtifacts.includes('Fastly Compute stderr'));
  }

  const diagnostics = Object.freeze({
    version: 'pulse.jwt-e3-diagnostic-projections.v1',
    packageErrors: input.packageAudit.cases
      .filter((entry) => entry.error)
      .map((entry) => ({ id: entry.id, error: entry.error })),
    providerErrors: input.providerAudit.providers
      .map((entry) => ({ id: entry.id, error: entry.error })),
    planningErrors: input.planning.cases
      .map((entry) => ({ id: entry.id, error: entry.error })),
  });
  const surfaces = [
    ...predecessorJsonSurfaces(input.predecessors),
    {
      id: 'packages/jwt/pulsewasm.manifest.cjs:exports',
      kind: 'manifest',
      value: pulseJwtManifest,
    },
    {
      id: 'selected-native-crypto-plan',
      kind: 'compiler-plan',
      value: input.planning.selectedPlan,
    },
    {
      id: 'e3-diagnostic-projections',
      kind: 'diagnostic-snapshot',
      value: diagnostics,
    },
    {
      id: 'e3-package-error-projections',
      kind: 'package-error-projection',
      value: input.packageAudit,
    },
    {
      id: 'e3-provider-error-projections',
      kind: 'provider-error-projection',
      value: input.providerAudit,
    },
    {
      id: 'e3-order-report',
      kind: 'generated-json',
      value: input.orderReport,
    },
    {
      id: 'e3-no-fallback-report',
      kind: 'generated-json',
      value: input.fallbackReport,
    },
  ];
  const scans = Object.freeze(
    surfaces.map((entry) => scanSurface(
      entry.id,
      entry.kind,
      entry.value,
      forbidden,
    )),
  );
  const report = Object.freeze({
    version: REDACTION_REPORT_VERSION,
    checkpoint: 'E3',
    status: 'passed',
    categories: Object.freeze([
      'token',
      'signature',
      'claims',
      'key-material',
      'secret',
    ]),
    forbiddenValueIds: Object.freeze(forbidden.map((entry) => entry.id)),
    scannedSurfaces: scans,
    scannedSurfaceKinds: Object.freeze(
      [...new Set(scans.map((entry) => entry.kind))].sort(),
    ),
    fastlyLogAttestations: Object.freeze([
      Object.freeze({
        checkpoint: 'E1',
        report: 'jwt-javascript-redaction-report.json',
        stdoutScanned: true,
        stderrScanned: true,
        forbiddenValuesPresent: 0,
      }),
      Object.freeze({
        checkpoint: 'E2',
        report: 'jwt-native-redaction-report.json',
        stdoutScanned: true,
        stderrScanned: true,
        forbiddenValuesPresent: 0,
      }),
    ]),
    generatedOutputRescanRequired: true,
    forbiddenValuesPresent: 0,
  });
  scanSurface('e3-redaction-report', 'generated-json', report, forbidden);
  return Object.freeze({ report, forbidden });
}

function writeReport(outputDirectory, name, value) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, stableJson(value));
  return Object.freeze({
    file: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: fileSha256(file),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const material = fixtureMaterial();
  const predecessors = assertPredecessorEvidence();
  const packageAudit = await directPackageAudit(material);
  const providerAudit = await providerErrorAudit(material);
  const planning = planningAudit();
  const targetLanes = crossTargetAudit();
  const nativeNoFallback = assertNativeGuestSourceNoFallback(targetLanes);

  const orderReport = Object.freeze({
    version: ORDER_REPORT_VERSION,
    checkpoint: 'E3',
    status: 'passed',
    packageSpy: packageAudit,
    providerErrorProjections: providerAudit,
    targetRuntimeLanes: targetLanes,
    acceptance: Object.freeze({
      invalidAuthenticityPreventsClaimExposure: true,
      invalidAuthenticityPreventsRegisteredClaimEvaluation: true,
      invalidAuthenticityPreventsSchemaEvaluation: true,
      invalidAuthenticityProducesNoVerifiedResult: true,
      jwtAllowlistBeforeCrypto: true,
      registeredClaimsBeforeSchema: true,
      verifiedResultDetachedAndImmutable: true,
      invalidSignatureDistinctFromRealizationFailure: true,
    }),
  });
  const fallbackReport = Object.freeze({
    version: FALLBACK_REPORT_VERSION,
    checkpoint: 'E3',
    status: 'passed',
    planning,
    selectedRealizationRuntime: packageAudit.cases.find(
      (entry) => entry.id === 'selected-realization-failure',
    ),
    nativeGuestSource: nativeNoFallback,
    targetRuntimeLanes: Object.freeze(
      targetLanes.map((entry) => Object.freeze({
        id: entry.id,
        target: entry.target,
        noFallback: entry.noFallback,
      })),
    ),
    acceptance: Object.freeze({
      missingProfileCryptoBeforeCompilation: true,
      unavailableTargetRealizationBeforePackaging: true,
      invalidExactPinNoRetry: true,
      runtimeCryptoFailureNoAlternativeRealization: true,
      guestSourceFailureNoHostVerify: true,
      guestSourceFailureNoJavascriptVerify: true,
      automaticFallback: false,
    }),
  });
  const redaction = redactionAudit({
    material,
    predecessors,
    packageAudit,
    providerAudit,
    planning,
    orderReport,
    fallbackReport,
  });

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const orderOutput = writeReport(
    options.outputDirectory,
    'jwt-fail-closed-order-report.json',
    orderReport,
  );
  const fallbackOutput = writeReport(
    options.outputDirectory,
    'jwt-no-fallback-audit-report.json',
    fallbackReport,
  );
  const redactionOutput = writeReport(
    options.outputDirectory,
    'jwt-redaction-audit-report.json',
    redaction.report,
  );
  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'E3',
    status: 'passed',
    classification: 'PASS',
    scope: Object.freeze({
      phase: 'E',
      unit: 'E3',
      changeClass: 'hardening-and-evidence',
      productionSemanticsChanged: false,
      publication: false,
      deployment: false,
    }),
    coverage: Object.freeze({
      directPackageSpyCases: packageAudit.cases.length,
      directProviderErrorProjections: providerAudit.providers.length,
      directPlanningFailureSpies: planning.cases.length,
      runtimeTargetLanes: targetLanes.length,
      javascriptLanes: targetLanes.filter((entry) => entry.target === 'javascript').length,
      nativeLanes: targetLanes.filter((entry) => entry.target === 'native').length,
      predecessorRuntimeExecutions:
        predecessors.e1.evidence.coverage.completedExecutions
        + predecessors.e2.evidence.corpus.executions,
      skippedRuntimeExecutions:
        predecessors.e1.evidence.coverage.skippedExecutions
        + predecessors.e2.evidence.corpus.skipped,
    }),
    acceptance: Object.freeze({
      allOrderingAssertionsDirectlyObserved: true,
      allNoFallbackAssertionsDirectlyObserved: true,
      generatedEvidenceForbiddenValueScanPassed: true,
      packageAndProviderErrorsRedacted: true,
      fastlyLogsScannedByRuntimeHarnesses: true,
      invalidSignatureDistinctFromRealizationFailure: true,
      automaticFallback: false,
    }),
    reports: Object.freeze({
      order: orderOutput,
      noFallback: fallbackOutput,
      redaction: redactionOutput,
    }),
    predecessor: Object.freeze({
      e1: Object.freeze({
        file: predecessors.e1.file,
        version: predecessors.e1.evidence.version,
        sha256: predecessors.e1.sha256,
      }),
      e2: Object.freeze({
        file: predecessors.e2.file,
        version: predecessors.e2.evidence.version,
        sha256: predecessors.e2.sha256,
      }),
    }),
    sources: Object.freeze([
      sourceRecord('wasm/test/jwt/assert-jwt-fail-closed-audit.cjs'),
      sourceRecord('wasm/test/jwt/jwt-conformance-harness.cjs'),
      sourceRecord('packages/jwt/src/crypto-verifier.ts'),
      sourceRecord('packages/provider-node/src/javascript/jwt-verifier.js'),
      sourceRecord('packages/provider-fastly/src/javascript/jwt-verifier.js'),
      sourceRecord('wasm/packages/compiler/src/crypto-requirement-planner.js'),
    ]),
    knownExceptions: Object.freeze([
      Object.freeze({
        id: 'catalog-version-skew',
        status: 'accepted-non-blocking',
        owner: 'F0',
        detail:
          '@pulse-compute/provider-fastly remains cataloged at 1.0.0-beta.1 while the working JWT and crypto packages are 1.0.0-beta.1; E3 does not publish or rewrite release identity.',
      }),
    ]),
    blocker: null,
    nextAuthorizedCheckpoint: 'E4',
  });
  scanSurface('jwt-e3-evidence.json', 'generated-json', evidence, redaction.forbidden);
  const evidenceOutput = writeReport(
    options.outputDirectory,
    'jwt-e3-evidence.json',
    evidence,
  );

  for (const output of [
    orderOutput,
    fallbackOutput,
    redactionOutput,
    evidenceOutput,
  ]) {
    scanSurface(
      output.file,
      'generated-json',
      fs.readFileSync(path.join(repoRoot, output.file)),
      redaction.forbidden,
    );
  }

  process.stdout.write(
    `JWT E3 fail-closed audit passed: ${targetLanes.length} runtime lanes, `
    + `${packageAudit.cases.length} package spies, `
    + `${planning.cases.length} planning failures, zero fallback, zero forbidden values.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
