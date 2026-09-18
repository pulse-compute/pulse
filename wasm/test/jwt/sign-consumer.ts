import { Pulse } from '@pulse-compute/pulse'
import { jwt, sign, type JwtClaims } from '@pulse-compute/jwt'

const app = new Pulse({ auto: true })
app.post('/sign', async ctx => {
  const claims = await ctx.req.json<JwtClaims>()
  const token = await jwt.sign(ctx, claims, {
    algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45,
  })
  ctx.log.info(token)
  return ctx.text(token)
})
app.get('/parallel', async ctx => {
  const result = await ctx.parallel({
    first: jwt.sign(ctx, { sub: 'first' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 1 }),
    second: sign(ctx, { sub: 'second' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 300 }),
  })
  return ctx.json(result)
})
export default app
