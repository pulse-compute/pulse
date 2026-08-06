import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.text('ok'))

export default app
