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
app.get('/five-minutes-plus', async ctx => {
  const token = await jwt.sign(ctx, { sub: 'lifetime' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 301 })
  return ctx.text(token)
})
app.get('/one-hour', async ctx => {
  const token = await jwt.sign(ctx, { sub: 'lifetime' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 3600 })
  return ctx.text(token)
})
app.get('/one-day', async ctx => {
  const token = await jwt.sign(ctx, { sub: 'lifetime' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 86400 })
  return ctx.text(token)
})
app.get('/date-limit', async ctx => {
  const token = await jwt.sign(ctx, { sub: 'lifetime' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 8638200000000 })
  return ctx.text(token)
})
app.get('/date-overflow', async ctx => {
  const token = await jwt.sign(ctx, { sub: 'lifetime' }, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 8638200000001 })
  return ctx.text(token)
})
export default app
