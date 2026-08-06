import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.json({ ok: true }))
app.get('/hello', async (ctx) => ctx.json({ message: 'hello from Pulse' }))
app.get('/*', async (ctx) => ctx.text('not found', { status: 404 }))

export default app
