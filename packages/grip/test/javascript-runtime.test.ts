import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { grip } from '@pulse-compute/grip';

const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any };
const runtime = require('../../runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>;
};

describe('@pulse-compute/grip stateless JavaScript runtime', () => {
  it('classifies websocket intent without creating a socket', () => {
    expect(grip.isWebSocket(new Request('https://example.test/events', {
      headers: { upgrade: 'websocket', connection: 'keep-alive, Upgrade' },
    }))).toBe(true);
    expect(grip.isWebSocket(new Request('https://example.test/events', {
      headers: { accept: 'application/websocket-events' },
    }))).toBe(true);
    expect(grip.isWebSocket(new Request('https://example.test/events'))).toBe(false);
  });

  it('decorates and hands off ordinary HTTP responses', async () => {
    const source = new Response('hello', { status: 202, headers: { 'x-source': 'yes' } });
    const subscribed = grip.subscribe(source, { channels: ['one', 'two'], mode: 'stream', timeoutMs: 5000 });
    expect(subscribed.status).toBe(202);
    expect(subscribed.headers.get('x-source')).toBe('yes');
    expect(subscribed.headers.get('grip-hold')).toBe('stream');
    expect(subscribed.headers.get('grip-channel')).toContain('one');
    expect(subscribed.headers.get('grip-channel')).toContain('two');
    expect(subscribed.headers.get('grip-timeout')).toBe('5000');
    expect(await subscribed.text()).toBe('hello');

    const handoff = grip.handoff({ channel: 'socket:1', body: 'OPEN' });
    expect(handoff.status).toBe(200);
    expect(handoff.headers.get('content-type')).toContain('application/websocket-events');
    expect(handoff.headers.get('grip-hold')).toBe('stream');
    expect(handoff.headers.get('grip-channel')).toBe('socket:1');
    expect(await handoff.text()).toBe('OPEN');
  });

  it('dispatches broadcast through direct await and keyed parallel', async () => {
    const app = new Router();
    const effects: any[] = [];
    app.post('/broadcast', async (ctx: any) => {
      const direct = await grip.broadcast(ctx, { channel: 'updates', data: { value: 1 } });
      const grouped = await ctx.parallel({
        publish: grip.broadcast(ctx, { channel: 'audit', data: { value: 2 }, event: 'changed' }),
        mode: ctx.config.get('MODE'),
      });
      return ctx.json({ direct, grouped });
    });
    const response = await runtime.executeRouter(app, new Request('https://example.test/broadcast', { method: 'POST' }), {
      capabilities: {
        config: async () => 'test',
        effect: async (effect: any) => {
          effects.push(effect);
          return Object.freeze({ accepted: true, messageId: `${effect.payload.channel}:id` });
        },
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      direct: { accepted: true, messageId: 'updates:id' },
      grouped: {
        publish: { accepted: true, messageId: 'audit:id' },
        mode: 'test',
      },
    });
    expect(effects.map((entry) => entry.kind)).toEqual(['grip.broadcast', 'grip.broadcast']);
    expect(effects.every((entry) => Object.isFrozen(entry.payload))).toBe(true);
  });

  it('rejects invalid channels before dispatch', () => {
    expect(() => grip.subscribe(new Response(), { channel: 'bad,channel' })).toThrow(/commas/);
    expect(() => grip.handoff({ channels: [] })).toThrow(/at least one channel/);
    expect(() => grip.broadcast({} as any, { channel: 'events' } as any)).toThrow(/data value/);
    expect(() => grip.broadcast({} as any, { channel: 'bad\r\nchannel', data: null })).toThrow(/line breaks/);
  });

  it('replaces prior subscription timeout framing instead of retaining stale state', () => {
    const source = new Response(null, {
      headers: {
        'Grip-Hold': 'stream',
        'Grip-Channel': 'old',
        'Grip-Timeout': '30000',
      },
    });
    const subscribed = grip.subscribe(source, { channel: 'new', mode: 'response' });
    expect(subscribed.headers.get('grip-hold')).toBe('response');
    expect(subscribed.headers.get('grip-channel')).toBe('new');
    expect(subscribed.headers.get('grip-timeout')).toBeNull();
  });
});
