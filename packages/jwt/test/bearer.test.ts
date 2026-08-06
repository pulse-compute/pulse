import { describe, expect, it } from 'vitest';
import { bearer, JwtError } from '../src/index.js';

const compact = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';

describe('jwt.bearer', () => {
  it('returns undefined for a missing Authorization header', () => {
    expect(bearer(new Request('https://example.test/'))).toBeUndefined();
  });

  it('accepts an ASCII case-insensitive Bearer scheme', () => {
    const request = new Request('https://example.test/', {
      headers: { authorization: `bEaReR ${compact}` },
    });
    expect(bearer(request)).toBe(compact);
  });

  it.each([
    ['empty', ''],
    ['scheme-only', 'Bearer'],
    ['empty-token', 'Bearer '],
    ['wrong-scheme', `Basic ${compact}`],
    ['combined-credentials', `Bearer ${compact}, Basic value`],
    ['line-break', `Bearer ${compact}\r\nOther: value`],
    ['too-few-segments', 'Bearer one.two'],
    ['too-many-segments', 'Bearer one.two.three.four'],
    ['padding', 'Bearer one=.two.three'],
  ])('rejects malformed authorization without echoing it: %s', (_case, authorization) => {
    const request = {
      method: 'GET',
      url: 'https://example.test/',
      path: '/',
      headers: [] as const,
      header: () => authorization,
      text: () => Promise.resolve('') as never,
      json: () => Promise.resolve({}) as never,
    };
    let caught: unknown;
    try {
      bearer(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JwtError);
    expect(caught).toMatchObject({ code: 'PULSE_JWT_BEARER_INVALID' });
    expect(JSON.stringify(caught)).not.toContain(compact);
  });

  it('rejects an accessor-backed Pulse request without invoking it', () => {
    let accessorCalls = 0;
    const request: Record<string, unknown> = {};
    Object.defineProperty(request, 'header', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return () => `Bearer ${compact}`;
      },
    });
    expect(() => bearer(request as never))
      .toThrowError(expect.objectContaining({ code: 'PULSE_JWT_BEARER_INVALID' }));
    expect(accessorCalls).toBe(0);
  });
});
