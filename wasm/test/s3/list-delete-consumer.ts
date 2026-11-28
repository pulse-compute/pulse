import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'
const app = new Pulse({ auto: true })
app.post('/list', async ctx => {
  const input = await ctx.req.json<{ prefix: string; continuationToken: string; maxKeys: number }>()
  const result = await s3.list(ctx, 'objects', input)
  return ctx.json(result)
})
app.post('/default', async ctx => {
  const result = await s3.list(ctx, 'objects')
  return ctx.json(result)
})
app.post('/delete', async ctx => {
  const input = await ctx.req.json<{ key: string }>()
  const result = await s3.delete(ctx, 'objects', input.key)
  return ctx.json(result)
})
app.post('/parallel', async ctx => {
  const result = await ctx.parallel({ page: s3.list(ctx, 'objects'), removed: s3.delete(ctx, 'objects', 'gone') })
  return ctx.json(result)
})
export default app
