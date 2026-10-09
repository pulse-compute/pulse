import { Router } from '@pulse-compute/runtime';

const app = new Router();
const shared = async (ctx, next) => {
  const value = await ctx.fetch('https://fixture.test/value').text();
  ctx.state.set('visits', (ctx.state.get('visits') || '') + value);
  return next();
};
const duplicate = async ctx => ctx.text(ctx.state.get('visits') || 'duplicate');

app.use('/duplicate', shared);
app.use('/duplicate', shared);
app.get('/ordinary', async ctx => ctx.text('ordinary'));
app.get('/next', async (ctx, next) => {
  if (ctx.req.header('x-stop') === 'yes') return ctx.text('stopped');
  return next();
});
app.get('/next', async ctx => ctx.text('fallback'));
app.get('/error', async (ctx, next) => next({ code: 'FIXTURE', message: 'recover' }));
app.get('/duplicate/a', duplicate);
app.get('/duplicate/b', duplicate);
app.error(async (error, ctx, next) => ctx.text(error.code, { status: 418 }));
export default app;
