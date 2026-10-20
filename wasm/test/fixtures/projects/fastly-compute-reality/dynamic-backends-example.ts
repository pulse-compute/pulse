import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/compare', async (ctx) => {
  const firstUrl = ctx.req.header('x-first-url')
  const secondUrl = ctx.req.header('x-second-url')
  if (!firstUrl || !secondUrl) {
    return ctx.text('Two complete origin URLs are required', { status: 400 })
  }
  const { first, second } = await ctx.parallel({
    first: ctx.fetch(firstUrl).text(),
    second: ctx.fetch(secondUrl).text(),
  })
  return ctx.json({ first, second })
})

export default app
