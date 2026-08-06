import { grip } from '@pulse-compute/grip';

export default async function handler(ctx: any) {
  if (ctx.req.path === '/classify') {
    return ctx.json({ websocket: grip.isWebSocket(ctx.req) });
  }

  if (ctx.req.path === '/handoff-default') {
    return grip.handoff({
      channel: 'socket:default',
      body: 'DEFAULT',
    });
  }

  if (ctx.req.path === '/handoff-custom') {
    return grip.handoff({
      channel: 'socket:custom',
      status: 203,
      headers: [['Content-Type', 'application/custom-events']],
      body: 'CUSTOM',
    });
  }

  if (ctx.req.path === '/handoff-exact') {
    return grip.handoff({
      channel: 'socket:exact',
      body: '{"b":2, "a":1}\n',
    });
  }

  if (grip.isWebSocket(ctx.req)) {
    return grip.handoff({
      channels: ['socket:primary', 'socket:audit'],
      mode: 'stream',
      timeoutMs: 0,
      status: 201,
      headers: [['X-Handoff', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']],
      body: 'OPEN',
    });
  }

  if (ctx.req.path === '/subscribe-single') {
    const source = ctx.text('source-body', {
      status: 206,
      headers: [['X-Source', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']],
    });
    return grip.subscribe(source, {
      channel: 'single',
      mode: 'stream',
      timeoutMs: 0,
    });
  }

  if (ctx.req.path === '/subscribe-stream') {
    return grip.subscribe(ctx.text('chunk-onechunk-two', { status: 207 }), {
      channel: 'stream',
    });
  }

  if (ctx.req.path === '/subscribe-replace') {
    const prior = ctx.text('replace', {
      headers: [['Grip-Hold', 'stream'], ['Grip-Channel', 'old'], ['Grip-Timeout', '10']],
    });
    return grip.subscribe(prior, {
      channels: ['new-one', 'new-two'],
      mode: 'response',
    });
  }

  if (ctx.req.path === '/broadcast-direct') {
    const acknowledgement = await grip.broadcast(ctx, {
      channel: 'direct',
      data: { value: 1 },
    });
    return ctx.json({ acknowledgement }, { status: 202 });
  }

  const grouped = await ctx.parallel({
    publish: grip.broadcast(ctx, {
      channel: 'updates',
      data: { value: 1 },
      event: 'changed',
      id: 'message-1',
    }),
    mode: ctx.config.get('MODE'),
  });
  const response = ctx.json({ grouped }, {
    status: 202,
    headers: [['X-Source', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']],
  });
  return grip.subscribe(response, {
    channels: ['updates', 'audit'],
    mode: 'response',
    timeoutMs: 5000,
  });
}
