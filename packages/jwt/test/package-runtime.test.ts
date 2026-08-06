import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { verify } from '../src/index.js';

const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any };
const runtime = require('../../runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>;
};

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

describe('@pulse-compute/jwt package effect', () => {
  it('dispatches the bounded public operation while observations redact its payload', async () => {
    const token = `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url('{"sub":"account-1"}')}.c2ln`;
    const descriptors: any[] = [];
    const observations: any[] = [];
    const app = new Router();
    app.get('/', async (ctx: any) => {
      const result = await verify(ctx, token, {
        algorithms: ['HS256'],
        key: {
          type: 'secret',
          binding: 'JWT_TEST_SECRET',
        },
      });
      return ctx.json(result);
    });

    const response = await runtime.executeRouter(
      app,
      new Request('https://example.test/'),
      {
        capabilities: {
          effect: async (descriptor: any) => {
            descriptors.push(descriptor);
            return {
              claims: { sub: 'account-1' },
              protectedHeader: { alg: 'HS256', typ: 'JWT' },
            };
          },
        },
        onEffectObservation: (observation: unknown) => observations.push(observation),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claims: { sub: 'account-1' },
      protectedHeader: { alg: 'HS256', typ: 'JWT' },
    });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      package: '@pulse-compute/jwt',
      contractId: 'pulse.jwt',
      kind: 'jwt.verify',
      providerKind: 'jwt',
      operation: 'verify',
      capability: 'jwt.verify',
      result: 'jwt-verification',
      payload: {
        token,
        options: {
          algorithms: ['HS256'],
          key: { type: 'secret' },
        },
      },
    });
    expect(Object.isFrozen(descriptors[0].payload)).toBe(true);
    expect(JSON.stringify(observations)).not.toContain(token);
    expect(JSON.stringify(observations)).not.toContain('account-1');
  });
});
