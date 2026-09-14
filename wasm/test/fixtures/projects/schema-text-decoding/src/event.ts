import { Pulse } from '@pulse-compute/pulse'
import type { Candidate } from './schemas.js'

const app = new Pulse({ auto: true })
app.on('candidate.inspect', { schema: null }, async (ctx) => {
  const value = ctx.decodeJson<Candidate>('{"title":"event","score":1,"role":"author","detail":{"tags":[],"note":null}}', 'app.Candidate')
  ctx.log.info('title:' + value.title)
})
export default app
