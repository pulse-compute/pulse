import type { PulseContext, PulseResult } from '@pulse-compute/runtime';
import { grip } from '@pulse-compute/grip/pulsewasm';
import type { RealityInput, RealityOriginUser, RealityOutput } from './schemas';

export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  if (ctx.req.path === '/structured') {
    const input = await ctx.req.json<RealityInput>('reality.Input');
    const apiBase = await ctx.config.get('API_BASE');
    const token = await ctx.secret.get('API_TOKEN');
    await ctx.kv<string>('state').put('last-name', input.name);
    const stored = await ctx.kv<string>('state').get('last-name');
    const origin = await ctx.fetch(`${apiBase}/origin/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-pulse-request': input.name
      }
    }).json<RealityOriginUser>('reality.OriginUser');
    const output: RealityOutput = {
      id: origin.id,
      name: input.name,
      active: input.active,
      stored,
      authSeen: origin.authSeen
    };
    return ctx.json(output, {
      status: 201,
      schema: 'reality.Output',
      headers: [
        ['x-pulse-runtime', 'fastly-compute'],
        ['x-pulse-repeat', 'one'],
        ['x-pulse-repeat', 'two']
      ]
    });
  }

  if (ctx.req.path === '/kv-read') {
    const stored = await ctx.kv<string>('state').get('last-name');
    return ctx.json({ stored }, { schema: 'reality.Stored' });
  }

  if (ctx.req.path === '/opaque') {
    const apiBase = await ctx.config.get('API_BASE');
    return ctx.fetch(`${apiBase}/binary`);
  }

  if (ctx.req.path === '/grip/hold') {
    await grip.channel('events:fastly-compute', { fanout: true });
    return grip.hold('stream', {
      channels: ['events:extra'],
      timeoutMs: 30000
    });
  }

  if (ctx.req.path === '/grip/publish') {
    return grip.publish('events:fastly-compute', 'hello from compiled Pulse', {
      event: 'pulse.message',
      id: 'reality-1'
    });
  }

  return ctx.text('not found', { status: 404 });
}
