import type { PulseRequest } from '@pulse-compute/runtime';
import { jwtError } from './errors.js';
import { jwtOwnDataProperty } from './internal/data.js';

function authorizationValue(request: PulseRequest | Request): string | undefined {
  if (!request || typeof request !== 'object') {
    throw jwtError('PULSE_JWT_BEARER_INVALID', { category: 'request' });
  }

  if (typeof Request !== 'undefined' && request instanceof Request) {
    return request.headers.get('authorization') ?? undefined;
  }

  const header = jwtOwnDataProperty(request, 'header');
  if (header.valid && typeof header.value === 'function') {
    const value = header.value('authorization');
    if (value === undefined || typeof value === 'string') return value;
    throw jwtError('PULSE_JWT_BEARER_INVALID', { category: 'authorization' });
  }
  throw jwtError('PULSE_JWT_BEARER_INVALID', { category: 'request' });
}

export function bearerFromAuthorizationValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || /[\r\n,]/.test(value)) {
    throw jwtError('PULSE_JWT_BEARER_INVALID', { category: 'authorization' });
  }

  const match = /^[Bb][Ee][Aa][Rr][Ee][Rr] ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
  if (!match) throw jwtError('PULSE_JWT_BEARER_INVALID', { category: 'authorization' });
  return match[1];
}

export function bearer(request: PulseRequest | Request): string | undefined {
  return bearerFromAuthorizationValue(authorizationValue(request));
}
