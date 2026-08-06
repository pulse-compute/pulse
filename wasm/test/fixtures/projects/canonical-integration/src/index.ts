import { Pulse } from '@pulse-compute/pulse'
import { Router } from '@pulse-compute/runtime'

const api = new Router()

api.get('/health', async (ctx) => {
  const version = await ctx.config.get('APP_VERSION')

  return ctx.json({
    ok: true,
    requestId: ctx.state.get('requestId'),
    version,
  })
})

const app = new Pulse({ auto: true })

app.use(async (ctx, next) => {
  const requestId = await ctx.req.header('x-request-id')
  ctx.state.set('requestId', requestId || 'missing')

  return next()
})

app.mount('/api', api)

export default app
