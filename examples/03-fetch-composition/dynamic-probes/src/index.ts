import { Pulse } from '@pulse-compute/pulse'

import type { ProbeInput, ProbeResult } from './schemas.js'
const app = new Pulse({ auto: true })
app.use(async (ctx, next) => {
  ctx.state.set('probe-admitted', 'yes')
  return next()
})
app.post('/probe', async ctx => {
  const input = await ctx.req.json<ProbeInput>('probe.Input')
  const effects = ctx.effects<ProbeResult>({ max: 32 })
  for (const endpoint of input.endpoints) {
    effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
  }
  const results = await ctx.parallel(effects)
  return ctx.json({ results }, { schema: 'probe.Output' })
})
app.error(async (error, ctx, next) => ctx.text('invalid probe data', { status: 422 }))
export default app
