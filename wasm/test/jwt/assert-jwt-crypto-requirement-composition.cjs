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

const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const packageContracts = require('../../packages/contracts/src/package/package-contract.js');
const {
  CRYPTO_SEMANTIC_OWNER,
  defineCryptoTargetCapabilities
} = require('../../packages/contracts/src/crypto/contracts.js');
const {
  normalizeProjectDeclaration,
  selectProfilePlan
} = require('../../packages/contracts/src/project/config-plan.js');
const {
  compileCanonicalProject,
  CanonicalProjectCompileError
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  packageOperationRecognitionForCompiled
} = require('../../packages/compiler/src/spine/package-operation-seam.js');
const jwtLowering = require('../../../packages/jwt/pulsewasm.compiler.cjs');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');

const REQUIRED_CONFIGURATION_CASES = Object.freeze([
  'inherited-global-pulse-crypto',
  'named-profile-without-local-crypto',
  'named-profile-complete-replacement',
  'no-array-merge',
  'no-object-merge',
  'empty-array',
  'empty-object',
  'duplicate-algorithm',
  'unknown-algorithm',
  'unknown-realization',
  'jwt-allowlist-missing-token-algorithm',
  'profile-missing-jwt-algorithm',
  'target-missing-algorithm-realization',
  'exact-pin-unavailable',
  'selected-realization-failure-without-fallback'
]);

const SOURCE_FILES = Object.freeze([
  'packages/crypto/package.json',
  'packages/jwt/package.json',
  'packages/jwt/pulsewasm.compiler.cjs',
  'packages/jwt/test/javascript-verifier.test.ts',
  'pnpm-lock.yaml',
  'wasm/packages/contracts/src/crypto/contracts.js',
  'wasm/packages/contracts/src/jwt/contracts.js',
  'wasm/packages/contracts/src/package/package-contract.js',
  'wasm/packages/compiler/src/crypto-requirement-planner.js',
  'wasm/packages/compiler/src/canonical-project-compiler.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js',
  'wasm/test/jwt/assert-jwt-package-owned-lowering.cjs',
  'wasm/test/jwt/assert-jwt-crypto-requirement-composition.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/registry.cjs',
  'wasm/test/suite/assert-suite-shape.cjs'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-d1');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT D1 option: ${argv[index]}`);
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

function select(raw, name) {
  return selectProfilePlan(normalizeProjectDeclaration(raw), {
    name,
    source: 'd1-fixture'
  });
}

function projectMetadata(plan, includeCrypto = true) {
  return Object.freeze({
    selectedProfile: Object.freeze({
      name: plan.profile.name,
      source: plan.profile.source
    }),
    strict: true,
    target: plan.profile.target,
    host: plan.profile.host,
    projectHash: plan.projectHash,
    configPlanHash: plan.planHash,
    bindings: plan.bindings,
    fragments: plan.fragments,
    ...(includeCrypto ? { crypto: plan.crypto } : {})
  });
}

function hs256Source(options = {}) {
  const schema = options.schema === true ? ", claimsSchema: 'auth.AccessClaims'" : '';
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(
    ctx,
    jwt.bearer(ctx.req),
    {
      algorithms: ['HS256'],
      key: { type: 'secret', binding: 'JWT_D1_SECRET_BINDING' }${schema}
    }
  )
  return ctx.text(verified.claims.sub)
}
`;
}

function rs256Source() {
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(
    ctx,
    jwt.bearer(ctx.req),
    {
      algorithms: ['RS256'],
      key: {
        type: 'jwk',
        key: {
          kty: 'RSA',
          alg: 'RS256',
          n: 'D1_PUBLIC_KEY_MATERIAL_MUST_NOT_REACH_DIAGNOSTICS',
          e: 'AQAB'
        }
      }
    }
  )
  return ctx.text(verified.claims.sub)
}
`;
}

function writeFixture(root, source, withSchema = false) {
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  fs.writeFileSync(path.join(sourceRoot, 'index.ts'), source);
  if (withSchema) {
    fs.writeFileSync(path.join(sourceRoot, 'schemas.ts'), 'export interface AccessClaims { sub: string }\n');
  }
  return path.join(sourceRoot, 'index.ts');
}

function compileFixture(root, source, plan, options = {}) {
  const entryFile = writeFixture(root, source, options.withSchema === true);
  return compileCanonicalProject(entryFile, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    packageTargetDescriptor: options.targetDescriptor || NODE_NATIVE_TARGET_DESCRIPTOR,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    ...(options.withSchema === true ? {
      schemas: {
        entries: [{
          id: 'auth.AccessClaims',
          namespace: 'auth',
          name: 'AccessClaims',
          source: './src/schemas.ts',
          type: 'AccessClaims'
        }]
      }
    } : {}),
    applicationProjectMetadata: projectMetadata(plan, options.includeCrypto !== false)
  });
}

function expectCompileCode(run, code, forbidden = []) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof CanonicalProjectCompileError, error && error.stack);
    assert.equal(error.code, code, error && error.stack);
    assert.equal(error.diagnostics[0].detail.automaticFallback, false);
    const serialized = `${error.message}\n${JSON.stringify(error.diagnostics)}`;
    for (const value of forbidden) assert.equal(serialized.includes(value), false);
    return true;
  });
}

function isolatedCaseRoot(parent, name) {
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function assertDependencyAndLowererContract() {
  const jwtPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'jwt', 'package.json'), 'utf8'));
  const cryptoPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'crypto', 'package.json'), 'utf8'));
  const lock = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const lowererSource = fs.readFileSync(path.join(repoRoot, 'packages', 'jwt', 'pulsewasm.compiler.cjs'), 'utf8');
  const suiteRegistry = fs.readFileSync(path.join(wasmRoot, 'test', 'suite', 'registry.cjs'), 'utf8');

  assert.equal(jwtPackage.version, '1.0.0-beta.1');
  assert.equal(cryptoPackage.version, '1.0.0-beta.1');
  assert.equal(jwtPackage.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.match(
    lock,
    /packages\/jwt:[\s\S]*?'@pulse-compute\/crypto':[\s\S]*?specifier: workspace:\*[\s\S]*?version: link:\.\.\/crypto/
  );
  assert.doesNotMatch(lowererSource, /descriptor\.realizations|jwtAlgorithmCapability|nativeCryptoImplementation/);
  assert.doesNotMatch(
    suiteRegistry,
    /['"]jwt-native-webcrypto['"]/,
    'the retired RS256 provider-owned backend must not remain in the current suite'
  );

  const direct = jwtLowering.buildJwtLoweringPlan({
    cwd: repoRoot,
    sourcePath: 'src/index.ts',
    sourceText: hs256Source({ schema: true }),
    schemaBundle: {
      declaredSchemaIds: ['auth.AccessClaims'],
      schemaIds: ['auth.AccessClaims'],
      registry: { schemas: [{ id: 'auth.AccessClaims' }] }
    },
    targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR
  });
  assert.equal(direct.artifact.status, 'ok');
  assert.deepEqual(direct.cryptoRequirements, [{
    version: packageContracts.PACKAGE_CRYPTO_REQUIREMENT_VERSION,
    requestedBy: '@pulse-compute/jwt',
    semanticOwner: CRYPTO_SEMANTIC_OWNER,
    reachable: true,
    algorithms: ['HS256']
  }]);
  assert.deepEqual(direct.entries[0].providerRequirements, [
    'time.wall-clock',
    'secret.get',
    'schema.decode'
  ]);
  assert.equal(direct.entries[0].target.status, 'provider-requirements-validated');
  assert.equal(Object.hasOwn(direct.entries[0].target, 'realization'), false);
  assert.equal(direct.entries[0].target.automaticFallback, false);
  assert.equal(direct.artifact.policy.jwtOwnsCryptoRealizationSelection, false);
  assert.deepEqual(
    jwtContracts.jwtCryptoRequirements(jwtContracts.JWT_ALGORITHMS)[0].algorithms,
    ['ES256', 'EdDSA', 'HS256', 'RS256']
  );
  return direct.cryptoRequirements[0];
}

function assertProjectComposition(temporary) {
  const inherited = select({
    pulse: { defaultProfile: 'prod', crypto: ['HS256'] },
    prod: { host: 'node', target: 'native' }
  }, 'prod');
  const inheritedCompiled = compileFixture(
    isolatedCaseRoot(temporary, 'inherited'),
    hs256Source(),
    inherited
  );
  const recognition = packageOperationRecognitionForCompiled(inheritedCompiled);
  assert.deepEqual(recognition.cryptoRequirements, [{
    version: packageContracts.PACKAGE_CRYPTO_REQUIREMENT_VERSION,
    requestedBy: '@pulse-compute/jwt',
    semanticOwner: CRYPTO_SEMANTIC_OWNER,
    reachable: true,
    algorithms: ['HS256']
  }]);
  assert.equal(inheritedCompiled.cryptoRealizationPlan.semanticOwner, CRYPTO_SEMANTIC_OWNER);
  assert.equal(inheritedCompiled.cryptoRealizationPlan.algorithms[0].algorithm, 'HS256');
  assert.deepEqual(inheritedCompiled.cryptoRealizationPlan.algorithms[0].requestedBy, ['@pulse-compute/jwt']);
  assert.equal(inheritedCompiled.cryptoRealizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
  assert.deepEqual(inheritedCompiled.cryptoRealizationPlan.profileProvenance, {
    selectedProfile: 'prod',
    selectionSource: 'default',
    cryptoSource: 'pulse'
  });
  assert.equal(inheritedCompiled.cryptoRealizationPlan.automaticFallback, false);

  const replacement = select({
    pulse: {
      defaultProfile: 'prod',
      crypto: { HS256: { realization: 'runtime-builtin' } }
    },
    prod: {
      host: 'node',
      target: 'native',
      crypto: { HS256: {} }
    }
  }, 'prod');
  const replacementCompiled = compileFixture(
    isolatedCaseRoot(temporary, 'replacement'),
    hs256Source(),
    replacement
  );
  assert.equal(replacement.crypto.source, 'profile');
  assert.equal(replacementCompiled.cryptoRealizationPlan.profileProvenance.cryptoSource, 'profile');
  assert.equal(replacementCompiled.cryptoRealizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
  assert.equal(replacementCompiled.cryptoRealizationPlan.algorithms[0].pinned, false);

  const implicit = select({
    pulse: { defaultProfile: 'prod' },
    prod: { host: 'node', target: 'native' }
  }, 'prod');
  expectCompileCode(
    () => compileFixture(
      isolatedCaseRoot(temporary, 'absent'),
      hs256Source(),
      implicit,
      { includeCrypto: false }
    ),
    'PULSE_CRYPTO_CONFIG_REQUIRED',
    ['JWT_D1_SECRET_BINDING']
  );
  for (const [name, plan] of [
    ['implicit', implicit],
    ['empty-array', select({
      pulse: { defaultProfile: 'prod' },
      prod: { host: 'node', target: 'native', crypto: [] }
    }, 'prod')],
    ['empty-object', select({
      pulse: { defaultProfile: 'prod' },
      prod: { host: 'node', target: 'native', crypto: {} }
    }, 'prod')]
  ]) {
    expectCompileCode(
      () => compileFixture(isolatedCaseRoot(temporary, name), hs256Source(), plan),
      'PULSE_CRYPTO_CONFIG_REQUIRED',
      ['JWT_D1_SECRET_BINDING']
    );
  }

  const noHsTarget = {
    ...NODE_NATIVE_TARGET_DESCRIPTOR,
    crypto: defineCryptoTargetCapabilities({
      target: 'native',
      algorithms: []
    })
  };
  expectCompileCode(
    () => compileFixture(
      isolatedCaseRoot(temporary, 'target-missing'),
      hs256Source(),
      inherited,
      { targetDescriptor: noHsTarget }
    ),
    'PULSE_CRYPTO_REALIZATION_UNAVAILABLE',
    ['JWT_D1_SECRET_BINDING']
  );

  const unavailablePin = select({
    pulse: { defaultProfile: 'prod' },
    prod: {
      host: 'node',
      target: 'native',
      crypto: { HS256: { realization: 'runtime-builtin' } }
    }
  }, 'prod');
  expectCompileCode(
    () => compileFixture(
      isolatedCaseRoot(temporary, 'pin-unavailable'),
      hs256Source(),
      unavailablePin
    ),
    'PULSE_CRYPTO_REALIZATION_PIN_INVALID',
    ['JWT_D1_SECRET_BINDING']
  );

  expectCompileCode(
    () => compileFixture(
      isolatedCaseRoot(temporary, 'algorithm-not-owned'),
      rs256Source(),
      inherited
    ),
    'PULSE_CRYPTO_ALGORITHM_UNKNOWN',
    ['D1_PUBLIC_KEY_MATERIAL_MUST_NOT_REACH_DIAGNOSTICS']
  );

  const nonCryptoRoot = isolatedCaseRoot(temporary, 'non-crypto');
  const nonCryptoEntry = writeFixture(
    nonCryptoRoot,
    "export default async function handler(ctx) { return ctx.text('ok') }\n"
  );
  const nonCrypto = compileCanonicalProject(nonCryptoEntry, {
    rootDir: nonCryptoRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(nonCryptoRoot, 'tsconfig.json'),
    packageTargetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    applicationProjectMetadata: projectMetadata(implicit, false)
  });
  assert.equal(nonCrypto.cryptoRealizationPlan, undefined);

  return Object.freeze({
    requirement: recognition.cryptoRequirements[0],
    realization: inheritedCompiled.cryptoRealizationPlan.algorithms[0],
    profileProvenance: inheritedCompiled.cryptoRealizationPlan.profileProvenance,
    validPlanHash: inheritedCompiled.cryptoRealizationPlan.planHash,
    nonCryptoUnchanged: true
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
          assert.match(output, /Test Files\s+7 passed \(7\)/);
          assert.match(output, /Tests\s+45 passed \(45\)/);
        }
      }
    ),
    runStage(
      'd1-package-and-planner-contracts',
      process.execPath,
      [
        runner,
        '--task', 'suite-shape',
        '--task', 'jwt-package-owned-lowering',
        '--task', 'crypto-config-planning',
        '--task', 'crypto-native-guest-source',
        '--no-report'
      ],
      {
        assertOutput(output) {
          assert.match(output, /suite-shape: passed/);
          assert.match(output, /jwt-package-owned-lowering: passed/);
          assert.match(output, /crypto-config-planning: passed/);
          assert.match(output, /crypto-native-guest-source: passed/);
        }
      }
    )
  ]);
}

function assertRedacted(serialized) {
  for (const marker of [
    'D1_PUBLIC_KEY_MATERIAL_MUST_NOT_REACH_DIAGNOSTICS',
    'JWT_D1_SECRET_BINDING',
    'PRIVATE_VALUE_MUST_NOT_LEAK'
  ]) {
    assert.equal(serialized.includes(marker), false);
  }
  assert.equal(serialized.includes(repoRoot), false);
  assert.doesNotMatch(serialized, /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-d1-'));
  try {
    const directRequirement = assertDependencyAndLowererContract();
    const composition = assertProjectComposition(temporary);
    const stages = runFocusedValidation();
    const evidence = Object.freeze({
      version: 'pulse.jwt-crypto.d1-evidence.v1',
      status: 'passed',
      scope: Object.freeze({
        phase: 'D1',
        operation: 'direct dependency and reachable crypto requirement composition',
        runtimeJwtVerificationChanged: false,
        publication: false,
        deployment: false,
        frozenReleaseCatalogMutated: false
      }),
      dependency: Object.freeze({
        from: '@pulse-compute/jwt@1.0.0-beta.1',
        to: '@pulse-compute/crypto@1.0.0-beta.1',
        range: 'workspace:*'
      }),
      requirement: directRequirement,
      composition,
      providerRequirements: Object.freeze([
        'time.wall-clock',
        'secret.get',
        'schema.decode'
      ]),
      configurationCases: REQUIRED_CONFIGURATION_CASES,
      validation: Object.freeze({
        stages,
        focusedPackageTestFiles: 7,
        focusedPackageTests: 45,
        focusedContractTasks: 4
      }),
      policy: Object.freeze({
        jwtOwnsJoseAndClaimsSemantics: true,
        cryptoOwnsPrimitiveAndRealizationSemantics: true,
        jwtTargetDetection: false,
        jwtBackendSelection: false,
        invalidRequirementsStopBeforeNativeToolchains: true,
        providerOwnedRs256ProofRegistered: false,
        automaticFallback: false,
        diagnosticsContainTokenClaimsKeyOrSecretValues: false
      }),
      sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
      nextAuthorizedUnit: 'D2'
    });
    const serialized = stableJson(evidence);
    assertRedacted(serialized);
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(options.outputDirectory, 'jwt-d1-evidence.json'), serialized);
    console.log(
      `ok - JWT D1 composed ${directRequirement.algorithms.join(', ')} through ` +
      `${directRequirement.semanticOwner} across ${REQUIRED_CONFIGURATION_CASES.length} required cases`
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
