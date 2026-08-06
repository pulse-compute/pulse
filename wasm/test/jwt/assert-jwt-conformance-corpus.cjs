#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  CORPUS_VERSION,
  REQUIRED_TARGET_IDS,
  REQUIRED_CASE_IDS,
  corpusFile,
  loadJwtConformanceCorpus,
  forbiddenSensitiveValues,
  createTargetHarnessManifest,
  assertTargetHarnessManifest
} = require('./jwt-conformance-harness.cjs');
const {
  getProviderDriver,
  getProviderTargetDescriptor
} = require('../../packages/compiler/src/provider-toolchain.js');

const SOURCE_FILES = Object.freeze([
  'wasm/test/jwt/jwt-conformance-corpus.json',
  'wasm/test/jwt/jwt-conformance-harness.cjs',
  'wasm/test/jwt/assert-jwt-conformance-corpus.cjs',
  'wasm/test/jwt/assert-jwt-realization-integration.cjs',
  'wasm/test/jwt/README.md'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-e0');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT E0 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceText(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function fileRecord(relative) {
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  return Object.freeze({
    file: relative,
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function runStage(id, command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 300000,
    shell: false
  });
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}` +
      `${detail ? `\n${detail}` : ''}`,
      { cause: result.error }
    );
  }
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
  const detail = options.assertOutput ? options.assertOutput(output) : undefined;
  return Object.freeze({
    id,
    status: 'passed',
    durationMs,
    ...(detail && typeof detail === 'object' ? detail : {})
  });
}

function assertD4Gate() {
  const relative = 'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json';
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  const seal = JSON.parse(bytes);
  assert.equal(seal.version, 'pulse.jwt-phase-d-seal.v1');
  assert.equal(seal.status, 'passed');
  assert.equal(seal.classification, 'PASS');
  assert.equal(seal.nextAuthorizedPhase, 'E');
  assert.equal(seal.knownExceptions.length, 1);
  assert.equal(seal.knownExceptions[0].blocksPhaseD, false);
  assert.equal(seal.knownExceptions[0].blocksPublication, true);
  return Object.freeze({
    file: relative,
    bytes: bytes.length,
    sha256: sha256(bytes),
    version: seal.version,
    status: seal.status,
    classification: seal.classification,
    nextAuthorizedPhase: seal.nextAuthorizedPhase
  });
}

function assertContractSynchronization(corpus) {
  const cryptoCorpus = JSON.parse(sourceText('packages/crypto/conformance/hs256.json'));
  assert.equal(cryptoCorpus.version, 'pulse.crypto.hs256-conformance.v2');
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_ALGORITHMS, ['HS256']);
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_KEY_TYPES, ['secret']);
  assert.equal(
    cryptoCorpus.resourceLimits.hmacKeyBytesMinimum,
    corpus.resourceLimits.secretBytesMinimum
  );
  assert.equal(
    cryptoCorpus.resourceLimits.hmacKeyBytesMaximum,
    corpus.resourceLimits.secretBytesMaximum
  );
  assert.equal(
    cryptoCorpus.resourceLimits.macDataBytesMaximum,
    corpus.resourceLimits.cryptoDataBytesMaximum
  );
  assert.equal(
    cryptoCorpus.resourceLimits.hs256TagBytes,
    corpus.resourceLimits.hs256AuthenticatorBytes
  );
  assert.equal(
    cryptoContracts.CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
    'webcrypto.subtle.hmac-sha-256.v1'
  );
  assert.equal(
    cryptoContracts.CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
    'pulse-hmac-as.v1'
  );
  assert.match(
    sourceText('packages/jwt/src/options.ts'),
    /const MAX_TOKEN_AGE_SECONDS = 31_536_000;/
  );

  const current = jwtContracts.JWT_TARGET_REALIZATIONS;
  for (const [provider, mode, targetId] of [
    ['node', 'javascript', 'node-javascript'],
    ['fastly', 'javascript', 'fastly-javascript'],
    ['node', 'native', 'node-native']
  ]) {
    const expected = corpus.targetMatrix.required.find((entry) => entry.id === targetId);
    assert.equal(current[provider][mode].realization, expected.realization);
    assert.equal(current[provider][mode].implementation, expected.implementation);
    assert.equal(current[provider][mode].automaticFallback, false);
  }
  assert.equal(current.fastly.native.status, 'not-realized');
  assert.equal(
    current.fastly.native.reasonId,
    'fastly-native-jwt-package-effect-unavailable'
  );
  const fastlyNative = getProviderTargetDescriptor(
    getProviderDriver('fastly', { projectRoot: repoRoot }),
    'native'
  );
  const expectedFastlyNative = corpus.targetMatrix.required.find(
    (entry) => entry.id === 'fastly-native'
  );
  assert.equal(fastlyNative.jwt.status, 'not-realized');
  assert.equal(fastlyNative.jwt.reasonId, expectedFastlyNative.currentReadiness.reasonId);
  assert.equal(
    fastlyNative.crypto.algorithms[0].realization,
    expectedFastlyNative.realization
  );
  assert.equal(
    fastlyNative.crypto.algorithms[0].implementation,
    expectedFastlyNative.implementation
  );
  assert.equal(fastlyNative.automaticFallback, false);

  return Object.freeze({
    status: 'passed',
    jwtAlgorithms: Object.freeze(['HS256']),
    jwtKeyTypes: Object.freeze(['secret']),
    cryptoCorpus: fileRecord('packages/crypto/conformance/hs256.json'),
    currentFastlyNativeJwtStatus: fastlyNative.jwt.status,
    currentFastlyNativeReasonId: fastlyNative.jwt.reasonId,
    expectedFastlyNativeCryptoRealization: expectedFastlyNative.realization,
    automaticFallback: false
  });
}

function expectManifestFailure(build, label) {
  assert.throws(build, undefined, label);
  return label;
}

function assertHarnessContracts(corpus) {
  const manifests = REQUIRED_TARGET_IDS.map((targetId) => {
    const manifest = createTargetHarnessManifest(
      targetId,
      `${targetId}-phase-e-harness`,
      corpus
    );
    assertTargetHarnessManifest(manifest, corpus);
    return manifest;
  });
  const base = manifests[0];
  const rejected = Object.freeze([
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        caseIds: base.caseIds.slice(1)
      }, corpus),
      'missing-required-case'
    ),
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        skippedCaseIds: [base.caseIds[0]]
      }, corpus),
      'explicit-case-skip'
    ),
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        realization: 'guest-source:pulse-hmac-as'
      }, corpus),
      'realization-masquerade'
    ),
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        runtimeObserved: true
      }, corpus),
      'e0-contract-masquerading-as-runtime-observation'
    ),
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        setup: {
          ...base.setup,
          classifiedAsTargetBehavior: true
        }
      }, corpus),
      'harness-setup-masquerading-as-target-behavior'
    ),
    expectManifestFailure(
      () => assertTargetHarnessManifest({
        ...base,
        automaticFallback: true
      }, corpus),
      'fallback-enabled'
    )
  ]);
  return Object.freeze({
    version: corpus.harnessContract.version,
    status: 'passed',
    manifests: Object.freeze(manifests),
    rejectedContractViolations: rejected,
    targetHarnesses: manifests.length,
    casesPerHarness: REQUIRED_CASE_IDS.length,
    totalRequiredCaseExecutionsAtE4: manifests.length * REQUIRED_CASE_IDS.length,
    runtimeObservedAtE0: false
  });
}

function runFocusedRegression() {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-e0-d3-'));
  try {
    return runStage(
      'd3-realization-regression-with-e0-corpus',
      process.execPath,
      [
        path.join(wasmRoot, 'test', 'jwt', 'assert-jwt-realization-integration.cjs'),
        '--out',
        outputDirectory
      ],
      {
        timeoutMs: 900000,
        assertOutput(output) {
          assert.match(
            output,
            /JWT D3 executes HS256 through exact JavaScript and Node Native crypto realizations/
          );
          const evidence = JSON.parse(
            fs.readFileSync(path.join(outputDirectory, 'jwt-d3-evidence.json'), 'utf8')
          );
          assert.equal(evidence.status, 'passed');
          assert.equal(evidence.semanticContract.algorithm, 'HS256');
          assert.equal(evidence.policy.automaticFallback, false);
          assert.equal(
            evidence.targetMatrix.find((entry) => entry.target === 'fastly-native').status,
            'planning-blocked'
          );
          return Object.freeze({
            packageTestFiles: evidence.validation.focusedPackageTestFiles,
            packageTests: evidence.validation.focusedPackageTests,
            focusedContractTasks: evidence.validation.focusedContractTasks,
            directJavascriptTargets: evidence.validation.directJavascriptTargets,
            directNativeExecutions: evidence.validation.directNativeExecutions
          });
        }
      }
    );
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function assertRedacted(serialized, corpus) {
  for (const entry of forbiddenSensitiveValues(corpus)) {
    assert.equal(
      serialized.includes(entry.value),
      false,
      `E0 evidence must not contain ${entry.id}`
    );
  }
  assert.equal(serialized.includes(repoRoot), false);
  assert.doesNotMatch(
    serialized,
    /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const d4Gate = assertD4Gate();
  const corpus = loadJwtConformanceCorpus(corpusFile);
  const synchronization = assertContractSynchronization(corpus);
  const harness = assertHarnessContracts(corpus);
  const regression = runFocusedRegression();

  const evidence = Object.freeze({
    version: 'pulse.jwt-conformance.e0-evidence.v1',
    status: 'passed',
    scope: Object.freeze({
      phase: 'E0',
      operation: 'freeze shared HS256 JWT corpus and four-target harness matrix',
      changeClass: 'evidence',
      runtimeTargetExecution: false,
      phaseEClassification: 'not-yet-sealed',
      publication: false,
      deployment: false,
      frozenReleaseCatalogMutated: false
    }),
    d4Gate,
    corpus: Object.freeze({
      file: 'wasm/test/jwt/jwt-conformance-corpus.json',
      version: corpus.version,
      status: corpus.status,
      sha256: sha256(fs.readFileSync(corpusFile)),
      semanticHash: corpus.corpusHash,
      hashAlgorithm: corpus.hashAlgorithm,
      requiredTargets: REQUIRED_TARGET_IDS.length,
      semanticCases: REQUIRED_CASE_IDS.length,
      positiveCases: corpus.cases.filter((entry) => entry.polarity === 'positive').length,
      negativeCases: corpus.cases.filter((entry) => entry.polarity === 'negative').length
    }),
    targetMatrix: Object.freeze(corpus.targetMatrix.required.map((entry) => Object.freeze({
      id: entry.id,
      provider: entry.provider,
      mode: entry.mode,
      required: entry.required,
      expectedStatus: entry.expectedStatus,
      realization: entry.realization,
      implementation: entry.implementation,
      providerRequirements: entry.providerRequirements,
      casePolicy: entry.casePolicy,
      automaticFallback: entry.automaticFallback,
      currentReadiness: entry.currentReadiness
    }))),
    coverage: Object.freeze({
      caseIds: REQUIRED_CASE_IDS,
      allTargetsConsumeSameOrderedCases: true,
      allFourCellsHaveExecutableExpectedResult: true,
      noRequiredCaseMayBeSkipped: true,
      additionalTargetCells: 0,
      expectedExecutionsAtE4: harness.totalRequiredCaseExecutionsAtE4
    }),
    harness,
    synchronization,
    validation: Object.freeze({
      stages: Object.freeze([regression]),
      packageTestFiles: regression.packageTestFiles,
      packageTests: regression.packageTests,
      focusedContractTasks: regression.focusedContractTasks,
      directJavascriptTargets: regression.directJavascriptTargets,
      directNativeExecutions: regression.directNativeExecutions,
      harnessContractNegativeChecks: harness.rejectedContractViolations.length
    }),
    boundaries: Object.freeze({
      jwtOwnsParsingPolicyClaimsTimeSchemaAndResult: true,
      cryptoOwnsExactByteAuthenticity: true,
      providerOwnsSecretClockSchemaAndLifecycle: true,
      guestLinkRequiredForHs256: false,
      fastlyNativeExecutionClaimedAtE0: false,
      harnessSetupClassifiedAsTargetBehavior: false,
      automaticFallback: false
    }),
    assumptions: Object.freeze([
      'E0 freezes expected Phase E outcomes; it does not claim that the four cells have executed.',
      'Fastly Native must resolve its JWT package-effect blocker and execute the corpus by E4.',
      'The 1.0.0-beta.1 workspace source candidate remains authoritative while the frozen 1.0.0-beta.1 catalog remains unchanged.'
    ]),
    knownExceptions: Object.freeze([
      Object.freeze({
        id: 'frozen-release-catalog-source-candidate-skew',
        check: 'maintainer:check',
        observed:
          '@pulse-compute/provider-fastly@1.0.0-beta.1 Pulse dependency metadata differs from the synchronized release',
        resolution: 'accepted-for-e0-with-frozen-release-catalog-unchanged',
        blocksE0: false,
        blocksPublication: true
      })
    ]),
    sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
    previousCheckpoint: 'D4',
    nextAuthorizedUnit: 'E1'
  });
  const serialized = stableJson(evidence);
  assertRedacted(serialized, corpus);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(options.outputDirectory, 'jwt-e0-evidence.json'),
    serialized
  );
  console.log(
    `ok - JWT E0 freezes ${REQUIRED_CASE_IDS.length} shared HS256 cases for ` +
    `${REQUIRED_TARGET_IDS.length} required target harnesses with exact realizations, no skips, and no fallback`
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
