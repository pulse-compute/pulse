import { Router } from '@pulse-compute/runtime'

const child = new Router()
const app = new Router()

app.use(async (ctx, next) => {
  ctx.state.set('request-id', ctx.req.header('x-request-id') || 'missing')
  const stateMarker = ctx.req.header('x-state-marker')
  if (stateMarker !== undefined) ctx.state.set('state-marker', stateMarker)
  return next()
})

app.use('/api', async (ctx, next) => {
  if (ctx.req.header('x-area') !== 'api') return ctx.text('area denied', { status: 403 })
  ctx.state.set('scope', 'api')
  return next()
})

child.use(async (ctx, next) => {
  if (ctx.req.header('x-child') !== 'ready') return ctx.text('child denied', { status: 409 })
  return next()
})

child.get('/items/:id', async (ctx, next) => {
  if (ctx.req.header('x-owner') !== 'primary') return next()
  return ctx.json({
    handler: 'primary',
    id: ctx.param('id'),
    scope: ctx.state.get('scope'),
    requestId: ctx.state.get('request-id'),
    stateMarker: ctx.state.get('state-marker') || 'missing',
    method: ctx.req.method,
    url: ctx.req.url,
    path: ctx.req.path,
  })
})

child.get('/items/:id', async (ctx) => {
  return ctx.json({
    handler: 'fallback',
    id: ctx.param('id'),
    scope: ctx.state.get('scope'),
    requestId: ctx.state.get('request-id'),
    stateMarker: ctx.state.get('state-marker') || 'missing',
  })
})

child.post('/echo/:id', async (ctx) => {
  const body = await ctx.req.text()
  return ctx.json({
    id: ctx.param('id'),
    body,
    firstRepeat: ctx.req.header('x-repeat'),
    headers: ctx.req.headers,
  }, {
    status: 201,
    headers: [
      ['set-cookie', 'a=1; Path=/'],
      ['set-cookie', 'b=2; Path=/'],
      ['x-repeat', 'one'],
      ['x-repeat', 'two'],
    ],
  })
})

child.head('/head', async (ctx) => {
  return ctx.text('hidden', { headers: [['x-head', 'yes']] })
})

child.get('/empty', async (ctx) => {
  return ctx.response({ status: 204, headers: [['x-empty', 'yes']], body: 'hidden' })
})

child.get('/custom', async (ctx) => {
  return ctx.response({
    status: 202,
    headers: [['x-custom', 'one'], ['x-custom', 'two']],
    body: 'custom',
  })
})

child.get('/handled-error', async (ctx, next) => {
  return next({ code: 'E_HANDLED', message: 'boom' })
})

child.get('/unhandled-error', async (ctx, next) => {
  return next({ code: 'E_UNHANDLED', message: 'unhandled' })
})

app.mount('/api', child)

app.error(async (error, ctx, next) => {
  if (error.code === 'E_HANDLED') {
    return ctx.json({
      handled: error.message,
      scope: ctx.state.get('scope'),
      requestId: ctx.state.get('request-id'),
      path: ctx.req.path,
    }, { status: 418 })
  }
  return next(error)
})

app.error(async (error, ctx, next) => {
  return next(error)
})

export default app
