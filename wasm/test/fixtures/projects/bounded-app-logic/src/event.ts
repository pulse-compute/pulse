import { Pulse } from '@pulse-compute/pulse'
const app = new Pulse({ auto: true })
app.on('values.inspect', { schema: null }, async (ctx) => {
  let total = 0
  for (let i = 0; i < 8; i++) total += i
  ctx.log.info('total:' + total)
})
export default app
