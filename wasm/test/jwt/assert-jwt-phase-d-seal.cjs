#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/javascript/target.js');
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-fastly/src/javascript/target.js');
const {
  getProviderDriver,
  getProviderTargetDescriptor
} = require('../../packages/compiler/src/provider-toolchain.js');

const PRIOR_EVIDENCE = Object.freeze([
  Object.freeze({
    phase: 'D0',
    file: 'wasm/.test-results/jwt-d0/jwt-d0-evidence.json',
    version: 'pulse.jwt-crypto.d0-evidence.v1'
  }),
  Object.freeze({
    phase: 'D1',
    file: 'wasm/.test-results/jwt-d1/jwt-d1-evidence.json',
    version: 'pulse.jwt-crypto.d1-evidence.v1'
  }),
  Object.freeze({
    phase: 'D2',
    file: 'wasm/.test-results/jwt-d2/jwt-d2-evidence.json',
    version: 'pulse.jwt-crypto.d2-evidence.v1'
  }),
  Object.freeze({
    phase: 'D3',
    file: 'wasm/.test-results/jwt-d3/jwt-d3-evidence.json',
    version: 'pulse.jwt-realization-integration.d3-evidence.v1'
  })
]);

const REQUIRED_OUTPUTS = Object.freeze([
  'wasm/.test-results/jwt-d0/jwt-crypto-migration-map.json',
  'wasm/.test-results/jwt-d0/jwt-crypto-requirements.json'
]);

const D4_SOURCE_FILES = Object.freeze([
  'wasm/test/jwt/assert-jwt-phase-d-seal.cjs',
  'wasm/test/jwt/assert-jwt-realization-integration.cjs',
  'wasm/test/jwt/assert-jwt-package-owned-lowering.cjs',
  'wasm/test/crypto/assert-crypto-config-planning.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/registry.cjs',
  'wasm/test/suite/assert-suite-shape.cjs'
]);

const ACTIVE_JWT_EXECUTION_FILES = Object.freeze([
  'packages/jwt/src/crypto-verifier.ts',
  'packages/jwt/src/provider.ts',
  'packages/provider-node/src/javascript/jwt-verifier.js',
  'packages/provider-fastly/src/javascript/jwt-verifier.js',
  'packages/provider-node/src/runtime/jwt-verifier.js',
  'wasm/packages/host-runtime/src/runtime/native-crypto-verifier.js'
]);

const CASE_MARKERS = Object.freeze([
  Object.freeze({
    id: 'valid-hs256',
    owner: 'cross-target-realization',
    source: 'wasm/.test-results/jwt-d3/jwt-d3-evidence.json',
    marker: 'node-native'
  }),
  Object.freeze({
    id: 'invalid-signature',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'altered protected header, payload, or authenticator before claims authority'
  }),
  Object.freeze({
    id: 'altered-header',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'altered protected header, payload, or authenticator before claims authority'
  }),
  Object.freeze({
    id: 'altered-payload',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: "sub: 'altered-subject'"
  }),
  Object.freeze({
    id: 'wrong-key',
    owner: 'provider-secret-authority',
    source: 'wasm/test/jwt/assert-jwt-realization-integration.cjs',
    marker: 'wrongSecret'
  }),
  Object.freeze({
    id: 'undersized-secret',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'undersized HS256 secret'
  }),
  Object.freeze({
    id: 'none',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'duplicate alg, none, and disallowed algorithms'
  }),
  Object.freeze({
    id: 'token-algorithm-outside-jwt-allowlist',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: "algorithms: ['HS256']"
  }),
  Object.freeze({
    id: 'jwt-algorithm-outside-profile-crypto',
    owner: 'crypto-requirement-planner',
    source: 'wasm/test/crypto/assert-crypto-config-planning.cjs',
    marker: 'profile-missing-hs256'
  }),
  Object.freeze({
    id: 'target-realization-unavailable',
    owner: 'crypto-requirement-planner',
    source: 'wasm/test/crypto/assert-crypto-config-planning.cjs',
    marker: 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE'
  }),
  Object.freeze({
    id: 'exact-pin-unavailable',
    owner: 'crypto-requirement-planner',
    source: 'wasm/test/crypto/assert-crypto-config-planning.cjs',
    marker: 'PULSE_CRYPTO_REALIZATION_PIN_INVALID'
  }),
  Object.freeze({
    id: 'selected-realization-failure',
    owner: '@pulse-compute/crypto',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: "'realization-failure'"
  }),
  Object.freeze({
    id: 'claims-unavailable-before-authenticity',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'parses claims only after valid authenticity'
  }),
  Object.freeze({
    id: 'registered-claims-after-authenticity',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'runs registered claims before schema'
  }),
  Object.freeze({
    id: 'schema-after-registered-claims',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/crypto-verifier.test.ts',
    marker: 'runs registered claims before schema'
  }),
  Object.freeze({
    id: 'immutable-normalized-result',
    owner: '@pulse-compute/jwt',
    source: 'packages/jwt/test/options.test.ts',
    marker: 'Object.isFrozen'
  }),
  Object.freeze({
    id: 'forbidden-sensitive-values-absent-from-artifacts',
    owner: 'result-detachment-and-redaction',
    source: 'wasm/test/jwt/assert-jwt-realization-integration.cjs',
    marker: 'assertRedacted'
  })
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-d4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT D4 option: ${argv[index]}`);
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

function runFocusedValidation() {
  const typescript = require.resolve('typescript/bin/tsc');
  const vitest = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs');
  const runner = path.join(wasmRoot, 'scripts', 'run-wasm-tests.cjs');
  const tasks = Object.freeze([
    'suite-shape',
    'package-exports',
    'hidden-contracts',
    'api-surface',
    'crypto-config-planning',
    'jwt-package-owned-lowering',
    'crypto-runtime-builtin',
    'crypto-native-guest-source',
    'target-support',
    'canonical-native-plan'
  ]);
  return Object.freeze([
    runStage(
      'jwt-api-and-package-types',
      process.execPath,
      [
        typescript,
        '-b',
        'packages/crypto/tsconfig.json',
        'packages/jwt/tsconfig.json'
      ]
    ),
    runStage(
      'jwt-provider-type-contract',
      process.execPath,
      [typescript, '-p', 'packages/jwt/tsconfig.types.json', '--noEmit']
    ),
    runStage(
      'jwt-strict-semantics-and-crypto-contracts',
      process.execPath,
      [
        vitest,
        'run',
        '--root',
        repoRoot,
        'packages/crypto/test',
        'packages/jwt/test'
      ],
      {
        assertOutput(output) {
          const files = /Test Files\s+(\d+) passed/.exec(output);
          const tests = /Tests\s+(\d+) passed/.exec(output);
          assert.ok(files);
          assert.ok(tests);
          return Object.freeze({
            testFiles: Number(files[1]),
            tests: Number(tests[1])
          });
        }
      }
    ),
    runStage(
      'profile-requirement-lowering-and-runtime-contracts',
      process.execPath,
      [
        runner,
        ...tasks.flatMap((task) => ['--task', task]),
        '--no-report'
      ],
      {
        timeoutMs: 600000,
        assertOutput(output) {
          for (const task of tasks) {
            assert.match(output, new RegExp(`${task}: passed`));
          }
          return Object.freeze({
            focusedContractTasks: tasks.length,
            tasks
          });
        }
      }
    ),
    runStage(
      'd3-cross-target-realization-replay',
      process.execPath,
      [
        runner,
        '--task',
        'jwt-realization-integration',
        '--no-report'
      ],
      {
        timeoutMs: 900000,
        assertOutput(output) {
          assert.match(output, /jwt-realization-integration: passed/);
          return Object.freeze({ directRealizationTasks: 1 });
        }
      }
    )
  ]);
}

function readPriorEvidence() {
  return Object.freeze(PRIOR_EVIDENCE.map((expected) => {
    const record = fileRecord(expected.file);
    const evidence = JSON.parse(sourceText(expected.file));
    assert.equal(evidence.version, expected.version);
    assert.equal(evidence.status, 'passed');
    return Object.freeze({
      phase: expected.phase,
      ...record,
      version: evidence.version,
      status: evidence.status
    });
  }));
}

function assertDependencyGraph() {
  const cryptoPackage = JSON.parse(sourceText('packages/crypto/package.json'));
  const jwtPackage = JSON.parse(sourceText('packages/jwt/package.json'));
  const nodePackage = JSON.parse(sourceText('packages/provider-node/package.json'));
  const fastlyPackage = JSON.parse(sourceText('packages/provider-fastly/package.json'));
  assert.equal(jwtPackage.version, '1.0.0-beta.1');
  assert.equal(cryptoPackage.version, '1.0.0-beta.1');
  assert.equal(jwtPackage.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.equal(Object.hasOwn(jwtPackage.dependencies, 'jose'), false);
  assert.equal(nodePackage.dependencies['@pulse-compute/jwt'], 'workspace:*');
  assert.equal(nodePackage.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.equal(fastlyPackage.dependencies['@pulse-compute/jwt'], 'workspace:*');
  assert.equal(fastlyPackage.dependencies['@pulse-compute/crypto'], 'workspace:*');

  const lock = sourceText('pnpm-lock.yaml');
  const jwtImporter = /^  packages\/jwt:\n([\s\S]*?)(?=^  \S|\Z)/m.exec(lock);
  assert.ok(jwtImporter);
  assert.match(jwtImporter[1], /'@pulse-compute\/crypto':/);
  assert.match(jwtImporter[1], /version: link:\.\.\/crypto/);
  assert.doesNotMatch(jwtImporter[1], /\bjose:/);

  return Object.freeze({
    status: 'passed',
    sourceCandidateVersion: '1.0.0-beta.1',
    frozenReleaseCatalogVersion: '1.0.0-beta.1',
    frozenReleaseCatalogMutated: false,
    edges: Object.freeze([
      Object.freeze({
        from: '@pulse-compute/jwt@1.0.0-beta.1',
        to: '@pulse-compute/crypto@1.0.0-beta.1',
        range: 'workspace:*',
        lock: 'link:../crypto'
      }),
      Object.freeze({
        from: '@pulse-compute/provider-node',
        to: '@pulse-compute/jwt',
        range: 'workspace:*'
      }),
      Object.freeze({
        from: '@pulse-compute/provider-node',
        to: '@pulse-compute/crypto',
        range: 'workspace:*'
      }),
      Object.freeze({
        from: '@pulse-compute/provider-fastly',
        to: '@pulse-compute/jwt',
        range: 'workspace:*'
      }),
      Object.freeze({
        from: '@pulse-compute/provider-fastly',
        to: '@pulse-compute/crypto',
        range: 'workspace:*'
      })
    ]),
    joseDependencyPresent: false
  });
}

function assertSourceAudits() {
  const activeSources = Object.fromEntries(
    ACTIVE_JWT_EXECUTION_FILES.map((file) => [file, sourceText(file)])
  );
  const jwtOwnedSources = Object.entries(activeSources)
    .filter(([file]) => file.startsWith('packages/jwt/'))
    .map(([, source]) => source)
    .join('\n');
  const providerJwtSources = Object.entries(activeSources)
    .filter(([file]) => file.includes('provider-'))
    .map(([, source]) => source)
    .join('\n');
  const allActiveSources = Object.values(activeSources).join('\n');

  assert.doesNotMatch(
    jwtOwnedSources,
    /(?:node:crypto|createHmac|timingSafeEqual|globalThis|WebCrypto|crypto\.subtle|subtle\.(?:sign|verify))/
  );
  assert.doesNotMatch(
    providerJwtSources,
    /(?:node:crypto|createHmac|timingSafeEqual|crypto\.subtle|subtle\.(?:sign|verify))/
  );
  assert.doesNotMatch(
    allActiveSources,
    /(?:verifyJwtWithJose|verifyJwtWithHostCrypto|jwt-host-verify|from ['"]jose['"])/
  );
  assert.doesNotMatch(allActiveSources, /automaticFallback:\s*true/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages/jwt/src/host-verifier.ts')), false);
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'packages/provider-node/src/runtime/jwt-host-verify.js')),
    false
  );
  assert.match(activeSources['packages/jwt/src/crypto-verifier.ts'], /cryptoMacVerify\(crypto\)/);
  assert.match(activeSources['packages/jwt/src/crypto-verifier.ts'], /verifyMac\(Object\.freeze/);
  assert.match(
    activeSources['packages/provider-node/src/javascript/jwt-verifier.js'],
    /verifyJwtWithCrypto/
  );
  assert.match(
    activeSources['packages/provider-fastly/src/javascript/jwt-verifier.js'],
    /verifyJwtWithCrypto/
  );
  assert.match(
    activeSources['packages/provider-node/src/runtime/jwt-verifier.js'],
    /verifyJwtWithCrypto/
  );
  assert.match(
    activeSources['wasm/packages/host-runtime/src/runtime/native-crypto-verifier.js'],
    /pulse_crypto_hs256_verify/
  );

  return Object.freeze({
    status: 'passed',
    files: Object.freeze(ACTIVE_JWT_EXECUTION_FILES.map(fileRecord)),
    jwtSideTargetOrBackendDetection: false,
    signatureVerificationOutsideCrypto: false,
    nativeHostRole: 'bounded ABI routing to selected crypto guest-source export',
    retiredJoseOrHostVerifierPathPresent: false,
    automaticFallbackPresent: false
  });
}

function assertComposition(priorEvidence) {
  const d0Requirements = JSON.parse(
    sourceText('wasm/.test-results/jwt-d0/jwt-crypto-requirements.json')
  );
  const d1 = JSON.parse(sourceText('wasm/.test-results/jwt-d1/jwt-d1-evidence.json'));
  const d2 = JSON.parse(sourceText('wasm/.test-results/jwt-d2/jwt-d2-evidence.json'));
  const d3 = JSON.parse(sourceText('wasm/.test-results/jwt-d3/jwt-d3-evidence.json'));

  assert.equal(d0Requirements.version, 'pulse.jwt-crypto-requirements.v1');
  assert.equal(d1.requirement.requestedBy, '@pulse-compute/jwt');
  assert.equal(d1.requirement.semanticOwner, '@pulse-compute/crypto');
  assert.deepEqual(d1.requirement.algorithms, ['HS256']);
  assert.equal(d1.composition.realization.automaticFallback, false);
  assert.equal(d2.policy.claimsAvailableBeforeAuthenticity, false);
  assert.equal(d2.policy.schemaRunsBeforeRegisteredClaims, false);
  assert.equal(d3.nativeCompilation.guestUnits, 0);
  assert.equal(d3.nativeCompilation.guestLink, false);
  assert.equal(d3.nativeCompilation.realization, 'guest-source:pulse-hmac-as');
  assert.equal(d3.nativeCompilation.implementation, 'pulse-hmac-as.v1');
  assert.equal(d3.policy.hostSignatureVerifierPresent, false);
  assert.equal(d3.policy.asymmetricAlgorithmsAdvertisedAsExecutable, false);
  assert.ok(d3.targetMatrix.every((entry) => entry.automaticFallback === false));

  const nodeJavascript = NODE_JAVASCRIPT_TARGET_DESCRIPTOR;
  const fastlyJavascript = FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR;
  const nodeNative = NODE_NATIVE_TARGET_DESCRIPTOR;
  const fastlyNative = getProviderTargetDescriptor(
    getProviderDriver('fastly', { projectRoot: repoRoot }),
    'native'
  );
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_ALGORITHMS, ['HS256']);
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_KEY_TYPES, ['secret']);
  assert.deepEqual(
    nodeJavascript.crypto.algorithms.map((entry) => entry.algorithm),
    ['HS256']
  );
  assert.deepEqual(
    fastlyJavascript.crypto.algorithms.map((entry) => entry.algorithm),
    ['HS256']
  );
  assert.deepEqual(
    nodeNative.realizations.flatMap((entry) => entry.algorithms),
    ['HS256']
  );
  assert.equal(fastlyNative.jwt.status, 'not-realized');
  assert.equal(fastlyNative.automaticFallback, false);

  return Object.freeze({
    status: 'passed',
    previousEvidence: priorEvidence,
    requirement: Object.freeze({
      requestedBy: d1.requirement.requestedBy,
      semanticOwner: d1.requirement.semanticOwner,
      algorithms: d1.requirement.algorithms,
      providerRequirements: d1.providerRequirements,
      automaticFallback: false
    }),
    realizations: Object.freeze({
      javascript: Object.freeze({
        realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.hmac-sha-256.v1',
        targets: Object.freeze(['node-javascript', 'fastly-javascript'])
      }),
      native: Object.freeze({
        realization: d3.nativeCompilation.realization,
        implementation: d3.nativeCompilation.implementation,
        targets: Object.freeze(['node-native']),
        guestUnits: d3.nativeCompilation.guestUnits,
        guestLink: d3.nativeCompilation.guestLink
      }),
      automaticFallback: false
    }),
    targetClaims: Object.freeze(d3.targetMatrix),
    asymmetricBypassAudit: Object.freeze({
      status: 'passed',
      publicVocabulary: Object.freeze([...jwtContracts.JWT_ALGORITHMS]),
      implementedAlgorithms: Object.freeze([...jwtContracts.JWT_IMPLEMENTED_ALGORITHMS]),
      implementedKeyTypes: Object.freeze([...jwtContracts.JWT_IMPLEMENTED_KEY_TYPES]),
      providerOwnedRs256ProofRegistered: false,
      asymmetricAlgorithmsAdvertisedAsExecutable: false
    })
  });
}

function assertRequiredCases() {
  return Object.freeze(CASE_MARKERS.map((testCase) => {
    const text = sourceText(testCase.source);
    assert.equal(
      text.includes(testCase.marker),
      true,
      `${testCase.id} evidence marker missing from ${testCase.source}`
    );
    return Object.freeze({
      id: testCase.id,
      status: 'passed',
      owner: testCase.owner,
      evidence: Object.freeze([
        Object.freeze({
          file: testCase.source,
          marker: testCase.marker
        })
      ])
    });
  }));
}

function assertRedacted(serialized) {
  assert.doesNotMatch(
    serialized,
    /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/
  );
  assert.equal(serialized.includes(repoRoot), false);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const validationStages = runFocusedValidation();
  const priorEvidence = readPriorEvidence();
  const dependencyGraph = assertDependencyGraph();
  const sourceAudits = assertSourceAudits();
  const composition = assertComposition(priorEvidence);
  const requiredCases = assertRequiredCases();
  assert.equal(requiredCases.length, 17);

  const compositionReport = Object.freeze({
    version: 'pulse.jwt-crypto-composition-report.v1',
    status: 'passed',
    phase: 'D',
    scope: Object.freeze({
      operation: 'JWT HS256 verification composed over @pulse-compute/crypto',
      authoringFacadeChanged: false,
      publication: false,
      deployment: false,
      frozenReleaseCatalogMutated: false
    }),
    dependencyGraph,
    sourceAudits,
    requirementAndRealization: composition,
    requiredCases,
    ordering: Object.freeze([
      'strict-jws-parse',
      'jwt-algorithm-allowlist',
      'provider-secret-resolution',
      'selected-crypto-realization',
      'authenticity-decision',
      'one-provider-wall-clock-capture',
      'registered-claims',
      'claims-schema',
      'detached-immutable-result'
    ]),
    assumptions: Object.freeze([
      'The 1.0.0-beta.1 workspace source candidate is authoritative for Phase D.',
      'The frozen 1.0.0-beta.1 release catalog remains intentionally unchanged.',
      'HS256 is the only Phase D executable JWT algorithm.',
      'Fastly Native JWT remains planning-blocked until its package-effect path is realized.'
    ]),
    deferred: Object.freeze([
      'Fastly Native JWT package-effect execution',
      'provider-owned RS256 proof',
      'browser runtime support',
      'additional JWT algorithms'
    ])
  });
  const compositionSerialized = stableJson(compositionReport);
  assertRedacted(compositionSerialized);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const compositionFile = path.join(
    options.outputDirectory,
    'jwt-crypto-composition-report.json'
  );
  fs.writeFileSync(compositionFile, compositionSerialized);

  const changedFiles = [
    ...new Set([
      ...JSON.parse(sourceText('wasm/.test-results/jwt-d3/jwt-d3-evidence.json'))
        .sources.map((entry) => entry.file),
      ...D4_SOURCE_FILES
    ])
  ].sort();
  const seal = Object.freeze({
    version: 'pulse.jwt-phase-d-seal.v1',
    status: 'passed',
    classification: 'PASS',
    phase: 'D',
    scope: Object.freeze({
      operation: 'focused Phase D JWT-to-crypto seal',
      releaseCatalogMutation: false,
      publication: false,
      deployment: false
    }),
    gates: Object.freeze([
      Object.freeze({ id: 'jwt-api-and-types', status: 'passed' }),
      Object.freeze({ id: 'jwt-strict-parsing-and-claims', status: 'passed' }),
      Object.freeze({ id: 'crypto-contract', status: 'passed' }),
      Object.freeze({ id: 'profile-normalization', status: 'passed' }),
      Object.freeze({ id: 'requirement-planning', status: 'passed' }),
      Object.freeze({ id: 'jwt-lowering', status: 'passed' }),
      Object.freeze({ id: 'javascript-runtime-composition', status: 'passed' }),
      Object.freeze({ id: 'native-compilation-and-guest-source', status: 'passed' }),
      Object.freeze({ id: 'provider-secret-and-clock-authority', status: 'passed' }),
      Object.freeze({ id: 'result-detachment-and-redaction', status: 'passed' }),
      Object.freeze({ id: 'no-fallback-diagnostics', status: 'passed' })
    ]),
    validation: Object.freeze({
      stages: validationStages,
      focusedPackageTestFiles: validationStages[2].testFiles,
      focusedPackageTests: validationStages[2].tests,
      focusedContractTasks: validationStages[3].focusedContractTasks,
      directRealizationTasks: validationStages[4].directRealizationTasks
    }),
    requiredCases,
    composition: Object.freeze({
      report: Object.freeze({
        file: 'wasm/.test-results/jwt-d4/jwt-crypto-composition-report.json',
        bytes: Buffer.byteLength(compositionSerialized),
        sha256: sha256(compositionSerialized)
      }),
      dependencyGraphStatus: dependencyGraph.status,
      sourceAuditStatus: sourceAudits.status,
      requirementAndRealizationStatus: composition.status
    }),
    requiredOutputs: Object.freeze(REQUIRED_OUTPUTS.map(fileRecord)),
    priorEvidence,
    changedFiles: Object.freeze(changedFiles.map(fileRecord)),
    targetClaims: composition.targetClaims,
    assumptions: compositionReport.assumptions,
    deferred: compositionReport.deferred,
    versionDecision: Object.freeze({
      workingCandidate: '1.0.0-beta.1',
      frozenReleaseCatalog: '1.0.0-beta.1',
      resolution: 'retain-source-candidate-and-do-not-mutate-frozen-catalog',
      publicationAuthorized: false
    }),
    knownExceptions: Object.freeze([
      Object.freeze({
        id: 'frozen-release-catalog-source-candidate-skew',
        check: 'maintainer:check',
        observed:
          '@pulse-compute/provider-fastly@1.0.0-beta.1 Pulse dependency metadata differs from the synchronized release',
        resolution: 'accepted-for-phase-d-with-frozen-release-catalog-unchanged',
        blocksPhaseD: false,
        blocksPublication: true
      })
    ]),
    nextAuthorizedPhase: 'E'
  });
  const sealSerialized = stableJson(seal);
  assertRedacted(sealSerialized);
  fs.writeFileSync(
    path.join(options.outputDirectory, 'jwt-phase-d-seal.json'),
    sealSerialized
  );
  console.log(
    'ok - Phase D PASS: JWT owns strict JWS and claims semantics, crypto owns ' +
    'HS256 authenticity, exact target realizations are sealed without fallback, and Phase E is authorized'
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
