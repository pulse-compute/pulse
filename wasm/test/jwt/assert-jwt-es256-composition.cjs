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
const corpusFile = path.join(__dirname, 'jwt-es256-conformance-corpus.json');
process.chdir(repoRoot);

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  createNodeJavascriptJwtVerify
} = require('../../../packages/provider-node/src/javascript/jwt-verifier.js');
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
  executeCanonicalNativeModule
} = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');

const CORPUS_VERSION = 'pulse.jwt-conformance-corpus.g3.v1';
const NOW = 2_000_000_000;
const SUBJECT = 'g3-sensitive-subject';
const ES256_X = 'YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y';
const ES256_Y = 'eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk';
const ES256_D = 'ya-p2EW6dRZrXCFXZ7HWk05Qw9s26JsSe4piKxIPZyE';
const P256_ORDER = Buffer.from(
  'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
  'hex'
);
const PUBLIC_JWK = Object.freeze({
  kty: 'EC',
  crv: 'P-256',
  x: ES256_X,
  y: ES256_Y,
  alg: 'ES256',
  use: 'sig',
  key_ops: Object.freeze(['verify']),
  kid: 'g3-key'
});
const PRIVATE_KEY = crypto.createPrivateKey({
  key: {
    kty: PUBLIC_JWK.kty,
    crv: PUBLIC_JWK.crv,
    x: PUBLIC_JWK.x,
    y: PUBLIC_JWK.y,
    d: ES256_D,
    alg: PUBLIC_JWK.alg,
    use: PUBLIC_JWK.use,
    kid: PUBLIC_JWK.kid
  },
  format: 'jwk'
});

const SOURCE_FILES = Object.freeze([
  'packages/crypto/src/contracts.ts',
  'packages/crypto/src/internal/verification.ts',
  'packages/crypto/src/internal/realization.ts',
  'packages/crypto/src/index.ts',
  'packages/crypto/test/contract.test.ts',
  'packages/crypto/test/runtime-builtin.test.ts',
  'packages/jwt/src/options.ts',
  'packages/jwt/src/token.ts',
  'packages/jwt/src/crypto-verifier.ts',
  'packages/jwt/test/crypto-verifier.test.ts',
  'packages/jwt/pulsewasm.compiler.cjs',
  'packages/jwt/pulsewasm.manifest.cjs',
  'packages/jwt/pulsewasm.native.cjs',
  'packages/crypto/pulsewasm.native.cjs',
  'packages/provider-node/src/javascript/jwt-verifier.js',
  'packages/provider-node/src/runtime/jwt-verifier.js',
  'wasm/packages/host-runtime/src/runtime/native-crypto-verifier.js',
  'packages/provider-node/src/native/target.js',
  'wasm/packages/contracts/src/crypto/contracts.js',
  'wasm/packages/contracts/src/jwt/contracts.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js',
  'wasm/packages/runtime-core-as/src/compiler/crypto-guest-source.js',
  'wasm/test/jwt/jwt-es256-conformance-corpus.json',
  'wasm/test/jwt/assert-jwt-es256-composition.cjs',
  'wasm/test/jwt/README.md',
  'wasm/test/suite/registry.cjs'
]);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g3');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT G3 option: ${argv[index]}`);
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
  return Object.freeze({ file: relative, bytes: bytes.length, sha256: sha256(bytes) });
}

function runStage(id, command, args, timeoutMs = 180_000) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${id} failed${detail ? `\n${detail}` : ''}`, { cause: result.error });
  }
  return Object.freeze({
    id,
    status: 'passed',
    durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n)
  });
}

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function claims(overrides = {}) {
  return JSON.stringify({
    sub: SUBJECT,
    iat: NOW - 10,
    exp: NOW + 60,
    roles: ['member'],
    ...overrides
  });
}

function signInput(signingInput) {
  return crypto.sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363'
  });
}

function compact(headerText, claimsText, signature) {
  const signingInput = `${b64(headerText)}.${b64(claimsText)}`;
  const bytes = signature || signInput(signingInput);
  return Object.freeze({
    token: `${signingInput}.${b64(bytes)}`,
    signingInput,
    signature: Buffer.from(bytes)
  });
}

function withSignature(fixture, signature) {
  return `${fixture.signingInput}.${b64(signature)}`;
}

function mutateByte(value) {
  const output = Buffer.from(value);
  output[0] ^= 0x80;
  return output;
}

function keyOptions(key = PUBLIC_JWK) {
  return Object.freeze({
    algorithms: Object.freeze(['ES256']),
    key: Object.freeze({ type: 'jwk', key })
  });
}

function jwksOptions(keys) {
  return Object.freeze({
    algorithms: Object.freeze(['ES256']),
    key: Object.freeze({ type: 'jwks', keys: Object.freeze(keys) })
  });
}

function makeOtherJwk(kid = 'other') {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  return Object.freeze({
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x,
    y: jwk.y,
    alg: 'ES256',
    use: 'sig',
    key_ops: Object.freeze(['verify']),
    ...(kid === undefined ? {} : { kid })
  });
}

function makeMaximumToken() {
  const targetSigningInputBytes = 16_384 - 1 - 86;
  for (let headerSpaces = 0; headerSpaces < 4; headerSpaces += 1) {
    const header = `{"alg":"ES256","typ":"JWT","kid":"g3-key"${' '.repeat(headerSpaces)}}`;
    for (let paddingBytes = 12_000; paddingBytes < 12_300; paddingBytes += 1) {
      const body = JSON.stringify({ sub: SUBJECT, pad: 'x'.repeat(paddingBytes) });
      const fixture = compact(header, body);
      if (Buffer.byteLength(fixture.signingInput) === targetSigningInputBytes) {
        assert.equal(Buffer.byteLength(fixture.token), 16_384);
        return fixture;
      }
    }
  }
  throw new Error('Could not construct the exact maximum-size compact JWT fixture.');
}

function errorSnapshot(error) {
  return Object.freeze({
    code: error && error.code,
    category: error && error.detail && error.detail.category,
    automaticFallback: error && error.detail && error.detail.automaticFallback
  });
}

async function executePackageCorpus(jwtRuntime, cryptoRuntime, corpus) {
  const results = [];
  const valid = compact(
    '{"typ":"JWT","kid":"g3-key","alg":"ES256"}',
    claims()
  );
  const noKid = compact('{"alg":"ES256","typ":"JWT"}', claims());
  const other = makeOtherJwk('other');
  const otherWithoutKid = makeOtherJwk(undefined);

  async function verifyCase(id, input, expected, controls = {}) {
    const order = [];
    const sensitive = [];
    let clockCalls = 0;
    let schemaCalls = 0;
    let caught;
    let output;
    const host = Object.freeze({
      captureWallClock() {
        clockCalls += 1;
        order.push('clock');
        return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
      },
      ...(controls.schema
        ? {
            validateClaims(schemaId, value) {
              schemaCalls += 1;
              order.push('schema');
              assert.equal(schemaId, 'auth.AccessClaims');
              return Object.freeze({ sub: value.sub, roles: value.roles });
            }
          }
        : {}),
      registerSensitiveValue(value) {
        sensitive.push(value);
      }
    });
    const selectedCrypto = controls.crypto || cryptoRuntime.crypto;
    const cryptoVerifier = controls.observeCrypto
      ? Object.freeze({
          signature: Object.freeze({
            async verify(request) {
              order.push('crypto');
              return selectedCrypto.signature.verify(request);
            }
          })
        })
      : selectedCrypto;
    try {
      output = await jwtRuntime.verifyJwtWithCrypto(input, host, cryptoVerifier);
    } catch (error) {
      caught = error;
    }
    if (expected === 'valid') {
      assert.equal(caught, undefined, `${id} unexpectedly failed`);
      assert.equal(output.protectedHeader.alg, 'ES256');
    } else {
      assert.equal(errorSnapshot(caught).code, expected, `${id} used the wrong status`);
    }
    const row = Object.freeze({
      id,
      status: 'passed',
      expected,
      observed: caught ? errorSnapshot(caught).code : 'valid'
    });
    results.push(row);
    return Object.freeze({
      row,
      order: Object.freeze(order),
      clockCalls,
      schemaCalls,
      sensitive: Object.freeze(sensitive),
      error: caught,
      output
    });
  }

  await verifyCase(
    'valid-inline-jwk',
    { token: valid.token, options: keyOptions() },
    'valid'
  );
  await verifyCase(
    'valid-bounded-jwks-kid',
    { token: valid.token, options: jwksOptions([other, PUBLIC_JWK]) },
    'valid'
  );
  await verifyCase(
    'missing-kid',
    { token: noKid.token, options: jwksOptions([PUBLIC_JWK, other]) },
    'PULSE_JWT_KEY_INVALID'
  );
  await verifyCase(
    'unknown-kid',
    {
      token: compact('{"alg":"ES256","typ":"JWT","kid":"unknown"}', claims()).token,
      options: jwksOptions([PUBLIC_JWK, other])
    },
    'PULSE_JWT_KEY_INVALID'
  );
  await verifyCase(
    'duplicate-kid',
    { token: valid.token, options: jwksOptions([PUBLIC_JWK, { ...other, kid: 'g3-key' }]) },
    'PULSE_JWT_KEY_INVALID'
  );
  await verifyCase(
    'ambiguous-key',
    {
      token: noKid.token,
      options: jwksOptions([
        { ...PUBLIC_JWK, kid: undefined },
        otherWithoutKid
      ])
    },
    'PULSE_JWT_KEY_INVALID'
  );

  const keyCases = [
    ['jwk-alg-mismatch', { ...PUBLIC_JWK, alg: 'RS256' }],
    ['jwk-kty-mismatch', { kty: 'RSA', n: 'AQ', e: 'AQAB', alg: 'ES256' }],
    ['jwk-wrong-curve', { ...PUBLIC_JWK, crv: 'P-384' }],
    ['jwk-missing-x', Object.fromEntries(Object.entries(PUBLIC_JWK).filter(([name]) => name !== 'x'))],
    ['jwk-missing-y', Object.fromEntries(Object.entries(PUBLIC_JWK).filter(([name]) => name !== 'y'))],
    ['jwk-invalid-base64url', { ...PUBLIC_JWK, x: '*' }],
    ['jwk-short-coordinate', { ...PUBLIC_JWK, x: b64(Buffer.alloc(31, 1)) }],
    ['jwk-long-coordinate', { ...PUBLIC_JWK, y: b64(Buffer.alloc(33, 1)) }],
    ['jwk-private-member', { ...PUBLIC_JWK, d: ES256_D }],
    ['jwk-certificate-member', { ...PUBLIC_JWK, x5c: ['certificate-data'] }]
  ];
  for (const [id, key] of keyCases) {
    await verifyCase(
      id,
      { token: valid.token, options: keyOptions(key) },
      'PULSE_JWT_KEY_INVALID'
    );
  }
  await verifyCase(
    'invalid-p256-point',
    {
      token: valid.token,
      options: keyOptions({
        ...PUBLIC_JWK,
        x: b64(Buffer.alloc(32)),
        y: b64(Buffer.alloc(32))
      })
    },
    'PULSE_JWT_KEY_INVALID'
  );

  const scalarOne = Buffer.alloc(32);
  scalarOne[31] = 1;
  const signatureCases = [
    ['short-signature', Buffer.alloc(63, 1)],
    ['long-signature', Buffer.alloc(65, 1)],
    [
      'der-signature',
      crypto.sign('sha256', Buffer.from(valid.signingInput, 'ascii'), PRIVATE_KEY)
    ],
    ['zero-r', Buffer.concat([Buffer.alloc(32), scalarOne])],
    ['out-of-range-r', Buffer.concat([P256_ORDER, scalarOne])],
    ['zero-s', Buffer.concat([scalarOne, Buffer.alloc(32)])],
    ['out-of-range-s', Buffer.concat([scalarOne, P256_ORDER])]
  ];
  for (const [id, signature] of signatureCases) {
    await verifyCase(
      id,
      { token: withSignature(valid, signature), options: keyOptions() },
      'PULSE_JWT_MALFORMED'
    );
  }
  const wrongSignature = mutateByte(valid.signature);
  await verifyCase(
    'wrong-signature',
    { token: withSignature(valid, wrongSignature), options: keyOptions() },
    'PULSE_JWT_SIGNATURE_INVALID'
  );
  let selectedKeyAttempts = 0;
  let macAccessorCalls = 0;
  const selectedKeyCrypto = {
    signature: Object.freeze({
      verify() {
        selectedKeyAttempts += 1;
        return Object.freeze({ status: 'invalid-authenticator' });
      }
    })
  };
  Object.defineProperty(selectedKeyCrypto, 'mac', {
    enumerable: true,
    get() {
      macAccessorCalls += 1;
      throw new Error('ES256 must not inspect an alternate algorithm seam.');
    }
  });
  await verifyCase(
    'selected-key-failure-no-retry',
    {
      token: valid.token,
      options: jwksOptions([PUBLIC_JWK, other])
    },
    'PULSE_JWT_SIGNATURE_INVALID',
    { crypto: selectedKeyCrypto }
  );
  assert.equal(selectedKeyAttempts, 1);
  assert.equal(macAccessorCalls, 0);
  const [headerSegment, payloadSegment, signatureSegment] = valid.token.split('.');
  await verifyCase(
    'mutated-header',
    {
      token: `${b64('{ "typ":"JWT","kid":"g3-key","alg":"ES256" }')}.${payloadSegment}.${signatureSegment}`,
      options: keyOptions()
    },
    'PULSE_JWT_SIGNATURE_INVALID'
  );
  await verifyCase(
    'mutated-payload',
    {
      token: `${headerSegment}.${b64(claims({ sub: 'mutated-subject' }))}.${signatureSegment}`,
      options: keyOptions()
    },
    'PULSE_JWT_SIGNATURE_INVALID'
  );

  const maximum = makeMaximumToken();
  await verifyCase(
    'maximum-signing-input',
    { token: maximum.token, options: keyOptions() },
    'valid'
  );
  await verifyCase(
    'over-limit-token',
    { token: `${maximum.token}A`, options: keyOptions() },
    'PULSE_JWT_LIMIT_EXCEEDED'
  );

  const expired = compact(
    '{"alg":"ES256","typ":"JWT","kid":"g3-key"}',
    claims({ exp: NOW })
  );
  const registered = await verifyCase(
    'registered-claim-order',
    { token: expired.token, options: keyOptions() },
    'PULSE_JWT_CLAIMS_INVALID',
    { observeCrypto: true, schema: true }
  );
  assert.deepEqual(registered.order, ['crypto', 'clock']);
  results[results.length - 1] = Object.freeze({
    id: 'registered-claim-order',
    status: 'passed',
    expected: 'crypto-clock',
    observed: registered.order.join('-')
  });

  const schema = await verifyCase(
    'schema-order',
    {
      token: valid.token,
      options: { ...keyOptions(), claimsSchema: 'auth.AccessClaims' }
    },
    'valid',
    { observeCrypto: true, schema: true }
  );
  assert.deepEqual(schema.order, ['crypto', 'clock', 'schema']);
  results[results.length - 1] = Object.freeze({
    id: 'schema-order',
    status: 'passed',
    expected: 'crypto-clock-schema',
    observed: schema.order.join('-')
  });

  const unavailable = await verifyCase(
    'claims-unavailable-before-authenticity',
    {
      token: withSignature(valid, wrongSignature),
      options: { ...keyOptions(), claimsSchema: 'auth.AccessClaims' }
    },
    'PULSE_JWT_SIGNATURE_INVALID',
    { observeCrypto: true, schema: true }
  );
  assert.equal(unavailable.clockCalls, 0);
  assert.equal(unavailable.schemaCalls, 0);
  assert.equal(unavailable.sensitive.includes(SUBJECT), false);

  const redacted = await verifyCase(
    'redacted-stable-diagnostics',
    { token: withSignature(valid, wrongSignature), options: keyOptions() },
    'PULSE_JWT_SIGNATURE_INVALID'
  );
  const serializedError = [
    String(redacted.error),
    JSON.stringify(redacted.error),
    redacted.error && redacted.error.stack
  ].join('\n');
  for (const forbidden of [valid.token, SUBJECT, ES256_X, ES256_Y, ES256_D, b64(valid.signature)]) {
    assert.equal(serializedError.includes(forbidden), false);
  }
  results[results.length - 1] = Object.freeze({
    id: 'redacted-stable-diagnostics',
    status: 'passed',
    expected: 'redacted',
    observed: 'redacted'
  });

  const realization = await verifyCase(
    'realization-failure-distinct',
    { token: valid.token, options: keyOptions() },
    'PULSE_JWT_OPERATION_FAILED',
    {
      crypto: Object.freeze({
        signature: Object.freeze({
          verify() {
            return Object.freeze({ status: 'realization-failure' });
          }
        })
      })
    }
  );
  assert.deepEqual(errorSnapshot(realization.error), {
    code: 'PULSE_JWT_OPERATION_FAILED',
    category: 'crypto-realization',
    automaticFallback: false
  });

  return Object.freeze({
    results: Object.freeze(results),
    fixtures: Object.freeze({
      valid,
      wrongToken: withSignature(valid, wrongSignature),
      invalidPoint: Object.freeze({
        ...PUBLIC_JWK,
        x: b64(Buffer.alloc(32)),
        y: b64(Buffer.alloc(32))
      }),
      maximumSigningInputBytes: Buffer.byteLength(maximum.signingInput),
      maximumTokenBytes: Buffer.byteLength(maximum.token)
    }),
    failClosed: Object.freeze({
      claimsUnavailableBeforeAuthenticity: true,
      registeredClaimsBeforeSchema: true,
      realizationFailureDistinct: true,
      stableDiagnosticCategories: true,
      automaticFallback: false
    })
  });
}

function nativeSource(jwk) {
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['ES256'],
    key: { type: 'jwk', key: ${JSON.stringify(jwk)} }
  })
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg)
}
`;
}

function compileNative(jwk) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-g3-'));
  fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'tsconfig.json'),
    '{"compilerOptions":{"baseUrl":"."}}\n'
  );
  const entryFile = path.join(tempRoot, 'src', 'index.ts');
  fs.writeFileSync(entryFile, nativeSource(jwk));
  const project = compileCanonicalProject(entryFile, {
    rootDir: tempRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(tempRoot, 'tsconfig.json'),
    packageTargetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    applicationProjectMetadata: {
      selectedProfile: { name: 'g3', source: 'fixture' },
      strict: true,
      target: 'native',
      host: 'node',
      projectHash: '3'.repeat(64),
      configPlanHash: '4'.repeat(64),
      bindings: { config: [], secret: [] },
      fragments: {},
      crypto: {
        source: 'profile',
        declaration: cryptoContracts.normalizeCryptoConfiguration({
          ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' }
        })
      }
    }
  });
  assert.equal(project.diagnostics.some((entry) => entry.severity === 'error'), false);
  const plan = buildCanonicalNativePlan(project);
  const compiled = compileCanonicalNativePlan(plan, {
    cwd: repoRoot,
    projectRoot: repoRoot,
    targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
    profile: 'g3',
    timeoutMs: 180_000,
    synchronizedPackages: [
      { name: '@pulse-compute/crypto', version: '1.0.0-beta.1' },
      { name: '@pulse-compute/jwt', version: '1.0.0-beta.1' }
    ]
  });
  return Object.freeze({ project, plan, compiled });
}

async function nativeAttempt(compiled, token) {
  let clockCalls = 0;
  try {
    const execution = await executeCanonicalNativeModule(compiled, {
      providerAdapter: createNodeProviderAdapter(),
      captureJwtWallClock() {
        clockCalls += 1;
        return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
      },
      request: {
        path: '/',
        headers: [['authorization', `Bearer ${token}`]]
      }
    });
    return Object.freeze({
      status: 'valid',
      responseStatus: execution.response.status,
      responseBody: execution.response.body,
      clockCalls,
      trace: execution.trace
    });
  } catch (error) {
    return Object.freeze({
      status: error && error.code,
      clockCalls,
      serialized: `${String(error)}\n${JSON.stringify(error && error.detail)}\n${JSON.stringify(error && error.execution)}`
    });
  }
}

async function executeNativeCorpus(fixtures) {
  const validFixture = compileNative(PUBLIC_JWK);
  const valid = await nativeAttempt(validFixture.compiled, fixtures.valid.token);
  assert.deepEqual(
    {
      status: valid.status,
      responseStatus: valid.responseStatus,
      responseBody: valid.responseBody,
      clockCalls: valid.clockCalls
    },
    {
      status: 'valid',
      responseStatus: 200,
      responseBody: `${SUBJECT}:ES256`,
      clockCalls: 1
    }
  );
  const trace = JSON.stringify(valid.trace);
  for (const forbidden of [
    fixtures.valid.token,
    SUBJECT,
    ES256_X,
    ES256_Y,
    ES256_D,
    b64(fixtures.valid.signature)
  ]) assert.equal(trace.includes(forbidden), false);

  const wrong = await nativeAttempt(validFixture.compiled, fixtures.wrongToken);
  assert.equal(wrong.status, 'PULSE_JWT_SIGNATURE_INVALID');
  assert.equal(wrong.clockCalls, 0);

  const invalidPointFixture = compileNative(fixtures.invalidPoint);
  const invalidPoint = await nativeAttempt(
    invalidPointFixture.compiled,
    fixtures.valid.token
  );
  assert.equal(invalidPoint.status, 'PULSE_JWT_KEY_INVALID');
  assert.equal(invalidPoint.clockCalls, 0);

  const compiled = validFixture.compiled;
  assert.equal(compiled.guestUnits.length, 1);
  assert.equal(compiled.guestLink.report.status, 'passed');
  assert.equal(compiled.guestLink.audit.status, 'passed');
  assert.equal(compiled.guestLink.providerPackaging.authorized, true);
  assert.equal(
    compiled.inspection.exports.some(
      (entry) => entry.name === 'pulse_crypto_es256_verify'
    ),
    true
  );
  assert.equal(
    compiled.inspection.imports.some(
      (entry) => entry.module === 'pulse_crypto_es256'
    ),
    false
  );
  assert.equal(compiled.realizationArtifacts.length, 1);

  return Object.freeze({
    results: Object.freeze([
      Object.freeze({
        id: 'native-valid',
        status: 'passed',
        expected: 'valid',
        observed: valid.status
      }),
      Object.freeze({
        id: 'native-wrong-signature',
        status: 'passed',
        expected: 'PULSE_JWT_SIGNATURE_INVALID',
        observed: wrong.status
      }),
      Object.freeze({
        id: 'native-invalid-point',
        status: 'passed',
        expected: 'PULSE_JWT_KEY_INVALID',
        observed: invalidPoint.status
      })
    ]),
    composition: Object.freeze({
      realization: compiled.manifest.crypto.algorithms[0].realization,
      implementation: compiled.manifest.crypto.algorithms[0].implementation,
      guestUnitId: compiled.guestUnits[0].id,
      guestLinkStatus: compiled.guestLink.report.status,
      finalWasmAuditStatus: compiled.guestLink.audit.status,
      providerPackagingAuthorized: compiled.guestLink.providerPackaging.authorized,
      finalArtifactBytes: compiled.wasm.length,
      finalArtifactSha256: compiled.inspection.sha256,
      guestArtifactSha256: compiled.guestLink.report.units[0].artifactSha256,
      finalExportPresent: true,
      unresolvedGuestImport: false,
      automaticFallback: false
    })
  });
}

async function executeNodeJavascriptAdapter(fixtures) {
  let clockCalls = 0;
  const redacted = [];
  const verify = createNodeJavascriptJwtVerify({
    captureWallClock() {
      clockCalls += 1;
      return Object.freeze({ unixEpochSeconds: NOW, trusted: true });
    }
  });
  const effect = (token) => Object.freeze({
    ...jwtContracts.JWT_VERIFY_OPERATION,
    id: 'jwt-g3-node-javascript',
    payload: Object.freeze({
      token,
      options: keyOptions()
    })
  });
  const execution = Object.freeze({
    registerRedactionValue(value) {
      redacted.push(value);
    }
  });
  const valid = await verify(effect(fixtures.valid.token), execution);
  assert.equal(valid.protectedHeader.alg, 'ES256');
  assert.equal(valid.claims.sub, SUBJECT);
  assert.equal(clockCalls, 1);
  assert.equal(redacted.includes(fixtures.valid.token), true);
  assert.equal(redacted.includes(SUBJECT), true);

  let caught;
  try {
    await verify(effect(fixtures.wrongToken), execution);
  } catch (error) {
    caught = error;
  }
  assert.equal(errorSnapshot(caught).code, 'PULSE_JWT_SIGNATURE_INVALID');
  assert.equal(clockCalls, 1);
  return Object.freeze({
    status: 'passed',
    valid: 'valid',
    invalid: 'PULSE_JWT_SIGNATURE_INVALID',
    realization: 'runtime-builtin',
    implementation: 'webcrypto.subtle.ecdsa-p256-sha-256.v1',
    automaticFallback: false
  });
}

function validateCorpus(corpus, results) {
  assert.equal(corpus.version, CORPUS_VERSION);
  assert.equal(corpus.extends, 'pulse.jwt-conformance-corpus.e0.v1');
  assert.equal(corpus.algorithm, 'ES256');
  assert.equal(corpus.semanticOwner, '@pulse-compute/crypto');
  assert.equal(corpus.automaticFallback, false);
  assert.deepEqual(corpus.resourceLimits, {
    jwksKeysMaximum: 16,
    coordinateBytes: 32,
    publicKeyBytes: 64,
    signatureBytes: 64,
    guestSigningInputBytesMaximum: 16_340,
    compactTokenBytesMaximum: 16_384
  });
  assert.deepEqual(
    results.map((entry) => entry.id),
    corpus.cases.map((entry) => entry.id)
  );
  assert.equal(new Set(results.map((entry) => entry.id)).size, results.length);
  assert.equal(results.every((entry) => entry.status === 'passed'), true);
}

function assertSourceBoundaries() {
  const jwtVerifier = fs.readFileSync(
    path.join(repoRoot, 'packages/jwt/src/crypto-verifier.ts'),
    'utf8'
  );
  const cryptoRealization = fs.readFileSync(
    path.join(repoRoot, 'packages/crypto/src/internal/realization.ts'),
    'utf8'
  );
  assert.match(jwtVerifier, /cryptoSignatureVerify/);
  assert.match(jwtVerifier, /normalizeEs256JoseVerifyRequest/);
  assert.doesNotMatch(jwtVerifier, /subtle|WebCrypto|pulse_crypto_es256_verify/);
  assert.match(cryptoRealization, /subtle\.importKey/);
  assert.match(cryptoRealization, /subtle\.verify/);
  assert.match(jwtVerifier, /automaticFallback: false/);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const stages = [];
  stages.push(runStage(
    'typescript-build',
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-b', 'packages/crypto', 'packages/jwt']
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
    ]
  ));

  assertSourceBoundaries();
  const corpusBytes = fs.readFileSync(corpusFile);
  const corpus = JSON.parse(corpusBytes);
  const jwtRuntime = await import(pathToFileURL(
    path.join(repoRoot, 'packages/jwt/dist/provider.js')
  ));
  const cryptoRuntime = await import(pathToFileURL(
    path.join(repoRoot, 'packages/crypto/dist/index.js')
  ));
  const packageResult = await executePackageCorpus(jwtRuntime, cryptoRuntime, corpus);
  const javascriptAdapter = await executeNodeJavascriptAdapter(packageResult.fixtures);
  const nativeResult = await executeNativeCorpus(packageResult.fixtures);
  const results = Object.freeze([
    ...packageResult.results,
    ...nativeResult.results
  ]);
  validateCorpus(corpus, results);

  const compositionReport = Object.freeze({
    version: 'pulse.jwt-es256-crypto-composition-report.g3.v1',
    status: 'passed',
    semanticOwner: '@pulse-compute/crypto',
    algorithm: 'ES256',
    request: Object.freeze({
      keyType: 'p256-public-key-bytes',
      keyBytes: 64,
      signatureEncoding: 'jose-r-s-big-endian',
      signatureBytes: 64,
      exactOriginalSigningInput: true
    }),
    javascript: javascriptAdapter,
    native: nativeResult.composition,
    statuses: Object.freeze([
      'valid',
      'invalid-authenticator',
      'invalid-key',
      'invalid-input',
      'realization-failure'
    ]),
    automaticFallback: false
  });
  const keyResults = results.filter((entry) => (
    corpus.cases.find((item) => item.id === entry.id).kind === 'key-selection'
    || corpus.cases.find((item) => item.id === entry.id).kind === 'key-normalization'
  ));
  const keyReport = Object.freeze({
    version: 'pulse.jwt-es256-key-normalization-report.g3.v1',
    status: 'passed',
    mode: 'bounded-static-inline',
    jwksKeysMaximum: 16,
    selection: 'kid-exact-or-single-eligible-key',
    duplicateKid: 'reject-entire-set',
    remoteDiscovery: false,
    fetch: false,
    cache: false,
    refresh: false,
    privateMembersRejected: true,
    certificateMembersRejected: true,
    cases: Object.freeze(keyResults)
  });
  const corpusReport = Object.freeze({
    version: 'pulse.jwt-es256-corpus-report.g3.v1',
    status: 'passed',
    corpusVersion: corpus.version,
    extends: corpus.extends,
    corpusFileSha256: sha256(corpusBytes),
    caseCount: results.length,
    cases: results,
    resourceLimits: corpus.resourceLimits,
    automaticFallback: false
  });
  const failClosedReport = Object.freeze({
    version: 'pulse.jwt-es256-fail-closed-audit.g3.v1',
    status: 'passed',
    ...packageResult.failClosed,
    exactOriginalSigningInput: true,
    signatureDecodedOnce: true,
    derAccepted: false,
    selectedKeyRetry: false,
    runtimeDetection: false,
    backendFallback: false,
    reportsContainSensitiveMaterial: false
  });

  const reportFiles = [
    ['es256-crypto-composition-report.json', compositionReport],
    ['es256-key-normalization-report.json', keyReport],
    ['es256-jwt-corpus-report.json', corpusReport],
    ['es256-fail-closed-audit.json', failClosedReport]
  ];
  for (const [name, report] of reportFiles) {
    fs.writeFileSync(path.join(options.outputDirectory, name), stableJson(report));
  }
  const forbiddenReportValues = [
    SUBJECT,
    ES256_X,
    ES256_Y,
    ES256_D,
    packageResult.fixtures.valid.token,
    b64(packageResult.fixtures.valid.signature)
  ];
  for (const [name] of reportFiles) {
    const text = fs.readFileSync(path.join(options.outputDirectory, name), 'utf8');
    for (const forbidden of forbiddenReportValues) {
      assert.equal(text.includes(forbidden), false, `${name} contains sensitive fixture material`);
    }
  }

  const evidence = Object.freeze({
    version: 'pulse.jwt-g3-evidence.v1',
    checkpoint: 'G3',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    stages,
    reports: Object.freeze(reportFiles.map(([name]) => {
      const bytes = fs.readFileSync(path.join(options.outputDirectory, name));
      return Object.freeze({ file: name, bytes: bytes.length, sha256: sha256(bytes) });
    })),
    sources: Object.freeze(SOURCE_FILES.map(fileRecord)),
    acceptance: Object.freeze({
      cryptoOwnedSignatureSeam: true,
      boundedDeterministicJwkAndJwks: true,
      fixedWidthGuestInputs: true,
      javascriptNativeSharedStatuses: true,
      claimsUnavailableBeforeAuthenticity: true,
      distinctFailureClasses: true,
      sensitiveReports: false,
      hs256PackageRegression: true,
      runtimeDetection: false,
      automaticFallback: false
    })
  });
  const evidenceFile = path.join(options.outputDirectory, 'jwt-g3-evidence.json');
  fs.writeFileSync(evidenceFile, stableJson(evidence));
  const evidenceText = fs.readFileSync(evidenceFile, 'utf8');
  for (const forbidden of forbiddenReportValues) {
    assert.equal(evidenceText.includes(forbidden), false);
  }
  process.stdout.write(`${stableJson({
    checkpoint: 'G3',
    status: 'passed',
    corpusCases: results.length,
    nativeArtifactSha256: nativeResult.composition.finalArtifactSha256,
    evidence: path.relative(repoRoot, evidenceFile).replace(/\\/g, '/')
  })}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  CORPUS_VERSION,
  NOW,
  PUBLIC_JWK,
  SUBJECT,
  compileNative,
  executePackageCorpus,
  executeNodeJavascriptAdapter,
  keyOptions,
  jwksOptions,
  nativeAttempt
});
