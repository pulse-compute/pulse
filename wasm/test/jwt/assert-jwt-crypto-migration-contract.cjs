#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'contracts');
const migrationMapFile = path.join(fixtureRoot, 'jwt-crypto-migration-map.json');
const requirementsFile = path.join(fixtureRoot, 'jwt-crypto-requirements.json');
const phaseCSealFile = path.join(wasmRoot, '.test-results', 'crypto-c4', 'phase-c-seal.json');

const JWT_TEST_FILES = Object.freeze([
  'packages/jwt/test/bearer.test.ts',
  'packages/jwt/test/javascript-verifier.test.ts',
  'packages/jwt/test/options.test.ts',
  'packages/jwt/test/package-runtime.test.ts',
  'packages/jwt/test/provider-runtime.test.ts',
  'wasm/test/jwt/assert-jwt-package-owned-lowering.cjs',
  'wasm/test/jwt/assert-jwt-native-webcrypto.cjs',
  'wasm/test/jwt/jwt-cross-target-corpus.json'
]);

const SOURCE_FILES = Object.freeze([
  'packages/jwt/package.json',
  'packages/crypto/package.json',
  'packages/jwt/src/index.ts',
  'packages/jwt/src/bearer.ts',
  'packages/jwt/src/options.ts',
  'packages/jwt/src/token.ts',
  'packages/jwt/src/javascript-verifier.ts',
  'packages/jwt/src/host-verifier.ts',
  'packages/jwt/src/result.ts',
  'packages/jwt/src/provider.ts',
  'packages/jwt/src/internal/clock.ts',
  'packages/jwt/pulse.package.json',
  'packages/jwt/pulsewasm.manifest.cjs',
  'packages/jwt/pulsewasm.compiler.cjs',
  'packages/jwt/as/index.as.ts',
  'packages/jwt/conformance/native-contract.json',
  'packages/crypto/src/contracts.ts',
  'packages/crypto/src/index.ts',
  'packages/crypto/src/internal/realization.ts',
  'packages/crypto/src/internal/verification.ts',
  'packages/crypto/pulsewasm.native.cjs',
  'packages/crypto/conformance/hs256.json',
  'wasm/packages/contracts/src/jwt/contracts.js',
  'wasm/packages/contracts/src/crypto/contracts.js',
  'wasm/packages/compiler/src/crypto-requirement-planner.js',
  'packages/provider-node/src/javascript/runtime-host.js',
  'packages/provider-node/src/javascript/jwt-verifier.js',
  'packages/provider-node/src/runtime/jwt-host-verify.js',
  'packages/provider-node/src/javascript/target-support-policy.js',
  'packages/provider-node/src/javascript/target.js',
  'packages/provider-node/src/native/target.js',
  'packages/provider-fastly/src/javascript/package-effects.js',
  'packages/provider-fastly/src/javascript/target-support-policy.js',
  'packages/provider-fastly/src/javascript/target.js',
  'packages/provider-fastly/src/toolchain/index.js',
  'wasm/test/jwt/jwt-cross-target-corpus.json',
  'wasm/test/jwt/fixtures/contracts/jwt-crypto-migration-map.json',
  'wasm/test/jwt/fixtures/contracts/jwt-crypto-requirements.json'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-d0');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT migration-contract option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeFile(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function fileRecord(relative) {
  const file = path.join(repoRoot, relative);
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: relativeFile(file),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function source(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
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
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs || 300000,
    shell: false
  });
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${id} failed${result.status === null ? '' : ` with status ${result.status}`}${detail ? `\n${detail}` : ''}`,
      { cause: result.error }
    );
  }
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
  if (options.assertOutput) options.assertOutput(output);
  return Object.freeze({ id, status: 'passed', durationMs });
}

function assertPhaseCGate(map) {
  assert.equal(fs.existsSync(phaseCSealFile), true, 'D0 requires the sealed Phase C report');
  const sealBytes = fs.readFileSync(phaseCSealFile);
  const seal = JSON.parse(sealBytes.toString('utf8'));
  assert.equal(sha256(sealBytes), map.phaseCGate.sha256);
  assert.equal(seal.version, map.phaseCGate.version);
  assert.equal(seal.status, 'passed');
  assert.equal(seal.gate.phaseC, 'passed');
  assert.equal(seal.gate.nextAuthorizedPhase, 'D');
  assert.equal(seal.corpus.version, map.phaseCGate.corpus.version);
  assert.equal(seal.corpus.sha256, map.phaseCGate.corpus.sha256);
  assert.equal(seal.corpus.verificationCases, 14);
  assert.equal(seal.corpus.configurationCases.length, 14);
  assert.equal(seal.realizations.javascript.kind, 'runtime-builtin');
  assert.equal(seal.realizations.native.realization, 'guest-source:pulse-hmac-as');
  assert.equal(seal.boundaries.guestLinkRequiredForHs256, false);
  assert.equal(seal.scope.automaticFallback, false);
  assert.equal(sha256(fs.readFileSync(path.join(repoRoot, map.phaseCGate.corpus.file))), map.phaseCGate.corpus.sha256);
  return Object.freeze({
    file: relativeFile(phaseCSealFile),
    sha256: sha256(sealBytes),
    version: seal.version,
    status: seal.status,
    verificationCases: seal.corpus.verificationCases,
    configurationCases: seal.corpus.configurationCases.length,
    javascriptRealization: seal.realizations.javascript.kind,
    nativeRealization: seal.realizations.native.realization,
    guestLinkedRequired: seal.boundaries.guestLinkRequiredForHs256,
    automaticFallback: seal.scope.automaticFallback,
    nextAuthorizedPhase: seal.gate.nextAuthorizedPhase
  });
}

function assertCurrentSourceTopology(map) {
  const jwtPackage = readJson(path.join(repoRoot, 'packages', 'jwt', 'package.json'));
  const cryptoPackage = readJson(path.join(repoRoot, 'packages', 'crypto', 'package.json'));
  const jwtSource = source('packages/jwt/src/javascript-verifier.ts');
  const jwtProviderSource = source('packages/jwt/src/provider.ts');
  const hostVerifierSource = source('packages/jwt/src/host-verifier.ts');
  const nodeJavascriptSource = source('packages/provider-node/src/javascript/jwt-verifier.js');
  const nodeNativeSource = source('packages/provider-node/src/runtime/jwt-host-verify.js');
  const fastlyJavascriptSource = source('packages/provider-fastly/src/javascript/package-effects.js');
  const jwtCompilerSource = source('packages/jwt/pulsewasm.compiler.cjs');
  const jwtManifestSource = source('packages/jwt/pulsewasm.manifest.cjs');
  const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
  const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');

  assert.equal(jwtPackage.version, map.versionDecision.jwtSourceVersion);
  assert.equal(cryptoPackage.version, map.versionDecision.cryptoSourceVersion);
  assert.equal(Object.hasOwn(jwtPackage.dependencies, '@pulse-compute/crypto'), false);
  for (const relative of [
    'packages/jwt/src',
    'packages/jwt/pulsewasm.compiler.cjs',
    'packages/jwt/pulsewasm.manifest.cjs'
  ]) {
    const files = fs.statSync(path.join(repoRoot, relative)).isDirectory()
      ? fs.readdirSync(path.join(repoRoot, relative), { recursive: true })
        .filter((entry) => typeof entry === 'string' && /\.(?:ts|js|cjs)$/.test(entry))
        .map((entry) => path.join(relative, entry))
      : [relative];
    for (const file of files) {
      assert.doesNotMatch(source(file), /@pulse-compute\/crypto/, `${file} must still be pre-composition at D0`);
    }
  }

  assert.match(jwtSource, /import \{ importJWK, jwtVerify \} from 'jose';/);
  assert.match(jwtSource, /await jwtVerify\(/);
  assert.match(jwtSource, /const currentDate = await captureJwtCurrentDate\(captureWallClock\);[\s\S]*await jwtVerify\(/);
  assert.match(jwtProviderSource, /verifyJwtWithJose/);
  assert.match(jwtProviderSource, /verifyJwtWithHostCrypto/);
  assert.match(hostVerifierSource, /verifier\.value\(Object\.freeze\(\{/);
  assert.match(nodeJavascriptSource, /return provider\.verifyJwtWithJose\(input, host\);/);
  assert.match(nodeNativeSource, /globalThis\.crypto && globalThis\.crypto\.subtle/);
  assert.match(nodeNativeSource, /inputRecord\.get\('algorithm'\) !== 'RS256'/);
  assert.match(nodeNativeSource, /jwtProvider\.verifyJwtWithHostCrypto/);
  assert.match(fastlyJavascriptSource, /function unavailableJwt/);
  assert.match(jwtCompilerSource, /nativeCryptoRealization: 'host-verify'/);
  assert.match(jwtManifestSource, /algorithms: Object\.freeze\(\['RS256'\]\)/);

  assert.deepEqual(jwtContracts.JWT_ALGORITHMS, ['HS256', 'RS256', 'ES256', 'EdDSA']);
  assert.deepEqual(cryptoContracts.CRYPTO_ALGORITHMS, ['HS256']);
  assert.deepEqual(
    cryptoContracts.CRYPTO_REALIZATIONS.map((entry) => entry.id),
    ['runtime-builtin', 'guest-source:pulse-hmac-as']
  );
}

function assertMigrationMap(map) {
  assert.equal(map.version, 'pulse.jwt-crypto-migration-map.v1');
  assert.equal(map.status, 'accepted-for-d1');
  assert.equal(map.scope.implementationChanges, false);
  assert.equal(map.scope.publication, false);
  assert.equal(map.scope.deployment, false);
  assert.equal(map.nextAuthorizedUnit, 'D1');

  const requiredBehaviors = [
    'Bearer extraction',
    'Compact JWS limits and strict parsing',
    'Protected-header allowlist',
    'Exact signing-input construction',
    'Secret binding resolution',
    'HS256 authenticity in jose',
    'JWT-side Web Crypto detection',
    'Native host signature verifier for HS256',
    'Registered claims',
    'Claims schema',
    'Detached immutable result',
    'RS256/ES256/EdDSA advertised support'
  ];
  assert.deepEqual(map.behaviorDispositions.map((entry) => entry.behavior), requiredBehaviors);
  assert.equal(new Set(map.behaviorDispositions.map((entry) => entry.behavior)).size, requiredBehaviors.length);

  const activePaths = map.verificationPaths.filter((entry) => entry.activeAuthenticity === true);
  assert.deepEqual(
    activePaths.map((entry) => entry.id).sort(),
    ['node-javascript-jose', 'node-native-host-verify-rs256', 'provider-direct-host-crypto', 'provider-direct-jose']
  );
  assert.equal(activePaths.every((entry) => !entry.disposition.startsWith('retain')), true);
  assert.equal(
    map.verificationPaths.find((entry) => entry.id === 'node-native-host-verify-rs256').notes
      .includes('No active Node Native HS256 host verifier exists'),
    true
  );

  assert.deepEqual(
    map.testDispositions.map((entry) => entry.file).sort(),
    [...JWT_TEST_FILES].sort()
  );
  assert.equal(map.testDispositions.every((entry) => entry.retain.length > 0), true);
  assert.deepEqual(map.algorithmAndTargetTopology.jwtDeclarations.proofDisposition, {
    HS256: 'supported-after-composition',
    RS256: 'unavailable-until-crypto-owned',
    ES256: 'unavailable-until-crypto-owned',
    EdDSA: 'unavailable-until-crypto-owned',
    none: 'never-accepted'
  });
  assert.equal(
    map.orderingFindings.find((entry) => entry.id === 'javascript-clock-before-authenticity').status,
    'must-change'
  );
  assert.equal(
    map.orderingFindings.find((entry) => entry.id === 'host-path-authenticity-order').status,
    'reusable'
  );
  assert.equal(map.versionDecision.frozenReleaseCatalogMutation, false);
  assert.equal(map.versionDecision.d0Blocker, false);
  assert.equal(
    map.versionDecision.decision,
    'align-crypto-source-to-1.0.0-beta.1-at-d1-before-recording-the-direct-dependency'
  );
  assert.equal(map.versionDecision.publication, false);
}

function assertRequirements(requirements) {
  assert.equal(requirements.version, 'pulse.jwt-crypto-requirements.v1');
  assert.equal(requirements.status, 'frozen-for-d1');
  assert.deepEqual(requirements.algorithmContract.supported, ['HS256']);
  assert.deepEqual(requirements.algorithmContract.unavailable, ['RS256', 'ES256', 'EdDSA']);
  assert.deepEqual(requirements.algorithmContract.forbidden, ['none']);
  assert.equal(requirements.scope.automaticFallback, false);
  assert.deepEqual(requirements.requirements.crypto, [{
    algorithm: 'HS256',
    requestedBy: '@pulse-compute/jwt',
    semanticOwner: '@pulse-compute/crypto',
    reachableOnly: true
  }]);
  assert.deepEqual(
    requirements.requirements.provider.map((entry) => entry.id),
    ['secret.get', 'time.wall-clock', 'schema.decode']
  );
  assert.deepEqual(requirements.operationOrder.slice(0, 4), [
    'enforce compact-token and segment limits',
    'strictly decode and parse the protected header',
    'enforce JWT protected-header policy',
    'enforce token algorithm in the static JWT allowlist'
  ]);
  assert.deepEqual(requirements.operationOrder.slice(8), [
    'invoke @pulse-compute/crypto MAC verification',
    'require crypto status valid',
    'parse claims',
    'capture one provider-owned trusted Unix wall-clock instant',
    'validate registered claims',
    'validate claims through the configured schema',
    'return a detached deeply immutable result'
  ]);

  assert.deepEqual(requirements.resourceLimits, {
    compactTokenBytesMaximum: 16 * 1024,
    protectedHeaderBytesMaximum: 4 * 1024,
    claimsBytesMaximum: 16 * 1024,
    jsonDepthMaximum: 32,
    jwtAlgorithmsPerOperationMaximum: 1,
    requiredClaimNamesMaximum: 32,
    clockToleranceSecondsMaximum: 300,
    maxTokenAgeSecondsMaximum: 31_536_000,
    hmacKeyBytesMinimum: 32,
    hmacKeyBytesMaximum: 4 * 1024,
    hs256SignatureBytes: 32,
    cryptoMacDataBytesMaximum: 1024 * 1024,
    effectiveJwtSigningInputBytesMaximum: 16_340
  });

  assert.equal(requirements.cryptoCallBoundary.entry, '@pulse-compute/crypto#crypto.mac.verify');
  assert.equal(requirements.cryptoCallBoundary.request.algorithm, 'HS256');
  assert.equal(requirements.cryptoCallBoundary.request.key.type, 'hmac-key-bytes');
  assert.match(requirements.cryptoCallBoundary.request.data, /original encoded protected segment/);
  assert.match(requirements.cryptoCallBoundary.request.tag, /original signature segment/);
  assert.equal(requirements.cryptoCallBoundary.keyLifecycle.jwtOwnedCopyWiped, 'required in finally');
  assert.equal(requirements.cryptoCallBoundary.keyLifecycle.cryptoOwnsInternalCopyAndWipe, true);

  assert.deepEqual(
    requirements.resultMapping.map((entry) => [
      entry.cryptoStatus,
      entry.jwtError,
      entry.category
    ]),
    [
      ['valid', null, null],
      ['invalid-authenticator', 'PULSE_JWT_SIGNATURE_INVALID', 'signature'],
      ['invalid-key', 'PULSE_JWT_KEY_INVALID', 'verification-key'],
      ['invalid-input', 'PULSE_JWT_OPERATION_FAILED', 'crypto-input-contract'],
      ['realization-failure', 'PULSE_JWT_OPERATION_FAILED', 'crypto-realization']
    ]
  );
  assert.equal(requirements.targetContract.javascript.realization, 'runtime-builtin');
  assert.equal(requirements.targetContract.native.realization, 'guest-source:pulse-hmac-as');
  assert.equal(requirements.targetContract.guestLinkedRequired, false);
  assert.equal(requirements.targetContract.targetDetectionInJwt, false);
  assert.equal(requirements.targetContract.backendDetectionInJwt, false);
  assert.equal(requirements.targetContract.automaticFallback, false);
  assert.equal(requirements.claimsContainment.claimsJsonParsingBeforeAuthenticity, false);
  assert.equal(requirements.claimsContainment.schemaValidationBeforeAuthenticity, false);
  assert.equal(requirements.claimsContainment.applicationObservationBeforeAuthenticity, false);
  assert.equal(requirements.versionDecision.alignCryptoSourceAtD1, true);
  assert.equal(requirements.versionDecision.mutateFrozenReleaseCatalog, false);
  assert.equal(requirements.versionDecision.publicationAuthorized, false);
  assert.equal(requirements.nextAuthorizedUnit, 'D1');
}

function assertRedacted(serialized) {
  const forbidden = [
    'phase-c-secret-marker-never-report-0001',
    'phase-c-sensitive-data',
    'node-provider-owned-hs256-secret-value',
    'node-provider-owned-hs256-secret-value-not-for-report',
    'schema-backend-sensitive-value',
    'account-provider-runtime-sensitive',
    'account-sensitive-value',
    'PRIVATE_VALUE_MUST_NOT_LEAK'
  ];
  for (const marker of forbidden) {
    assert.equal(serialized.includes(marker), false, 'D0 evidence must not contain JWT or crypto sensitive fixtures');
  }
  assert.doesNotMatch(
    serialized,
    /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/,
    'D0 evidence must not contain a complete compact token'
  );
  assert.equal(serialized.includes(repoRoot), false, 'D0 evidence must not contain absolute repository paths');
}

function runFocusedBaseline(temporary) {
  const typescript = require.resolve('typescript/bin/tsc');
  const vitest = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs');
  const runner = path.join(wasmRoot, 'scripts', 'run-wasm-tests.cjs');

  return Object.freeze([
    runStage(
      'jwt-package-build',
      process.execPath,
      [typescript, '-b', 'packages/jwt/tsconfig.json'],
      { timeoutMs: 120000 }
    ),
    runStage(
      'jwt-and-crypto-package-tests',
      process.execPath,
      [
        vitest,
        'run',
        '--root',
        repoRoot,
        'packages/jwt/test',
        'packages/crypto/test'
      ],
      {
        timeoutMs: 120000,
        assertOutput(output) {
          assert.match(output, /Test Files\s+7 passed \(7\)/);
          assert.match(output, /Tests\s+44 passed \(44\)/);
        }
      }
    ),
    runStage(
      'current-jwt-lowering-and-native-reality',
      process.execPath,
      [
        runner,
        '--task', 'jwt-package-owned-lowering',
        '--task', 'jwt-native-webcrypto',
        '--no-report'
      ],
      {
        timeoutMs: 300000,
        assertOutput(output) {
          assert.match(output, /jwt-package-owned-lowering: passed/);
          assert.match(output, /jwt-native-webcrypto: passed/);
        }
      }
    ),
    runStage(
      'phase-c-focused-crypto-replay',
      process.execPath,
      [
        runner,
        '--task', 'crypto-config-planning',
        '--task', 'crypto-runtime-builtin',
        '--task', 'crypto-native-guest-source',
        '--task', 'crypto-cross-target-conformance',
        '--no-report'
      ],
      {
        timeoutMs: 600000,
        assertOutput(output) {
          for (const task of [
            'crypto-config-planning',
            'crypto-runtime-builtin',
            'crypto-native-guest-source',
            'crypto-cross-target-conformance'
          ]) {
            assert.match(output, new RegExp(`${task}: passed`));
          }
        }
      }
    )
  ]);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-d0-'));
  try {
    const map = readJson(migrationMapFile);
    const requirements = readJson(requirementsFile);

    assertMigrationMap(map);
    assertRequirements(requirements);
    const phaseCGate = assertPhaseCGate(map);
    assertCurrentSourceTopology(map);
    const stages = runFocusedBaseline(temporary);
    const sources = Object.freeze(SOURCE_FILES.map(fileRecord));

    const migrationArtifact = Object.freeze({
      ...map,
      baselineEvidence: Object.freeze({
        phaseCGate,
        stages,
        focusedPackageTestFiles: 7,
        focusedPackageTests: 44,
        sourceFiles: sources
      })
    });
    const requirementsArtifact = Object.freeze({
      ...requirements,
      contractEvidence: Object.freeze({
        migrationMapVersion: map.version,
        migrationMapStatus: map.status,
        phaseCSealSha256: phaseCGate.sha256,
        sourceFiles: Object.freeze(sources.filter((entry) => [
          'packages/jwt/src/token.ts',
          'packages/jwt/src/options.ts',
          'packages/jwt/src/result.ts',
          'packages/crypto/src/contracts.ts',
          'packages/crypto/src/internal/verification.ts',
          'wasm/packages/contracts/src/crypto/contracts.js'
        ].includes(entry.file)))
      })
    });

    const migrationJson = stableJson(migrationArtifact);
    const requirementsJson = stableJson(requirementsArtifact);
    assertRedacted(migrationJson);
    assertRedacted(requirementsJson);

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const migrationOutput = path.join(options.outputDirectory, 'jwt-crypto-migration-map.json');
    const requirementsOutput = path.join(options.outputDirectory, 'jwt-crypto-requirements.json');
    fs.writeFileSync(migrationOutput, migrationJson);
    fs.writeFileSync(requirementsOutput, requirementsJson);

    const evidence = Object.freeze({
      version: 'pulse.jwt-crypto.d0-evidence.v1',
      status: 'passed',
      scope: map.scope,
      phaseCGate,
      baseline: Object.freeze({
        orderedBuildThenTest: true,
        stages,
        focusedPackageTestFiles: 7,
        focusedPackageTests: 44,
        currentJwtLoweringAndNativeTasks: 2,
        cryptoVerificationCases: 14,
        cryptoConfigurationCases: 14
      }),
      decisions: Object.freeze({
        jwtToCryptoSeam: requirements.cryptoCallBoundary.entry,
        resultMapping: requirements.resultMapping,
        supportedAlgorithms: requirements.algorithmContract.supported,
        unavailableAlgorithms: requirements.algorithmContract.unavailable,
        targetDetectionInJwt: false,
        backendDetectionInJwt: false,
        automaticFallback: false,
        versionAlignment: map.versionDecision.decision,
        frozenReleaseCatalogMutated: false
      }),
      outputs: Object.freeze([
        fileRecord(relativeFile(migrationOutput)),
        fileRecord(relativeFile(requirementsOutput))
      ]),
      nextAuthorizedUnit: 'D1'
    });
    const evidenceJson = stableJson(evidence);
    assertRedacted(evidenceJson);
    fs.writeFileSync(path.join(options.outputDirectory, 'jwt-d0-evidence.json'), evidenceJson);

    console.log(
      `ok - JWT D0 froze ${map.verificationPaths.length} paths, ` +
      `${map.behaviorDispositions.length} behavior dispositions, ` +
      `${map.testDispositions.length} test dispositions, and one HS256 crypto seam`
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
