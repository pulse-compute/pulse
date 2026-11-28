import { Pulse, type Handler, type RouterMiddleware, type RouterErrorHandler } from '@pulse-compute/pulse';
import { assets, lookup, respond, createAssets, AssetBucket } from '@pulse-compute/assets';
import { s3 } from '@pulse-compute/s3';
import { grip } from '@pulse-compute/grip';

// Consumer source: no assertions or suppression on supported return values.
const app = new Pulse({ auto: true });
app.get('/asset', async ctx => {
  const found = await assets.lookup(ctx, 'static', '/index.html');
  return assets.respond(found);
});
app.head('/asset', async ctx => {
  const found = await lookup(ctx, 'static', '/index.html', { method: 'HEAD' });
  return respond(found);
});
app.get('/direct', async ctx => await assets.lookup(ctx, 'static', '/index.html'));
app.get('/parallel', async ctx => {
  const result = await ctx.parallel({ asset: assets.lookup(ctx, 'static', '/index.html') });
  return assets.respond(result.asset, { headers: { 'x-fixture': 'yes' } });
});
app.get('/body', async ctx => await s3.getBody(ctx, 'objects', 'image'));
app.get('/subscribe', async ctx => {
  const found = await assets.lookup(ctx, 'static', '/index.html');
  return grip.subscribe(found, { channel: 'updates' });
});
app.get('/handoff', async () => grip.handoff({ channel: 'updates', body: 'ready' }));
app.use('/static', createAssets({ mode: 'hosted', origin: 'https://assets.example.test' }));
app.use('/bucket', new AssetBucket({ endpoint: 'https://objects.example.test', bucket: 'public', credentials: { key: 'fixture', secret: 'fixture' } }));
const handler: Handler = async ctx => assets.respond(await assets.lookup(ctx, 'static', '/index.html'));
const middleware: RouterMiddleware = async ctx => await s3.getBody(ctx, 'objects', 'image');
const errorHandler: RouterErrorHandler = async () => grip.handoff({ channel: 'errors' });
app.use(middleware);
app.error(errorHandler);
void handler;

// These existing neighboring contracts must continue to type-check.
app.get('/delete', async ctx => await ctx.fetch('https://origin.example.test', { method: 'DELETE' }));
app.get('/options', async ctx => await ctx.fetch('https://origin.example.test', { method: 'OPTIONS' }));
app.get('/text', async ctx => ctx.text('ok'));
app.get('/json', async ctx => ctx.json({ ok: true }));
const webResponse: Response = grip.handoff({ channel: 'updates' });
void webResponse.headers;
void webResponse.status;

// Package result typing must not turn raw values, effects or acknowledgements
// into HTTP replies. Native eligibility is checked separately by the compiler.
// @ts-expect-error A raw Web Response has not been adopted by a package facade.
app.get('/raw', async () => new Response('raw'));
// @ts-expect-error Package metadata is not an HTTP response.
app.get('/metadata', async ctx => await s3.head(ctx, 'objects', 'image'));
// @ts-expect-error A GRIP acknowledgement is not an HTTP response.
app.get('/ack', async ctx => await grip.broadcast(ctx, { channel: 'updates', data: 'hello' }));
// @ts-expect-error Package declarations do not add arbitrary fetch verbs.
app.get('/trace', async ctx => await ctx.fetch('https://origin.example.test', { method: 'TRACE' }));
// @ts-expect-error A synchronous handler is still outside the handler contract.
app.get('/sync', () => grip.handoff({ channel: 'updates' }));
// @ts-expect-error Package response typing must not accept a raw middleware reply.
app.use(async () => new Response('raw'));
// @ts-expect-error Error handlers retain the same response restriction.
app.error(async () => new Response('raw'));
