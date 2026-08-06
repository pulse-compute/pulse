#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h4');
const OBSERVED_AT = '2026-07-31';
const STARTING_SNAPSHOT = Object.freeze({
  archive: 'pulse-boundary-h3-implemented.zip',
  sha256: 'ed2c066bb91e596a3e4796001a3f1293cd7b22237e1a713485067a6f4b2b67bc'
});

process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-fastly/src/javascript/target.js');
const {
  FASTLY_JAVASCRIPT_JWT_REALIZATION,
  FASTLY_JAVASCRIPT_JWT_REALIZATIONS,
  FASTLY_JAVASCRIPT_JWT_VERIFIER_VERSION,
  createFastlyJavascriptJwtVerify
} = require('../../../packages/provider-fastly/src/javascript/jwt-verifier.js');
const {
  classifyFastlyJavascriptCapability,
  classifyFastlyJavascriptProviderRequirement
} = require('../../../packages/provider-fastly/src/javascript/target-support-policy.js');
const {
  NOW,
  SUBJECT,
  loadEs256ConformanceCorpus,
  materializeEs256ConformanceCases
} = require('../jwt/jwt-es256-conformance-harness.cjs');

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])])
  );
}

function writeJson(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, `${JSON.stringify(stable(value), null, 2)}\n`);
  return Object.freeze({
    file: path.relative(repoRoot, target).replace(/\\/g, '/'),
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

function writeText(name, value) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, value);
  return Object.freeze({
    file: path.relative(repoRoot, target).replace(/\\/g, '/'),
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

async function assertFastlyAdapter() {
  const materialized = materializeEs256ConformanceCases(
    loadEs256ConformanceCorpus()
  );
  const valid = materialized.cases.find((entry) => entry.id === 'valid-inline-jwk');
  const invalid = materialized.cases.find((entry) => entry.id === 'wrong-signature');
  assert.ok(valid && invalid);
  const verify = createFastlyJavascriptJwtVerify({
    captureWallClock() {
      return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
    }
  });
  const execution = Object.freeze({ registerRedactionValue() {} });
  const output = await verify(Object.freeze({
    ...jwtContracts.JWT_VERIFY_OPERATION,
    id: 'boundary-h4-valid-es256',
    payload: valid.input
  }), execution);
  assert.equal(output.protectedHeader.alg, 'ES256');
  assert.equal(output.claims.sub, SUBJECT);
  await assert.rejects(
    () => verify(Object.freeze({
      ...jwtContracts.JWT_VERIFY_OPERATION,
      id: 'boundary-h4-invalid-es256',
      payload: invalid.input
    }), execution),
    (error) => error && error.code === 'PULSE_JWT_SIGNATURE_INVALID'
  );
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  assert.deepEqual(
    cryptoContracts.CRYPTO_ES256_CONTRACT.runtimeBuiltin.eligibleTargets,
    ['node-javascript', 'fastly-javascript']
  );
  assert.equal(
    cryptoContracts.CRYPTO_ES256_CONTRACT.automaticFallback,
    false
  );
  assert.deepEqual(
    FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms.map((entry) => ({
      algorithm: entry.algorithm,
      realization: entry.realization,
      implemented: entry.implemented
    })),
    [
      { algorithm: 'ES256', realization: 'runtime-builtin', implemented: true },
      { algorithm: 'HS256', realization: 'runtime-builtin', implemented: true }
    ]
  );
  assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.automaticFallback, false);
  assert.deepEqual(FASTLY_JAVASCRIPT_JWT_REALIZATIONS, {
    HS256: {
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implementation: cryptoContracts.CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
      automaticFallback: false
    },
    ES256: {
      algorithm: 'ES256',
      realization: 'runtime-builtin',
      implementation: cryptoContracts.CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
      automaticFallback: false
    }
  });
  assert.equal(FASTLY_JAVASCRIPT_JWT_REALIZATION, FASTLY_JAVASCRIPT_JWT_REALIZATIONS.HS256);
  assert.equal(FASTLY_JAVASCRIPT_JWT_VERIFIER_VERSION, 'pulse.fastly-javascript-jwt-verifier.v2');
  assert.deepEqual(
    jwtContracts.JWT_TARGET_REALIZATIONS.fastly.javascript.algorithms,
    ['HS256', 'ES256']
  );
  assert.deepEqual(
    jwtContracts.JWT_TARGET_REALIZATIONS.fastly.javascript.keyTypes,
    ['secret', 'jwk', 'jwks']
  );
  for (const classify of [
    classifyFastlyJavascriptCapability,
    classifyFastlyJavascriptProviderRequirement
  ]) {
    assert.equal(classify('jwt.verify.es256').status, 'eligible');
    assert.equal(classify('jwt.verify.rs256').status, 'blocked');
  }

  const pulseTypes = read('packages/pulse/src/index.d.ts');
  assert.match(pulseTypes, /export type PulseCryptoAlgorithm = 'HS256' \| 'ES256';/);
  assert.match(pulseTypes, /'guest-linked:pulse-es256-rustcrypto-p256'/);
  const cryptoTypes = read('packages/crypto/src/contracts.ts');
  assert.match(cryptoTypes, /'node-javascript',\s*'fastly-javascript',/);
  const verifierSource = read('packages/provider-fastly/src/javascript/jwt-verifier.js');
  assert.doesNotMatch(verifierSource, /algorithm\) => algorithm !== 'HS256'/);
  assert.doesNotMatch(verifierSource, /automaticFallback:\s*true/);
  assert.match(verifierSource, /cryptoProvider\.crypto\.signature/);
  const realizationSource = read('packages/crypto/src/internal/realization.ts');
  assert.match(realizationSource, /validP256Point/);
  assert.match(realizationSource, /subtle\.importKey\(\s*'jwk'/);
  assert.doesNotMatch(realizationSource, /(?:process\.env|navigator\.userAgent|PULSE_TARGET|PULSE_PROVIDER)/);

  const architecture = read('docs/architecture/current-contracts.md');
  const lowering = read('docs/concepts/package-owned-lowering.md');
  const compatibility = read('docs/reference/compatibility-matrix.md');
  assert.match(architecture, /The executable algorithm set is\s+HS256 and ES256/);
  assert.match(architecture, /six-cell 38-case matrix/);
  assert.match(lowering, /ES256 Native\s+contributes one exact prebuilt guest unit/);
  assert.match(compatibility, /\| ES256 signature verification \| `runtime-builtin` \| `runtime-builtin` \|/);

  await assertFastlyAdapter();

  const matrixFile = path.join(outputDirectory, 'es256-six-cell-matrix.json');
  assert.equal(fs.existsSync(matrixFile), true, 'run jwt-es256-six-cell before boundary-authority-h4');
  const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
  assert.equal(matrix.version, 'pulse.jwt-es256-six-cell-matrix.h4.v1');
  assert.equal(matrix.status, 'PASS');
  assert.equal(matrix.requiredCellCount, 6);
  assert.equal(matrix.corpusCases, 38);
  assert.equal(matrix.completedSemanticEvaluations, 228);
  assert.equal(matrix.skippedRequiredEvaluations, 0);
  assert.equal(matrix.exactInputOutputFailureParity, true);
  assert.equal(matrix.automaticFallback, false);

  const shapeContract = Object.freeze({
    version: 'pulse.boundary-crypto-jwt-shape.h4.v1',
    stage: 'H4',
    status: 'PASS',
    observedAt: OBSERVED_AT,
    startingSnapshot: STARTING_SNAPSHOT,
    semanticOwner: '@pulse-compute/crypto',
    packageOwner: '@pulse-compute/jwt',
    providerEligibilityOwner: '@pulse-compute/provider-fastly',
    publicConfigurationOwner: '@pulse-compute/pulse',
    algorithms: Object.freeze(['HS256', 'ES256']),
    fastlyJavascript: Object.freeze({
      targetId: 'fastly-javascript',
      realization: 'runtime-builtin',
      implementation: cryptoContracts.CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
      publicKeyInput: 'p256-public-key-bytes',
      runtimePrivateKeyImport: 'jwk',
      preImportPointValidation: true,
      corpusCases: 38,
      viceroyExecuted: true
    }),
    sixCellMatrix: Object.freeze({
      requiredCells: 6,
      semanticEvaluations: 228,
      skipped: 0,
      parity: 'exact-input-output-failure'
    }),
    closedFindings: Object.freeze(['H0-B012', 'H0-B015']),
    preserved: Object.freeze([
      'H1 exact package contribution contracts',
      'H2 guest-link invocation and final-artifact authorization',
      'H3 provider invocation and result contracts',
      'H0-B013 canonical Native plan and requirement plan-hash authority',
      'provider-neutral crypto request and result taxonomy',
      'no automatic fallback'
    ]),
    policy: Object.freeze({
      alternateAlgorithmAuthorized: false,
      alternateTargetAuthorized: false,
      alternateProviderAuthorized: false,
      alternateRealizationAuthorized: false,
      automaticFallback: false
    })
  });
  const shapeOutput = writeJson('crypto-jwt-boundary-shape.json', shapeContract);
  const handoffOutput = writeText('boundary-h4-handoff.md', `# Pulse boundary lock H4 completion handoff

**Schema:** \`pulse.boundary-h4-handoff.v1\`  
**H4 result:** PASS  
**Boundary-lock sprint:** COMPLETE  
**Next authorized focus:** Entities boundary design and implementation  
**Recommended GPT-5.6 effort:** \`xhigh\`

## H4 conclusion

\`H0-B012\` is closed. Crypto and JWT semantics, Fastly JavaScript target
eligibility, provider runtime behavior, runtime-neutral contract mirrors, and
public Pulse crypto types now agree on HS256 and ES256. Fastly JavaScript
executes the frozen 38-case ES256 corpus in its generated JavaScript runtime
Wasm under Viceroy. Its outcomes match Node JavaScript and both exact
default/size Node/Fastly Native artifacts: six required cells, 228 semantic
evaluations, zero skips, and no algorithm, realization, target, or provider
fallback.

The real engine exposed a raw P-256 import incompatibility and an invalid-point
engine trap. The crypto-owned adapter now validates the normalized 64-byte
point before constructing a runtime-private public JWK. The public byte
contract and closed result taxonomy did not change.

\`H0-B015\` is also closed by updating current architecture, package-lowering,
compatibility, and package documentation. \`H0-B014\` remains intentionally
deferred to post-beta compiler proof-command cleanup. \`H0-B013\` remains a
protected existing seam.

## Start Entities from these contracts

- consume package contributions only through the H1 envelope;
- keep guest units behind the H2 guest-link invocation/result boundary;
- request provider realization only through the H3 target invocation/result
  contracts;
- use the H4 runtime-neutral crypto/JWT requirements and public types as
  immutable neighboring contracts;
- preserve the canonical Native plan and provider-requirement plan hash.

Do not begin with a compiler reorganization, event mechanics, publication,
deployment, release promotion, or post-beta proof cleanup. Define Entities'
owner, author-facing shape, canonical operations, host authority, and exact
package/provider projections before adding realization code.
`);

  const report = Object.freeze({
    version: 'pulse.boundary-h4-report.v1',
    stage: 'H4',
    status: 'PASS',
    observedAt: OBSERVED_AT,
    startingSnapshot: STARTING_SNAPSHOT,
    changeClass: 'architecture',
    scope: 'architecture-change',
    humanDecision: 'provided-by-direct-H4-implementation-request-and-H3-handoff',
    protectedBoundariesReviewed: Object.freeze([
      'public-authoring-api',
      'provider-registry',
      'runtime-target-fluidity',
      'lowerer-trust'
    ]),
    closedFindings: shapeContract.closedFindings,
    validation: Object.freeze({
      focusedCommand: 'PULSE_VICEROY_BIN=<viceroy-0.20.1> node wasm/scripts/run-wasm-tests.cjs --task jwt-es256-six-cell --task boundary-authority-h4 --task target-support --task provider-fastly-package --task fastly-javascript-runtime --no-report',
      sixCellResult: 'PASS — 6 cells, 38 corpus cases, 228 semantic evaluations, 0 skipped',
      exactInputOutputFailureParity: true,
      fastlyJavascriptRealEngine: true,
      fastlyJavascriptRuntimeWasm: true,
      publicCryptoTypesAligned: true,
      providerCapabilityTruthAligned: true,
      runtimeSemanticsChanged: true,
      fallbackChanged: false,
      result: 'PASS'
    }),
    outputs: Object.freeze({
      shapeContract: shapeOutput,
      sixCellMatrix: Object.freeze({
        file: path.relative(repoRoot, matrixFile).replace(/\\/g, '/'),
        bytes: fs.statSync(matrixFile).size,
        sha256: sha256(fs.readFileSync(matrixFile))
      }),
      completionHandoff: handoffOutput
    }),
    remainingBoundaryDebt: Object.freeze([
      'H0-B014 → post-beta compiler proof-command cleanup'
    ]),
    protectedExistingSeams: Object.freeze([
      'H0-B013 canonical-native-plan and provider-requirement plan-hash authority'
    ]),
    nextAuthorizedFocus: 'Entities boundary design and implementation',
    stopConditionsEncountered: Object.freeze([]),
    risksOrBlockers: Object.freeze([])
  });
  writeJson('boundary-h4-report.json', report);
  console.log('ok - H4 closes H0-B012 and H0-B015 with six-cell ES256 parity, real Fastly JavaScript execution, exact boundary ownership, and no fallback');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
