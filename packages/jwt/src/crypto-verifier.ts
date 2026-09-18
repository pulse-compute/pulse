import {
  CRYPTO_VERIFICATION_STATUSES,
  normalizeEs256JoseVerifyRequest,
  normalizeRs256JoseVerifyRequest,
  type CryptoVerificationResult,
  type CryptoVerificationStatus,
  type MacVerifyRequest,
  type SignatureVerifyRequest,
} from '@pulse-compute/crypto';
import { isJwtError, jwtError } from './errors.js';
import {
  normalizeJwtVerifyOptions,
  selectSignatureVerificationJwk,
  type JwtAlgorithm,
  type JwtClaims,
  type JwtVerificationKey,
} from './options.js';
import { normalizeJwtVerification, type JwtVerification } from './result.js';
import {
  compactJwtParts,
  compactJwtSignatureInput,
  parseVerifiedClaims,
  preflightCompactJwt,
  protectedAlgorithm,
  protectedHeaderString,
} from './token.js';
import { captureJwtCurrentDate } from './internal/clock.js';
import {
  isJwtOrdinaryObject,
  jwtDataEntries,
  jwtDataRecord,
  jwtOwnDataProperty,
} from './internal/data.js';
import { validateRegisteredClaims } from './internal/registered-claims.js';
import {
  registerClaimStrings,
  registerSensitive,
  validateClaimsSchema,
  verifierHostFunction,
  type JwtVerifierHost,
  type JwtVerifierInput,
} from './internal/verifier-authority.js';

export type JwtCryptoVerifierInput = JwtVerifierInput;

export interface JwtCryptoVerifierHost extends JwtVerifierHost {}

export type JwtCryptoMacVerify = (
  request: MacVerifyRequest,
) => CryptoVerificationResult | PromiseLike<CryptoVerificationResult>;

export type JwtCryptoSignatureVerify = (
  request: SignatureVerifyRequest,
) => CryptoVerificationResult | PromiseLike<CryptoVerificationResult>;

export interface JwtCryptoVerifier {
  readonly mac: Readonly<{
    readonly verify: JwtCryptoMacVerify;
  }>;
  readonly signature?: Readonly<{
    readonly verify: JwtCryptoSignatureVerify;
  }>;
}

function cryptoMacVerify(
  crypto: JwtCryptoVerifier,
): JwtCryptoMacVerify {
  if (!isJwtOrdinaryObject(crypto)) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  const macProperty = jwtOwnDataProperty(crypto, 'mac');
  if (!macProperty.valid || !macProperty.present || !isJwtOrdinaryObject(macProperty.value)) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  const verifyProperty = jwtOwnDataProperty(macProperty.value, 'verify');
  if (!verifyProperty.valid || !verifyProperty.present || typeof verifyProperty.value !== 'function') {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  return verifyProperty.value as JwtCryptoMacVerify;
}

function cryptoSignatureVerify(
  crypto: JwtCryptoVerifier,
): JwtCryptoSignatureVerify {
  if (!isJwtOrdinaryObject(crypto)) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  const signatureProperty = jwtOwnDataProperty(crypto, 'signature');
  if (
    !signatureProperty.valid
    || !signatureProperty.present
    || !isJwtOrdinaryObject(signatureProperty.value)
  ) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  const verifyProperty = jwtOwnDataProperty(signatureProperty.value, 'verify');
  if (!verifyProperty.valid || !verifyProperty.present || typeof verifyProperty.value !== 'function') {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'crypto-verifier' });
  }
  return verifyProperty.value as JwtCryptoSignatureVerify;
}

function normalizedCryptoStatus(value: unknown): CryptoVerificationStatus {
  if (!isJwtOrdinaryObject(value)) return 'realization-failure';
  const entries = jwtDataEntries(value);
  if (!entries || entries.length !== 1 || entries[0][0] !== 'status') {
    return 'realization-failure';
  }
  const status = entries[0][1];
  return typeof status === 'string'
    && (CRYPTO_VERIFICATION_STATUSES as readonly string[]).includes(status)
    ? status as CryptoVerificationStatus
    : 'realization-failure';
}

function assertCryptoVerified(status: CryptoVerificationStatus): void {
  if (status === 'valid') return;
  if (status === 'invalid-authenticator') {
    throw jwtError('PULSE_JWT_SIGNATURE_INVALID');
  }
  if (status === 'invalid-key') {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'crypto-key' });
  }
  if (status === 'invalid-input') {
    throw jwtError('PULSE_JWT_MALFORMED', { category: 'crypto-input' });
  }
  throw jwtError('PULSE_JWT_OPERATION_FAILED', {
    category: 'crypto-realization',
    automaticFallback: false,
  });
}

async function resolveHmacKeyBytes(
  key: JwtVerificationKey,
  algorithm: JwtAlgorithm,
  host: JwtCryptoVerifierHost,
): Promise<Uint8Array> {
  if (algorithm !== 'HS256' || key.type !== 'secret') {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'algorithm-key-mismatch' });
  }
  const resolveSecret = verifierHostFunction(host, 'resolveSecret');
  if (!resolveSecret) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'secret-authority' });
  }
  let resolved: string | Uint8Array | undefined;
  try {
    resolved = await resolveSecret(key.binding) as string | Uint8Array | undefined;
  } catch {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'secret-binding' });
  }
  const bytes = typeof resolved === 'string'
    ? new TextEncoder().encode(resolved)
    : resolved instanceof Uint8Array
      ? new Uint8Array(resolved)
      : undefined;
  if (!bytes || bytes.byteLength === 0) {
    throw jwtError('PULSE_JWT_KEY_INVALID', { category: 'secret-binding' });
  }
  try {
    registerSensitive(host, resolved as string | Uint8Array);
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
  return bytes;
}

async function captureCurrentDate(
  host: JwtCryptoVerifierHost,
): Promise<Date> {
  const clock = jwtOwnDataProperty(host, 'captureWallClock');
  if (
    !clock.valid
    || (
      clock.present
      && clock.value !== undefined
      && typeof clock.value !== 'function'
    )
  ) {
    throw jwtError('PULSE_JWT_CLOCK_INVALID');
  }
  return captureJwtCurrentDate(
    typeof clock.value === 'function'
      ? clock.value as JwtCryptoVerifierHost['captureWallClock']
      : undefined,
  );
}

export async function verifyJwtWithCrypto<Claims = JwtClaims>(
  input: JwtCryptoVerifierInput,
  host: JwtCryptoVerifierHost,
  crypto: JwtCryptoVerifier,
): Promise<JwtVerification<Claims>> {
  try {
    const inputRecord = jwtDataRecord(input);
    if (!inputRecord || !isJwtOrdinaryObject(host)) {
      throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'verifier-input' });
    }
    const token = inputRecord.get('token');
    const inputOptions = inputRecord.get('options');
    if (typeof token === 'string') registerSensitive(host, token);

    const preflight = preflightCompactJwt(token as string | undefined);
    const options = normalizeJwtVerifyOptions(inputOptions as JwtCryptoVerifierInput['options']);
    const algorithm = protectedAlgorithm(preflight.protectedHeader);
    if (algorithm === 'none' || !(options.algorithms as readonly string[]).includes(algorithm)) {
      throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', { category: 'protected-algorithm' });
    }
    const selectedAlgorithm = algorithm as JwtAlgorithm;
    const kid = protectedHeaderString(preflight.protectedHeader, 'kid');
    const typ = protectedHeaderString(preflight.protectedHeader, 'typ');
    if (options.typ !== undefined && typ !== options.typ) {
      throw jwtError('PULSE_JWT_CLAIMS_INVALID', { category: 'protected-type' });
    }

    let cryptoResult: unknown;
    if (selectedAlgorithm === 'HS256') {
      const verifyMac = cryptoMacVerify(crypto);
      const keyBytes = await resolveHmacKeyBytes(options.key, selectedAlgorithm, host);
      const compact = compactJwtSignatureInput(token as string);
      try {
        try {
          cryptoResult = await verifyMac(Object.freeze({
            algorithm: 'HS256',
            key: Object.freeze({
              type: 'hmac-key-bytes',
              bytes: keyBytes,
            }),
            data: compact.signingInput,
            tag: compact.signature,
          }));
        } catch {
          throw jwtError('PULSE_JWT_OPERATION_FAILED', {
            category: 'crypto-verification',
            automaticFallback: false,
          });
        }
      } finally {
        keyBytes.fill(0);
      }
    } else if (selectedAlgorithm === 'ES256' || selectedAlgorithm === 'RS256') {
      const verifySignature = cryptoSignatureVerify(crypto);
      const selectedJwk = selectSignatureVerificationJwk(options.key, kid, selectedAlgorithm);
      const compact = compactJwtParts(token as string);
      const normalized = selectedAlgorithm === 'RS256' ? normalizeRs256JoseVerifyRequest({
        key: { n: selectedJwk.n as string, e: selectedJwk.e as string },
        data: compact.signingInput, signature: compact.signatureSegment,
      }) : normalizeEs256JoseVerifyRequest({
        key: {
          x: selectedJwk.x as string,
          y: selectedJwk.y as string,
        },
        data: compact.signingInput,
        signature: compact.signatureSegment,
      });
      if (!normalized.ok) {
        assertCryptoVerified(normalized.result.status);
        throw jwtError('PULSE_JWT_OPERATION_FAILED', {
          category: 'crypto-normalization',
        });
      }
      try {
        try {
          cryptoResult = await verifySignature(normalized.request);
        } catch {
          throw jwtError('PULSE_JWT_OPERATION_FAILED', {
            category: 'crypto-verification',
            automaticFallback: false,
          });
        }
      } finally {
        normalized.request.key.bytes.fill(0);
      }
    } else {
      throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', {
        category: 'protected-algorithm',
      });
    }
    assertCryptoVerified(normalizedCryptoStatus(cryptoResult));

    const claims = parseVerifiedClaims(preflight);
    registerClaimStrings(host, claims);
    const currentDate = await captureCurrentDate(host);
    validateRegisteredClaims(claims, options, currentDate);
    const normalizedClaims = await validateClaimsSchema(
      claims,
      options.claimsSchema,
      host,
    );
    if (normalizedClaims !== claims) registerClaimStrings(host, normalizedClaims);
    return normalizeJwtVerification<Claims>({
      claims: normalizedClaims,
      protectedHeader: {
        alg: selectedAlgorithm,
        ...(kid === undefined ? {} : { kid }),
        ...(typ === undefined ? {} : { typ }),
      },
    });
  } catch (error) {
    if (isJwtError(error)) throw error;
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'crypto-verifier' });
  }
}
