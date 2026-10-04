import { Router } from '@pulse-compute/runtime'

const app = new Router()
const collection = new Router()
const history = new Router()
const nested = new Router()
const empty = new Router()

app.use(async (ctx, next) => {
  ctx.state.set('trace', '')
  ctx.state.set('family', ctx.req.header('x-family') || '')
  if (ctx.req.header('x-mode') === 'preerror') return next({ code: 'EARLY', message: 'early' })
  return next()
})
app.get('/api/items', async (ctx, next) => { ctx.state.set('family', 'collection'); return next() })
app.get('/api/requests', async (ctx, next) => { ctx.state.set('family', 'collection'); return next() })
app.get('/api/hosting', async (ctx, next) => { ctx.state.set('family', 'collection'); return next() })
app.get('/api/items/:id/history', async (ctx, next) => { ctx.state.set('family', 'history'); return next() })
app.get('/api/items/:id', async (ctx, next) => { ctx.state.set('family', 'entity'); return next() })
app.post('/api/requests', async (ctx, next) => next())

collection.use(async (ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'collection.enter>')
  return next()
})
collection.use(async (ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'collection.effect>')
  ctx.state.set('family', 'changed')
  const value = await ctx.fetch('https://effects.test/collection').text()
  ctx.state.set('value', value)
  return next()
})
collection.use(async (ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'collection.finish>')
  if (ctx.req.header('x-mode') === 'terminal') return ctx.text(ctx.state.get('trace') + ctx.state.get('value'))
  if (ctx.req.header('x-mode') === 'error') return next({ code: 'REFUSED', message: 'refused' })
  return next()
})
collection.error(async (error, ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'collection.error>')
  if (ctx.req.header('x-local') === '1') return ctx.text(ctx.state.get('trace') + error.code, { status: 409 })
  return next(error)
})
history.use(async (ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'history.enter>')
  return next()
})
history.use(async (ctx, next) => {
  const value = await ctx.fetch('https://effects.test/history').text()
  ctx.state.set('value', value)
  ctx.state.set('trace', ctx.state.get('trace') + 'history.effect>')
  return next()
})
nested.get('/:id/history', async (ctx, next) => {
  ctx.state.set('trace', ctx.state.get('trace') + 'id=' + ctx.param('id') + '>')
  return next()
})
history.mount('/items', nested, { state: 'family', equals: 'history' })
app.mount('/api', collection, { state: 'family', equals: 'collection' })
app.mount('/api', history, { state: 'family', equals: 'history' })
app.mount('/api', empty, { state: 'family', equals: 'entity' })
app.use(async (ctx, next) => ctx.text(ctx.state.get('trace') + 'tail>' + (ctx.state.get('value') || '') + '|' + ctx.req.method + '|' + ctx.req.path))
app.error(async (error, ctx, next) => ctx.text(ctx.state.get('trace') + 'parent.error>' + error.code, { status: 409 }))
export default app
