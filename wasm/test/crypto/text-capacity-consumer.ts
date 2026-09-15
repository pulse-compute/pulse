import { Pulse } from '@pulse-compute/pulse'
import { crypto } from '@pulse-compute/crypto'
import { s3 } from '@pulse-compute/s3'

const app = new Pulse({ auto: true })
app.post('/encoded', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const text = ctx.encodeJson(input, 'app.Text')
  const before = await crypto.digestText(ctx, text)
  const written = await s3.putText(ctx, 'objects', 'capacity', text)
  const read = await s3.getText(ctx, 'objects', 'capacity')
  if (read.status !== 'found') return ctx.json(read)
  const after = await crypto.digestText(ctx, read.text)
  return ctx.json({ before, written, after })
})
app.post('/response', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  return ctx.text(ctx.encodeJson(input, 'app.Text'))
})
app.post('/encode-over', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const text = ctx.encodeJson({ text: input.text + input.text }, 'app.Text')
  const written = await s3.putText(ctx, 'objects', 'capacity', text)
  return ctx.json(written)
})
app.post('/small', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const written = await s3.putText(ctx, 'small', 'capacity', input.text)
  return ctx.json(written)
})
app.get('/get', async ctx => {
  const read = await s3.getText(ctx, 'objects', 'capacity')
  if (read.status !== 'found') return ctx.json(read)
  const digest = await crypto.digestText(ctx, read.text)
  return ctx.json(digest)
})
app.get('/get-small', async ctx => {
  const read = await s3.getText(ctx, 'small', 'capacity')
  return ctx.json(read)
})
export default app
