import { grip } from '@pulse-compute/grip'
import { Pulse } from '@pulse-compute/pulse'

interface User {
  id: number
  name: string
}

interface Session {
  userId: number
}

const app = new Pulse({ auto: true })

// Config, secret, and a named Fastly backend.
app.get('/users/7', async (ctx) => {
  const base = await ctx.config.get('API_BASE')
  const token = await ctx.secret.get('API_TOKEN')
  const user = await ctx
    .fetch('https://api.example.com/users/7', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-api-base': base,
      },
    })
    .json<User>()
  return ctx.json({ user })
})

// Named Fastly KV storage.
app.get('/session', async (ctx) => {
  const current = await ctx.kv<Session>('sessions').get('session:123')
  if (current === undefined) {
    return ctx.json({ error: 'not_found' }, { status: 404 })
  }
  await ctx.kv<Session>('sessions').put('session:last', current)
  return ctx.json({ session: current })
})

// Request-bound GRIP broadcast through the supported package root.
app.post('/publish', async (ctx) => {
  const acknowledgement = await grip.broadcast(ctx, {
    channel: 'events:demo',
    event: 'pulse.message',
    id: 'message-1',
    data: { message: 'hello from Pulse' },
  })
  return ctx.json(
    { accepted: acknowledgement.accepted },
    { status: 202 },
  )
})

export default app
