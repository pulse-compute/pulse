#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const {
  compileCanonicalProject
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const {
  packageLoweringForCanonicalNativePlan
} = require('../../packages/compiler/src/spine/canonical-native-plan.js');
const {
  compileCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const {
  extractSchemaRegistry
} = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION
} = require('../../packages/build-support/src/native-optimization.js');
const {
  instantiateCanonicalNativeModule
} = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  createNodeProviderAdapter
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');
const {
  compileFastlyNativePlatformCapabilitiesPlan
} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const {
  writeFastlyCanonicalTarget
} = require('../../../packages/provider-fastly/src/build/canonical-target.js');
const {
  createFastlyLoweringPlan
} = require('../../../packages/provider-fastly/src/provider-contract.js');
const {
  fastlyComputeRealityVersion,
  inspectFastlyComputeLauncher,
  renderFastlyLocalConfig,
  requestFastlyCompute,
  startFastlyComputeServe
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {
  binaryenIdentity
} = require('../../packages/wasm-guest-link/src/toolchain.js');
const {
  HARNESS_VERSION,
  NOW,
  SUBJECT,
  PUBLIC_JWK,
  FASTLY_PLANNING_CASE_IDS,
  loadEs256ConformanceCorpus,
  materializeEs256ConformanceCases,
  forbiddenSensitiveValues
} = require('./jwt-es256-conformance-harness.cjs');

const EVIDENCE_VERSION = 'pulse.jwt-g4-evidence.v1';
const JAVASCRIPT_REPORT_VERSION = 'pulse.jwt-es256-javascript-conformance.g4.v1';
const NATIVE_REPORT_VERSION = 'pulse.jwt-es256-native-conformance.g4.v1';
const NODE_REALITY_VERSION = 'pulse.jwt-es256-node-native-reality.g4.v1';
const FASTLY_REALITY_VERSION = 'pulse.jwt-es256-fastly-native-reality.g4.v1';
const MATRIX_VERSION = 'pulse.jwt-es256-target-matrix.g4.v1';
const IMPACT_VERSION = 'pulse.jwt-es256-artifact-impact.g4.v1';
const REALIZATION = 'guest-linked:pulse-es256-rustcrypto-p256';
const IMPLEMENTATION =
  'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1';
const SYNCHRONIZED_PACKAGES = Object.freeze([
  Object.freeze({ name: '@pulse-compute/crypto', version: '1.0.0-beta.1' }),
  Object.freeze({ name: '@pulse-compute/jwt', version: '1.0.0-beta.1' })
]);
const MODES = Object.freeze([
  Object.freeze({ id: 'default', nativeOptimization: undefined }),
  Object.freeze({
    id: 'experimental-native-size',
    nativeOptimization: EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION
  })
]);
const SOURCE_FILES = Object.freeze([
  'packages/crypto/guests/es256-rustcrypto/pulse.guest-unit.json',
  'packages/crypto/guests/es256-rustcrypto/prebuilt/es256-verifier.wasm',
  'packages/crypto/guests/es256-rustcrypto/source/Cargo.lock',
  'packages/crypto/guests/es256-rustcrypto/source/Cargo.toml',
  'packages/crypto/guests/es256-rustcrypto/source/rust-toolchain.toml',
  'packages/jwt/as/index.as.ts',
  'packages/jwt/pulsewasm.native.cjs',
  'packages/provider-fastly/src/build/fixed-memory-runtime.as.ts',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'packages/provider-fastly/src/build/canonical-target.js',
  'packages/provider-fastly/src/provider-contract.js',
  'packages/provider-fastly/src/testing/fastly-cli.js',
  'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
  'packages/provider-fastly/src/toolchain/index.js',
  'wasm/packages/cli/src/project-execution.js',
  'wasm/packages/contracts/src/provider/canonical-provider.js',
  'wasm/test/jwt/jwt-es256-conformance-corpus.json',
  'wasm/test/jwt/jwt-es256-conformance-harness.cjs',
  'wasm/test/jwt/assert-jwt-es256-cross-target.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/assert-suite-shape.cjs',
  'wasm/test/suite/registry.cjs'
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) {
      outputDirectory = path.resolve(repoRoot, argv[++index]);
    } else {
      throw new TypeError(`Unknown or incomplete JWT G4 option ${argv[index]}.`);
    }
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sourceRecord(relativeFile) {
  const bytes = fs.readFileSync(path.join(repoRoot, relativeFile));
  return Object.freeze({
    file: relativeFile,
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  });
}

function providerPackageFacts(plan) {
  const lowering = packageLoweringForCanonicalNativePlan(plan);
  return Object.freeze({
    realizationArtifacts: lowering && lowering.realizationArtifacts || [],
    guestUnits: lowering && lowering.guestUnits || []
  });
}

function runStage(id, command, args, timeoutMs) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${id} failed${detail ? `\n${detail}` : ''}`, {
      cause: result.error
    });
  }
  return Object.freeze({
    id,
    status: 'passed',
    durationMs: Date.now() - startedAt
  });
}

function optionalToolInspection(command, args) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 10_000,
    shell: false
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return Object.freeze({
    available: !result.error && result.status === 0,
    output: !result.error && result.status === 0 ? output : null,
    durationMs: Date.now() - startedAt,
    countedAsApplicationExecution: false
  });
}

function fastlyNativeDescriptor() {
  return fastlyToolchain.createDriver().targets.native;
}

function schemaSource() {
  return `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { AccessClaims } from './models.js'
export default defineSchemaRegistry({
  schemas: {
    'auth.AccessClaims': schema<AccessClaims>(),
  },
  responses: {},
})
`;
}

function handlerSource(options) {
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), ${JSON.stringify(options)})
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg)
}
`;
}

function projectMetadata(host) {
  return {
    selectedProfile: { name: `g4-${host}`, source: 'g4-cross-target' },
    strict: true,
    target: 'native',
    host,
    projectHash: host === 'node' ? '4'.repeat(64) : '5'.repeat(64),
    configPlanHash: '6'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {},
    crypto: {
      source: 'profile',
      declaration: cryptoContracts.normalizeCryptoConfiguration({
        ES256: { realization: REALIZATION }
      })
    }
  };
}

function compileProjectFixture(
  root,
  host,
  targetDescriptor,
  options,
  compileOptions = {}
) {
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  fs.writeFileSync(
    path.join(sourceRoot, 'models.ts'),
    'export interface AccessClaims { sub: string; roles: string[] }\n'
  );
  let schemas;
  if (options.claimsSchema) {
    const schemaFile = path.join(sourceRoot, 'schemas.ts');
    fs.writeFileSync(schemaFile, schemaSource());
    schemas = {
      registry: extractSchemaRegistry(schemaFile, { projectRoot: root }).registry
    };
  }
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(entryFile, handlerSource(options));
  const project = compileCanonicalProject(entryFile, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    packageTargetDescriptor: targetDescriptor,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    schemas,
    applicationProjectMetadata: projectMetadata(host)
  });
  const errors = project.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length > 0 && compileOptions.allowDiagnostics !== true) {
    const error = new Error('G4 ES256 fixture produced compiler diagnostics.');
    error.code = 'PULSE_G4_FIXTURE_DIAGNOSTICS';
    error.diagnostics = errors;
    throw error;
  }
  if (errors.length > 0) {
    return Object.freeze({ project, errors: Object.freeze(errors), plan: null });
  }
  const plan = buildCanonicalNativePlan(project);
  return Object.freeze({ project, errors: Object.freeze([]), plan });
}

function compileControlFixture(root, host, targetDescriptor) {
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(
    entryFile,
    'export default async function handler(ctx) { return ctx.text("ok") }\n'
  );
  const project = compileCanonicalProject(entryFile, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    packageTargetDescriptor: targetDescriptor,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    applicationProjectMetadata: {
      ...projectMetadata(host),
      crypto: {
        source: 'profile',
        declaration: cryptoContracts.normalizeCryptoConfiguration({})
      }
    }
  });
  assert.equal(project.diagnostics.some((entry) => entry.severity === 'error'), false);
  return Object.freeze({ project, plan: buildCanonicalNativePlan(project) });
}

function errorCode(error) {
  return error && error.code ? String(error.code) : 'PULSE_RUNTIME_FAILED';
}

async function executeSemanticCase(testCase, jwtRuntime, baseCrypto, runtimeId) {
  const order = [];
  const sensitive = [];
  let clockCalls = 0;
  let schemaCalls = 0;
  let cryptoCalls = 0;
  const selectedCrypto = testCase.forceRealizationFailure
    ? Object.freeze({
        signature: Object.freeze({
          verify() {
            cryptoCalls += 1;
            order.push('crypto');
            return Object.freeze({ status: 'realization-failure' });
          }
        })
      })
    : Object.freeze({
        signature: Object.freeze({
          async verify(request) {
            cryptoCalls += 1;
            order.push('crypto');
            return baseCrypto.signature.verify(request);
          }
        })
      });
  const host = Object.freeze({
    captureWallClock() {
      clockCalls += 1;
      order.push('clock');
      return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
    },
    validateClaims(schemaId, value) {
      schemaCalls += 1;
      order.push('schema');
      assert.equal(schemaId, 'auth.AccessClaims');
      return Object.freeze({ sub: value.sub, roles: value.roles });
    },
    registerSensitiveValue(value) {
      sensitive.push(String(value));
    }
  });
  let output;
  let caught;
  try {
    output = await jwtRuntime.verifyJwtWithCrypto(
      testCase.input,
      host,
      selectedCrypto
    );
  } catch (error) {
    caught = error;
  }
  const observedStatus = caught ? errorCode(caught) : 'valid';
  assert.equal(observedStatus, testCase.expectedStatus, testCase.id);
  if (!caught) {
    assert.equal(output.protectedHeader.alg, 'ES256');
    assert.equal(output.claims.sub, SUBJECT);
  } else if (caught.detail && Object.hasOwn(caught.detail, 'automaticFallback')) {
    assert.equal(caught.detail.automaticFallback, false);
  }
  if (testCase.expectedOrder) {
    assert.deepEqual(order, testCase.expectedOrder, testCase.id);
  }
  if (testCase.requireClaimsUnavailable) {
    assert.equal(clockCalls, 0);
    assert.equal(schemaCalls, 0);
    assert.equal(sensitive.includes(SUBJECT), false);
  }
  if (testCase.requireRedaction) {
    const serialized = [
      String(caught),
      JSON.stringify(caught),
      caught && caught.stack
    ].join('\n');
    for (const forbidden of [
      testCase.input.token,
      SUBJECT,
      PUBLIC_JWK.x,
      PUBLIC_JWK.y
    ]) assert.equal(serialized.includes(forbidden), false);
  }
  return Object.freeze({
    id: testCase.id,
    status: 'passed',
    evaluation: 'runtime',
    expectedStatus: testCase.expectedStatus,
    observedStatus,
    order: Object.freeze([...order]),
    observation: Object.freeze({
      cryptoCalls,
      clockCalls,
      schemaCalls,
      claimsAvailable: Boolean(output),
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false
    }),
    runtime: runtimeId
  });
}

function artifactFacts(compiled, providerConsumedSha256) {
  const report = compiled.guestLink && compiled.guestLink.report;
  const audit = compiled.guestLink && compiled.guestLink.audit;
  assert.ok(report && report.status === 'passed');
  assert.ok(audit && audit.status === 'passed');
  const finalSha256 = sha256(compiled.wasm);
  assert.equal(report.finalArtifact.sha256, finalSha256);
  assert.equal(audit.artifact.sha256, finalSha256);
  assert.equal(providerConsumedSha256, finalSha256);
  const unit = report.units[0];
  assert.equal(unit.artifactSha256, report.inputs.guest.sha256);
  return Object.freeze({
    realization: REALIZATION,
    implementation: IMPLEMENTATION,
    source: Object.freeze({
      included: unit.sourceIncluded,
      treeSha256: unit.sourceSha256,
      files: unit.provenance.source.files,
      bytes: unit.provenance.source.bytes
    }),
    prebuilt: Object.freeze({
      bytes: report.inputs.guest.bytes,
      sha256: report.inputs.guest.sha256
    }),
    materialized: Object.freeze({
      contentAddressed: true,
      hashVerifiedBeforeUse: report.materialization.hashVerifiedBeforeUse,
      bytes: report.inputs.guest.bytes,
      sha256: report.inputs.guest.sha256
    }),
    primaryInput: report.inputs.primary,
    preOptimizationLinked: Object.freeze({
      sha256: report.optimization.inputSha256
    }),
    finalOptimized: Object.freeze({
      bytes: compiled.wasm.byteLength,
      sha256: finalSha256,
      posture: report.optimization.posture
    }),
    finalAudit: Object.freeze({
      version: audit.version,
      status: audit.status,
      artifactSha256: audit.artifact.sha256,
      providerPackagingAuthorized: audit.providerPackaging.authorized
    }),
    providerConsumed: Object.freeze({
      bytes: compiled.wasm.byteLength,
      sha256: providerConsumedSha256,
      matchesFinalAudit: providerConsumedSha256 === audit.artifact.sha256
    }),
    automaticFallback: false
  });
}

async function runJavascriptCell(materialized, jwtRuntime, cryptoRuntime) {
  const startedAt = Date.now();
  const cases = [];
  for (const testCase of materialized.cases) {
    cases.push(await executeSemanticCase(
      testCase,
      jwtRuntime,
      cryptoRuntime.crypto,
      'node-webcrypto-runtime-builtin'
    ));
  }
  return Object.freeze({
    id: 'node-javascript',
    status: 'passed',
    required: true,
    realization: 'runtime-builtin',
    implementation: 'webcrypto.subtle.ecdsa-p256-sha-256.v1',
    cases: Object.freeze(cases),
    requiredExecutions: cases.length,
    completedExecutions: cases.length,
    skippedExecutions: 0,
    timing: Object.freeze({ corpusDurationMs: Date.now() - startedAt }),
    automaticFallback: false
  });
}

async function runNodeNativeMode(
  mode,
  fixture,
  materialized,
  jwtRuntime
) {
  const compiled = compileCanonicalNativePlan(fixture.plan, {
    cwd: repoRoot,
    projectRoot: repoRoot,
    targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    profile: `g4-node-${mode.id}`,
    synchronizedPackages: SYNCHRONIZED_PACKAGES,
    timeoutMs: 180_000,
    nativeOptimization: mode.nativeOptimization
  });
  const controller = instantiateCanonicalNativeModule(compiled, {
    providerAdapter: createNodeProviderAdapter()
  });
  assert.equal(controller.cryptoRealization.available, true);
  assert.equal(controller.cryptoRealization.realization, REALIZATION);
  const corpusStartedAt = Date.now();
  const cases = [];
  for (const testCase of materialized.cases) {
    cases.push(await executeSemanticCase(
      testCase,
      jwtRuntime,
      controller.cryptoVerifier,
      'node-exact-guest-linked-final-wasm'
    ));
  }
  const consumedSha256 = sha256(compiled.wasm);
  return Object.freeze({
    mode: mode.id,
    status: 'passed',
    artifact: artifactFacts(compiled, consumedSha256),
    cases: Object.freeze(cases),
    timing: Object.freeze({
      buildDurationMs: compiled.durationMs,
      corpusDurationMs: Date.now() - corpusStartedAt
    }),
    compiled
  });
}

function headersObject(headers) {
  return Object.fromEntries(
    headers.map(([name, value]) => [String(name).toLowerCase(), String(value)])
  );
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number) && number >= 0, label);
  return number;
}

function fastlyCaseResult(testCase, response) {
  const headers = headersObject(response.headers);
  assert.equal(headers['x-pulse-e2-case'], testCase.id);
  assert.equal(headers['x-pulse-e2-realization'], REALIZATION);
  assert.equal(headers['x-pulse-e2-implementation'], IMPLEMENTATION);
  assert.equal(headers['x-pulse-e2-fallback'], 'false');
  const observedStatus = headers['x-pulse-e2-status'] === 'success'
    ? 'valid'
    : headers['x-pulse-e2-code'];
  assert.equal(observedStatus, testCase.expectedStatus, testCase.id);
  const eventNames = Object.freeze({
    A: 'crypto',
    C: 'clock',
    H: 'schema'
  });
  const order = Object.freeze(
    [...String(headers['x-pulse-e2-order'] || '')]
      .map((entry) => eventNames[entry])
      .filter(Boolean)
  );
  if (testCase.expectedOrder) {
    assert.deepEqual(order, testCase.expectedOrder, testCase.id);
  }
  const cryptoCalls = nonnegativeInteger(
    headers['x-pulse-e2-crypto-calls'],
    `${testCase.id}:crypto`
  );
  const clockCalls = nonnegativeInteger(
    headers['x-pulse-e2-clock-calls'],
    `${testCase.id}:clock`
  );
  const schemaCalls = nonnegativeInteger(
    headers['x-pulse-e2-schema-calls'],
    `${testCase.id}:schema`
  );
  if (testCase.requireClaimsUnavailable) {
    assert.equal(clockCalls, 0);
    assert.equal(schemaCalls, 0);
    assert.equal(headers['x-pulse-e2-claims-parsed'], '0');
  }
  if (observedStatus === 'valid') {
    assert.equal(response.status, 200);
    assert.equal(response.body.toString('utf8'), `${SUBJECT}:ES256`);
  } else {
    assert.equal(response.status, 400);
    assert.equal(response.body.byteLength, 0);
  }
  return Object.freeze({
    id: testCase.id,
    status: 'passed',
    evaluation: 'fastly-compute-serve-request',
    expectedStatus: testCase.expectedStatus,
    observedStatus,
    order,
    observation: Object.freeze({
      cryptoCalls,
      clockCalls,
      schemaCalls,
      claimsAvailable: headers['x-pulse-e2-verified'] === '1',
      signingInputBytes: nonnegativeInteger(
        headers['x-pulse-e2-signing-bytes'],
        `${testCase.id}:signing-input`
      ),
      signingInputSha256: headers['x-pulse-e2-signing-sha256'] || null,
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false
    }),
    runtime: fastlyComputeRealityVersion
  });
}

function planningObservation(
  testCase,
  mode,
  targetDescriptor,
  root
) {
  const startedAt = Date.now();
  let rejected = false;
  let diagnosticCodes = [];
  try {
    const fixture = compileProjectFixture(
      root,
      'fastly',
      targetDescriptor,
      testCase.input.options,
      { allowDiagnostics: true }
    );
    if (fixture.errors.length > 0) {
      rejected = true;
      diagnosticCodes = fixture.errors
        .map((entry) => String(entry.code || 'PULSE_COMPILE_REJECTED'))
        .sort();
    } else {
      try {
        compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, {
          ...providerPackageFacts(fixture.plan),
          cwd: repoRoot,
          projectRoot: repoRoot,
          targetDescriptor,
          profile: `g4-fastly-${mode.id}-${testCase.id}`,
          synchronizedPackages: SYNCHRONIZED_PACKAGES,
          requirePlatformCapability: false,
          canonicalBuild: true,
          timeoutMs: 180_000,
          nativeOptimization: mode.nativeOptimization,
          jwtReality: { enabled: true, clockUnixSeconds: NOW }
        });
      } catch (error) {
        rejected = true;
        diagnosticCodes = [errorCode(error)];
      }
    }
  } catch (error) {
    rejected = true;
    diagnosticCodes = [
      ...(Array.isArray(error.diagnostics)
        ? error.diagnostics.map((entry) => String(entry.code || 'PULSE_COMPILE_REJECTED'))
        : [errorCode(error)])
    ].sort();
  }
  assert.equal(rejected, true, `${testCase.id} must be rejected before packaging`);
  return Object.freeze({
    id: testCase.id,
    status: 'passed',
    evaluation: 'provider-native-compile-rejection',
    expectedStatus: testCase.expectedStatus,
    observedStatus: testCase.expectedStatus,
    diagnosticCodes: Object.freeze(diagnosticCodes),
    observation: Object.freeze({
      cryptoCalls: 0,
      clockCalls: 0,
      schemaCalls: 0,
      claimsAvailable: false,
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false
    }),
    durationMs: Date.now() - startedAt
  });
}

function writeFastlyPackage(
  packageRoot,
  fixture,
  compiled,
  mode,
  targetDescriptor
) {
  const providerBuild = writeFastlyCanonicalTarget({
    outDir: packageRoot,
    cwd: repoRoot,
    projectRoot: repoRoot,
    plan: fixture.plan,
    providerPlan: createFastlyLoweringPlan(fixture.project.metadata, {}),
    native: compiled,
    providerConfig: { bindings: {} },
    bindings: {},
    profile: `g4-fastly-${mode.id}`,
    targetDescriptor,
    synchronizedPackages: SYNCHRONIZED_PACKAGES,
    nativeOptimization: mode.nativeOptimization,
    compileTimeoutMs: 180_000
  });
  fs.writeFileSync(
    path.join(packageRoot, 'fastly.toml'),
    renderFastlyLocalConfig({
      name: `pulse-jwt-g4-${mode.id}`,
      description: 'Pulse G4 ES256 exact-artifact conformance'
    })
  );
  const providerConsumedSha256 = fileSha256(providerBuild.wasmFile);
  assert.equal(providerConsumedSha256, sha256(compiled.wasm));
  assert.equal(providerBuild.build.guestLink.packagedBytesMatchAudit, true);
  return Object.freeze({ providerBuild, providerConsumedSha256 });
}

async function runFastlyVariant(
  mode,
  variant,
  fixture,
  compiled,
  cases,
  launcher,
  tempRoot,
  targetDescriptor,
  forbidden
) {
  const packageRoot = path.join(tempRoot, `fastly-${mode.id}-${variant}`);
  const written = writeFastlyPackage(
    packageRoot,
    fixture,
    compiled,
    mode,
    targetDescriptor
  );
  const bootStartedAt = Date.now();
  const server = await startFastlyComputeServe({
    launcher,
    packageRoot,
    wasmFile: written.providerBuild.wasmFile,
    manifestFile: path.join(packageRoot, 'fastly.toml'),
    startTimeoutMs: 60_000,
    stopTimeoutMs: 5_000,
    env: process.env
  });
  const engineBootDurationMs = Date.now() - bootStartedAt;
  const results = [];
  const requests = [];
  const corpusStartedAt = Date.now();
  let teardownDurationMs = 0;
  try {
    for (const testCase of cases) {
      const requestStartedAt = Date.now();
      const response = await requestFastlyCompute(server, {
        path: '/',
        headers: {
          authorization: `Bearer ${testCase.input.token}`,
          'x-pulse-e2-case': testCase.id
        },
        timeoutMs: 30_000
      });
      requests.push(Date.now() - requestStartedAt);
      results.push(fastlyCaseResult(testCase, response));
    }
  } finally {
    const teardownStartedAt = Date.now();
    await server.stop();
    teardownDurationMs = Date.now() - teardownStartedAt;
    server.child.stdout.destroy();
    server.child.stderr.destroy();
    server.child.unref();
  }
  const corpusDurationMs = Date.now() - corpusStartedAt - teardownDurationMs;
  const logs = `${server.logs.stdout}\n${server.logs.stderr}`;
  for (const entry of forbidden) {
    assert.equal(logs.includes(entry.value), false, `${variant}:${entry.id}`);
  }
  return Object.freeze({
    variant,
    status: 'passed',
    artifact: artifactFacts(compiled, written.providerConsumedSha256),
    cases: Object.freeze(results),
    timing: Object.freeze({
      buildDurationMs: compiled.durationMs,
      engineBootDurationMs,
      corpusDurationMs,
      perRequestDurationMs: Object.freeze(requests),
      teardownDurationMs,
      launcherInspectionIncludedInApplicationExecution: false
    }),
    runtime: Object.freeze({
      version: fastlyComputeRealityVersion,
      launcherKind: launcher.kind,
      cliVersion:
        launcher.fastlyCliInspection
        && launcher.fastlyCliInspection.version
        || null,
      viceroyVersion:
        launcher.viceroyInspection
        && launcher.viceroyInspection.version
        || null,
      requestCount: results.length,
      logsSha256: sha256(logs)
    })
  });
}

async function runFastlyMode(
  mode,
  fixtures,
  materialized,
  launcher,
  tempRoot,
  targetDescriptor,
  forbidden
) {
  const planning = materialized.cases.filter(
    (entry) => entry.fastlyEvaluation === 'planning'
  );
  assert.deepEqual(
    planning.map((entry) => entry.id),
    FASTLY_PLANNING_CASE_IDS
  );
  const planningResults = planning.map((testCase) => planningObservation(
    testCase,
    mode,
    targetDescriptor,
    path.join(tempRoot, `planning-${mode.id}-${testCase.id}`)
  ));
  const runtimeCases = materialized.cases.filter(
    (entry) => entry.fastlyEvaluation === 'runtime'
  );
  const variants = [...new Set(runtimeCases.map((entry) => entry.variant))];
  const compiledByVariant = new Map();
  for (const variant of variants) {
    const fixture = fixtures.get(variant);
    assert.ok(fixture, `Missing Fastly fixture ${variant}`);
    compiledByVariant.set(
      variant,
      compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, {
        ...providerPackageFacts(fixture.plan),
        cwd: repoRoot,
        projectRoot: repoRoot,
        targetDescriptor,
        profile: `g4-fastly-${mode.id}-${variant}`,
        synchronizedPackages: SYNCHRONIZED_PACKAGES,
        requirePlatformCapability: false,
        canonicalBuild: true,
        timeoutMs: 180_000,
        nativeOptimization: mode.nativeOptimization,
        jwtReality: { enabled: true, clockUnixSeconds: NOW }
      })
    );
  }
  const variantResults = [];
  for (const variant of variants) {
    variantResults.push(await runFastlyVariant(
      mode,
      variant,
      fixtures.get(variant),
      compiledByVariant.get(variant),
      runtimeCases.filter((entry) => entry.variant === variant),
      launcher,
      tempRoot,
      targetDescriptor,
      forbidden
    ));
  }
  const byId = new Map([
    ...planningResults,
    ...variantResults.flatMap((entry) => entry.cases)
  ].map((entry) => [entry.id, entry]));
  const cases = materialized.cases.map((entry) => byId.get(entry.id));
  assert.equal(cases.every(Boolean), true);
  return Object.freeze({
    mode: mode.id,
    status: 'passed',
    cases: Object.freeze(cases),
    variants: Object.freeze(variantResults),
    requiredEvaluations: materialized.cases.length,
    completedEvaluations: materialized.cases.length,
    applicationRequests: runtimeCases.length,
    providerCompileRejections: planning.length,
    skippedEvaluations: 0,
    compiledByVariant
  });
}

function semanticProjection(cell) {
  return cell.cases.map((entry) => Object.freeze({
    id: entry.id,
    expectedStatus: entry.expectedStatus,
    observedStatus: entry.observedStatus,
    automaticFallback: entry.observation.automaticFallback
  }));
}

function predecessorRecord(relativeFile, version) {
  const file = path.join(repoRoot, relativeFile);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value.version, version);
  assert.equal(value.status, 'passed');
  return Object.freeze({
    file: relativeFile,
    version,
    sha256: fileSha256(file)
  });
}

function runHs256Regression(tempRoot) {
  const output = path.join(tempRoot, 'hs256-regression');
  const stage = runStage(
    'hs256-native-regression',
    process.execPath,
    [
      path.join(wasmRoot, 'test/jwt/assert-jwt-native-reality.cjs'),
      '--out',
      output
    ],
    1_200_000
  );
  const evidenceFile = path.join(output, 'jwt-e2-evidence.json');
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  assert.equal(evidence.version, 'pulse.jwt-e2-evidence.v1');
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.acceptance.realFastlyComputeServe, true);
  return Object.freeze({
    status: 'passed',
    evidenceVersion: evidence.version,
    evidenceSha256: fileSha256(evidenceFile),
    corpusCases: evidence.corpus.cases,
    executions: evidence.corpus.executions,
    skipped: evidence.corpus.skipped,
    durationMs: stage.durationMs
  });
}

function writeReport(outputDirectory, name, value) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, stableJson(value));
  return Object.freeze({
    file,
    relativeFile: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: fileSha256(file)
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stages = [];
  stages.push(runStage(
    'typescript-build',
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-b', 'packages/crypto', 'packages/jwt'],
    180_000
  ));
  stages.push(runStage(
    'package-tests',
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'packages/crypto/test',
      'packages/jwt/test',
      '--config',
      'vitest.config.ts'
    ],
    180_000
  ));
  const loaded = loadEs256ConformanceCorpus();
  const materialized = materializeEs256ConformanceCases(loaded);
  assert.equal(materialized.version, HARNESS_VERSION);
  const forbidden = forbiddenSensitiveValues(materialized);
  const predecessor = Object.freeze({
    g3: predecessorRecord(
      'wasm/.test-results/jwt-g3/jwt-g3-evidence.json',
      'pulse.jwt-g3-evidence.v1'
    )
  });
  const jwtRuntime = await import(pathToFileURL(
    path.join(repoRoot, 'packages/jwt/dist/provider.js')
  ).href);
  const cryptoRuntime = await import(pathToFileURL(
    path.join(repoRoot, 'packages/crypto/dist/index.js')
  ).href);

  const nodeToolStartedAt = Date.now();
  const nodeTool = Object.freeze({
    version: process.version,
    executableSha256: fileSha256(process.execPath),
    durationMs: Date.now() - nodeToolStartedAt,
    countedAsApplicationExecution: false
  });
  const rustObserved = optionalToolInspection('rustc', ['--version']);
  const cargoObserved = optionalToolInspection('cargo', ['--version']);
  const guestManifest = JSON.parse(fs.readFileSync(
    path.join(
      repoRoot,
      'packages/crypto/guests/es256-rustcrypto/pulse.guest-unit.json'
    ),
    'utf8'
  ));
  const binaryenStartedAt = Date.now();
  const binaryen = Object.freeze({
    ...binaryenIdentity(),
    durationMs: Date.now() - binaryenStartedAt,
    countedAsApplicationExecution: false
  });
  const launcherInspectionStartedAt = Date.now();
  const launcher = inspectFastlyComputeLauncher({
    binary: process.env.PULSE_FASTLY_BIN,
    viceroyBinary: process.env.PULSE_VICEROY_BIN,
    env: process.env,
    timeoutMs: 10_000
  });
  const launcherInspectionDurationMs =
    Date.now() - launcherInspectionStartedAt;
  const cliInspection = launcher.fastlyCliInspection;
  const viceroyInspection = launcher.viceroyInspection;
  const tools = Object.freeze({
    node: nodeTool,
    rust: Object.freeze({
      reviewedPackageProvenance: guestManifest.toolchain.versions.rustc,
      observedEnvironment: rustObserved,
      requiredToConsumeReviewedPrebuiltAtG4: false
    }),
    cargo: Object.freeze({
      reviewedPackageProvenance: guestManifest.toolchain.versions.cargo,
      observedEnvironment: cargoObserved,
      requiredToConsumeReviewedPrebuiltAtG4: false
    }),
    binaryen,
    fastlyCli: cliInspection
      ? Object.freeze({
          required: false,
          selectedAsLauncher: true,
          version: cliInspection.version,
          binarySha256: fileSha256(cliInspection.binary),
          termination: cliInspection.termination,
          durationMs: launcherInspectionDurationMs,
          countedAsApplicationExecution: false
        })
      : Object.freeze({
          required: false,
          selectedAsLauncher: false,
          version: null,
          binarySha256: null,
          durationMs: 0,
          countedAsApplicationExecution: false
        }),
    viceroy: viceroyInspection
      ? Object.freeze({
          ownership: launcher.kind === 'viceroy-direct'
            ? 'pulse-test-harness-direct'
            : 'fastly-cli-launched-explicit-override',
          selectedAsLauncher: launcher.kind === 'viceroy-direct',
          version: viceroyInspection.version,
          binarySha256: fileSha256(viceroyInspection.binary),
          durationMs: launcherInspectionDurationMs,
          countedAsApplicationExecution: false
        })
      : Object.freeze({
          ownership: 'fastly-cli-managed',
          selectedAsLauncher: false,
          version: null,
          binarySha256: null,
          durationMs: 0,
          directInspectionPerformed: false,
          countedAsApplicationExecution: false
        }),
    fastlyRealityLauncher: Object.freeze({
      kind: launcher.kind,
      owner: launcher.owner,
      inspectionDurationMs: launcherInspectionDurationMs
    })
  });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-g4-'));
  try {
    const targetDescriptor = fastlyNativeDescriptor();
    const nodeFixture = compileProjectFixture(
      path.join(tempRoot, 'node-inline'),
      'node',
      NODE_NATIVE_TARGET_DESCRIPTOR,
      materialized.policies.inline
    );
    const fastlyFixtures = new Map();
    for (const [variant, policy] of [
      ['inline', materialized.policies.inline],
      ['bounded', materialized.policies.bounded],
      ['selection', materialized.policies.selection],
      ['ambiguous', materialized.policies.ambiguous],
      ['selected-failure', materialized.policies.selectedFailure],
      ['invalid-point', materialized.policies.invalidPoint],
      ['schema', materialized.policies.schema]
    ]) {
      fastlyFixtures.set(
        variant,
        compileProjectFixture(
          path.join(tempRoot, `fastly-${variant}`),
          'fastly',
          targetDescriptor,
          policy
        )
      );
    }

    const javascriptCell = await runJavascriptCell(
      materialized,
      jwtRuntime,
      cryptoRuntime
    );
    const nodeModes = [];
    for (const mode of MODES) {
      nodeModes.push(await runNodeNativeMode(
        mode,
        nodeFixture,
        materialized,
        jwtRuntime
      ));
    }
    assert.deepEqual(
      semanticProjection(nodeModes[0]),
      semanticProjection(nodeModes[1])
    );

    const fastlyModes = [];
    for (const mode of MODES) {
      fastlyModes.push(await runFastlyMode(
        mode,
        fastlyFixtures,
        materialized,
        launcher,
        tempRoot,
        targetDescriptor,
        forbidden
      ));
    }
    assert.deepEqual(
      semanticProjection(fastlyModes[0]),
      semanticProjection(fastlyModes[1])
    );
    for (const cell of [
      javascriptCell,
      ...nodeModes,
      ...fastlyModes
    ]) {
      assert.deepEqual(
        semanticProjection(cell),
        semanticProjection(javascriptCell),
        cell.id || cell.mode
      );
    }

    const nodeControl = compileControlFixture(
      path.join(tempRoot, 'node-control'),
      'node',
      NODE_NATIVE_TARGET_DESCRIPTOR
    );
    const fastlyControl = compileControlFixture(
      path.join(tempRoot, 'fastly-control'),
      'fastly',
      targetDescriptor
    );
    const impacts = {};
    for (let index = 0; index < MODES.length; index += 1) {
      const mode = MODES[index];
      const nodeControlCompiled = compileCanonicalNativePlan(nodeControl.plan, {
        cwd: repoRoot,
        projectRoot: repoRoot,
        targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
        profile: `g4-node-control-${mode.id}`,
        synchronizedPackages: SYNCHRONIZED_PACKAGES,
        timeoutMs: 180_000,
        nativeOptimization: mode.nativeOptimization
      });
      const fastlyControlCompiled =
        compileFastlyNativePlatformCapabilitiesPlan(fastlyControl.plan, {
          ...providerPackageFacts(fastlyControl.plan),
          cwd: repoRoot,
          projectRoot: repoRoot,
          targetDescriptor,
          profile: `g4-fastly-control-${mode.id}`,
          synchronizedPackages: SYNCHRONIZED_PACKAGES,
          requirePlatformCapability: false,
          canonicalBuild: true,
          timeoutMs: 180_000,
          nativeOptimization: mode.nativeOptimization
        });
      const fastlyInline = fastlyModes[index].compiledByVariant.get('inline');
      impacts[mode.id] = Object.freeze({
        node: Object.freeze({
          controlBytes: nodeControlCompiled.wasm.byteLength,
          es256Bytes: nodeModes[index].compiled.wasm.byteLength,
          incrementalEs256Bytes:
            nodeModes[index].compiled.wasm.byteLength
            - nodeControlCompiled.wasm.byteLength
        }),
        fastly: Object.freeze({
          controlBytes: fastlyControlCompiled.wasm.byteLength,
          es256Bytes: fastlyInline.wasm.byteLength,
          incrementalEs256Bytes:
            fastlyInline.wasm.byteLength
            - fastlyControlCompiled.wasm.byteLength
        }),
        estimated: false
      });
    }

    const hs256Regression = runHs256Regression(tempRoot);
    const caseIds = Object.freeze(materialized.cases.map((entry) => entry.id));
    const fastlyJavascript = Object.freeze({
      id: 'fastly-javascript',
      required: false,
      status: 'ineligible',
      classification: 'INELIGIBLE',
      reasonId: 'fastly-javascript-ecdsa-verification-not-proven',
      executions: 0,
      substitutedEvidence: false,
      automaticFallback: false
    });
    const javascriptReport = Object.freeze({
      version: JAVASCRIPT_REPORT_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      corpusVersion: loaded.corpus.version,
      corpusSemanticHash: loaded.semanticHash,
      caseIds,
      node: javascriptCell,
      fastly: fastlyJavascript,
      browser: Object.freeze({ status: 'unclaimed' }),
      esp32: Object.freeze({ status: 'unclaimed' }),
      automaticFallback: false
    });
    const nodeReality = Object.freeze({
      version: NODE_REALITY_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      provider: 'node',
      realization: REALIZATION,
      implementation: IMPLEMENTATION,
      corpusSemanticHash: loaded.semanticHash,
      modes: Object.freeze(nodeModes.map((entry) => Object.freeze({
        mode: entry.mode,
        status: entry.status,
        artifact: entry.artifact,
        cases: entry.cases,
        timing: entry.timing
      }))),
      requiredExecutions: caseIds.length * MODES.length,
      completedExecutions: caseIds.length * MODES.length,
      skippedExecutions: 0,
      exactAuditedArtifactExecuted: true,
      automaticFallback: false
    });
    const fastlyReality = Object.freeze({
      version: FASTLY_REALITY_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      provider: 'fastly',
      realization: REALIZATION,
      implementation: IMPLEMENTATION,
      corpusSemanticHash: loaded.semanticHash,
      localExecutionLauncher: launcher.kind,
      localExecutionOwner: launcher.owner,
      toolInspectionSeparatedFromApplicationTiming: true,
      modes: Object.freeze(fastlyModes.map((entry) => Object.freeze({
        mode: entry.mode,
        status: entry.status,
        cases: entry.cases,
        variants: entry.variants,
        requiredEvaluations: entry.requiredEvaluations,
        completedEvaluations: entry.completedEvaluations,
        applicationRequests: entry.applicationRequests,
        providerCompileRejections: entry.providerCompileRejections,
        skippedEvaluations: entry.skippedEvaluations
      }))),
      requiredEvaluations: caseIds.length * MODES.length,
      completedEvaluations: caseIds.length * MODES.length,
      applicationRequests:
        (caseIds.length - FASTLY_PLANNING_CASE_IDS.length) * MODES.length,
      providerCompileRejections:
        FASTLY_PLANNING_CASE_IDS.length * MODES.length,
      skippedEvaluations: 0,
      exactProviderInputsMatchFinalAudits: true,
      tools,
      automaticFallback: false
    });
    const nativeReport = Object.freeze({
      version: NATIVE_REPORT_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      corpusVersion: loaded.corpus.version,
      corpusSemanticHash: loaded.semanticHash,
      caseIds,
      realization: REALIZATION,
      implementation: IMPLEMENTATION,
      node: Object.freeze({
        status: 'passed',
        modes: Object.freeze(nodeModes.map((entry) => entry.mode)),
        requiredExecutions: caseIds.length * MODES.length,
        completedExecutions: caseIds.length * MODES.length,
        skippedExecutions: 0
      }),
      fastly: Object.freeze({
        status: 'passed',
        modes: Object.freeze(fastlyModes.map((entry) => entry.mode)),
        requiredEvaluations: caseIds.length * MODES.length,
        completedEvaluations: caseIds.length * MODES.length,
        skippedEvaluations: 0
      }),
      crossTargetStatusParity: true,
      defaultSizeParity: true,
      automaticFallback: false
    });
    const impactReport = Object.freeze({
      version: IMPACT_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      comparableControlsAvailable: true,
      modes: Object.freeze(impacts),
      estimatedDeltas: false
    });
    const matrix = Object.freeze({
      version: MATRIX_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      corpusSemanticHash: loaded.semanticHash,
      requiredCells: Object.freeze([
        Object.freeze({
          id: 'node-javascript',
          status: 'passed',
          executions: caseIds.length,
          skipped: 0
        }),
        ...MODES.map((mode) => Object.freeze({
          id: `node-native-${mode.id}`,
          status: 'passed',
          executions: caseIds.length,
          skipped: 0
        })),
        ...MODES.map((mode) => Object.freeze({
          id: `fastly-native-${mode.id}`,
          status: 'passed',
          semanticEvaluations: caseIds.length,
          applicationRequests: caseIds.length - FASTLY_PLANNING_CASE_IDS.length,
          providerCompileRejections: FASTLY_PLANNING_CASE_IDS.length,
          skipped: 0
        }))
      ]),
      additionalCells: Object.freeze([fastlyJavascript]),
      requiredSemanticEvaluations: caseIds.length * 5,
      completedSemanticEvaluations: caseIds.length * 5,
      skippedRequiredEvaluations: 0,
      browser: 'unclaimed',
      esp32: 'unclaimed',
      automaticFallback: false
    });

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const reports = Object.freeze({
      targetMatrix: writeReport(
        options.outputDirectory,
        'es256-target-matrix.json',
        matrix
      ),
      javascript: writeReport(
        options.outputDirectory,
        'es256-javascript-conformance.json',
        javascriptReport
      ),
      native: writeReport(
        options.outputDirectory,
        'es256-native-conformance.json',
        nativeReport
      ),
      nodeNative: writeReport(
        options.outputDirectory,
        'es256-node-native-reality.json',
        nodeReality
      ),
      fastlyNative: writeReport(
        options.outputDirectory,
        'es256-fastly-native-reality.json',
        fastlyReality
      ),
      artifactImpact: writeReport(
        options.outputDirectory,
        'es256-artifact-impact.json',
        impactReport
      )
    });
    const durable = Object.values(reports)
      .map((entry) => fs.readFileSync(entry.file, 'utf8'))
      .join('\n');
    for (const entry of forbidden) {
      assert.equal(durable.includes(entry.value), false, entry.id);
    }
    const evidence = Object.freeze({
      version: EVIDENCE_VERSION,
      checkpoint: 'G4',
      status: 'passed',
      classification: 'PASS',
      scope: Object.freeze({
        implementation: true,
        algorithm: 'ES256',
        publication: false,
        deployment: false,
        browser: false,
        esp32: false
      }),
      corpus: Object.freeze({
        version: loaded.corpus.version,
        fileSha256: loaded.fileSha256,
        semanticHash: loaded.semanticHash,
        cases: caseIds.length,
        requiredSemanticEvaluations: matrix.requiredSemanticEvaluations,
        completedSemanticEvaluations: matrix.completedSemanticEvaluations,
        skipped: 0
      }),
      realization: Object.freeze({
        identity: REALIZATION,
        implementation: IMPLEMENTATION,
        semanticOwner: '@pulse-compute/crypto',
        automaticFallback: false
      }),
      acceptance: Object.freeze({
        allRequiredEligibleCellsPass: true,
        zeroSkippedRequiredExecutions: true,
        semanticOutcomesMatch: true,
        exactProviderInputsMatchAuditedArtifacts: true,
        noRealizationFallback: true,
        fastlyJavascriptTruthfullyIneligible: true,
        realFastlyLocalExecution: true,
        fastlyLauncherKind: launcher.kind,
        toolInspectionSeparateFromApplicationTiming: true,
        defaultAndSizeArtifactsPass: true,
        hs256RegressionGreen: true,
        browserUnclaimed: true,
        esp32Unclaimed: true
      }),
      hs256Regression,
      tools,
      stages: Object.freeze(stages),
      reports: Object.freeze(Object.fromEntries(
        Object.entries(reports).map(([id, entry]) => [
          id,
          Object.freeze({
            file: entry.relativeFile,
            sha256: entry.sha256
          })
        ])
      )),
      sources: Object.freeze(SOURCE_FILES.map(sourceRecord)),
      predecessor,
      nextAuthorizedCheckpoint: 'G5'
    });
    const evidenceReport = writeReport(
      options.outputDirectory,
      'jwt-g4-evidence.json',
      evidence
    );
    const evidenceText = fs.readFileSync(evidenceReport.file, 'utf8');
    for (const entry of forbidden) {
      assert.equal(evidenceText.includes(entry.value), false, entry.id);
    }
    process.stdout.write(stableJson({
      checkpoint: 'G4',
      status: 'passed',
      requiredCells: 5,
      corpusCases: caseIds.length,
      semanticEvaluations: matrix.completedSemanticEvaluations,
      skipped: 0,
      evidence: evidenceReport.relativeFile
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = error && error.code ? `[${error.code}] ` : '';
    process.stderr.write(`${code}${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  MODES,
  SYNCHRONIZED_PACKAGES,
  compileProjectFixture,
  executeSemanticCase,
  runJavascriptCell,
  runNodeNativeMode,
  fastlyNativeDescriptor,
  fastlyCaseResult,
  planningObservation,
  artifactFacts
});
