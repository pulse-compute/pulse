import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'

const app = new Pulse({ auto: true })
app.post('/candidate', async (ctx) => {
  const input = await ctx.req.json<{ title: string }>('app.Input')
  const text = ctx.encodeJson({ schemaVersion: 1, resourceId: 'resource-1', title: input.title }, 'app.Candidate')
  const result = await s3.putText(ctx, 'objects', 'candidate.json', text)
  if (result.status !== 'stored') return ctx.text('storage failed', { status: 502 })
  return ctx.json({ text, byteLength: result.byteLength, sha256: result.sha256 }, { schema: 'app.Stored' })
})
export default app
