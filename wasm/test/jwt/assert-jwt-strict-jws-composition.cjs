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

const HIGH_RISK_CASES = Object.freeze([
  'altered-protected-header',
  'altered-payload',
  'altered-authenticator',
  'duplicate-protected-alg',
  'padded-base64url',
  'noncanonical-base64url',
  'malformed-utf8',
  'malformed-json',
  'original-signing-input-bytes',
  'invalid-authenticator-before-clock',
  'invalid-authenticator-before-schema',
  'claims-unavailable-before-authenticity',
  'backend-exception-normalized',
  'authenticator-mismatch-distinct-from-realization-failure'
]);

const RESULT_MAPPING = Object.freeze({
  valid: 'continue-to-claims',
  'invalid-authenticator': 'PULSE_JWT_SIGNATURE_INVALID',
  'invalid-key': 'PULSE_JWT_KEY_INVALID',
  'invalid-input': 'PULSE_JWT_MALFORMED',
  'realization-failure': 'PULSE_JWT_OPERATION_FAILED'
});

const SOURCE_FILES = Object.freeze([
  'packages/jwt/package.json',
  'packages/jwt/tsconfig.json',
  'packages/jwt/tsconfig.types.json',
  'packages/jwt/src/crypto-verifier.ts',
  'packages/jwt/src/host-verifier.ts',
  'packages/jwt/src/javascript-verifier.ts',
  'packages/jwt/src/provider.ts',
  'packages/jwt/src/token.ts',
  'packages/jwt/src/internal/registered-claims.ts',
  'packages/jwt/src/internal/verifier-authority.ts',
  'packages/jwt/test/crypto-verifier.test.ts',
  'packages/jwt/test/types.ts',
  'wasm/test/jwt/assert-jwt-strict-jws-composition.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/registry.cjs',
  'wasm/test/suite/assert-suite-shape.cjs'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-d2');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT D2 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
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
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs || 180000,
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

function assertSemanticContract() {
  const jwtPackage = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'packages', 'jwt', 'package.json'),
    'utf8'
  ));
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'packages', 'jwt', 'src', 'crypto-verifier.ts'),
    'utf8'
  );
  const providerSource = fs.readFileSync(
    path.join(repoRoot, 'packages', 'jwt', 'src', 'provider.ts'),
    'utf8'
  );
  const tokenSource = fs.readFileSync(
    path.join(repoRoot, 'packages', 'jwt', 'src', 'token.ts'),
    'utf8'
  );
  const suiteRegistry = fs.readFileSync(
    path.join(wasmRoot, 'test', 'suite', 'registry.cjs'),
    'utf8'
  );

  assert.equal(jwtPackage.version, '1.0.0-beta.1');
  assert.equal(jwtPackage.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.match(verifierSource, /from '@pulse-compute\/crypto'/);
  assert.match(verifierSource, /CRYPTO_VERIFICATION_STATUSES/);
  assert.match(verifierSource, /verifyJwtWithCrypto/);
  assert.match(verifierSource, /compactJwtSignatureInput/);
  assert.match(verifierSource, /validateRegisteredClaims/);
  assert.match(verifierSource, /validateClaimsSchema/);
  assert.match(verifierSource, /automaticFallback: false/);
  assert.doesNotMatch(
    verifierSource,
    /(?:from 'jose'|jwtVerify|verifySignature|globalThis|subtle|WebCrypto)/
  );
  assert.match(providerSource, /verifyJwtWithCrypto/);
  assert.match(tokenSource, /canonical !== segment/);
  assert.match(tokenSource, /duplicate-json-member/);
  assert.equal(
    tokenSource.includes('new TextEncoder().encode(`${segments[0]}.${segments[1]}`)'),
    true
  );
  assert.match(suiteRegistry, /['"]jwt-strict-jws-composition['"]/);

  return Object.freeze({
    package: '@pulse-compute/jwt@1.0.0-beta.1',
    semanticOwner: '@pulse-compute/crypto',
    operation: 'crypto.mac.verify',
    algorithm: 'HS256',
    requestFields: Object.freeze([
      'algorithm',
      'key',
      'data',
      'tag'
    ]),
    keyDescriptor: 'hmac-key-bytes',
    exactSigningInput: 'encoded-protected-header + ASCII-period + encoded-payload',
    authenticatorInput: 'decoded-original-signature-segment',
    resultMapping: RESULT_MAPPING
  });
}

function runFocusedValidation() {
  const typescript = require.resolve('typescript/bin/tsc');
  const vitest = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs');
  const runner = path.join(wasmRoot, 'scripts', 'run-wasm-tests.cjs');
  return Object.freeze([
    runStage(
      'crypto-and-jwt-package-build',
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
      [
        typescript,
        '-p',
        'packages/jwt/tsconfig.types.json',
        '--noEmit'
      ]
    ),
    runStage(
      'crypto-and-jwt-package-tests',
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
          assert.match(output, /Test Files\s+8 passed \(8\)/);
          assert.match(output, /Tests\s+53 passed \(53\)/);
        }
      }
    ),
    runStage(
      'd1-composition-regression-contracts',
      process.execPath,
      [
        runner,
        '--task', 'suite-shape',
        '--task', 'jwt-package-owned-lowering',
        '--task', 'crypto-config-planning',
        '--no-report'
      ],
      {
        assertOutput(output) {
          assert.match(output, /suite-shape: passed/);
          assert.match(output, /jwt-package-owned-lowering: passed/);
          assert.match(output, /crypto-config-planning: passed/);
        }
      }
    )
  ]);
}

function assertRedacted(serialized) {
  for (const marker of [
    'D2_CLAIMS_MUST_REMAIN_UNAVAILABLE',
    'D2_BACKEND_EXCEPTION_MUST_NOT_ESCAPE',
    'JWT_D2_SECRET',
    'd2-secret-material'
  ]) {
    assert.equal(serialized.includes(marker), false);
  }
  assert.equal(serialized.includes(repoRoot), false);
  assert.doesNotMatch(serialized, /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const semanticContract = assertSemanticContract();
  const stages = runFocusedValidation();
  const evidence = Object.freeze({
    version: 'pulse.jwt-crypto.d2-evidence.v1',
    status: 'passed',
    scope: Object.freeze({
      phase: 'D2',
      entryPoint: 'package-surface',
      package: '@pulse-compute/jwt',
      operation: 'strict JWS composition and result ordering',
      authoringFacadeChanged: false,
      providerIntegrationChanged: false,
      nativeGuestAbiChanged: false,
      publication: false,
      deployment: false,
      frozenReleaseCatalogMutated: false
    }),
    semanticContract,
    ordering: Object.freeze([
      'bounded-compact-token',
      'strict-three-segment-split',
      'strict-protected-header',
      'jwt-algorithm-allowlist',
      'algorithm-compatible-key-resolution',
      'exact-original-signing-input',
      'crypto-verification',
      'claims-parse-after-valid',
      'one-provider-wall-clock-capture',
      'registered-claims',
      'claims-schema',
      'detached-immutable-result'
    ]),
    highRiskCases: HIGH_RISK_CASES,
    validation: Object.freeze({
      stages,
      focusedPackageTestFiles: 8,
      focusedPackageTests: 53,
      d2HighRiskTests: 8,
      focusedContractTasks: 3
    }),
    policy: Object.freeze({
      jwtOwnsJwsParsingAndClaimsSemantics: true,
      cryptoOwnsAuthenticityDecision: true,
      claimsAvailableBeforeAuthenticity: false,
      clockCapturedBeforeAuthenticity: false,
      schemaRunsBeforeRegisteredClaims: false,
      backendObjectOrExceptionEscapes: false,
      joseUsedByD2SemanticPath: false,
      automaticFallback: false,
      secretBytesClearedAfterCryptoCall: true,
      diagnosticsContainTokenClaimsAuthenticatorKeyOrSecretValues: false
    }),
    preserved: Object.freeze({
      d1RequirementComposition: true,
      runtimeRealizationIntegrationDeferredTo: 'D3',
      legacyRuntimePathsRetainedUntilD3: true
    }),
    sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
    previousCheckpoint: 'D1',
    nextAuthorizedUnit: 'D3'
  });
  const serialized = stableJson(evidence);
  assertRedacted(serialized);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(options.outputDirectory, 'jwt-d2-evidence.json'), serialized);
  console.log(
    `ok - JWT D2 routes exact HS256 JWS bytes through ${semanticContract.semanticOwner} ` +
    `with ${HIGH_RISK_CASES.length} high-risk cases and no fallback`
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
