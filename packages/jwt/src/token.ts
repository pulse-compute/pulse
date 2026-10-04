import { jwtError } from './errors.js';
import {
  isJwtOrdinaryObject,
  jwtDataEntries,
  jwtDenseArrayValues,
  jwtOwnDataProperty,
} from './internal/data.js';
import type { JwtClaims, JwtJsonValue } from './options.js';

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_HEADER_BYTES = 4 * 1024;
const MAX_CLAIMS_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface JwtPreflight {
  readonly protectedHeader: Readonly<Record<string, JwtJsonValue>>;
  readonly claimsText: string;
}

export interface JwtCompactSignatureInput {
  readonly signingInput: Uint8Array;
  readonly signature: Uint8Array;
}

export interface JwtCompactParts {
  readonly signingInput: Uint8Array;
  readonly signatureSegment: string;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function decodeBase64url(
  segment: string,
  category: 'protected-header' | 'claims' | 'signature',
): Uint8Array {
  if (!canonicalBase64url(segment)) {
    throw jwtError('PULSE_JWT_MALFORMED', { category });
  }
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - segment.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw jwtError('PULSE_JWT_MALFORMED', { category });
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let canonical = '';
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  canonical = btoa(canonical).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  if (canonical !== segment) throw jwtError('PULSE_JWT_MALFORMED', { category });
  return bytes;
}

function canonicalBase64url(segment: string): boolean {
  if (
    !segment
    || !BASE64URL.test(segment)
    || segment.includes('=')
    || segment.length % 4 === 1
  ) return false;
  const remainder = segment.length % 4;
  if (remainder === 0) return true;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(segment[segment.length - 1]);
  return last >= 0
    && (remainder === 2 ? (last & 15) === 0 : (last & 3) === 0);
}

function decodeUtf8(bytes: Uint8Array, category: 'protected-header' | 'claims'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw jwtError('PULSE_JWT_MALFORMED', { category });
  }
}

class JsonShapeParser {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): void {
    this.#value(0);
    this.#space();
    if (this.#index !== this.#text.length) this.#fail();
  }

  #fail(): never {
    throw jwtError('PULSE_JWT_MALFORMED', { category: 'json' });
  }

  #space(): void {
    while (this.#index < this.#text.length && /[\t\n\r ]/.test(this.#text[this.#index])) this.#index += 1;
  }

  #value(depth: number): void {
    if (depth > MAX_JSON_DEPTH) {
      throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
        category: 'json-depth',
        limit: MAX_JSON_DEPTH,
        actual: depth,
      });
    }
    this.#space();
    const character = this.#text[this.#index];
    if (character === '{') return this.#object(depth);
    if (character === '[') return this.#array(depth);
    if (character === '"') {
      this.#string();
      return;
    }
    const rest = this.#text.slice(this.#index);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      this.#index += number[0].length;
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (rest.startsWith(literal)) {
        this.#index += literal.length;
        return;
      }
    }
    this.#fail();
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        try {
          return JSON.parse(this.#text.slice(start, this.#index)) as string;
        } catch {
          this.#fail();
        }
      }
      if (character === '\\') {
        this.#index += 1;
        const escaped = this.#text[this.#index];
        if (escaped === 'u') {
          if (!/^[0-9A-Fa-f]{4}$/.test(this.#text.slice(this.#index + 1, this.#index + 5))) this.#fail();
          this.#index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped || '')) this.#fail();
        this.#index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) this.#fail();
      this.#index += 1;
    }
    this.#fail();
  }

  #object(depth: number): void {
    this.#index += 1;
    this.#space();
    const names = new Set<string>();
    if (this.#text[this.#index] === '}') {
      this.#index += 1;
      return;
    }
    while (this.#index < this.#text.length) {
      this.#space();
      if (this.#text[this.#index] !== '"') this.#fail();
      const name = this.#string();
      if (names.has(name)) throw jwtError('PULSE_JWT_MALFORMED', { category: 'duplicate-json-member' });
      names.add(name);
      this.#space();
      if (this.#text[this.#index] !== ':') this.#fail();
      this.#index += 1;
      this.#value(depth + 1);
      this.#space();
      const delimiter = this.#text[this.#index];
      this.#index += 1;
      if (delimiter === '}') return;
      if (delimiter !== ',') this.#fail();
    }
    this.#fail();
  }

  #array(depth: number): void {
    this.#index += 1;
    this.#space();
    if (this.#text[this.#index] === ']') {
      this.#index += 1;
      return;
    }
    while (this.#index < this.#text.length) {
      this.#value(depth + 1);
      this.#space();
      const delimiter = this.#text[this.#index];
      this.#index += 1;
      if (delimiter === ']') return;
      if (delimiter !== ',') this.#fail();
    }
    this.#fail();
  }
}

function parseObject(
  text: string,
  category: 'protected-header' | 'claims',
): Readonly<Record<string, JwtJsonValue>> {
  try {
    new JsonShapeParser(text).parse();
    const value: unknown = JSON.parse(text);
    if (!isJwtOrdinaryObject(value)) {
      throw jwtError('PULSE_JWT_MALFORMED', { category });
    }
    validateJsonValue(value, category, 0);
    return value as Readonly<Record<string, JwtJsonValue>>;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw jwtError('PULSE_JWT_MALFORMED', { category });
  }
}

function validateJsonValue(
  value: unknown,
  category: 'protected-header' | 'claims',
  depth: number,
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: 'json-depth',
      limit: MAX_JSON_DEPTH,
      actual: depth,
    });
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw jwtError('PULSE_JWT_MALFORMED', { category });
    return;
  }
  const children = Array.isArray(value)
    ? jwtDenseArrayValues(value)
    : isJwtOrdinaryObject(value)
      ? jwtDataEntries(value)?.map((entry) => entry[1])
      : undefined;
  if (!children) throw jwtError('PULSE_JWT_MALFORMED', { category });
  for (const child of children) validateJsonValue(child, category, depth + 1);
}

export function preflightCompactJwt(token: string | undefined): JwtPreflight {
  if (token === undefined || token === '') throw jwtError('PULSE_JWT_TOKEN_REQUIRED');
  if (typeof token !== 'string') throw jwtError('PULSE_JWT_MALFORMED', { category: 'compact-token' });
  const tokenBytes = utf8Bytes(token);
  if (tokenBytes > MAX_TOKEN_BYTES) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: 'compact-token',
      limit: MAX_TOKEN_BYTES,
      actual: tokenBytes,
    });
  }
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment || !BASE64URL.test(segment))) {
    throw jwtError('PULSE_JWT_MALFORMED', { category: 'compact-token' });
  }
  const headerBytes = decodeBase64url(segments[0], 'protected-header');
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: 'protected-header',
      limit: MAX_HEADER_BYTES,
      actual: headerBytes.byteLength,
    });
  }
  const claimsBytes = decodeBase64url(segments[1], 'claims');
  if (claimsBytes.byteLength > MAX_CLAIMS_BYTES) {
    throw jwtError('PULSE_JWT_LIMIT_EXCEEDED', {
      category: 'claims',
      limit: MAX_CLAIMS_BYTES,
      actual: claimsBytes.byteLength,
    });
  }
  if (!canonicalBase64url(segments[2])) {
    throw jwtError('PULSE_JWT_MALFORMED', { category: 'signature' });
  }
  const protectedHeader = parseObject(decodeUtf8(headerBytes, 'protected-header'), 'protected-header');
  const claimsText = decodeUtf8(claimsBytes, 'claims');
  return Object.freeze({ protectedHeader, claimsText });
}

export function protectedAlgorithm(header: Readonly<Record<string, JwtJsonValue>>): string {
  for (const name of ['crit', 'b64']) {
    const unsupported = jwtOwnDataProperty(header, name);
    if (!unsupported.valid) {
      throw jwtError('PULSE_JWT_MALFORMED', { category: 'protected-header' });
    }
    if (unsupported.present) {
      throw jwtError('PULSE_JWT_MALFORMED', { category: 'protected-extension' });
    }
  }
  const property = jwtOwnDataProperty(header, 'alg');
  const algorithm = property.valid && property.present ? property.value : undefined;
  if (typeof algorithm !== 'string') {
    throw jwtError('PULSE_JWT_ALGORITHM_NOT_ALLOWED', { category: 'protected-algorithm' });
  }
  return algorithm;
}

export function protectedHeaderString(
  header: Readonly<Record<string, JwtJsonValue>>,
  name: 'kid' | 'typ',
): string | undefined {
  const property = jwtOwnDataProperty(header, name);
  if (!property.valid) {
    throw jwtError('PULSE_JWT_MALFORMED', { category: `protected-${name}` });
  }
  if (!property.present || property.value === undefined) return undefined;
  if (typeof property.value !== 'string') {
    throw jwtError('PULSE_JWT_MALFORMED', { category: `protected-${name}` });
  }
  return property.value;
}

export function parseVerifiedClaims(preflight: JwtPreflight): JwtClaims {
  return parseObject(preflight.claimsText, 'claims') as JwtClaims;
}

export function compactJwtSignatureInput(token: string): JwtCompactSignatureInput {
  const compact = compactJwtParts(token);
  return Object.freeze({
    signingInput: compact.signingInput,
    signature: decodeBase64url(compact.signatureSegment, 'signature'),
  });
}

export function compactJwtParts(token: string): JwtCompactParts {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw jwtError('PULSE_JWT_MALFORMED', { category: 'compact-token' });
  }
  return Object.freeze({
    signingInput: new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    signatureSegment: segments[2],
  });
}

// Private package boundary: retain duplicate-member rejection for secret JWKs.
export function parsePrivateKeyObject(text: string): Readonly<Record<string, JwtJsonValue>> {
  return parseObject(text, 'protected-header');
}
