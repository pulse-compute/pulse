import { Pulse } from '@pulse-compute/pulse';

const app = new Pulse({ auto: true });
app.post('/', async ctx => {
  return ctx.fetch('https://origin.example/upload', {
    method: 'POST',
    body: ctx.req.body(),
    timeoutMs: 1500,
    headers: { 'content-type': 'application/octet-stream' }
  });
});
export default app;
