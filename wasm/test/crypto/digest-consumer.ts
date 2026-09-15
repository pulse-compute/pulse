import { Pulse } from '@pulse-compute/pulse'
import { crypto, digestText } from '@pulse-compute/crypto'

const app = new Pulse({ auto: true })
app.post('/digest', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const result = await crypto.digestText(ctx, input.text)
  return ctx.json(result)
})
app.post('/parallel', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const result = await ctx.parallel({
    first: crypto.digestText(ctx, input.text),
    empty: digestText(ctx, ''),
  })
  return ctx.json(result)
})
export default app
