import { Router } from '@pulse-compute/runtime';
import { grip } from '@pulse-compute/grip';

const app = new Router();

app.get('/events', async (ctx: any) => {
  if (grip.isWebSocket(ctx.req)) {
    return grip.handoff({
      channel: 'router:socket',
      status: 200,
      body: 'OPEN',
    });
  }
  return grip.subscribe(ctx.text('waiting', { status: 202 }), {
    channels: ['router:events', 'router:audit'],
    mode: 'stream',
  });
});

app.post('/events', async (ctx: any) => {
  const acknowledgement = await grip.broadcast(ctx, {
    channel: 'router:events',
    data: { source: 'router' },
  });
  return ctx.json({ acknowledgement }, { status: 202 });
});

export default app;
