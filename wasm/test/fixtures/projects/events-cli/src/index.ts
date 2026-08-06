import { Pulse } from '@pulse-compute/pulse'
import { health, onInput } from './handlers.js'

const app = new Pulse({ auto: true })

app.get('/health', health)
app.on('input.received', { schema: 'events.Input' }, onInput)

export default app
