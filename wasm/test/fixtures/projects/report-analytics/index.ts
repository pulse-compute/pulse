import { Pulse } from '@pulse-compute/pulse';
import { Router } from '@pulse-compute/runtime';
import { sharedLookup, packageHandler } from '@fixture/analytics';

const app = new Pulse({ auto: true });
const child = new Router();

const rootMiddleware = async (ctx, next) => {
  const value = await ctx.config.get('ROOT');
  ctx.state.set('root', value || '');
  if (ctx.req.header('x-stop') === 'yes') return ctx.text('stopped', { status: 403 });
  return next();
};
const scopedMiddleware = async (ctx, next) => {
  const value = await ctx.config.get('SCOPED');
  ctx.state.set('scoped', value || '');
  return next();
};
const reused = async ctx => {
  const first = await ctx.config.get('REGION');
  const again = await ctx.config.get('REGION');
  const other = await ctx.config.get('OTHER');
  return ctx.text(first + again + other);
};

app.use(rootMiddleware);
child.use('/scoped', scopedMiddleware);
child.get('/scoped', async ctx => ctx.text(ctx.state.get('scoped') || 'missing'));
child.get('/plain', async ctx => ctx.text('plain'));
app.mount('/api', child);
app.mount('/v2', child);
app.get('/direct-a', reused);
app.get('/direct-b', reused);
app.get('/helper-a', async ctx => {
  const value = await sharedLookup(ctx, 'a');
  return ctx.text(value);
});
app.get('/helper-b', async ctx => {
  const value = await sharedLookup(ctx, 'b');
  return ctx.text(value);
});
app.get('/package', packageHandler);
app.get('/dynamic', async ctx => {
  const name = ctx.req.header('x-config') || 'REGION';
  const value = await ctx.config.get(name);
  return ctx.text(value || '');
});
app.get('/error', async (ctx, next) => next({ code: 'AN9', message: 'recover' }));
app.error(async (error, ctx, next) => {
  const value = await ctx.config.get('RECOVERY');
  return ctx.text(error.code + ':' + value, { status: 418 });
});
app.on('analytics.tick', { schema: null }, async ctx => {
  const value = await ctx.config.get('EVENT');
  ctx.state.set('event', value || '');
});
export default app;
