import { jwtError } from '../errors.js';
import type {
  JwtClaims,
  JwtVerifyOptions,
} from '../options.js';
import type { JwtWallClockCapture } from './clock.js';
import {
  isJwtOrdinaryObject,
  jwtDataEntries,
  jwtDenseArrayValues,
  jwtOwnDataProperty,
} from './data.js';

export interface JwtVerifierInput {
  readonly token: string | undefined;
  readonly options: JwtVerifyOptions;
}

export interface JwtClaimsSchemaErrorDetail {
  readonly path?: string;
  readonly expected?: string;
  readonly actualKind?: string;
}

export interface JwtVerifierHost {
  readonly captureWallClock?: JwtWallClockCapture;
  readonly resolveSecret?: (
    binding: string,
  ) => string | Uint8Array | undefined | PromiseLike<string | Uint8Array | undefined>;
  readonly validateClaims?: (
    schemaId: string,
    claims: JwtClaims,
    context: Readonly<{ source: 'jwt-claims' }>,
  ) => unknown | PromiseLike<unknown>;
  readonly registerSensitiveValue?: (value: string | Uint8Array) => void;
}

export function verifierHostFunction(
  host: JwtVerifierHost,
  name: keyof JwtVerifierHost,
): Function | undefined {
  const property = jwtOwnDataProperty(host, name);
  if (!property.valid) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'verifier-host' });
  }
  if (!property.present || property.value === undefined) return undefined;
  if (typeof property.value !== 'function') {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'verifier-host' });
  }
  return property.value;
}

export function registerSensitive(
  host: JwtVerifierHost,
  value: string | Uint8Array,
): void {
  const register = verifierHostFunction(host, 'registerSensitiveValue');
  if (!register) return;
  try {
    register(value);
  } catch {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'redaction-registration' });
  }
}

export function registerClaimStrings(
  host: JwtVerifierHost,
  value: unknown,
  depth = 0,
): void {
  if (depth > 32) return;
  if (typeof value === 'string') {
    if (value.length > 0) registerSensitive(host, value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    const entries = jwtDenseArrayValues(value);
    if (!entries) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'claim-redaction' });
    for (const entry of entries) registerClaimStrings(host, entry, depth + 1);
    return;
  }
  if (!isJwtOrdinaryObject(value)) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'claim-redaction' });
  }
  const entries = jwtDataEntries(value);
  if (!entries) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'claim-redaction' });
  for (const [, entry] of entries) registerClaimStrings(host, entry, depth + 1);
}

function schemaErrorDetail(
  schemaId: string,
  error: unknown,
): Readonly<Record<string, string>> {
  const detail = error && typeof error === 'object'
    ? (
        Object.getOwnPropertyDescriptor(error, 'detail')?.value
        ?? Object.getOwnPropertyDescriptor(error, 'details')?.value
      )
    : undefined;
  const record = detail && typeof detail === 'object' && !Array.isArray(detail)
    ? detail as Readonly<Record<string, unknown>>
    : {};
  const output: Record<string, string> = {
    schemaId,
    source: 'jwt-claims',
  };
  const code = error && typeof error === 'object'
    ? Object.getOwnPropertyDescriptor(error, 'code')?.value
    : undefined;
  if (typeof code === 'string' && /^PULSE_[A-Z0-9_]{1,96}$/.test(code)) output.schemaCode = code;
  const path = Object.getOwnPropertyDescriptor(record, 'path')?.value;
  if (typeof path === 'string' && /^[A-Za-z0-9_$.[\]-]{1,256}$/.test(path)) {
    output.path = path;
  }
  const jsonKinds = new Set([
    'array', 'boolean', 'integer', 'null', 'number', 'object', 'string',
  ]);
  const expected = Object.getOwnPropertyDescriptor(record, 'expected')?.value;
  if (typeof expected === 'string' && jsonKinds.has(expected)) {
    output.expected = expected;
  }
  const actualKind = Object.getOwnPropertyDescriptor(record, 'actualKind')?.value;
  if (typeof actualKind === 'string' && jsonKinds.has(actualKind)) {
    output.actualKind = actualKind;
  }
  return Object.freeze(output);
}

export async function validateClaimsSchema(
  claims: JwtClaims,
  schemaId: string | undefined,
  host: JwtVerifierHost,
): Promise<unknown> {
  if (schemaId === undefined) return claims;
  const validateClaims = verifierHostFunction(host, 'validateClaims');
  if (!validateClaims) {
    throw jwtError('PULSE_JWT_TARGET_UNSUPPORTED', { category: 'claims-schema' });
  }
  try {
    return await validateClaims(
      schemaId,
      claims,
      Object.freeze({ source: 'jwt-claims' }),
    );
  } catch (error) {
    throw jwtError('PULSE_JWT_CLAIMS_SCHEMA_INVALID', schemaErrorDetail(schemaId, error));
  }
}
