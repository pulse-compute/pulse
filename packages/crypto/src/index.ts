import { normalizeRs256Request, verifyRs256 } from './internal/rsa.js';
import { ownDataProperty } from './internal/data.js';
export { normalizeRsaPublicKey, normalizeRs256JoseVerifyRequest } from './internal/rsa.js';
export type { RsaPublicKeyBytes, Rs256JoseVerifyInput } from './contracts.js';
export { CRYPTO_RS256_GUEST_LINKED_REALIZATION, CRYPTO_RS256_GUEST_LINKED_IMPLEMENTATION, CRYPTO_RS256_RUNTIME_BUILTIN_IMPLEMENTATION } from './contracts.js';
import {
  CRYPTO_ALGORITHMS,
  CRYPTO_CONTRACT_VERSION,
  CRYPTO_ES256_CONTRACT,
  CRYPTO_ES256_CONTRACT_VERSION,
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
  CRYPTO_RESOURCE_LIMITS,
  CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_VERIFICATION_STATUSES,
  type CryptoAlgorithm,
  type CryptoVerificationResult,
  type CryptoVerificationStatus,
  type Es256JoseVerifyInput,
  type HmacKeyBytes,
  type HmacVerificationKey,
  type MacAlgorithm,
  type MacVerifyRequest,
  type P256PublicKeyBytes,
  type P256PublicKeyCoordinates,
  type SignatureAlgorithm,
  type SignatureVerifyRequest,
} from './contracts.js';
import { verifyEs256, verifyHs256 } from './internal/realization.js';
import {
  normalizeEs256JoseVerifyRequest,
  normalizeMacVerifyRequest,
  normalizeP256PublicKeyCoordinates,
  normalizeSignatureVerifyRequest,
  normalizeVerificationResult,
} from './internal/verification.js';

export {
  CRYPTO_ALGORITHMS,
  CRYPTO_CONTRACT_VERSION,
  CRYPTO_ES256_CONTRACT,
  CRYPTO_ES256_CONTRACT_VERSION,
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_ES256_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
  CRYPTO_RESOURCE_LIMITS,
  CRYPTO_RUNTIME_BUILTIN_IMPLEMENTATION,
  CRYPTO_VERIFICATION_STATUSES,
};
export type {
  CryptoAlgorithm,
  CryptoVerificationResult,
  CryptoVerificationStatus,
  Es256JoseVerifyInput,
  HmacKeyBytes,
  HmacVerificationKey,
  MacAlgorithm,
  MacVerifyRequest,
  P256PublicKeyBytes,
  P256PublicKeyCoordinates,
  SignatureAlgorithm,
  SignatureVerifyRequest,
};

export {
  normalizeEs256JoseVerifyRequest,
  normalizeP256PublicKeyCoordinates,
};

export async function verifyMac(
  request: MacVerifyRequest,
): Promise<CryptoVerificationResult> {
  let normalized: ReturnType<typeof normalizeMacVerifyRequest>;
  try {
    normalized = normalizeMacVerifyRequest(request);
  } catch {
    return normalizeVerificationResult({ status: 'invalid-input' });
  }
  if (!normalized.ok) return normalized.result;

  try {
    return normalizeVerificationResult(await verifyHs256(normalized.request));
  } catch {
    return normalizeVerificationResult(undefined);
  }
}

export async function verifySignature(
  request: SignatureVerifyRequest,
): Promise<CryptoVerificationResult> {
  let rsa = false;
  try { rsa = ownDataProperty(request, 'algorithm').value === 'RS256'; }
  catch { return normalizeVerificationResult({ status: 'invalid-input' }); }
  if (rsa) {
    const normalized = normalizeRs256Request(request);
    if (!normalized.ok) return normalized.result;
    return normalizeVerificationResult(await verifyRs256(normalized.request));
  }
  let normalized: ReturnType<typeof normalizeSignatureVerifyRequest>;
  try {
    normalized = normalizeSignatureVerifyRequest(request);
  } catch {
    return normalizeVerificationResult({ status: 'invalid-input' });
  }
  if (!normalized.ok) return normalized.result;

  try {
    return normalizeVerificationResult(await verifyEs256(normalized.request));
  } catch {
    normalized.request.key.bytes.fill(0);
    return normalizeVerificationResult(undefined);
  }
}

export const mac = Object.freeze({
  verify: verifyMac,
});

export const signature = Object.freeze({
  verify: verifySignature,
});

export { DIGEST_TEXT_MAX_BYTES, digestText, type TextDigestResult } from './digest.js';
import { digestText } from './digest.js';

export const crypto = Object.freeze({
  digestText,
  mac,
  signature,
});

export default crypto;
