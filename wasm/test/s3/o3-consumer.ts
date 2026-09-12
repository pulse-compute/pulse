import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'

const app = new Pulse({ auto: true })
app.post('/put', async (ctx) => {
  const input = await ctx.req.json<{ key: string; text: string }>()
  const result = await s3.putText(ctx, 'objects', input.key, input.text)
  return ctx.json(result)
})
app.post('/flow', async (ctx) => {
  const input = await ctx.req.json<{ key: string; text: string }>()
  const written = await s3.putText(ctx, 'objects', input.key, input.text, { contentType: 'application/json;  charset=utf-8' })
  const inspected = await ctx.parallel({
    metadata: s3.head(ctx, 'objects', input.key),
    object: s3.getText(ctx, 'objects', input.key),
  })
  return ctx.json({ written, inspected })
})
app.post('/parallel', async (ctx) => {
  const input = await ctx.req.json<{ key: string; text: string }>()
  const result = await ctx.parallel({
    first: s3.putText(ctx, 'objects', input.key, input.text),
    second: s3.putText(ctx, 'objects', 'parallel-other', 'second'),
  })
  return ctx.json(result)
})
export default app
