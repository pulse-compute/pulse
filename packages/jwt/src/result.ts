import { jwtError } from './errors.js';
import {
  defineJwtDataProperty,
  isJwtOrdinaryObject,
  jwtDataEntries,
  jwtDenseArrayValues,
  jwtOwnDataProperty,
} from './internal/data.js';
import type { JwtAlgorithm, JwtClaims, JwtJsonValue } from './options.js';

export type DeepReadonly<Value> =
  Value extends JwtJsonPrimitive ? Value
    : Value extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
      : Value extends object ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : never;

type JwtJsonPrimitive = string | number | boolean | null;

export interface JwtProtectedHeader {
  readonly alg: JwtAlgorithm;
  readonly kid?: string;
  readonly typ?: string;
}

export interface JwtVerification<Claims = JwtClaims> {
  readonly claims: DeepReadonly<Claims>;
  readonly protectedHeader: Readonly<JwtProtectedHeader>;
}

function dataProperty(
  value: object,
  name: string,
): unknown {
  const property = jwtOwnDataProperty(value, name);
  return property.valid && property.present ? property.value : undefined;
}

function cloneJson(value: unknown, path: string, depth: number, seen: Set<object>): JwtJsonValue {
  if (depth > 32) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-depth' });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
  }
  if (seen.has(value)) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = jwtDenseArrayValues(value);
      if (!entries) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
      const output: JwtJsonValue[] = [];
      for (let index = 0; index < entries.length; index += 1) {
        output.push(cloneJson(entries[index], `${path}[${index}]`, depth + 1, seen));
      }
      return Object.freeze(output);
    }
    if (!isJwtOrdinaryObject(value)) {
      throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
    }
    const entries = jwtDataEntries(value);
    if (!entries) throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-value' });
    const output: Record<string, JwtJsonValue> = {};
    for (const [key, child] of entries) {
      defineJwtDataProperty(
        output,
        key,
        cloneJson(child, `${path}.${key}`, depth + 1, seen),
      );
    }
    return Object.freeze(output);
  } finally {
    seen.delete(value);
  }
}

export function normalizeJwtVerification<Claims = JwtClaims>(
  value: unknown,
): JwtVerification<Claims> {
  if (!isJwtOrdinaryObject(value)) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result' });
  }
  const record = value as Readonly<Record<string, unknown>>;
  const recordEntries = jwtDataEntries(record);
  if (
    !recordEntries
    || recordEntries.length !== 2
    || !recordEntries.some(([name]) => name === 'claims')
    || !recordEntries.some(([name]) => name === 'protectedHeader')
  ) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result' });
  }
  const header = dataProperty(record, 'protectedHeader');
  if (!isJwtOrdinaryObject(header)) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-header' });
  }
  const headerRecord = header as Readonly<Record<string, unknown>>;
  const headerEntries = jwtDataEntries(headerRecord);
  if (!headerEntries || headerEntries.some(([name]) => !['alg', 'kid', 'typ'].includes(name))) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-header' });
  }
  const alg = dataProperty(headerRecord, 'alg');
  if (!['HS256', 'RS256', 'ES256', 'EdDSA'].includes(String(alg))) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-header' });
  }
  const kid = dataProperty(headerRecord, 'kid');
  const typ = dataProperty(headerRecord, 'typ');
  if (kid !== undefined && typeof kid !== 'string') {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-header' });
  }
  if (typ !== undefined && typeof typ !== 'string') {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-header' });
  }
  const claims = cloneJson(dataProperty(record, 'claims'), '$', 0, new Set());
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw jwtError('PULSE_JWT_OPERATION_FAILED', { category: 'result-claims' });
  }
  return Object.freeze({
    claims: claims as DeepReadonly<Claims>,
    protectedHeader: Object.freeze({
      alg: alg as JwtAlgorithm,
      ...(kid === undefined ? {} : { kid }),
      ...(typ === undefined ? {} : { typ }),
    }),
  });
}
