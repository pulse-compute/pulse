import { Pulse } from '@pulse-compute/pulse'

// Intentionally failing consumer fixture for the catalog's existing HTTP verbs.
// This is not the application entrypoint and is not a deployment artifact.
const app = new Pulse({ auto: true })
app.put('/api/v1/resources/:resourceId/visibility', async (ctx) => ctx.json({ ok: true }))
app.patch('/api/v1/resources/:resourceId', async (ctx) => ctx.json({ ok: true }))
app.delete('/api/v1/resources/:resourceId', async (ctx) => ctx.json({ ok: true }))
export default app
