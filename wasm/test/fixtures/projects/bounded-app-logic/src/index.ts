import { Pulse } from '@pulse-compute/pulse'
import handler from './handler'

const app = new Pulse({ auto: true })
app.post('/', handler)
export default app
