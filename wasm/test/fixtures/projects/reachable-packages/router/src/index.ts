import { Pulse } from '@pulse-compute/pulse'
import { holdEvents, publishEvent } from './routes/events.js'
import type { EventLabel } from './types/event.js'

const app = new Pulse({ auto: true })

app.get('/events', holdEvents)
app.post('/publish', publishEvent)
app.get('/label', async (ctx) => {
  const label: EventLabel = 'reachable-package'
  return ctx.text(label)
})

export default app
