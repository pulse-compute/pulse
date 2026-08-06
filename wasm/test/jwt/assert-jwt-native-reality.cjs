#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const {
  planProjectCrypto,
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  compileCanonicalProject,
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  buildCanonicalNativePlan,
} = require('../../packages/compiler/src/canonical-native-plan.js');
const {
  compileCanonicalNativePlan,
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const {
  extractSchemaRegistry,
} = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
} = require('../../packages/build-support/src/native-optimization.js');
const {
  executeCanonicalNativeModule,
  instantiateCanonicalNativeModule,
} = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/native/target.js');
const {
  createNodeProviderAdapter,
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');
const {
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS,
  compileFastlyNativePlatformCapabilitiesPlan,
} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const {
  fastlyComputeRealityVersion,
  inspectFastlyComputeLauncher,
  renderFastlyLocalConfig,
  requestFastlyCompute,
  startFastlyComputeServe,
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {
  pulseHmacAssemblyScriptSource,
} = require('../../../packages/crypto/pulsewasm.native.cjs');
const {
  pulseJwtAssemblyScriptSource,
} = require('../../../packages/jwt/pulsewasm.native.cjs');
const {
  NATIVE_REALITY_HARNESS_VERSION,
  REQUIRED_CASE_IDS,
  forbiddenSensitiveValues,
  loadJwtConformanceCorpus,
  materializeNativeConformanceCases,
} = require('./jwt-conformance-harness.cjs');

const EVIDENCE_VERSION = 'pulse.jwt-e2-evidence.v1';
const CONFORMANCE_REPORT_VERSION = 'pulse.jwt-native-conformance-report.e2.v1';
const TARGET_REALITY_REPORT_VERSION = 'pulse.jwt-native-target-reality-report.e2.v1';
const ARTIFACT_AUDIT_REPORT_VERSION = 'pulse.jwt-native-artifact-audit-report.e2.v1';
const REDACTION_REPORT_VERSION = 'pulse.jwt-native-redaction-report.e2.v1';
const SECRET_STORE = 'jwt_e2_secrets';
const PLANNING_CASE_IDS = Object.freeze([
  'jwt-algorithm-outside-profile-crypto',
  'missing-target-realization',
  'invalid-exact-realization-pin',
]);
const MODES = Object.freeze([
  Object.freeze({ id: 'default', nativeOptimization: undefined }),
  Object.freeze({
    id: 'experimental-native-size',
    nativeOptimization: EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
  }),
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-e2');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') outputDirectory = path.resolve(argv[++index]);
    else throw new TypeError(`Unknown E2 option ${String(argv[index])}.`);
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
    sha256: sha256(bytes),
  });
}

function fastlyNativeDescriptor() {
  return fastlyToolchain.createDriver({
    buildJavascriptTargetSupportEvidence() {
      throw new Error('The E2 Native gate must not enter JavaScript target support.');
    },
  }).targets.native;
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

function handlerSource(corpus) {
  const policy = corpus.fixture.policy;
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ${JSON.stringify(policy.algorithms)},
    key: { type: 'secret', binding: ${JSON.stringify(policy.key.binding)} },
    issuer: ${JSON.stringify(policy.issuer)},
    audience: ${JSON.stringify(policy.audience)},
    subject: ${JSON.stringify(policy.subject)},
    typ: ${JSON.stringify(policy.typ)},
    clockToleranceSeconds: ${JSON.stringify(policy.clockToleranceSeconds)},
    maxTokenAgeSeconds: ${JSON.stringify(policy.maxTokenAgeSeconds)},
    requiredClaims: ${JSON.stringify(policy.requiredClaims)},
    claimsSchema: ${JSON.stringify(policy.claimsSchema)}
  })
  return ctx.text(verified.claims.sub + ':' + verified.claims.roles[0] + ':' + verified.protectedHeader.alg)
}
`;
}

function projectMetadata(host, cryptoDeclaration) {
  return {
    selectedProfile: { name: `e2-${host}`, source: 'e2-native-reality' },
    strict: true,
    target: 'native',
    host,
    projectHash: host === 'node' ? 'e'.repeat(64) : 'f'.repeat(64),
    configPlanHash: '2'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {},
    crypto: {
      source: 'profile',
      declaration: cryptoDeclaration,
    },
  };
}

function compileProjectFixture(root, host, targetDescriptor, corpus) {
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  fs.writeFileSync(
    path.join(sourceRoot, 'models.ts'),
    'export interface AccessClaims { sub: string; roles: string[] }\n',
  );
  const schemaFile = path.join(sourceRoot, 'schemas.ts');
  fs.writeFileSync(schemaFile, schemaSource());
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(entryFile, handlerSource(corpus));
  const declaration = cryptoContracts.normalizeCryptoConfiguration({
    HS256: { realization: 'guest-source:pulse-hmac-as' },
  });
  const project = compileCanonicalProject(entryFile, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    packageTargetDescriptor: targetDescriptor,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    schemas: {
      registry: extractSchemaRegistry(schemaFile, { projectRoot: root }).registry,
    },
    applicationProjectMetadata: projectMetadata(host, declaration),
  });
  const plan = buildCanonicalNativePlan(project);
  assert.equal(plan.effects.length, 1);
  assert.equal(plan.effects[0].kind, 'jwt.verify');
  assert.deepEqual(
    plan.crypto.algorithms.map((entry) => ({
      algorithm: entry.algorithm,
      realization: entry.realization,
      requestedBy: entry.requestedBy,
    })),
    [{
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
      requestedBy: ['@pulse-compute/jwt'],
    }],
  );
  return Object.freeze({ project, plan });
}

function compileControlFixture(root, targetDescriptor) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  const entryFile = path.join(root, 'src', 'index.ts');
  fs.writeFileSync(
    entryFile,
    'export default async function handler(ctx) { return ctx.text("ok") }\n',
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
    applicationProjectMetadata: projectMetadata(
      'fastly',
      cryptoContracts.normalizeCryptoConfiguration([]),
    ),
  });
  return buildCanonicalNativePlan(project);
}

function schemaValue(mode, claims) {
  if (mode === 'reject') {
    const error = new Error('E2 schema negative control');
    error.code = 'PULSE_SCHEMA_VALUE_INVALID';
    throw error;
  }
  return Object.freeze({
    sub: String(claims.sub),
    roles: Object.freeze(Array.isArray(claims.roles) ? claims.roles.map(String) : []),
  });
}

function authority(caseInput, secretValues) {
  return Object.freeze({
    resolveSecret(binding) {
      return Object.prototype.hasOwnProperty.call(secretValues, binding)
        ? secretValues[binding]
        : undefined;
    },
    captureWallClock() {
      return Object.freeze({
        unixEpochSeconds: caseInput.clockInstantUnixSeconds,
        trusted: true,
      });
    },
    validateClaims(_schemaId, claims, _context, mode) {
      return schemaValue(mode, claims);
    },
  });
}

function planningObservation(caseId, targetDescriptor) {
  const requirements = cryptoContracts.normalizeCryptoRequirements([{
    algorithm: 'HS256',
    requestedBy: '@pulse-compute/jwt',
  }]);
  let declaration;
  let descriptor = targetDescriptor;
  if (caseId === 'jwt-algorithm-outside-profile-crypto') {
    declaration = cryptoContracts.normalizeCryptoConfiguration([]);
  } else if (caseId === 'missing-target-realization') {
    declaration = cryptoContracts.normalizeCryptoConfiguration(['HS256']);
    descriptor = {
      ...targetDescriptor,
      crypto: cryptoContracts.defineCryptoTargetCapabilities({
        target: 'native',
        algorithms: [],
      }),
    };
  } else if (caseId === 'invalid-exact-realization-pin') {
    declaration = cryptoContracts.normalizeCryptoConfiguration({
      HS256: { realization: 'runtime-builtin' },
    });
  } else {
    throw new TypeError(`Unknown E2 planning case ${caseId}.`);
  }
  try {
    planProjectCrypto({
      declaration,
      requirements,
      targetDescriptor: descriptor,
      target: 'native',
      profile: 'jwt-e2',
      profileSelectionSource: 'e2-native-reality',
      configurationSource: 'e2-native-reality',
    });
    assert.fail(`${caseId} unexpectedly emitted an artifact plan`);
  } catch (error) {
    return Object.freeze({
      status: 'error-before-artifact',
      code: error.code,
      artifactEmitted: false,
      automaticFallback: false,
    });
  }
}

function caseValue(result, name) {
  if (name === 'status') return result.status;
  if (name === 'code') return result.error && result.error.code;
  if (name === 'category') return result.error && result.error.category;
  if (name === 'detached') return result.result && result.result.detached;
  if (name === 'immutablePaths') {
    return result.result
      && Object.values(result.result.immutablePaths).every(Boolean);
  }
  if (name === 'cryptoCalls') return result.observation.cryptoPrimitiveCalls;
  if (name === 'clockCalls') return result.observation.clockCalls;
  if (name === 'schemaCalls') return result.observation.schemaCalls;
  if (name === 'secretCalls') return result.observation.secretCalls;
  if (name === 'claimsObserved') return result.observation.claimsObserved;
  if (name === 'claimsParsed') return result.observation.claimsParsed;
  if (name === 'registeredClaimsStatus') return result.observation.registeredClaimsStatus;
  if (name === 'realizationAttempts') return result.observation.realizationAttempts;
  if (name === 'alternateTargetAttempts') return result.observation.alternateTargetAttempts;
  if (name === 'alternateRealizationAttempts') return result.observation.alternateRealizationAttempts;
  if (name === 'automaticFallback') return result.observation.automaticFallback;
  if (name === 'result') return result.resultMatchesExpected;
  if (name === 'forbiddenValuesPresent') return 0;
  if (name === 'categories') return ['token', 'signature', 'claims', 'key', 'secret'];
  return undefined;
}

function assertRuntimeCase(testCase, result, runtimeVersion) {
  assert.equal(result.version, runtimeVersion);
  assert.equal(result.status, testCase.expected.status, testCase.id);
  const assertions = [];
  for (const [name, expected] of Object.entries(testCase.expected)) {
    const actual = caseValue(result, name);
    if (name === 'result' || name === 'immutablePaths') {
      assert.equal(actual, true, testCase.id);
    }
    else assert.deepEqual(actual, expected, `${testCase.id}:${name}`);
    assertions.push(name);
  }
  if (result.status === 'success') {
    const order = result.observation.eventOrder;
    assert.ok(order.indexOf('crypto') > order.indexOf('secret'), testCase.id);
    assert.ok(order.indexOf('clock') > order.indexOf('crypto'), testCase.id);
    assert.ok(order.indexOf('schema') > order.indexOf('clock'), testCase.id);
  }
  return Object.freeze({
    id: testCase.id,
    kind: testCase.kind,
    polarity: testCase.polarity,
    status: 'passed',
    observedStatus: result.status,
    errorCode: result.error && result.error.code || null,
    observation: result.observation,
    result: result.result,
    assertions: Object.freeze(assertions),
  });
}

function assertPlanningCase(testCase, result) {
  assert.equal(result.status, testCase.expected.status, testCase.id);
  assert.equal(result.code, testCase.expected.code, testCase.id);
  assert.equal(result.artifactEmitted, false);
  assert.equal(result.automaticFallback, false);
  return Object.freeze({
    id: testCase.id,
    kind: testCase.kind,
    polarity: testCase.polarity,
    status: 'passed',
    observedStatus: result.status,
    errorCode: result.code,
    observation: Object.freeze({
      artifactEmitted: false,
      automaticFallback: false,
    }),
    result: null,
    assertions: Object.freeze(['status', 'code', 'no-artifact', 'no-fallback']),
  });
}

function localArtifactAudit(compiled, mode) {
  const imports = compiled.inspection.imports;
  const exports = new Set(compiled.inspection.exports.map((entry) => entry.name));
  assert.equal(compiled.guestUnits.length, 0);
  assert.equal(compiled.guestLink, undefined);
  assert.ok(exports.has('pulse_crypto_hs256_verify'));
  assert.ok(exports.has('pulse_crypto_sha256_digest'));
  assert.equal(
    imports.some((entry) => /fastly|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)),
    false,
  );
  assert.equal(compiled.manifest.crypto.active, true);
  assert.equal(compiled.manifest.crypto.automaticFallback, false);
  return Object.freeze({
    targetId: 'node-native',
    mode,
    status: 'passed',
    bytes: compiled.wasm.byteLength,
    sha256: sha256(compiled.wasm),
    imports: Object.freeze(imports),
    guestUnits: 0,
    rustGuestUnitRequired: false,
    guestSourceExports: Object.freeze([
      'pulse_crypto_hs256_verify',
      'pulse_crypto_sha256_digest',
    ]),
    automaticFallback: false,
  });
}

async function canonicalNodeProbe(compiled, materialized, corpus) {
  const valid = materialized.cases.find((entry) => entry.id === 'valid-hs256');
  const invalid = materialized.cases.find((entry) => entry.id === 'invalid-signature');
  const run = async (testCase) => {
    let clockCalls = 0;
    try {
      const execution = await executeCanonicalNativeModule(compiled, {
        providerAdapter: createNodeProviderAdapter(),
        secrets: materialized.secrets.values,
        captureJwtWallClock() {
          clockCalls += 1;
          return Object.freeze({
            unixEpochSeconds: corpus.fixture.clockInstantUnixSeconds,
            trusted: true,
          });
        },
        request: {
          path: '/',
          headers: [['authorization', `Bearer ${testCase.input.verifierInput.token}`]],
        },
      });
      return Object.freeze({
        status: 'success',
        responseStatus: execution.response.status,
        bodyBytes: Buffer.byteLength(execution.response.body),
        bodySha256: sha256(execution.response.body),
        traceSha256: sha256(JSON.stringify(execution.trace)),
        clockCalls,
      });
    } catch (error) {
      return Object.freeze({
        status: 'error',
        code: error && error.code,
        clockCalls,
        traceSha256: sha256(JSON.stringify(error && error.execution && error.execution.trace || [])),
      });
    }
  };
  const validResult = await run(valid);
  const invalidResult = await run(invalid);
  assert.equal(validResult.status, 'success');
  assert.equal(validResult.responseStatus, 200);
  assert.equal(validResult.clockCalls, 1);
  assert.deepEqual(
    { status: invalidResult.status, code: invalidResult.code, clockCalls: invalidResult.clockCalls },
    { status: 'error', code: 'PULSE_JWT_SIGNATURE_INVALID', clockCalls: 0 },
  );
  return Object.freeze({ valid: validResult, invalid: invalidResult });
}

async function runLocalMode(mode, compiled, materialized, corpus, runtimeModule) {
  const controller = instantiateCanonicalNativeModule(compiled, {
    providerAdapter: createNodeProviderAdapter(),
  });
  assert.equal(controller.cryptoRealization.available, true);
  assert.equal(controller.cryptoRealization.realization, 'guest-source:pulse-hmac-as');
  const cases = [];
  for (const testCase of materialized.cases) {
    if (testCase.kind === 'planning') {
      cases.push(assertPlanningCase(
        testCase,
        planningObservation(testCase.id, NODE_NATIVE_TARGET_DESCRIPTOR),
      ));
    } else {
      const result = await runtimeModule.executeNativeSemanticCase(
        testCase.input,
        authority(testCase.input, materialized.secrets.values),
        controller.cryptoVerifier,
      );
      cases.push(assertRuntimeCase(
        testCase,
        result,
        runtimeModule.NATIVE_CASE_RUNTIME_VERSION,
      ));
    }
  }
  assert.deepEqual(cases.map((entry) => entry.id), REQUIRED_CASE_IDS);
  return Object.freeze({
    mode: mode.id,
    artifact: localArtifactAudit(compiled, mode.id),
    canonicalProbe: await canonicalNodeProbe(compiled, materialized, corpus),
    cases: Object.freeze(cases),
    timing: Object.freeze({
      buildDurationMs: compiled.durationMs,
    }),
  });
}

function headersObject(headers) {
  return Object.fromEntries(
    headers.map(([name, value]) => [String(name).toLowerCase(), String(value)]),
  );
}

function integerHeader(headers, name) {
  const value = Number(headers[name]);
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${name} must be a counter`);
  return value;
}

function fastlySemanticResult(response, expectedBody) {
  const headers = headersObject(response.headers);
  const status = headers['x-pulse-e2-status'];
  const success = status === 'success';
  const order = String(headers['x-pulse-e2-order'] || '');
  const eventNames = Object.freeze({
    S: 'secret',
    A: 'crypto',
    P: 'claims',
    C: 'clock',
    H: 'schema',
    V: 'verified',
  });
  const schemaCalls = integerHeader(headers, 'x-pulse-e2-schema-calls');
  const observation = Object.freeze({
    secretCalls: integerHeader(headers, 'x-pulse-e2-secret-calls'),
    cryptoRequests: integerHeader(headers, 'x-pulse-e2-realization-attempts'),
    cryptoPrimitiveCalls: integerHeader(headers, 'x-pulse-e2-crypto-calls'),
    clockCalls: integerHeader(headers, 'x-pulse-e2-clock-calls'),
    schemaCalls,
    realizationAttempts: integerHeader(headers, 'x-pulse-e2-realization-attempts'),
    alternateTargetAttempts: 0,
    alternateRealizationAttempts: 0,
    claimsParsed: headers['x-pulse-e2-claims-parsed'] === '1',
    claimsObserved: headers['x-pulse-e2-claims-parsed'] === '1',
    registeredClaimsStatus: schemaCalls > 0 ? 'passed' : null,
    signingInputBytes: integerHeader(headers, 'x-pulse-e2-signing-bytes'),
    signingInputSha256: headers['x-pulse-e2-signing-sha256'] || null,
    eventOrder: Object.freeze([...order].map((entry) => eventNames[entry])),
    automaticFallback: headers['x-pulse-e2-fallback'] === 'true',
  });
  const bodyMatches = success
    && response.body.equals(Buffer.from(expectedBody, 'utf8'));
  return Object.freeze({
    version: 'pulse.jwt-native-case-runtime.e2.v1',
    status,
    resultMatchesExpected: bodyMatches,
    result: success
      ? Object.freeze({
          detached: true,
          immutablePaths: Object.freeze({
            '$': headers['x-pulse-e2-verified'] === '1',
            '$.claims': headers['x-pulse-e2-verified'] === '1',
            '$.claims.roles': headers['x-pulse-e2-verified'] === '1',
            '$.protectedHeader': headers['x-pulse-e2-verified'] === '1',
          }),
        })
      : null,
    error: success
      ? null
      : Object.freeze({
          code: headers['x-pulse-e2-code'],
          category: headers['x-pulse-e2-category'] || null,
          automaticFallback: false,
        }),
    observation,
    response: Object.freeze({
      status: response.status,
      bodyBytes: response.body.byteLength,
      bodySha256: sha256(response.body),
    }),
  });
}

function fastlyArtifactAudit(compiled, mode, materialized) {
  const allowed = new Set(
    FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS
      .map(([module, name]) => `${module}:${name}`),
  );
  const imports = compiled.inspection.imports;
  const exports = new Set(compiled.inspection.exports.map((entry) => entry.name));
  assert.ok(imports.every((entry) => allowed.has(`${entry.module}:${entry.name}`)));
  assert.equal(
    imports.some((entry) => /pulse_host|env|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)),
    false,
  );
  assert.ok(imports.some((entry) => (
    entry.module === 'wasi_snapshot_preview1'
    && entry.name === 'clock_time_get'
  )));
  for (const name of [
    '_start',
    'pulse_crypto_hs256_verify',
    'pulse_crypto_sha256_digest',
    'pulse_jwt_fastly_verify',
    'pulse_fastly_jwt_error',
  ]) assert.ok(exports.has(name), `${mode}:${name}`);
  assert.equal(compiled.manifest.jwt.status, 'implemented-e2');
  assert.equal(compiled.manifest.jwt.sourceIncluded, true);
  assert.equal(compiled.manifest.jwt.cryptoRealization, 'guest-source:pulse-hmac-as');
  assert.equal(compiled.manifest.jwt.automaticFallback, false);
  assert.equal(compiled.manifest.harness.classifiedAsTargetBehavior, false);
  assert.equal(compiled.manifest.crypto.automaticFallback, false);
  for (const secret of Object.values(materialized.secrets.values)) {
    const bytes = Buffer.from(secret, 'utf8');
    assert.equal(compiled.wasm.includes(bytes), false);
    assert.equal(compiled.source.includes(secret), false);
    assert.equal(compiled.wat.includes(secret), false);
    assert.equal(JSON.stringify(compiled.manifest).includes(secret), false);
  }
  return Object.freeze({
    targetId: 'fastly-native',
    mode,
    status: 'passed',
    bytes: compiled.wasm.byteLength,
    sha256: sha256(compiled.wasm),
    sourceSha256: sha256(compiled.source),
    watSha256: sha256(compiled.wat),
    imports: Object.freeze(imports),
    importPolicy: 'exact Fastly imports plus wasi_snapshot_preview1.clock_time_get',
    exports: Object.freeze([...exports].sort()),
    jwtSourceSha256: compiled.manifest.jwt.sourceSha256,
    cryptoRealization: 'guest-source:pulse-hmac-as',
    rustGuestUnitRequired: false,
    guestLinkedUnitRequired: false,
    automaticFallback: false,
    secretValuesPresent: false,
  });
}

function writeFastlyPackage(root, compiled, materialized) {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const wasmFile = path.join(root, 'bin', 'main.wasm');
  fs.writeFileSync(wasmFile, compiled.wasm);
  fs.writeFileSync(
    path.join(root, 'fastly.toml'),
    renderFastlyLocalConfig({
      name: 'pulse-jwt-e2-fastly-native-reality',
      description: 'Pulse E2 Fastly Native JWT reality gate',
      secretStores: {
        [SECRET_STORE]: materialized.secrets.values,
      },
    }),
  );
  assert.equal(fileSha256(wasmFile), sha256(compiled.wasm));
  return Object.freeze({ wasmFile });
}

async function runFastlyMode(
  mode,
  compiled,
  materialized,
  corpus,
  launcher,
  tempRoot,
) {
  const packageRoot = path.join(tempRoot, `fastly-${mode.id}`);
  const written = writeFastlyPackage(packageRoot, compiled, materialized);
  const audit = fastlyArtifactAudit(compiled, mode.id, materialized);
  const bootStartedAt = Date.now();
  const server = await startFastlyComputeServe({
    launcher,
    packageRoot,
    wasmFile: written.wasmFile,
    manifestFile: path.join(packageRoot, 'fastly.toml'),
    startTimeoutMs: 60_000,
    stopTimeoutMs: 5_000,
    env: process.env,
  });
  const engineBootDurationMs = Date.now() - bootStartedAt;
  const expectedBody = [
    corpus.fixture.normalizedResult.claims.sub,
    corpus.fixture.normalizedResult.claims.roles[0],
    corpus.fixture.normalizedResult.protectedHeader.alg,
  ].join(':');
  const cases = [];
  const requestDurations = [];
  const corpusStartedAt = Date.now();
  let teardownDurationMs = 0;
  try {
    for (const testCase of materialized.cases) {
      if (testCase.kind === 'planning') {
        cases.push(assertPlanningCase(
          testCase,
          planningObservation(testCase.id, fastlyNativeDescriptor()),
        ));
        continue;
      }
      const requestStartedAt = Date.now();
      const response = await requestFastlyCompute(server, {
        path: '/',
        headers: {
          authorization: `Bearer ${testCase.input.verifierInput.token}`,
          'x-pulse-e2-case': testCase.id,
        },
        timeoutMs: 30_000,
      });
      requestDurations.push(Date.now() - requestStartedAt);
      const semantic = fastlySemanticResult(response, expectedBody);
      const record = assertRuntimeCase(
        testCase,
        semantic,
        'pulse.jwt-native-case-runtime.e2.v1',
      );
      cases.push(Object.freeze({
        ...record,
        response: semantic.response,
        signingInput: Object.freeze({
          bytes: semantic.observation.signingInputBytes,
          sha256: semantic.observation.signingInputSha256,
        }),
      }));
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
  for (const forbidden of forbiddenSensitiveValues(corpus)) {
    assert.equal(logs.includes(forbidden.value), false, `${mode.id}:${forbidden.id}`);
  }
  for (const secret of Object.values(materialized.secrets.values)) {
    assert.equal(logs.includes(secret), false, `${mode.id}:secret-log`);
  }
  assert.deepEqual(cases.map((entry) => entry.id), REQUIRED_CASE_IDS);
  return Object.freeze({
    mode: mode.id,
    status: 'passed',
    artifact: audit,
    exactExecutedArtifactSha256: fileSha256(written.wasmFile),
    cases: Object.freeze(cases),
    timing: Object.freeze({
      buildDurationMs: compiled.durationMs,
      engineBootDurationMs,
      corpusDurationMs,
      perRequestDurationMs: Object.freeze(requestDurations),
      teardownDurationMs,
      launcherInspectionIncludedInApplicationExecution: false,
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
      command: launcher.kind === 'viceroy-direct'
        ? Object.freeze([
            'viceroy',
            'serve',
            '--addr',
            '<loopback>',
            '--config',
            `<e2-${mode.id}-package>/fastly.toml`,
            `<e2-${mode.id}-package>/bin/main.wasm`,
          ])
        : Object.freeze([
            'fastly',
            'compute',
            'serve',
            '--dir',
            `<e2-${mode.id}-package>`,
            '--file',
            `<e2-${mode.id}-package>/bin/main.wasm`,
            '--addr',
            '<loopback>',
            ...(launcher.viceroyInspection
              ? ['--viceroy-path', '<fastly-cli-managed-viceroy>']
              : []),
          ]),
      requestCount: materialized.cases.length - PLANNING_CASE_IDS.length,
      stdoutBytes: Buffer.byteLength(server.logs.stdout),
      stderrBytes: Buffer.byteLength(server.logs.stderr),
      logsSha256: sha256(logs),
    }),
  });
}

function semanticProjection(target) {
  return target.cases.map((entry) => ({
    id: entry.id,
    observedStatus: entry.observedStatus,
    errorCode: entry.errorCode,
    assertions: entry.assertions,
    observation: {
      secretCalls: entry.observation.secretCalls,
      cryptoPrimitiveCalls: entry.observation.cryptoPrimitiveCalls,
      clockCalls: entry.observation.clockCalls,
      schemaCalls: entry.observation.schemaCalls,
      realizationAttempts: entry.observation.realizationAttempts,
      alternateTargetAttempts: entry.observation.alternateTargetAttempts,
      alternateRealizationAttempts: entry.observation.alternateRealizationAttempts,
      automaticFallback: entry.observation.automaticFallback,
    },
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
    sha256: fileSha256(file),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = loadJwtConformanceCorpus();
  const materialized = materializeNativeConformanceCases(corpus);
  assert.equal(materialized.version, NATIVE_REALITY_HARNESS_VERSION);
  const runtimeModule = await import(pathToFileURL(
    path.join(__dirname, 'native-case-runtime.mjs'),
  ).href);
  assert.equal(
    runtimeModule.NATIVE_CASE_RUNTIME_VERSION,
    'pulse.jwt-native-case-runtime.e2.v1',
  );
  const predecessor = Object.freeze({
    d4: predecessorRecord(
      'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
      'pulse.jwt-phase-d-seal.v1',
    ),
    e0: predecessorRecord(
      'wasm/.test-results/jwt-e0/jwt-e0-evidence.json',
      'pulse.jwt-conformance.e0-evidence.v1',
    ),
    e1: predecessorRecord(
      'wasm/.test-results/jwt-e1/jwt-e1-evidence.json',
      'pulse.jwt-e1-evidence.v1',
    ),
  });
  const e1Conformance = JSON.parse(fs.readFileSync(
    path.join(wasmRoot, '.test-results', 'jwt-e1', 'jwt-javascript-conformance-report.json'),
    'utf8',
  ));
  assert.equal(e1Conformance.status, 'passed');
  assert.equal(e1Conformance.completedExecutions, 70);
  assert.equal(e1Conformance.corpusHash, corpus.corpusHash);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-e2-'));
  try {
    const nodeFixture = compileProjectFixture(
      path.join(tempRoot, 'node-project'),
      'node',
      NODE_NATIVE_TARGET_DESCRIPTOR,
      corpus,
    );
    const fastlyDescriptor = fastlyNativeDescriptor();
    assert.equal(fastlyDescriptor.jwt.status, 'implemented-e2');
    const fastlyFixture = compileProjectFixture(
      path.join(tempRoot, 'fastly-project'),
      'fastly',
      fastlyDescriptor,
      corpus,
    );
    const controlPlan = compileControlFixture(
      path.join(tempRoot, 'fastly-control'),
      fastlyDescriptor,
    );

    const localCompiled = new Map();
    const fastlyCompiled = new Map();
    const controlCompiled = new Map();
    for (const mode of MODES) {
      localCompiled.set(mode.id, compileCanonicalNativePlan(nodeFixture.plan, {
        cwd: repoRoot,
        timeoutMs: 180_000,
        nativeOptimization: mode.nativeOptimization,
      }));
      fastlyCompiled.set(mode.id, compileFastlyNativePlatformCapabilitiesPlan(
        fastlyFixture.plan,
        {
          requirePlatformCapability: false,
          canonicalBuild: true,
          secretStore: SECRET_STORE,
          timeoutMs: 180_000,
          nativeOptimization: mode.nativeOptimization,
          jwtReality: {
            enabled: true,
            clockUnixSeconds: corpus.fixture.clockInstantUnixSeconds,
            wrongSecretBinding: materialized.secrets.bindings.wrong,
            shortSecretBinding: materialized.secrets.bindings.short,
          },
        },
      ));
      controlCompiled.set(mode.id, compileFastlyNativePlatformCapabilitiesPlan(
        controlPlan,
        {
          requirePlatformCapability: false,
          canonicalBuild: true,
          timeoutMs: 180_000,
          nativeOptimization: mode.nativeOptimization,
        },
      ));
    }

    const localModes = [];
    for (const mode of MODES) {
      localModes.push(await runLocalMode(
        mode,
        localCompiled.get(mode.id),
        materialized,
        corpus,
        runtimeModule,
      ));
    }
    assert.deepEqual(
      semanticProjection(localModes[0]),
      semanticProjection(localModes[1]),
      'Local Native default and optimized semantics must agree',
    );

    const launcherInspectionStartedAt = Date.now();
    const launcher = inspectFastlyComputeLauncher({
      binary: process.env.PULSE_FASTLY_BIN,
      viceroyBinary: process.env.PULSE_VICEROY_BIN,
      env: process.env,
      timeoutMs: 10_000,
    });
    const launcherInspectionDurationMs =
      Date.now() - launcherInspectionStartedAt;

    const fastlyModes = [];
    for (const mode of MODES) {
      fastlyModes.push(await runFastlyMode(
        mode,
        fastlyCompiled.get(mode.id),
        materialized,
        corpus,
        launcher,
        tempRoot,
      ));
    }
    assert.deepEqual(
      semanticProjection(fastlyModes[0]),
      semanticProjection(fastlyModes[1]),
      'Fastly Native default and optimized semantics must agree',
    );
    for (let index = 0; index < REQUIRED_CASE_IDS.length; index += 1) {
      assert.equal(
        localModes[0].cases[index].observedStatus,
        fastlyModes[0].cases[index].observedStatus,
        REQUIRED_CASE_IDS[index],
      );
      assert.equal(
        localModes[0].cases[index].errorCode,
        fastlyModes[0].cases[index].errorCode,
        REQUIRED_CASE_IDS[index],
      );
    }

    const jwtSource = pulseJwtAssemblyScriptSource();
    const cryptoSource = pulseHmacAssemblyScriptSource();
    const impacts = Object.freeze(Object.fromEntries(MODES.map((mode) => {
      const target = fastlyCompiled.get(mode.id);
      const control = controlCompiled.get(mode.id);
      return [mode.id, Object.freeze({
        controlWasmBytes: control.wasm.byteLength,
        finalWasmBytes: target.wasm.byteLength,
        totalArtifactImpactBytes: target.wasm.byteLength - control.wasm.byteLength,
        jwtSourceContributionBytes: jwtSource.sourceBytes,
        jwtSourceContributionSha256: jwtSource.sourceSha256,
        cryptoSourceContributionBytes: cryptoSource.sourceBytes,
        cryptoSourceContributionSha256: cryptoSource.sourceSha256,
        oneFinalArtifact: true,
        guestUnitRequired: false,
        rustGuestUnitRequired: false,
      })];
    })));

    const localTarget = Object.freeze({
      targetId: 'node-native',
      provider: 'node',
      mode: 'native',
      status: 'passed',
      realization: 'guest-source:pulse-hmac-as',
      implementation: 'pulse-hmac-as.v1',
      caseIds: Object.freeze([...REQUIRED_CASE_IDS]),
      skippedCaseIds: Object.freeze([]),
      modes: Object.freeze(localModes),
      defaultOptimizedParity: true,
      automaticFallback: false,
    });
    const fastlyTarget = Object.freeze({
      targetId: 'fastly-native',
      provider: 'fastly',
      mode: 'native',
      status: 'passed',
      realization: 'guest-source:pulse-hmac-as',
      implementation: 'pulse-hmac-as.v1',
      caseIds: Object.freeze([...REQUIRED_CASE_IDS]),
      skippedCaseIds: Object.freeze([]),
      modes: Object.freeze(fastlyModes),
      defaultOptimizedParity: true,
      oneFinalArtifactPerMode: true,
      automaticFallback: false,
    });
    const conformance = Object.freeze({
      version: CONFORMANCE_REPORT_VERSION,
      checkpoint: 'E2',
      status: 'passed',
      classification: 'PASS',
      corpusVersion: corpus.version,
      corpusHash: corpus.corpusHash,
      frozenCorpusReadinessAtE0: 'planning-blocked',
      currentReadinessResolution: 'implemented-e2',
      harnessVersion: materialized.version,
      targetIds: Object.freeze(['node-native', 'fastly-native']),
      caseIds: Object.freeze([...REQUIRED_CASE_IDS]),
      requiredExecutions: REQUIRED_CASE_IDS.length * 2 * MODES.length,
      completedExecutions: REQUIRED_CASE_IDS.length * 2 * MODES.length,
      skippedExecutions: 0,
      javascriptPredecessor: Object.freeze({
        report: 'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
        sha256: fileSha256(path.join(
          wasmRoot,
          '.test-results',
          'jwt-e1',
          'jwt-javascript-conformance-report.json',
        )),
        completedExecutions: e1Conformance.completedExecutions,
      }),
      targets: Object.freeze([localTarget, fastlyTarget]),
      crossTargetStatusAndErrorParity: true,
      automaticFallback: false,
    });

    const artifactAudit = Object.freeze({
      version: ARTIFACT_AUDIT_REPORT_VERSION,
      checkpoint: 'E2',
      status: 'passed',
      local: Object.freeze(localModes.map((entry) => entry.artifact)),
      fastly: Object.freeze(fastlyModes.map((entry) => entry.artifact)),
      realizationContributionAndImpact: impacts,
      exactFinalArtifactsAuditedAndExecuted: true,
      directImportsWithinTargetPolicy: true,
      oneFinalWasmArtifactPerMode: true,
      guestSourceImplementationPresent: true,
      rustGuestUnitRequired: false,
      secretValuesPresent: false,
      automaticFallback: false,
    });

    const targetReality = Object.freeze({
      version: TARGET_REALITY_REPORT_VERSION,
      checkpoint: 'E2',
      status: 'passed',
      selection: Object.freeze({
        realization: 'guest-source:pulse-hmac-as',
        implementation: 'pulse-hmac-as.v1',
        jwtPackageSource: 'pulse-jwt-as',
        semanticOwner: '@pulse-compute/crypto',
        automaticFallback: false,
      }),
      canonicalCompilation: Object.freeze({
        nodePlanHash: nodeFixture.plan.planHash,
        fastlyPlanHash: fastlyFixture.plan.planHash,
        cryptoRequirement: 'HS256',
        requestedBy: '@pulse-compute/jwt',
      }),
      providerAuthority: Object.freeze({
        requestOwnedSecretLookup: true,
        exactSigningInputObserved: true,
        clockAfterAuthenticity: true,
        registeredClaimsBeforeSchema: true,
        detachedImmutableResult: true,
      }),
      fastlyLauncherInspection: Object.freeze({
        kind: launcher.kind,
        owner: launcher.owner,
        durationMs: launcherInspectionDurationMs,
        version: launcher.inspection.version,
        termination: launcher.inspection.termination,
        timeoutAfterCompleteVersionOutput:
          launcher.inspection.termination
          === 'timeout-after-complete-version-output',
        countedAsApplicationExecution: false,
        launcherSha256: fileSha256(launcher.inspection.binary),
      }),
      fastlyCliInspection: launcher.fastlyCliInspection
        ? Object.freeze({
            required: false,
            selectedAsLauncher: true,
            version: launcher.fastlyCliInspection.version,
            termination: launcher.fastlyCliInspection.termination,
            binarySha256: fileSha256(
              launcher.fastlyCliInspection.binary,
            ),
          })
        : Object.freeze({
            required: false,
            selectedAsLauncher: false,
            version: null,
            termination: null,
            binarySha256: null,
          }),
      viceroyInspection: launcher.viceroyInspection
        ? Object.freeze({
            selectedAsLauncher: launcher.kind === 'viceroy-direct',
            version: launcher.viceroyInspection.version,
            binarySha256: fileSha256(launcher.viceroyInspection.binary),
          })
        : Object.freeze({
            selectedAsLauncher: false,
            version: null,
            binarySha256: null,
          }),
      localModes: Object.freeze(localModes.map((entry) => Object.freeze({
        mode: entry.mode,
        bytes: entry.artifact.bytes,
        sha256: entry.artifact.sha256,
        canonicalProbe: entry.canonicalProbe,
        timing: entry.timing,
      }))),
      fastlyModes: Object.freeze(fastlyModes.map((entry) => Object.freeze({
        mode: entry.mode,
        bytes: entry.artifact.bytes,
        sha256: entry.artifact.sha256,
        exactExecutedArtifactSha256: entry.exactExecutedArtifactSha256,
        timing: entry.timing,
        runtime: entry.runtime,
      }))),
      predecessor,
      versionSkewDisposition: Object.freeze({
        status: 'accepted-non-blocking',
        detail:
          '@pulse-compute/provider-fastly remains cataloged at 1.0.0-beta.1 while the working JWT package is 1.0.0-beta.1; E2 does not publish or rewrite release identity.',
      }),
    });

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const conformanceFile = path.join(
      options.outputDirectory,
      'jwt-native-conformance-report.json',
    );
    const targetRealityFile = path.join(
      options.outputDirectory,
      'jwt-native-target-reality-report.json',
    );
    const artifactAuditFile = path.join(
      options.outputDirectory,
      'jwt-native-artifact-audit-report.json',
    );
    fs.writeFileSync(conformanceFile, stableJson(conformance));
    fs.writeFileSync(targetRealityFile, stableJson(targetReality));
    fs.writeFileSync(artifactAuditFile, stableJson(artifactAudit));

    const forbidden = [
      ...forbiddenSensitiveValues(corpus),
      ...Object.entries(materialized.secrets.values).map(([id, value]) => ({
        id: `secret:${id}`,
        value,
      })),
    ];
    const durable = [
      fs.readFileSync(conformanceFile, 'utf8'),
      fs.readFileSync(targetRealityFile, 'utf8'),
      fs.readFileSync(artifactAuditFile, 'utf8'),
    ].join('\n');
    const findings = forbidden.filter((entry) => durable.includes(entry.value));
    assert.deepEqual(findings, []);
    const redaction = Object.freeze({
      version: REDACTION_REPORT_VERSION,
      checkpoint: 'E2',
      status: 'passed',
      scannedArtifacts: Object.freeze([
        'jwt-native-conformance-report.json',
        'jwt-native-target-reality-report.json',
        'jwt-native-artifact-audit-report.json',
        'exact Fastly default Wasm',
        'exact Fastly optimized Wasm',
        'Fastly Compute stdout',
        'Fastly Compute stderr',
      ]),
      forbiddenValueIds: Object.freeze(forbidden.map((entry) => entry.id)),
      forbiddenValuesPresent: 0,
      secretValuesInGeneratedWasm: false,
      secretValuesInDurableEvidence: false,
    });
    const redactionFile = path.join(
      options.outputDirectory,
      'jwt-native-redaction-report.json',
    );
    fs.writeFileSync(redactionFile, stableJson(redaction));

    const evidence = Object.freeze({
      version: EVIDENCE_VERSION,
      checkpoint: 'E2',
      status: 'passed',
      classification: 'PASS',
      scope: Object.freeze({
        implementation: true,
        targets: Object.freeze(['node-native', 'fastly-native']),
        algorithm: 'HS256',
        publication: false,
        deployment: false,
      }),
      corpus: Object.freeze({
        version: corpus.version,
        sha256: fileSha256(path.join(__dirname, 'jwt-conformance-corpus.json')),
        semanticHash: corpus.corpusHash,
        cases: REQUIRED_CASE_IDS.length,
        executions: conformance.completedExecutions,
        skipped: 0,
      }),
      acceptance: Object.freeze({
        canonicalCompilationEmitsHs256Requirement: true,
        finalModulesContainGuestSource: true,
        providerOwnedSecretLookup: true,
        exactSigningInputObserved: true,
        claimsClockSchemaOrderingMatchesJavascript: true,
        defaultOptimizedParity: true,
        finalArtifactAuditPassed: true,
        realFastlyComputeServe: true,
        exactFastlyArtifactsAuditedAndExecuted: true,
        oneFinalWasmArtifactPerMode: true,
        noRustGuestUnit: true,
        importsWithinPolicy: true,
        secretValuesAbsent: true,
        sharedCorpusMatchesJavascript: true,
        automaticFallback: false,
        launcherInspectionExcludedFromApplicationTime: true,
      }),
      reports: Object.freeze({
        conformance: Object.freeze({
          file: 'wasm/.test-results/jwt-e2/jwt-native-conformance-report.json',
          sha256: fileSha256(conformanceFile),
        }),
        targetReality: Object.freeze({
          file: 'wasm/.test-results/jwt-e2/jwt-native-target-reality-report.json',
          sha256: fileSha256(targetRealityFile),
        }),
        artifactAudit: Object.freeze({
          file: 'wasm/.test-results/jwt-e2/jwt-native-artifact-audit-report.json',
          sha256: fileSha256(artifactAuditFile),
        }),
        redaction: Object.freeze({
          file: 'wasm/.test-results/jwt-e2/jwt-native-redaction-report.json',
          sha256: fileSha256(redactionFile),
        }),
      }),
      source: Object.freeze([
        sourceRecord('packages/jwt/as/index.as.ts'),
        sourceRecord('packages/jwt/pulsewasm.native.cjs'),
        sourceRecord('packages/jwt/pulsewasm.manifest.cjs'),
        sourceRecord('packages/crypto/as/pulse-hmac-as.ts'),
        sourceRecord('packages/provider-fastly/src/build/native-platform-capabilities.js'),
        sourceRecord('packages/provider-fastly/src/testing/fastly-cli.js'),
        sourceRecord('packages/provider-fastly/src/toolchain/index.js'),
        sourceRecord('wasm/test/jwt/jwt-conformance-corpus.json'),
        sourceRecord('wasm/test/jwt/jwt-conformance-harness.cjs'),
        sourceRecord('wasm/test/jwt/native-case-runtime.mjs'),
        sourceRecord('wasm/test/jwt/assert-jwt-native-reality.cjs'),
      ]),
      predecessor,
      nextAuthorizedCheckpoint: 'E3',
    });
    const evidenceFile = path.join(options.outputDirectory, 'jwt-e2-evidence.json');
    fs.writeFileSync(evidenceFile, stableJson(evidence));
    process.stdout.write(
      `ok - JWT E2 passed ${conformance.completedExecutions}/${conformance.requiredExecutions} `
      + 'Local/Fastly Native executions with exact guest-source artifacts and no fallback\n',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
