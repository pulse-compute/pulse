'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const corpusFile = path.join(__dirname, 'jwt-es256-conformance-corpus.json');
const CORPUS_VERSION = 'pulse.jwt-conformance-corpus.g3.v1';
const HARNESS_VERSION = 'pulse.jwt-es256-conformance-harness.g4.v1';
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
const OTHER_JWK = Object.freeze({
  kty: 'EC',
  crv: 'P-256',
  x: 'qFHAip2VC_Et56lukn2N6TFcBop06AWCwGJphRG1wY8',
  y: 'qnUnmGtMO440t8XCg27HvDzL9slqNUyYjQnbuGcK5VA',
  alg: 'ES256',
  use: 'sig',
  key_ops: Object.freeze(['verify']),
  kid: 'other'
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
const FASTLY_PLANNING_CASE_IDS = Object.freeze([
  'duplicate-kid',
  'jwk-alg-mismatch',
  'jwk-kty-mismatch',
  'jwk-wrong-curve',
  'jwk-missing-x',
  'jwk-missing-y',
  'jwk-invalid-base64url',
  'jwk-short-coordinate',
  'jwk-long-coordinate',
  'jwk-private-member',
  'jwk-certificate-member'
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
}

function semanticHash(corpus) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalValue(corpus)))
    .digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function loadEs256ConformanceCorpus(file = corpusFile) {
  const bytes = fs.readFileSync(file);
  const corpus = JSON.parse(bytes.toString('utf8'));
  assert.equal(corpus.version, CORPUS_VERSION);
  assert.equal(corpus.algorithm, 'ES256');
  assert.equal(corpus.semanticOwner, '@pulse-compute/crypto');
  assert.equal(corpus.automaticFallback, false);
  assert.equal(corpus.cases.length, 38);
  assert.equal(new Set(corpus.cases.map((entry) => entry.id)).size, 38);
  return Object.freeze({
    corpus: deepFreeze(corpus),
    file,
    bytes: bytes.byteLength,
    fileSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    semanticHash: semanticHash(corpus)
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

function compact(headerText, claimsText, signature) {
  const signingInput = `${b64(headerText)}.${b64(claimsText)}`;
  const authenticator = signature || crypto.sign(
    'sha256',
    Buffer.from(signingInput, 'ascii'),
    { key: PRIVATE_KEY, dsaEncoding: 'ieee-p1363' }
  );
  return Object.freeze({
    token: `${signingInput}.${b64(authenticator)}`,
    signingInput,
    signature: Buffer.from(authenticator)
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

function keyOptions(key = PUBLIC_JWK, claimsSchema) {
  return Object.freeze({
    algorithms: Object.freeze(['ES256']),
    key: Object.freeze({ type: 'jwk', key }),
    ...(claimsSchema ? { claimsSchema } : {})
  });
}

function jwksOptions(keys) {
  return Object.freeze({
    algorithms: Object.freeze(['ES256']),
    key: Object.freeze({ type: 'jwks', keys: Object.freeze(keys) })
  });
}

function maximumToken() {
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
  throw new Error('Could not construct the exact maximum-size ES256 fixture.');
}

function expectedStatus(expected) {
  if (expected === 'valid' || expected === 'crypto-clock-schema') return 'valid';
  if (expected === 'crypto-clock') return 'PULSE_JWT_CLAIMS_INVALID';
  if (expected === 'redacted') return 'PULSE_JWT_SIGNATURE_INVALID';
  return expected;
}

function materializeEs256ConformanceCases(loaded = loadEs256ConformanceCorpus()) {
  const corpus = loaded.corpus || loaded;
  const valid = compact(
    '{"typ":"JWT","kid":"g3-key","alg":"ES256"}',
    claims()
  );
  const noKid = compact('{"alg":"ES256","typ":"JWT"}', claims());
  const wrongSignature = mutateByte(valid.signature);
  const wrongToken = withSignature(valid, wrongSignature);
  const maximum = maximumToken();
  const expired = compact(
    '{"alg":"ES256","typ":"JWT","kid":"g3-key"}',
    claims({ exp: NOW })
  );
  const [headerSegment, payloadSegment, signatureSegment] = valid.token.split('.');
  const scalarOne = Buffer.alloc(32);
  scalarOne[31] = 1;
  const invalidPoint = Object.freeze({
    ...PUBLIC_JWK,
    x: b64(Buffer.alloc(32)),
    y: b64(Buffer.alloc(32))
  });
  const keyCases = Object.freeze({
    'jwk-alg-mismatch': Object.freeze({ ...PUBLIC_JWK, alg: 'RS256' }),
    'jwk-kty-mismatch': Object.freeze({
      kty: 'RSA',
      n: 'AQ',
      e: 'AQAB',
      alg: 'ES256'
    }),
    'jwk-wrong-curve': Object.freeze({ ...PUBLIC_JWK, crv: 'P-384' }),
    'jwk-missing-x': Object.freeze(
      Object.fromEntries(Object.entries(PUBLIC_JWK).filter(([name]) => name !== 'x'))
    ),
    'jwk-missing-y': Object.freeze(
      Object.fromEntries(Object.entries(PUBLIC_JWK).filter(([name]) => name !== 'y'))
    ),
    'jwk-invalid-base64url': Object.freeze({ ...PUBLIC_JWK, x: '*' }),
    'jwk-short-coordinate': Object.freeze({
      ...PUBLIC_JWK,
      x: b64(Buffer.alloc(31, 1))
    }),
    'jwk-long-coordinate': Object.freeze({
      ...PUBLIC_JWK,
      y: b64(Buffer.alloc(33, 1))
    }),
    'jwk-private-member': Object.freeze({ ...PUBLIC_JWK, d: ES256_D }),
    'jwk-certificate-member': Object.freeze({
      ...PUBLIC_JWK,
      x5c: Object.freeze(['certificate-data'])
    })
  });
  const signatures = Object.freeze({
    'short-signature': Buffer.alloc(63, 1),
    'long-signature': Buffer.alloc(65, 1),
    'der-signature': crypto.sign(
      'sha256',
      Buffer.from(valid.signingInput, 'ascii'),
      PRIVATE_KEY
    ),
    'zero-r': Buffer.concat([Buffer.alloc(32), scalarOne]),
    'out-of-range-r': Buffer.concat([P256_ORDER, scalarOne]),
    'zero-s': Buffer.concat([scalarOne, Buffer.alloc(32)]),
    'out-of-range-s': Buffer.concat([scalarOne, P256_ORDER])
  });
  const policies = Object.freeze({
    inline: keyOptions(),
    bounded: jwksOptions([OTHER_JWK, PUBLIC_JWK]),
    selection: jwksOptions([PUBLIC_JWK, OTHER_JWK]),
    ambiguous: jwksOptions([
      Object.freeze({ ...PUBLIC_JWK, kid: undefined }),
      Object.freeze({ ...OTHER_JWK, kid: undefined })
    ]),
    selectedFailure: jwksOptions([
      Object.freeze({ ...OTHER_JWK, kid: 'g3-key' }),
      Object.freeze({ ...PUBLIC_JWK, kid: 'actual-key' })
    ]),
    invalidPoint: keyOptions(invalidPoint),
    schema: keyOptions(PUBLIC_JWK, 'auth.AccessClaims')
  });
  const setup = {
    'valid-inline-jwk': [valid.token, policies.inline, 'inline'],
    'valid-bounded-jwks-kid': [valid.token, policies.bounded, 'bounded'],
    'missing-kid': [noKid.token, policies.selection, 'selection'],
    'unknown-kid': [
      compact('{"alg":"ES256","typ":"JWT","kid":"unknown"}', claims()).token,
      policies.selection,
      'selection'
    ],
    'duplicate-kid': [
      valid.token,
      jwksOptions([PUBLIC_JWK, Object.freeze({ ...OTHER_JWK, kid: 'g3-key' })]),
      'duplicate-kid'
    ],
    'ambiguous-key': [noKid.token, policies.ambiguous, 'ambiguous'],
    'invalid-p256-point': [valid.token, policies.invalidPoint, 'invalid-point'],
    'wrong-signature': [wrongToken, policies.inline, 'inline'],
    'selected-key-failure-no-retry': [
      valid.token,
      policies.selectedFailure,
      'selected-failure'
    ],
    'mutated-header': [
      `${b64('{ "typ":"JWT","kid":"g3-key","alg":"ES256" }')}.${payloadSegment}.${signatureSegment}`,
      policies.inline,
      'inline'
    ],
    'mutated-payload': [
      `${headerSegment}.${b64(claims({ sub: 'mutated-subject' }))}.${signatureSegment}`,
      policies.inline,
      'inline'
    ],
    'maximum-signing-input': [maximum.token, policies.inline, 'inline'],
    'over-limit-token': [`${maximum.token}A`, policies.inline, 'inline'],
    'registered-claim-order': [expired.token, policies.inline, 'inline'],
    'schema-order': [valid.token, policies.schema, 'schema'],
    'claims-unavailable-before-authenticity': [
      wrongToken,
      policies.schema,
      'schema'
    ],
    'redacted-stable-diagnostics': [wrongToken, policies.inline, 'inline'],
    'realization-failure-distinct': [valid.token, policies.inline, 'inline'],
    'native-valid': [valid.token, policies.inline, 'inline'],
    'native-wrong-signature': [wrongToken, policies.inline, 'inline'],
    'native-invalid-point': [valid.token, policies.invalidPoint, 'invalid-point']
  };
  for (const [id, key] of Object.entries(keyCases)) {
    setup[id] = [valid.token, keyOptions(key), id];
  }
  for (const [id, signature] of Object.entries(signatures)) {
    setup[id] = [withSignature(valid, signature), policies.inline, 'inline'];
  }
  const cases = corpus.cases.map((definition) => {
    const materialized = setup[definition.id];
    assert.ok(materialized, `Missing ES256 materialization for ${definition.id}`);
    return Object.freeze({
      id: definition.id,
      corpusKind: definition.kind,
      polarity: definition.polarity,
      expected: definition.expected,
      expectedStatus: expectedStatus(definition.expected),
      expectedOrder: definition.expected === 'crypto-clock'
        ? Object.freeze(['crypto', 'clock'])
        : definition.expected === 'crypto-clock-schema'
          ? Object.freeze(['crypto', 'clock', 'schema'])
          : undefined,
      fastlyEvaluation: FASTLY_PLANNING_CASE_IDS.includes(definition.id)
        ? 'planning'
        : 'runtime',
      variant: materialized[2],
      input: Object.freeze({
        token: materialized[0],
        options: materialized[1]
      }),
      forceRealizationFailure: definition.id === 'realization-failure-distinct',
      requireRedaction: definition.id === 'redacted-stable-diagnostics',
      requireClaimsUnavailable: definition.id === 'claims-unavailable-before-authenticity'
    });
  });
  assert.deepEqual(
    cases.map((entry) => entry.id),
    corpus.cases.map((entry) => entry.id)
  );
  return Object.freeze({
    version: HARNESS_VERSION,
    corpusVersion: corpus.version,
    corpusSemanticHash: loaded.semanticHash || semanticHash(corpus),
    cases: Object.freeze(cases),
    policies,
    fixtures: Object.freeze({
      valid,
      wrongToken,
      invalidPoint,
      maximumSigningInputBytes: Buffer.byteLength(maximum.signingInput),
      maximumTokenBytes: Buffer.byteLength(maximum.token)
    })
  });
}

function forbiddenSensitiveValues(materialized) {
  return Object.freeze([
    Object.freeze({ id: 'complete-token', value: materialized.fixtures.valid.token }),
    Object.freeze({
      id: 'authenticator',
      value: b64(materialized.fixtures.valid.signature)
    }),
    Object.freeze({ id: 'subject', value: SUBJECT }),
    Object.freeze({ id: 'jwk-x', value: ES256_X }),
    Object.freeze({ id: 'jwk-y', value: ES256_Y }),
    Object.freeze({ id: 'private-scalar', value: ES256_D })
  ]);
}

module.exports = Object.freeze({
  CORPUS_VERSION,
  HARNESS_VERSION,
  NOW,
  SUBJECT,
  PUBLIC_JWK,
  OTHER_JWK,
  FASTLY_PLANNING_CASE_IDS,
  loadEs256ConformanceCorpus,
  materializeEs256ConformanceCases,
  forbiddenSensitiveValues,
  expectedStatus
});
