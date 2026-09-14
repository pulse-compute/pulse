import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'
import type { Candidate } from './schemas.js'

const app = new Pulse({ auto: true })
app.get('/candidate', async (ctx) => {
  const stored = await s3.getText(ctx, 'objects', 'candidate.json')
  if (stored.status !== 'found') return ctx.text('object unavailable', { status: 502 })
  const candidate = ctx.decodeJson<Candidate>(stored.text, 'app.Candidate')
  const copied = await s3.putText(ctx, 'objects', 'copy.json', stored.text)
  if (copied.status !== 'stored') return ctx.text('copy failed', { status: 502 })
  return ctx.json({ title: candidate.title, text: stored.text, sha256: stored.sha256, copiedSha256: copied.sha256 }, { schema: 'app.Verified' })
})
export default app
