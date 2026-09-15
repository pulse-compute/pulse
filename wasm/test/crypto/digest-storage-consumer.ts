import { Pulse } from '@pulse-compute/pulse'
import { crypto } from '@pulse-compute/crypto'
import { s3 } from '@pulse-compute/s3'

const app = new Pulse({ auto: true })
app.post('/flow', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const before = await crypto.digestText(ctx, input.text)
  if (before.status === 'failed') return ctx.json(before)
  const written = await s3.putText(ctx, 'objects', 'digest-proof', input.text)
  const downloaded = await s3.getText(ctx, 'objects', 'digest-proof')
  if (downloaded.status !== 'found') return ctx.json(downloaded)
  const after = await crypto.digestText(ctx, downloaded.text)
  return ctx.json({ before, written, downloaded, after })
})
app.post('/encoded', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const text = ctx.encodeJson(input, 'app.Resource')
  const before = await crypto.digestText(ctx, text)
  if (before.status === 'failed') return ctx.json(before)
  const written = await s3.putText(ctx, 'objects', 'digest-proof', text)
  const downloaded = await s3.getText(ctx, 'objects', 'digest-proof')
  if (downloaded.status !== 'found') return ctx.json(downloaded)
  const after = await crypto.digestText(ctx, downloaded.text)
  return ctx.json({ before, written, downloaded, after })
})
export default app
