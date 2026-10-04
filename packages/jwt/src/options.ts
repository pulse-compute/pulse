import { normalizeRsaPublicKey } from '@pulse-compute/crypto';
import { normalizeP256PublicKeyCoordinates } from '@pulse-compute/crypto';
import { jwtError } from './errors.js';
import {
  jwtDataRecord,
  jwtDenseArrayValues,
} from './internal/data.js';

export const JWT_ALGORITHMS = Object.freeze(['HS256', 'RS256', 'ES256', 'EdDSA'] as const);
export type JwtAlgorithm = typeof JWT_ALGORITHMS[number];

export type JwtJsonPrimitive = string | number | boolean | null;
export type JwtJsonValue =
  | JwtJsonPrimitive
  | readonly JwtJsonValue[]
  | { readonly [name: string]: JwtJsonValue };

export interface JwtClaims {
  readonly [name: string]: JwtJsonValue;
}

export interface JwtPublicJwk {
  readonly kty: string;
  readonly use?: string;
  readonly key_ops?: readonly string[];
  readonly alg?: string;
  readonly kid?: string;
  readonly ext?: boolean;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
  readonly x5c?: readonly string[];
  readonly x5t?: string;
  readonly 'x5t#S256'?: string;
}

export type JwtVerificationKey =
  | {
      readonly type: 'secret';
      readonly binding: string;
    }
  | {
      readonly type: 'jwk';
      readonly key: JwtPublicJwk;
    }
  | {
      readonly type: 'jwks';
      readonly keys: readonly JwtPublicJwk[];
    };

export interface JwtVerifyOptions {
  readonly algorithms: readonly JwtAlgorithm[];
  readonly key: JwtVerificationKey;
  readonly issuer?: string | readonly string[];
  readonly audience?: string | readonly string[];
  readonly subject?: string;
  readonly typ?: string;
  readonly clockToleranceSeconds?: number;
  readonly maxTokenAgeSeconds?: number;
  readonly requiredClaims?: readonly string[];
  readonly claimsSchema?: string;
}

export interface NormalizedJwtVerifyOptions {
  readonly algorithms: readonly JwtAlgorithm[];
  readonly key: JwtVerificationKey;
  readonly issuer?: string | readonly string[];
  readonly audience?: string | readonly string[];
  readonly subject?: string;
  readonly typ?: string;
  readonly clockToleranceSeconds?: number;
  readonly maxTokenAgeSeconds?: number;
  readonly requiredClaims?: readonly string[];
  readonly claimsSchema?: string;
}

const PRIVATE_JWK_MEMBERS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);
const JWK_MEMBERS = new Set([
  'kty', 'use', 'key_ops', 'alg', 'kid', 'ext',
  'n', 'e', 'crv', 'x', 'y', 'x5c', 'x5t', 'x5t#S256',
]);
const ES256_JWK_MEMBERS = new Set([
  'kty', 'crv', 'x', 'y', 'alg', 'use', 'key_ops', 'kid',
]);
const MAX_JWKS_KEYS = 16;
const MAX_REQUIRED_CLAIMS = 32;
const MAX_CLOCK_TOLERANCE_SECONDS = 300;
const MAX_TOKEN_AGE_SECONDS = 31_536_000;

/**
 * G0 contract freeze only. G3 owns making these rules executable.
 *
 * JWT owns public JWK/JWKS shape and deterministic key selection. The
 * crypto-owned adapter owns coordinate/signature decoding into fixed bytes.
 */
export const JWT_ES256_KEY_NORMALIZATION_CONTRACT = Object.freeze({
  version: 'pulse.jwt.es256-key-normalization.v1',
  status: 'executable-g3',
  algorithm: 'ES256',
  inlineJwk: Object.freeze({
    requiredMembers: Object.freeze(['kty', 'crv', 'x', 'y'] as const),
    optionalMembers: Object.freeze([
      'alg',
      'use',
      'key_ops',
      'kid',
    ] as const),
    exactValues: Object.freeze({
      kty: 'EC',
      crv: 'P-256',
      alg: 'absent-or-ES256',
      use: 'absent-or-sig',
      key_ops: 'absent-or-exactly-verify',
    }),
    coordinateEncoding: 'canonical-unpadded-base64url',
    coordinateBytes: 32,
    privateMembersRejected: true,
    unknownMembersRejected: true,
    certificateMembersRejected: true,
  }),
  jwks: Object.freeze({
    kind: 'bounded-static-inline',
    entriesMaximum: MAX_JWKS_KEYS,
    remoteDiscovery: false,
    fetch: false,
    cache: false,
    refresh: false,
    duplicateKid: 'reject-entire-set',
    selection: 'kid-exact-or-single-eligible-key',
    selectedKeyFailure: 'terminal-no-retry',
  }),
  cryptoAdapter: Object.freeze({
    publicKeyType: 'p256-public-key-bytes',
    publicKeyEncoding: 'x-y-big-endian',
    publicKeyBytes: 64,
    signatureEncoding: 'jose-r-s-big-endian',
    signatureBytes: 64,
    derAccepted: false,
    highS: 'accepted-if-otherwise-valid',
  }),
  exactSigningInput: true,
  claimsBeforeAuthenticity: false,
  automaticFallback: false,
} as const);

function requireKnownKeys(
  entries: ReadonlyMap<string, unknown>,
  allowed: ReadonlySet<string>,
  category: 'options' | 'key',
): void {
  if ([...entries.keys()].some((key) => !allowed.has(key))) {
    throw jwtError(category === 'key' ? 'PULSE_JWT_KEY_INVALID' : 'PULSE_JWT_OPERATION_FAILED', { category });
  }
}

function nonEmptyString(value: unknown, category: 'options' | 'key'): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw jwtError(category === 'key' ? 'PULSE_JWT_KEY_INVALID' : 'PULSE_JWT_OPERATION_FAILED', { category });
  }
  return value;
}

function arrayDataValues(
  value: unknown,
  category: 'options' | 'key',
): readonly unknown[] {
  const output = jwtDenseArrayValues(value);
  if (!output) {
    throw jwtError(
      category === 'key' ? 'PULSE_JWT_KEY_INVALID' : 'PULSE_JWT_OPERATION_FAILED',
      { category },
    );
  }
  return output;
}

function stringList(
  value: unknown,
  category: 'options' | 'key',
  maximum?: number,
): readonly string[] {
  const values = arrayDataValues(value, category);
  if (values.length === 0) {
    throw jwtError(category === 'key' ? 'PULSE_JWT_KEY_INVALID' : 'PULSE_JWT_OPERATION_FAILED', { category });
  }
  if (maximum !== undefined && values.length > maximum) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category,
      limit: maximum,
      actual: values.length,
    });
  }
  const normalized = values.map((entry) => nonEmptyString(entry, category));
  if (new Set(normalized).size !== normalized.length) {
    throw jwtError(category === 'key' ? 'PULSE_JWT_KEY_INVALID' : 'PULSE_JWT_OPERATION_FAILED', { category });
  }
  return Object.freeze(normalized);
}

function optionalStringOrList(
  value: unknown,
  category: 'options',
): string | readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return stringList(value, category);
  return nonEmptyString(value, category);
}

function integerOption(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: name });
  }
  if (Number(value) > maximum) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: name,
      limit: maximum,
      actual: Number(value),
    });
  }
  return Number(value);
}

function normalizeAlgorithms(value: unknown): readonly JwtAlgorithm[] {
  const values = arrayDataValues(value, 'options');
  if (values.length === 0) {
    throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', { category: 'algorithms' });
  }
  if (values.length > JWT_ALGORITHMS.length) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: 'algorithms',
      limit: JWT_ALGORITHMS.length,
      actual: values.length,
    });
  }
  const output = values.map((entry) => {
    if (typeof entry !== 'string' || !(JWT_ALGORITHMS as readonly string[]).includes(entry)) {
      throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', { category: 'algorithms' });
    }
    return entry as JwtAlgorithm;
  });
  if (new Set(output).size !== output.length) {
    throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', { category: 'algorithms' });
  }
  return Object.freeze(output);
}

function compatibleAlgorithm(jwk: JwtPublicJwk, algorithm: JwtAlgorithm): boolean {
  const record = jwtDataRecord(jwk);
  if (!record) return false;
  const keyAlgorithm = record.get('alg');
  const keyType = record.get('kty');
  const curve = record.get('crv');
  if (keyAlgorithm !== undefined && keyAlgorithm !== algorithm) return false;
  if (algorithm === 'RS256') return keyType === 'RSA';
  if (algorithm === 'ES256') return keyType === 'EC' && curve === 'P-256';
  if (algorithm === 'EdDSA') return keyType === 'OKP' && curve === 'Ed25519';
  return false;
}

function normalizePublicJwk(value: unknown): JwtPublicJwk {
  const record = jwtDataRecord(value);
  if (!record) throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  const declaredType = record.get('kty');
  if (
    [...record.keys()].some((key) => PRIVATE_JWK_MEMBERS.includes(key))
    || [...record.keys()].some((key) => (
      declaredType === 'RSA' ? !new Set(['kty', 'n', 'e', 'alg', 'use', 'key_ops', 'kid']).has(key)
        : declaredType === 'EC' ? !ES256_JWK_MEMBERS.has(key) : !JWK_MEMBERS.has(key)
    ))
  ) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  }

  const kty = nonEmptyString(record.get('kty'), 'key');
  const output: Record<string, unknown> = { kty };
  for (const name of ['use', 'alg', 'kid', 'n', 'e', 'crv', 'x', 'y', 'x5t', 'x5t#S256'] as const) {
    const entry = record.get(name);
    if (entry !== undefined) output[name] = nonEmptyString(entry, 'key');
  }
  const ext = record.get('ext');
  if (ext !== undefined) {
    if (typeof ext !== 'boolean') throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
    output.ext = ext;
  }
  const keyOperations = record.get('key_ops');
  if (keyOperations !== undefined) {
    const operations = stringList(keyOperations, 'key');
    if (!operations.includes('verify') || operations.some((operation) => operation !== 'verify')) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
    }
    output.key_ops = operations;
  }
  const certificateChain = record.get('x5c');
  if (certificateChain !== undefined) output.x5c = stringList(certificateChain, 'key');
  if (output.use !== undefined && output.use !== 'sig') {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  }

  if (kty === 'RSA') {
    if (typeof output.kid === 'string' && new TextEncoder().encode(output.kid).length > 256) throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key-kid' });
    const n = nonEmptyString(output.n, 'key'), e = nonEmptyString(output.e, 'key');
    const normalized = normalizeRsaPublicKey({ n, e });
    if (!normalized.ok || output.alg !== undefined && output.alg !== 'RS256') throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key-rsa' });
    normalized.key.bytes.fill(0);
  } else if (kty === 'EC') {
    if (output.crv !== 'P-256') throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
    const x = nonEmptyString(output.x, 'key');
    const y = nonEmptyString(output.y, 'key');
    if (output.alg !== undefined && output.alg !== 'ES256') {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'algorithm-key-mismatch' });
    }
    const normalized = normalizeP256PublicKeyCoordinates({ x, y });
    if (!normalized.ok) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key-coordinate' });
    }
    normalized.key.bytes.fill(0);
  } else if (kty === 'OKP') {
    if (output.crv !== 'Ed25519') throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
    nonEmptyString(output.x, 'key');
  } else {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  }

  if (output.alg !== undefined && !(JWT_ALGORITHMS as readonly string[]).includes(String(output.alg))) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  }
  return Object.freeze(output) as unknown as JwtPublicJwk;
}

function assertKeyAlgorithms(key: JwtVerificationKey, algorithms: readonly JwtAlgorithm[]): void {
  if (key.type === 'secret') {
    if (algorithms.some((algorithm) => algorithm !== 'HS256')) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'algorithm-key-mismatch' });
    }
    return;
  }

  if (algorithms.includes('HS256')) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'algorithm-key-mismatch' });
  }
  const keys = key.type === 'jwk' ? [key.key] : key.keys;
  if (algorithms.some((algorithm) => !keys.some((jwk) => compatibleAlgorithm(jwk, algorithm)))) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'algorithm-key-mismatch' });
  }
}

function normalizeKey(value: unknown, algorithms: readonly JwtAlgorithm[]): JwtVerificationKey {
  const record = jwtDataRecord(value);
  if (!record) throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
  const type = record.get('type');
  if (type === 'secret') {
    requireKnownKeys(record, new Set(['type', 'binding']), 'key');
    const key = Object.freeze({
      type,
      binding: nonEmptyString(record.get('binding'), 'key'),
    }) as JwtVerificationKey;
    assertKeyAlgorithms(key, algorithms);
    return key;
  }
  if (type === 'jwk') {
    requireKnownKeys(record, new Set(['type', 'key']), 'key');
    const key = Object.freeze({
      type,
      key: normalizePublicJwk(record.get('key')),
    }) as JwtVerificationKey;
    assertKeyAlgorithms(key, algorithms);
    return key;
  }
  if (type === 'jwks') {
    requireKnownKeys(record, new Set(['type', 'keys']), 'key');
    const keyValues = arrayDataValues(record.get('keys'), 'key');
    if (keyValues.length === 0) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
    }
    if (keyValues.length > MAX_JWKS_KEYS) {
      throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
        category: 'jwks',
        limit: MAX_JWKS_KEYS,
        actual: keyValues.length,
      });
    }
    const keys = Object.freeze(keyValues.map(normalizePublicJwk));
    const kids = keys.map((entry) => entry.kid).filter((kid): kid is string => kid !== undefined);
    if (new Set(kids).size !== kids.length) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'duplicate-kid' });
    }
    const key = Object.freeze({ type, keys }) as JwtVerificationKey;
    assertKeyAlgorithms(key, algorithms);
    return key;
  }
  throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'key' });
}

export function normalizeJwtVerifyOptions(value: JwtVerifyOptions): NormalizedJwtVerifyOptions {
  const record = jwtDataRecord(value);
  if (!record) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'options' });
  requireKnownKeys(record, new Set([
    'algorithms', 'key', 'issuer', 'audience', 'subject', 'typ',
    'clockToleranceSeconds', 'maxTokenAgeSeconds', 'requiredClaims', 'claimsSchema',
  ]), 'options');

  const algorithms = normalizeAlgorithms(record.get('algorithms'));
  const key = normalizeKey(record.get('key'), algorithms);
  const issuer = optionalStringOrList(record.get('issuer'), 'options');
  const audience = optionalStringOrList(record.get('audience'), 'options');
  const subjectValue = record.get('subject');
  const typValue = record.get('typ');
  const subject = subjectValue === undefined ? undefined : nonEmptyString(subjectValue, 'options');
  const typ = typValue === undefined ? undefined : nonEmptyString(typValue, 'options');
  const clockToleranceSeconds = integerOption(
    record.get('clockToleranceSeconds'),
    'clock-tolerance',
    0,
    MAX_CLOCK_TOLERANCE_SECONDS,
  );
  const maxTokenAgeSeconds = integerOption(
    record.get('maxTokenAgeSeconds'),
    'max-token-age',
    1,
    MAX_TOKEN_AGE_SECONDS,
  );
  const requiredClaimsValue = record.get('requiredClaims');
  const requiredClaims = requiredClaimsValue === undefined
    ? undefined
    : stringList(requiredClaimsValue, 'options', MAX_REQUIRED_CLAIMS);
  const claimsSchemaValue = record.get('claimsSchema');
  const claimsSchema = claimsSchemaValue === undefined
    ? undefined
    : nonEmptyString(claimsSchemaValue, 'options');

  return Object.freeze({
    algorithms,
    key,
    ...(issuer === undefined ? {} : { issuer }),
    ...(audience === undefined ? {} : { audience }),
    ...(subject === undefined ? {} : { subject }),
    ...(typ === undefined ? {} : { typ }),
    ...(clockToleranceSeconds === undefined ? {} : { clockToleranceSeconds }),
    ...(maxTokenAgeSeconds === undefined ? {} : { maxTokenAgeSeconds }),
    ...(requiredClaims === undefined ? {} : { requiredClaims }),
    ...(claimsSchema === undefined ? {} : { claimsSchema }),
  });
}

export function isJwkCompatibleWithAlgorithm(
  jwk: JwtPublicJwk,
  algorithm: JwtAlgorithm,
): boolean {
  return compatibleAlgorithm(jwk, algorithm);
}

export function selectEs256VerificationJwk(key: JwtVerificationKey, kid: string | undefined): JwtPublicJwk {
  return selectSignatureVerificationJwk(key, kid, 'ES256');
}

export function selectSignatureVerificationJwk(
  key: JwtVerificationKey, kid: string | undefined, algorithm: 'ES256' | 'RS256',
): JwtPublicJwk {
  if (key.type === 'secret') {
    throw jwtError('PULSE_JWT_KEY_INVALID', {
      category: 'algorithm-key-mismatch',
    });
  }
  if (key.type === 'jwk') {
    if (!compatibleAlgorithm(key.key, algorithm)) {
      throw jwtError('PULSE_JWT_KEY_INVALID', {
        category: 'algorithm-key-mismatch',
      });
    }
    if (kid !== undefined && key.key.kid !== undefined && key.key.kid !== kid) {
      throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'unknown-kid' });
    }
    return key.key;
  }

  if (kid !== undefined) {
    const selected = key.keys.filter((entry) => entry.kid === kid);
    if (selected.length !== 1) {
      throw jwtError('PULSE_JWT_KEY_INVALID', {
        category: selected.length === 0 ? 'unknown-kid' : 'duplicate-kid',
      });
    }
    if (!compatibleAlgorithm(selected[0], algorithm)) {
      throw jwtError('PULSE_JWT_KEY_INVALID', {
        category: 'algorithm-key-mismatch',
      });
    }
    return selected[0];
  }

  const eligible = key.keys.filter((entry) => (
    compatibleAlgorithm(entry, algorithm)
  ));
  if (eligible.length !== 1) {
    throw jwtError('PULSE_JWT_KEY_INVALID', {
      category: eligible.length === 0 ? 'missing-kid' : 'ambiguous-key',
    });
  }
  return eligible[0];
}
