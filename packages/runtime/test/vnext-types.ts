import { Router, type Handler, type PulseContext, type PulseEventHandler, type PulseRouteContext } from '../src/index.js'

const plain: Handler = async (ctx: PulseContext) => {
  ctx.log.debug('reading request body')
  const body = await ctx.req.text()
  ctx.state.set('body', body)
  const token = await ctx.secret.get('TOKEN')
  ctx.log.info('request body processed')
  return ctx.json({ body: ctx.state.get('body'), token })
}
void plain

const app = new Router()
app.use(async (ctx, next) => {
  ctx.state.set('request-id', 'r1')
  return next()
})
app.get('/users/:id', async (ctx: PulseRouteContext) => {
  const user = await ctx.fetch(`/origin/users/${ctx.param('id')}`).json<{ id: string }>('app.User')
  return ctx.json({ user, requestId: ctx.state.get('request-id') })
})

const eventHandler: PulseEventHandler<{ readonly userId: string }> = async (ctx) => {
  ctx.log.info(ctx.event.type)
  ctx.state.set('user-id', ctx.event.payload.userId)
  await ctx.secret.get('TOKEN')
}
void eventHandler
