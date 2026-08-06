export const JWT_ERROR_CODES = Object.freeze([
  'PULSE_JWT_BEARER_INVALID',
  'PULSE_JWT_TOKEN_REQUIRED',
  'PULSE_JWT_MALFORMED',
  'PULSE_JWT_LIMIT_EXCEEDED',
  'PULSE_JWT_ALGORITHM_NOT_ALLOWED',
  'PULSE_JWT_KEY_INVALID',
  'PULSE_JWT_SIGNATURE_INVALID',
  'PULSE_JWT_CLAIMS_INVALID',
  'PULSE_JWT_CLAIMS_SCHEMA_INVALID',
  'PULSE_JWT_CLOCK_UNAVAILABLE',
  'PULSE_JWT_CLOCK_INVALID',
  'PULSE_JWT_TARGET_UNSUPPORTED',
  'PULSE_JWT_OPERATION_FAILED',
] as const);

export type JwtErrorCode = typeof JWT_ERROR_CODES[number];

export type JwtErrorDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly JwtErrorDetailValue[]
  | Readonly<{ readonly [name: string]: JwtErrorDetailValue }>;

const MESSAGES: Readonly<Record<JwtErrorCode, string>> = Object.freeze({
  PULSE_JWT_BEARER_INVALID: 'The Authorization header is not a valid Bearer credential.',
  PULSE_JWT_TOKEN_REQUIRED: 'JWT verification requires a Bearer token.',
  PULSE_JWT_MALFORMED: 'The compact JWT is malformed.',
  PULSE_JWT_LIMIT_EXCEEDED: 'The JWT exceeds a bounded resource limit.',
  PULSE_JWT_ALGORITHM_NOT_ALLOWED: 'The JWT protected algorithm is not allowed.',
  PULSE_JWT_KEY_INVALID: 'The JWT verification key is invalid or ambiguous.',
  PULSE_JWT_SIGNATURE_INVALID: 'The JWT signature is invalid.',
  PULSE_JWT_CLAIMS_INVALID: 'The JWT registered claims are invalid.',
  PULSE_JWT_CLAIMS_SCHEMA_INVALID: 'The verified JWT claims do not match the selected schema.',
  PULSE_JWT_CLOCK_UNAVAILABLE: 'Trusted wall-clock time is unavailable.',
  PULSE_JWT_CLOCK_INVALID: 'The supplied wall-clock instant is invalid.',
  PULSE_JWT_TARGET_UNSUPPORTED: 'The selected target cannot realize this JWT verification.',
  PULSE_JWT_OPERATION_FAILED: 'JWT verification failed.',
});

function cloneDetail(value: JwtErrorDetailValue): JwtErrorDetailValue {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneDetail));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneDetail(child)]),
    ));
  }
  return value;
}

export class JwtError extends Error {
  readonly code: JwtErrorCode;
  readonly detail: Readonly<Record<string, JwtErrorDetailValue>>;

  static [Symbol.hasInstance](value: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
    if (!(value instanceof Error)) return false;
    const code = Object.getOwnPropertyDescriptor(value, 'code')?.value;
    return typeof code === 'string'
      && (JWT_ERROR_CODES as readonly string[]).includes(code);
  }

  constructor(
    code: JwtErrorCode,
    detail: Readonly<Record<string, JwtErrorDetailValue>> = {},
  ) {
    super(MESSAGES[code]);
    this.name = 'JwtError';
    this.code = code;
    this.detail = cloneDetail(detail) as Readonly<Record<string, JwtErrorDetailValue>>;
    Object.freeze(this.detail);
  }
}

export function jwtError(
  code: JwtErrorCode,
  detail: Readonly<Record<string, JwtErrorDetailValue>> = {},
): JwtError {
  return new JwtError(code, detail);
}

export function isJwtError(value: unknown): value is JwtError {
  return value instanceof JwtError;
}
