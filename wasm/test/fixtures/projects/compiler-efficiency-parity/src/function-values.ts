import { Pulse } from '@pulse-compute/pulse'
import { shared, alias, distinct } from './helper-values'

const app = new Pulse({ auto: true })
app.get('/functions', async (ctx) => {
  return ctx.text((shared === alias) + ':' + (shared === distinct) + ':' + shared() + ':' + alias() + ':' + distinct())
})

export default app
