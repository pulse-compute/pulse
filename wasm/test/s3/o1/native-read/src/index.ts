import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'
import { crypto } from '@pulse-compute/crypto'

const app = new Pulse({ auto: true })
// The request body is already a Pulse string. It carries the runtime key;
// this consumer is not an HTTP-wire-byte fidelity test.
app.post('/head', async (ctx) => {
  const key = await ctx.req.text()
  const result = await s3.head(ctx, 'objects', key)
  return ctx.json(result)
})
app.post('/get', async (ctx) => {
  const key = await ctx.req.text()
  const result = await s3.getText(ctx, 'objects', key)
  if (result.status !== 'found' || result.byteLength < 0) return ctx.json(result)
  const hash = await crypto.digestText(ctx, result.text)
  if (hash.status !== 'ok' || hash.sha256 !== result.sha256) return ctx.text('digest failed', {status: 500})
  ctx.state.set('object-text', result.text)
  return ctx.json({...result, text: ctx.state.get('object-text')})
})
app.post('/parallel', async (ctx) => {
  const key = await ctx.req.text()
  const result = await ctx.parallel({
    metadata: s3.head(ctx, 'objects', key),
    object: s3.getText(ctx, 'objects', key),
  })
  return ctx.json(result)
})
export default app
