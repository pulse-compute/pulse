import { Router } from '@pulse-compute/runtime'

interface User {
  id: number
  name: string
}

const users = new Router()
const api = new Router()
const app = new Router()

app.use(async (ctx, next) => {
  if (ctx.req.header('x-pulse-deny') === '1') {
    return ctx.json(
      { error: 'denied by middleware' },
      { status: 401 },
    )
  }
  return next()
})

api.use(async (ctx, next) => {
  if (ctx.req.header('x-api-state') === 'closed') {
    return ctx.text('api closed', { status: 503 })
  }
  return next()
})

users.get('/:id', async (ctx) => {
  const id = ctx.param('id')
  const user = await ctx
    .fetch('https://users.example.test/users/' + id)
    .json<User>()
  return ctx.json({ route: 'user', id, user })
})

api.get('/health', async (ctx, next) => {
  if (ctx.req.header('x-health-handler') === 'fallback') {
    return next()
  }
  return ctx.json({ ok: true, handler: 'primary' })
})
api.get('/health', async (ctx) => ctx.json({ ok: true, handler: 'fallback' }))
api.head('/health', async (ctx) => ctx.text('', {
  status: 204,
  headers: [['x-pulse-route', 'health']],
}))
api.post('/users', async (ctx) => ctx.json(
  { route: 'create', method: ctx.req.method },
  { status: 201 },
))
api.get('/files/*', async (ctx) => ctx.text(ctx.req.path))
api.get('/failure', async (ctx, next) => next('documented-failure'))

api.mount('/users', users)
app.mount('/api', api)

app.error(async (error, ctx, next) => {
  if (error === 'documented-failure') {
    return ctx.json({ error: 'handled' }, { status: 418 })
  }
  return next(error)
})

export default app
