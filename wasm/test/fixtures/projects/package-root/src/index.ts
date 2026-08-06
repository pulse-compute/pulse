import { Router } from '@pulse-compute/runtime'
import { assets } from '@pulse-compute/assets'

const app = new Router()

app.get('/asset', async (ctx) => {
  const found = await assets.lookup(ctx, 'public', '/app.js', { method: 'GET' })
  return assets.respond(found)
})

app.get('/parallel', async (ctx) => {
  const { first, second } = await ctx.parallel({
    first: assets.lookup(ctx, 'public', '/first.js'),
    second: assets.lookup(ctx, 'public', '/second.js'),
  })
  return first
})

export default app
