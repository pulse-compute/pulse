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
const jwtLowering = require('../../../packages/jwt/pulsewasm.compiler.cjs');
const {
  NODE_JAVASCRIPT_JWT_REALIZATION,
  createNodeJavascriptJwtVerify
} = require('../../../packages/provider-node/src/javascript/jwt-verifier.js');
const {
  FASTLY_JAVASCRIPT_JWT_REALIZATION,
  createFastlyJavascriptJwtVerify
} = require('../../../packages/provider-fastly/src/javascript/jwt-verifier.js');
const {
  NODE_NATIVE_JWT_REALIZATION
} = require('../../../packages/provider-node/src/runtime/jwt-verifier.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  createNodeProviderAdapter
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  compileCanonicalProject
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const {
  compileCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const {
  createNativeGuestSourceCryptoVerifier,
  executeCanonicalNativeModule
} = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  getProviderDriver,
  getProviderTargetDescriptor
} = require('../../packages/compiler/src/provider-toolchain.js');
const {
  CORPUS_VERSION,
  loadJwtConformanceCorpus
} = require('./jwt-conformance-harness.cjs');

const NOW_SECONDS = 2_000_000_000;
const SECRET_BINDING = 'JWT_D3_SECRET';
const SECRET = 'd3-provider-owned-secret-material-32-bytes-minimum';
const SUBJECT = 'd3-native-sensitive-subject';
const ISSUER = 'https://issuer.example';
const AUDIENCE = 'pulse-api';
const RUNTIME_BUILTIN_IMPLEMENTATION = 'webcrypto.subtle.hmac-sha-256.v1';
const GUEST_SOURCE_IMPLEMENTATION = 'pulse-hmac-as.v1';

const SOURCE_FILES = Object.freeze([
  'packages/crypto/src/contracts.ts',
  'packages/crypto/src/index.ts',
  'packages/jwt/package.json',
  'packages/jwt/src/crypto-verifier.ts',
  'packages/jwt/src/provider.ts',
  'packages/jwt/test/options.test.ts',
  'packages/jwt/test/package-runtime.test.ts',
  'packages/jwt/test/javascript-verifier.test.ts',
  'packages/jwt/test/provider-runtime.test.ts',
  'packages/jwt/test/types.ts',
  'packages/provider-node/package.json',
  'packages/provider-node/src/javascript/jwt-verifier.js',
  'packages/provider-node/src/javascript/runtime-host.js',
  'packages/provider-node/src/javascript/target-support-policy.js',
  'packages/provider-node/src/runtime/canonical-api-runtime.js',
  'packages/provider-node/src/runtime/jwt-verifier.js',
  'packages/provider-node/src/native/target.js',
  'packages/provider-fastly/package.json',
  'packages/provider-fastly/src/javascript/jwt-verifier.js',
  'packages/provider-fastly/src/javascript/package-effects.js',
  'packages/provider-fastly/src/javascript/runtime-host.js',
  'packages/provider-fastly/src/javascript/support.js',
  'packages/provider-fastly/src/javascript/target.js',
  'packages/provider-fastly/src/javascript/target-support-policy.js',
  'packages/provider-fastly/src/toolchain/index.js',
  'packages/jwt/pulse.package.json',
  'packages/jwt/pulsewasm.compiler.cjs',
  'packages/jwt/pulsewasm.manifest.cjs',
  'wasm/packages/contracts/src/crypto/contracts.js',
  'wasm/packages/contracts/src/jwt/contracts.js',
  'wasm/packages/compiler/src/canonical-native-plan.js',
  'wasm/packages/host-runtime/src/runtime/canonical-native-host.js',
  'wasm/packages/host-runtime/src/runtime/native-crypto-verifier.js',
  'wasm/packages/runtime-core-as/src/compiler/crypto-guest-source.js',
  'wasm/test/jwt/assert-jwt-package-owned-lowering.cjs',
  'wasm/test/jwt/assert-jwt-realization-integration.cjs',
  'wasm/test/jwt/jwt-conformance-corpus.json',
  'wasm/test/jwt/jwt-conformance-harness.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/assert-hidden-contracts.cjs',
  'wasm/test/suite/registry.cjs',
  'wasm/test/suite/assert-suite-shape.cjs',
  'pnpm-lock.yaml'
]);

const HIGH_RISK_CASES = Object.freeze([
  'node-javascript-runtime-builtin',
  'fastly-javascript-runtime-builtin',
  'node-native-guest-source',
  'exact-original-signing-input',
  'exact-implementation-identity',
  'provider-owned-secret',
  'one-clock-after-authenticity',
  'schema-after-authenticity',
  'request-cancellation-before-secret',
  'fixed-host-owned-native-arena',
  'native-staging-wipe',
  'missing-native-export-no-fallback',
  'no-native-guest-unit',
  'fastly-native-planning-rejection',
  'asymmetric-target-rejection',
  'redacted-runtime-evidence'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-d3');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT D3 option: ${argv[index]}`);
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
  const detail = options.assertOutput ? options.assertOutput(output) : undefined;
  return Object.freeze({
    id,
    status: 'passed',
    durationMs,
    ...(detail && typeof detail === 'object' ? detail : {})
  });
}

function filesUnder(relativeRoot, extensions = new Set(['.js', '.cjs', '.mjs', '.ts'])) {
  const root = path.join(repoRoot, relativeRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function sourceText(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function assertSourceTopology() {
  const jwtPackage = JSON.parse(sourceText('packages/jwt/package.json'));
  assert.equal(jwtPackage.version, '1.0.0-beta.1');
  assert.equal(jwtPackage.dependencies['@pulse-compute/crypto'], 'workspace:*');
  assert.equal(Object.hasOwn(jwtPackage.dependencies, 'jose'), false);

  const jwtSources = filesUnder('packages/jwt/src')
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const providerSources = [
    ...filesUnder('packages/provider-node/src'),
    ...filesUnder('packages/provider-fastly/src')
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const nodeJavascript = sourceText('packages/provider-node/src/javascript/jwt-verifier.js');
  const fastlyJavascript = sourceText('packages/provider-fastly/src/javascript/jwt-verifier.js');
  const nodeNative = sourceText('packages/provider-node/src/runtime/jwt-verifier.js');
  const nativeBoundary = sourceText(
    'wasm/packages/host-runtime/src/runtime/native-crypto-verifier.js'
  );

  assert.doesNotMatch(jwtSources, /(?:verifyJwtWithJose|verifyJwtWithHostCrypto|from ['"]jose['"])/);
  assert.doesNotMatch(providerSources, /(?:jwt-host-verify|verifyJwtWithJose|verifyJwtWithHostCrypto)/);
  assert.match(nodeJavascript, /verifyJwtWithCrypto/);
  assert.match(fastlyJavascript, /verifyJwtWithCrypto/);
  assert.match(nodeJavascript, /@pulse-compute\/crypto/);
  assert.match(fastlyJavascript, /@pulse-compute\/crypto/);
  assert.doesNotMatch(nodeJavascript, /(?:globalThis|subtle|WebCrypto|createHmac)/);
  assert.doesNotMatch(fastlyJavascript, /(?:globalThis|subtle|WebCrypto|createHmac)/);
  assert.match(nodeNative, /verifyJwtWithCrypto/);
  assert.doesNotMatch(nodeNative, /(?:node:crypto|globalThis|subtle|createHmac|verifySignature)/);
  assert.match(nativeBoundary, /pulse_crypto_hs256_verify/);
  assert.match(nativeBoundary, /GUARD_BYTES = PAGE_BYTES/);
  assert.doesNotMatch(nativeBoundary, /(?:arenaBytes|allocationOptions|automaticFallback:\s*true)/);

  assert.equal(cryptoContracts.CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION, RUNTIME_BUILTIN_IMPLEMENTATION);
  assert.equal(cryptoContracts.CRYPTO_GUEST_SOURCE_IMPLEMENTATION, GUEST_SOURCE_IMPLEMENTATION);
  assert.deepEqual(NODE_JAVASCRIPT_JWT_REALIZATION, {
    algorithm: 'HS256',
    realization: 'runtime-builtin',
    implementation: RUNTIME_BUILTIN_IMPLEMENTATION,
    automaticFallback: false
  });
  assert.deepEqual(FASTLY_JAVASCRIPT_JWT_REALIZATION, NODE_JAVASCRIPT_JWT_REALIZATION);
  assert.deepEqual(NODE_NATIVE_JWT_REALIZATION, {
    algorithm: 'HS256',
    realization: 'guest-source:pulse-hmac-as',
    implementation: GUEST_SOURCE_IMPLEMENTATION,
    semanticOwner: '@pulse-compute/crypto',
    guestUnitRequired: false,
    automaticFallback: false
  });
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_ALGORITHMS, ['HS256']);
  assert.deepEqual(jwtContracts.JWT_IMPLEMENTED_KEY_TYPES, ['secret']);

  const corpus = loadJwtConformanceCorpus();
  assert.equal(corpus.version, CORPUS_VERSION);
  assert.deepEqual(
    corpus.targetMatrix.required.map(
      (entry) => [entry.id, entry.expectedStatus, entry.realization]
    ),
    [
      ['node-javascript', 'executable', 'runtime-builtin'],
      ['fastly-javascript', 'executable', 'runtime-builtin'],
      ['node-native', 'executable', 'guest-source:pulse-hmac-as'],
      ['fastly-native', 'executable', 'guest-source:pulse-hmac-as']
    ]
  );
  assert.deepEqual(
    corpus.targetMatrix.required.map((entry) => entry.currentReadiness.status),
    ['passed', 'passed', 'passed', 'planning-blocked']
  );
  assert.equal(corpus.harnessContract.allCasesRequired, true);
  assert.equal(corpus.harnessContract.allowSkip, false);
  assert.equal(corpus.harnessContract.allowModeFallback, false);
  assert.equal(corpus.harnessContract.allowRealizationFallback, false);
  assert.ok(corpus.targetMatrix.required.every(
    (entry) => entry.automaticFallback === false
  ));

  return Object.freeze({
    package: '@pulse-compute/jwt@1.0.0-beta.1',
    algorithm: 'HS256',
    semanticOwner: '@pulse-compute/crypto',
    javascript: Object.freeze({
      realization: 'runtime-builtin',
      implementation: RUNTIME_BUILTIN_IMPLEMENTATION
    }),
    native: Object.freeze({
      realization: 'guest-source:pulse-hmac-as',
      implementation: GUEST_SOURCE_IMPLEMENTATION,
      guestUnitRequired: false
    }),
    automaticFallback: false
  });
}

function compactToken(secret, claims, header = { alg: 'HS256', typ: 'JWT' }) {
  const protectedSegment = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const claimsSegment = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${protectedSegment}.${claimsSegment}`;
  const tag = crypto.createHmac('sha256', secret).update(signingInput, 'ascii').digest();
  return Object.freeze({
    token: `${signingInput}.${tag.toString('base64url')}`,
    signingInput: Buffer.from(signingInput, 'ascii'),
    tag
  });
}

function invalidateAuthenticator(token) {
  const segments = token.split('.');
  const tag = Buffer.from(segments[2], 'base64url');
  tag[0] ^= 1;
  return `${segments[0]}.${segments[1]}.${tag.toString('base64url')}`;
}

function canonicalEffect(token) {
  return Object.freeze({
    ...jwtContracts.JWT_VERIFY_OPERATION,
    id: 'jwt-d3-runtime-proof',
    payload: Object.freeze({
      token,
      options: Object.freeze({
        algorithms: Object.freeze(['HS256']),
        key: Object.freeze({ type: 'secret', binding: SECRET_BINDING }),
        issuer: ISSUER,
        audience: AUDIENCE,
        typ: 'JWT',
        requiredClaims: Object.freeze(['sub', 'exp']),
        claimsSchema: 'auth.AccessClaims'
      })
    })
  });
}

async function assertJavascriptRealizations(validFixture, invalidToken) {
  const rows = [];
  for (const [provider, createVerify, realization] of [
    ['node-javascript', createNodeJavascriptJwtVerify, NODE_JAVASCRIPT_JWT_REALIZATION],
    ['fastly-javascript', createFastlyJavascriptJwtVerify, FASTLY_JAVASCRIPT_JWT_REALIZATION]
  ]) {
    const capture = { secret: 0, clock: 0, schema: 0 };
    const redacted = [];
    const verify = createVerify({
      secretLookup(binding) {
        capture.secret += 1;
        assert.equal(binding, SECRET_BINDING);
        return SECRET;
      },
      captureWallClock() {
        capture.clock += 1;
        return Object.freeze({ unixEpochSeconds: NOW_SECONDS, trusted: true });
      }
    });
    const result = await verify(canonicalEffect(validFixture.token), {
      registerRedactionValue(value) {
        redacted.push(value);
      },
      validateSchemaValue(schemaId, claims, context) {
        capture.schema += 1;
        assert.equal(schemaId, 'auth.AccessClaims');
        assert.equal(context.source, 'jwt-claims');
        return Object.freeze({ sub: String(claims.sub) });
      }
    });
    assert.deepEqual(result, {
      claims: { sub: SUBJECT },
      protectedHeader: { alg: 'HS256', typ: 'JWT' }
    });
    assert.deepEqual(capture, { secret: 1, clock: 1, schema: 1 });
    assert.equal(redacted.includes(validFixture.token), true);
    assert.equal(redacted.includes(SECRET), true);
    assert.equal(redacted.includes(SUBJECT), true);

    const invalidCapture = { secret: 0, clock: 0, schema: 0 };
    const invalidVerify = createVerify({
      secretLookup() {
        invalidCapture.secret += 1;
        return SECRET;
      },
      captureWallClock() {
        invalidCapture.clock += 1;
        return Object.freeze({ unixEpochSeconds: NOW_SECONDS, trusted: true });
      }
    });
    await assert.rejects(
      () => invalidVerify(canonicalEffect(invalidToken), {
        registerRedactionValue() {},
        validateSchemaValue() {
          invalidCapture.schema += 1;
          return {};
        }
      }),
      (error) => error && error.code === 'PULSE_JWT_SIGNATURE_INVALID'
    );
    assert.deepEqual(invalidCapture, { secret: 1, clock: 0, schema: 0 });

    rows.push(Object.freeze({
      target: provider,
      status: 'passed',
      realization: realization.realization,
      implementation: realization.implementation,
      secretAuthority: 'provider-owned',
      clockCapturesAfterValidAuthenticity: capture.clock,
      clockCapturesAfterInvalidAuthenticity: invalidCapture.clock,
      automaticFallback: false
    }));
  }

  let cancellationSecretCalls = 0;
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    () => createNodeJavascriptJwtVerify({
      secretLookup() {
        cancellationSecretCalls += 1;
        return SECRET;
      }
    })(canonicalEffect(validFixture.token), {
      signal: cancelled.signal,
      registerRedactionValue() {}
    }),
    (error) => (
      error
      && error.code === 'PULSE_JWT_OPERATION_FAILED'
      && error.detail
      && error.detail.category === 'request-cancelled'
      && error.detail.automaticFallback === false
    )
  );
  assert.equal(cancellationSecretCalls, 0);

  return Object.freeze(rows);
}

function nativeSource() {
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['HS256'],
    key: { type: 'secret', binding: '${SECRET_BINDING}' },
    issuer: '${ISSUER}',
    audience: '${AUDIENCE}',
    typ: 'JWT',
    requiredClaims: ['sub', 'exp'],
    claimsSchema: 'auth.AccessClaims'
  })
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg)
}
`;
}

function compileNativeFixture(tempRoot) {
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  fs.writeFileSync(
    path.join(sourceRoot, 'schemas.ts'),
    'export interface AccessClaims { sub: string }\n'
  );
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(entryFile, nativeSource());
  const project = compileCanonicalProject(entryFile, {
    rootDir: tempRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(tempRoot, 'tsconfig.json'),
    packageTargetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    schemas: {
      entries: [{
        id: 'auth.AccessClaims',
        namespace: 'auth',
        name: 'AccessClaims',
        source: './src/schemas.ts',
        type: 'AccessClaims'
      }]
    },
    applicationProjectMetadata: {
      selectedProfile: { name: 'd3', source: 'fixture' },
      strict: true,
      target: 'native',
      host: 'node',
      projectHash: 'd'.repeat(64),
      configPlanHash: '3'.repeat(64),
      bindings: { config: [], secret: [] },
      fragments: {},
      crypto: {
        source: 'profile',
        declaration: cryptoContracts.normalizeCryptoConfiguration({
          HS256: { realization: 'guest-source:pulse-hmac-as' }
        })
      }
    }
  });
  const plan = buildCanonicalNativePlan(project);
  const compiled = compileCanonicalNativePlan(plan, {
    cwd: repoRoot,
    timeoutMs: 180000
  });
  return Object.freeze({ project, plan, compiled });
}

function assertNativeCompilation(fixture) {
  const { project, plan, compiled } = fixture;
  assert.equal(project.cryptoRealizationPlan.algorithms.length, 1);
  assert.deepEqual(project.cryptoRealizationPlan.algorithms[0], {
    algorithm: 'HS256',
    primitive: { kind: 'hmac', hash: 'SHA-256' },
    requestedBy: ['@pulse-compute/jwt'],
    semanticOwner: '@pulse-compute/crypto',
    realization: 'guest-source:pulse-hmac-as',
    kind: 'guest-source',
    backend: 'pulse-hmac-as',
    implementation: GUEST_SOURCE_IMPLEMENTATION,
    targetStatus: 'implemented-c3',
    targetImplemented: true,
    pinned: true,
    automaticFallback: false
  });
  assert.deepEqual(plan.crypto, project.cryptoRealizationPlan);
  assert.equal(plan.crypto.automaticFallback, false);
  assert.equal(compiled.guestUnits.length, 0);
  assert.equal(compiled.guestLink, undefined);
  assert.equal(compiled.manifest.crypto.active, true);
  assert.equal(compiled.manifest.crypto.automaticFallback, false);
  assert.equal(compiled.manifest.crypto.algorithms.length, 1);
  assert.equal(
    compiled.manifest.crypto.algorithms[0].realization,
    'guest-source:pulse-hmac-as'
  );
  assert.equal(
    compiled.manifest.crypto.algorithms[0].implementation,
    GUEST_SOURCE_IMPLEMENTATION
  );
  const exports = new Set(compiled.inspection.exports.map((entry) => entry.name));
  assert.equal(exports.has('pulse_crypto_hs256_verify'), true);
  assert.equal(exports.has('pulse_crypto_sha256_digest'), true);
  assert.equal(
    compiled.inspection.imports.some(
      (entry) => /(?:wasi|js[_-]?compute)/i.test(`${entry.module}:${entry.name}`)
    ),
    false
  );
  return Object.freeze({
    planHash: plan.planHash,
    wasmSha256: compiled.inspection.sha256,
    guestUnits: compiled.guestUnits.length,
    guestLink: false,
    finalWasmInspected: true,
    realization: 'guest-source:pulse-hmac-as',
    implementation: GUEST_SOURCE_IMPLEMENTATION,
    automaticFallback: false
  });
}

function assertNativeCryptoBoundary(plan, validFixture) {
  const calls = [];
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 8 });
  const exports = {
    memory,
    pulse_crypto_hs256_verify(
      keyPointer,
      keyLength,
      dataPointer,
      dataLength,
      tagPointer,
      tagLength
    ) {
      const view = new Uint8Array(memory.buffer);
      calls.push(Object.freeze({
        keyPointer,
        keyLength,
        dataPointer,
        dataLength,
        tagPointer,
        tagLength,
        key: Buffer.from(view.slice(keyPointer, keyPointer + keyLength)),
        data: Buffer.from(view.slice(dataPointer, dataPointer + dataLength)),
        tag: Buffer.from(view.slice(tagPointer, tagPointer + tagLength))
      }));
      return 1;
    }
  };
  const selected = createNativeGuestSourceCryptoVerifier({ plan, exports });
  assert.equal(selected.realization.available, true);
  assert.equal(selected.realization.implementation, GUEST_SOURCE_IMPLEMENTATION);
  const key = Buffer.from(SECRET, 'utf8');
  const result = selected.verifier.mac.verify({
    algorithm: 'HS256',
    key: { type: 'hmac-key-bytes', bytes: key },
    data: validFixture.signingInput,
    tag: validFixture.tag
  });
  assert.deepEqual(result, { status: 'valid' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].key, key);
  assert.deepEqual(calls[0].data, validFixture.signingInput);
  assert.deepEqual(calls[0].tag, validFixture.tag);
  const wiped = new Uint8Array(memory.buffer);
  for (const [pointer, length] of [
    [calls[0].keyPointer, calls[0].keyLength],
    [calls[0].dataPointer, calls[0].dataLength],
    [calls[0].tagPointer, calls[0].tagLength]
  ]) {
    assert.equal(
      wiped.subarray(pointer, pointer + length).every((value) => value === 0),
      true
    );
  }
  assert.deepEqual(
    selected.verifier.mac.verify({
      algorithm: 'HS256',
      key: { type: 'hmac-key-bytes', bytes: Buffer.alloc(31) },
      data: validFixture.signingInput,
      tag: validFixture.tag
    }),
    { status: 'invalid-key' }
  );
  assert.equal(calls.length, 1);

  const unavailable = createNativeGuestSourceCryptoVerifier({
    plan,
    exports: { memory: new WebAssembly.Memory({ initial: 1, maximum: 4 }) }
  });
  assert.equal(unavailable.realization.available, false);
  assert.deepEqual(
    unavailable.verifier.mac.verify({
      algorithm: 'HS256',
      key: { type: 'hmac-key-bytes', bytes: key },
      data: validFixture.signingInput,
      tag: validFixture.tag
    }),
    { status: 'realization-failure' }
  );
  assert.equal(unavailable.realization.automaticFallback, false);

  return Object.freeze({
    exactKeyBytes: true,
    exactSigningInputBytes: true,
    exactAuthenticatorBytes: true,
    fixedHostOwnedArena: true,
    stagedBytesWiped: true,
    missingExportStatus: 'realization-failure',
    automaticFallback: false
  });
}

async function nativeExecutionAttempt(compiled, token, secret) {
  let clockCaptures = 0;
  try {
    const result = await executeCanonicalNativeModule(compiled, {
      providerAdapter: createNodeProviderAdapter(),
      secrets: { [SECRET_BINDING]: secret },
      captureJwtWallClock() {
        clockCaptures += 1;
        return Object.freeze({ unixEpochSeconds: NOW_SECONDS, trusted: true });
      },
      request: {
        path: '/',
        headers: [['authorization', `Bearer ${token}`]]
      }
    });
    return Object.freeze({ status: 'success', result, clockCaptures });
  } catch (error) {
    return Object.freeze({
      status: 'error',
      code: error && error.code,
      clockCaptures,
      evidence: `${error && error.message} ${JSON.stringify(error && error.detail)} ${JSON.stringify(error && error.execution)}`
    });
  }
}

async function assertNativeExecution(compiled, validFixture, invalidToken) {
  const valid = await nativeExecutionAttempt(compiled, validFixture.token, SECRET);
  assert.equal(valid.status, 'success');
  assert.equal(valid.result.response.status, 200);
  assert.equal(valid.result.response.body, `${SUBJECT}:HS256`);
  assert.equal(valid.clockCaptures, 1);
  const validEvidence = JSON.stringify(valid.result.trace);
  assert.equal(validEvidence.includes(validFixture.token), false);
  assert.equal(validEvidence.includes(SECRET), false);
  assert.equal(validEvidence.includes(SUBJECT), false);
  assert.match(validEvidence, /<redacted>/);

  const invalid = await nativeExecutionAttempt(compiled, invalidToken, SECRET);
  assert.deepEqual(
    { status: invalid.status, code: invalid.code, clockCaptures: invalid.clockCaptures },
    {
      status: 'error',
      code: 'PULSE_JWT_SIGNATURE_INVALID',
      clockCaptures: 0
    }
  );
  assert.equal(invalid.evidence.includes(SUBJECT), false);
  assert.equal(invalid.evidence.includes(invalidToken), false);
  assert.equal(invalid.evidence.includes(SECRET), false);

  const wrongSecret = await nativeExecutionAttempt(
    compiled,
    validFixture.token,
    'wrong-provider-secret-material-with-32-byte-minimum'
  );
  assert.deepEqual(
    {
      status: wrongSecret.status,
      code: wrongSecret.code,
      clockCaptures: wrongSecret.clockCaptures
    },
    {
      status: 'error',
      code: 'PULSE_JWT_SIGNATURE_INVALID',
      clockCaptures: 0
    }
  );

  const undersizedSecret = await nativeExecutionAttempt(compiled, validFixture.token, 'short');
  assert.deepEqual(
    {
      status: undersizedSecret.status,
      code: undersizedSecret.code,
      clockCaptures: undersizedSecret.clockCaptures
    },
    {
      status: 'error',
      code: 'PULSE_JWT_KEY_INVALID',
      clockCaptures: 0
    }
  );

  return Object.freeze({
    target: 'node-native',
    status: 'passed',
    realization: 'guest-source:pulse-hmac-as',
    implementation: GUEST_SOURCE_IMPLEMENTATION,
    responseBody: `${SUBJECT}:HS256`.replace(SUBJECT, '<redacted-subject>'),
    validClockCaptures: valid.clockCaptures,
    invalidClockCaptures: invalid.clockCaptures,
    guestUnitRequired: false,
    automaticFallback: false
  });
}

function assertFastlyNativePlanning() {
  const fastlyNative = getProviderTargetDescriptor(
    getProviderDriver('fastly', { projectRoot: repoRoot }),
    'native'
  );
  const result = jwtLowering.buildJwtLoweringPlan({
    cwd: repoRoot,
    sourcePath: 'src/index.ts',
    sourceText: nativeSource(),
    schemaBundle: {
      declaredSchemaIds: ['auth.AccessClaims'],
      schemaIds: ['auth.AccessClaims'],
      registryIrVersion: 'test.schema-registry.v1',
      fullCodecRealization: true,
      registry: { schemas: [{ id: 'auth.AccessClaims' }] }
    },
    targetDescriptor: fastlyNative
  });
  assert.equal(result.artifact.status, 'error');
  assert.ok(result.diagnostics.some(
    (entry) => entry.code === jwtContracts.JWT_DIAGNOSTIC_CODES.TARGET_ALGORITHM_UNSUPPORTED
  ));
  assert.ok(result.diagnostics.some(
    (entry) => entry.code === jwtContracts.JWT_DIAGNOSTIC_CODES.TARGET_KEY_UNSUPPORTED
  ));
  assert.ok(result.diagnostics.some(
    (entry) => entry.code === jwtContracts.JWT_DIAGNOSTIC_CODES.TARGET_CLOCK_UNAVAILABLE
  ));
  assert.equal(fastlyNative.jwt.status, 'not-realized');
  assert.equal(fastlyNative.jwt.reasonId, 'fastly-native-jwt-package-effect-unavailable');
  assert.equal(fastlyNative.automaticFallback, false);
  return Object.freeze({
    target: 'fastly-native',
    status: 'planning-blocked',
    reasonId: fastlyNative.jwt.reasonId,
    diagnosticCodes: Object.freeze(
      [...new Set(result.diagnostics.map((entry) => entry.code))].sort()
    ),
    automaticFallback: false
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
      'd3-composition-and-realization-contracts',
      process.execPath,
      [
        runner,
        '--task', 'suite-shape',
        '--task', 'jwt-package-owned-lowering',
        '--task', 'crypto-config-planning',
        '--task', 'crypto-native-guest-source',
        '--task', 'target-support',
        '--no-report'
      ],
      {
        timeoutMs: 600000,
        assertOutput(output) {
          for (const task of [
            'suite-shape',
            'jwt-package-owned-lowering',
            'crypto-config-planning',
            'crypto-native-guest-source',
            'target-support'
          ]) {
            assert.match(output, new RegExp(`${task}: passed`));
          }
          return Object.freeze({ focusedContractTasks: 5 });
        }
      }
    )
  ]);
}

function assertRedacted(serialized, validFixture, invalidToken) {
  for (const marker of [
    SECRET,
    SUBJECT,
    validFixture.token,
    invalidToken,
    validFixture.tag.toString('hex'),
    validFixture.tag.toString('base64url'),
    repoRoot
  ]) {
    assert.equal(serialized.includes(marker), false);
  }
  assert.doesNotMatch(
    serialized,
    /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const semanticContract = assertSourceTopology();
  const stages = runFocusedValidation();
  const validFixture = compactToken(SECRET, {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: SUBJECT,
    iat: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 300
  });
  const invalidToken = invalidateAuthenticator(validFixture.token);
  const javascriptTargets = await assertJavascriptRealizations(validFixture, invalidToken);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-d3-'));
  let nativeCompilation;
  let nativeBoundary;
  let nodeNative;
  try {
    const fixture = compileNativeFixture(tempRoot);
    nativeCompilation = assertNativeCompilation(fixture);
    nativeBoundary = assertNativeCryptoBoundary(fixture.plan, validFixture);
    nodeNative = await assertNativeExecution(fixture.compiled, validFixture, invalidToken);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const fastlyNative = assertFastlyNativePlanning();

  const evidence = Object.freeze({
    version: 'pulse.jwt-realization-integration.d3-evidence.v1',
    status: 'passed',
    scope: Object.freeze({
      phase: 'D3',
      entryPoints: Object.freeze([
        'package-surface',
        'package-lowering',
        'provider-integration',
        'runtime-effects'
      ]),
      operation: 'JWT HS256 realization integration',
      authoringFacadeChanged: false,
      providerIntegrationChanged: true,
      nativeGuestSourceChanged: true,
      publication: false,
      deployment: false,
      frozenReleaseCatalogMutated: false
    }),
    semanticContract,
    targetMatrix: Object.freeze([
      ...javascriptTargets,
      nodeNative,
      fastlyNative
    ]),
    nativeCompilation,
    nativeBoundary,
    ordering: Object.freeze([
      'request-active',
      'provider-secret-resolution',
      'exact-original-signing-input',
      'selected-crypto-realization',
      'authenticity-decision',
      'one-provider-wall-clock-capture',
      'registered-claims',
      'claims-schema',
      'detached-immutable-result'
    ]),
    highRiskCases: HIGH_RISK_CASES,
    validation: Object.freeze({
      stages,
      focusedPackageTestFiles: stages[2].testFiles,
      focusedPackageTests: stages[2].tests,
      focusedContractTasks: stages[3].focusedContractTasks,
      directJavascriptTargets: javascriptTargets.length,
      directNativeExecutions: 4
    }),
    policy: Object.freeze({
      jwtOwnsJwsParsingAndClaimsSemantics: true,
      cryptoOwnsAuthenticityDecision: true,
      requestSecretCachedAcrossExecutions: false,
      claimsAvailableBeforeAuthenticity: false,
      clockCapturedBeforeAuthenticity: false,
      guestUnitRequiredForHs256: false,
      hostSignatureVerifierPresent: false,
      asymmetricAlgorithmsAdvertisedAsExecutable: false,
      diagnosticsContainTokenClaimsAuthenticatorKeyOrSecretValues: false,
      automaticFallback: false
    }),
    sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
    previousCheckpoint: 'D2',
    nextAuthorizedUnit: 'D4'
  });
  const serialized = stableJson(evidence);
  assertRedacted(serialized, validFixture, invalidToken);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(options.outputDirectory, 'jwt-d3-evidence.json'),
    serialized
  );
  console.log(
    'ok - JWT D3 executes HS256 through exact JavaScript and Node Native crypto ' +
    'realizations, rejects unavailable Fastly Native planning, and never falls back'
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
