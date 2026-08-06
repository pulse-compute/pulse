import { Pulse } from '@pulse-compute/pulse'
import { assets } from '@pulse-compute/assets'
import { grip } from '@pulse-compute/grip'
import type { CreateUserInput, OriginUser, UserResponse } from './schemas'

const app = new Pulse({ auto: true })

app.use(async (ctx, next) => {
  ctx.state.set('middleware', 'seen')
  return next()
})

app.post('/users/:id', async (ctx) => {
  const input = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const sessions = ctx.kv('sessions')
  const grouped = await ctx.parallel({
    mode: ctx.config.get('MODE'),
    token: ctx.secret.get('TOKEN'),
    session: sessions.get('session:1'),
    stored: sessions.put('session:last', { status: 'served', name: input.name }),
    user: ctx.fetch('https://api.example.test/user', {
      method: 'POST',
      headers: { accept: 'application/json' },
      json: { name: input.name },
      schema: 'app.OriginRequest',
    }).json<OriginUser>('app.OriginUser'),
    acknowledgement: grip.broadcast(ctx, {
      channel: 'users',
      data: { kind: 'updated' },
    }),
  })
  ctx.log.error(`error ${grouped.token}`)
  ctx.log.warn(`warn ${grouped.token}`)
  ctx.log.info(`served ${ctx.param('id')} ${grouped.token}`)
  ctx.log.debug(`debug ${grouped.token}`)
  const session = grouped.session as { id: string } | undefined
  const output: UserResponse = {
    id: ctx.param('id'),
    name: input.name,
    active: input.active,
    middleware: ctx.state.get('middleware') || 'missing',
    mode: grouped.mode || 'missing',
    sessionId: session ? session.id : 'missing',
    stored: grouped.stored,
    upstreamId: grouped.user.id,
    score: grouped.user.score,
    acknowledged: grouped.acknowledgement.accepted,
    authenticated: grouped.token ? true : false,
  }
  return ctx.json(output, { status: 201, schema: 'app.UserResponse' })
})

app.get('/assets/app.js', async (ctx) => {
  const found = await assets.lookup(ctx, 'public', 'app.js', {
    cacheControl: 'public, max-age=60',
  })
  return assets.respond(found)
})

app.head('/assets/app.js', async (ctx) => {
  const found = await assets.lookup(ctx, 'public', 'app.js', { method: 'HEAD' })
  return assets.respond(found)
})

app.get('/error', async (ctx, next) => {
  const token = await ctx.secret.get('TOKEN')
  ctx.log.error(`representative failure ${token}`)
  return next('representative failure')
})

app.get('/empty', async (ctx) => ctx.response({
  status: 204,
  headers: { 'x-pulse-empty': 'yes' },
}))

app.get('/schema', async (ctx) => ctx.json(
  { value: 'encoded' },
  { schema: 'app.Payload' },
))

app.error(async (error, ctx, next) => ctx.text('Internal Server Error', { status: 500 }))

export default app
